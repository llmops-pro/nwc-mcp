import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "../config.js";
import { decodeInvoice, type DecodedInvoice } from "../lib/bolt11.js";
import type { NwcClient } from "../nwc-client.js";
import type { Allowlist } from "../safety/allowlist.js";
import type { AuditLog } from "../safety/audit-log.js";
import type { BudgetTracker } from "../safety/budget-tracker.js";
import type { ConfirmStore } from "../safety/confirm.js";
import { errorResult, textResult } from "./_result.js";

export type PayInvoiceDeps = {
  config: Config;
  nwc: NwcClient;
  audit: AuditLog;
  budget: BudgetTracker;
  allowlist: Allowlist;
  confirm: ConfirmStore;
};

export type PayInvoiceParams = {
  invoice: string;
  amount_override_sats?: number;
};

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

const inputSchema = {
  invoice: z
    .string()
    .min(1)
    .describe("The bolt11 invoice to pay (lnbc...)."),
  amount_override_sats: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Amount in sats — required for amountless invoices; rejected if the invoice already encodes an amount.",
    ),
};

export type SafetyOutcome =
  | {
      kind: "ready";
      effective_amount_sats: number;
      destination: string | null;
      summary: string;
    }
  | {
      kind: "needs_confirm";
      effective_amount_sats: number;
      destination: string | null;
      summary: string;
    }
  | { kind: "blocked"; reason: string };

export async function evaluateSafety(
  ctx: {
    config: Config;
    budget: BudgetTracker;
    allowlist: Allowlist;
  },
  decoded: DecodedInvoice,
  amount_override_sats: number | undefined,
  opts: { skipConfirmGate?: boolean; destinationLabel?: string } = {},
): Promise<SafetyOutcome> {
  if (ctx.config.NWC_READ_ONLY) {
    return { kind: "blocked", reason: "NWC_READ_ONLY=true — spend tools are disabled" };
  }

  const invoiceAmt = decoded.amount_sats;
  let effective: number;
  if (invoiceAmt !== null && invoiceAmt > 0) {
    if (amount_override_sats !== undefined && amount_override_sats !== invoiceAmt) {
      return {
        kind: "blocked",
        reason: `amount_override_sats=${amount_override_sats} but invoice has fixed amount ${invoiceAmt} sats — refuse rather than guess`,
      };
    }
    effective = invoiceAmt;
  } else {
    if (amount_override_sats === undefined) {
      return {
        kind: "blocked",
        reason: "invoice is amountless; pass amount_override_sats to specify how much to send",
      };
    }
    effective = amount_override_sats;
  }

  // destinationLabel overrides the bolt11 payee for allowlist matching + summary —
  // used by callers like pay_lightning_address where the human-meaningful destination
  // is the LN address, not the underlying node pubkey.
  const destination = opts.destinationLabel ?? decoded.payee_pubkey;
  if (ctx.allowlist.enabled) {
    if (!destination) {
      return {
        kind: "blocked",
        reason: "NWC_ALLOWED_DESTINATIONS is set but the bolt11 invoice has no payee pubkey to match against",
      };
    }
    if (!ctx.allowlist.isAllowed(destination)) {
      return {
        kind: "blocked",
        reason: `destination ${destination} is not in NWC_ALLOWED_DESTINATIONS`,
      };
    }
  }

  const budgetCheck = await ctx.budget.check(effective);
  if (!budgetCheck.ok) {
    return { kind: "blocked", reason: budgetCheck.reason };
  }

  const summary = `pay ${effective} sats to ${destination ?? "unknown payee"}${
    decoded.description ? ` (memo: ${decoded.description})` : ""
  }`;

  if (ctx.config.NWC_REQUIRE_CONFIRM && !opts.skipConfirmGate) {
    return {
      kind: "needs_confirm",
      effective_amount_sats: effective,
      destination,
      summary,
    };
  }

  return {
    kind: "ready",
    effective_amount_sats: effective,
    destination,
    summary,
  };
}

async function executePayment(
  nwc: NwcClient,
  invoice: string,
  effective_amount_sats: number,
  invoice_has_amount: boolean,
): Promise<{ preimage: string; fees_paid_sats: number }> {
  // NIP-47 takes msats. Only pass `amount` for amountless invoices; passing it
  // when the invoice already encodes an amount is rejected by some wallets.
  const args: { invoice: string; amount?: number } = { invoice };
  if (!invoice_has_amount) args.amount = effective_amount_sats * 1000;
  const result = (await nwc.raw.payInvoice(args)) as {
    preimage: string;
    fees_paid?: number;
  };
  return {
    preimage: result.preimage,
    // Round msat fees UP to integer sats so the BudgetTracker over-records
    // rather than under-records sub-sat fees. Errs on the side of triggering
    // the daily cap slightly early instead of letting silent drift accumulate.
    fees_paid_sats: Math.ceil((result.fees_paid ?? 0) / 1000),
  };
}

export async function evaluateAndExecute(
  deps: PayInvoiceDeps,
  params: PayInvoiceParams,
  opts: {
    skipConfirmGate?: boolean;
    auditTool?: string;
    destinationLabel?: string;
    extraAuditInput?: Record<string, unknown>;
  } = {},
): Promise<ToolResult> {
  const auditTool = opts.auditTool ?? "nwc_pay_invoice";
  const inputForAudit = {
    invoice_prefix: params.invoice.slice(0, 24) + "...",
    amount_override_sats: params.amount_override_sats ?? null,
    ...(opts.extraAuditInput ?? {}),
  };

  let decoded: DecodedInvoice;
  try {
    decoded = decodeInvoice(params.invoice);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await deps.audit.record({
      tool: auditTool,
      outcome: "error",
      input: inputForAudit,
      error: `invoice decode failed: ${msg}`,
    });
    return errorResult(`invoice decode failed: ${msg}`);
  }

  const outcome = await evaluateSafety(
    { config: deps.config, budget: deps.budget, allowlist: deps.allowlist },
    decoded,
    params.amount_override_sats,
    {
      skipConfirmGate: opts.skipConfirmGate,
      destinationLabel: opts.destinationLabel,
    },
  );

  if (outcome.kind === "blocked") {
    await deps.audit.record({
      tool: auditTool,
      outcome: "blocked",
      input: inputForAudit,
      blocked_reason: outcome.reason,
    });
    return errorResult(outcome.reason);
  }

  if (outcome.kind === "needs_confirm") {
    const { token, expires_at } = deps.confirm.prepare({
      tool: auditTool,
      params: {
        ...params,
        ...(opts.destinationLabel ? { destinationLabel: opts.destinationLabel } : {}),
      },
      amount_sats: outcome.effective_amount_sats,
      summary: outcome.summary,
    });
    await deps.audit.record({
      tool: auditTool,
      outcome: "ok",
      input: inputForAudit,
      result: { confirmation_required: true, token, amount_sats: outcome.effective_amount_sats },
    });
    return textResult({
      status: "confirmation_required",
      token,
      expires_at: new Date(expires_at).toISOString(),
      summary: outcome.summary,
      next_step: `Call nwc_confirm_payment with token "${token}" to execute.`,
    });
  }

  try {
    const invoice_has_amount = decoded.amount_sats !== null && decoded.amount_sats > 0;
    const payment = await executePayment(
      deps.nwc,
      params.invoice,
      outcome.effective_amount_sats,
      invoice_has_amount,
    );
    // Record principal + fees so the budget tracks real outflow.
    await deps.budget.recordSpend(outcome.effective_amount_sats + payment.fees_paid_sats);
    await deps.audit.record({
      tool: auditTool,
      outcome: "ok",
      input: inputForAudit,
      result: {
        paid_sats: outcome.effective_amount_sats,
        fees_paid_sats: payment.fees_paid_sats,
        destination: outcome.destination,
      },
    });
    return textResult({
      preimage: payment.preimage,
      paid_sats: outcome.effective_amount_sats,
      fees_paid_sats: payment.fees_paid_sats,
      destination: outcome.destination,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await deps.audit.record({
      tool: auditTool,
      outcome: "error",
      input: inputForAudit,
      error: msg,
    });
    return errorResult(`${auditTool} failed: ${msg}`);
  }
}

export function registerPayInvoice(server: McpServer, deps: PayInvoiceDeps): void {
  server.registerTool(
    "nwc_pay_invoice",
    {
      description:
        "Pay a bolt11 Lightning invoice. Decodes locally, runs the safety pipeline (read-only gate, destination allowlist, budget cap), and either executes immediately or — if NWC_REQUIRE_CONFIRM=true — returns a one-time confirmation token to pass to nwc_confirm_payment. Returns preimage + fees on success.",
      inputSchema,
    },
    async ({ invoice, amount_override_sats }) => {
      return evaluateAndExecute(deps, { invoice, amount_override_sats });
    },
  );
}
