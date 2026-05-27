import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { decodeInvoice } from "../lib/bolt11.js";
import { errorResult, textResult } from "./_result.js";
import {
  evaluateAndExecute,
  evaluateSafety,
  type PayInvoiceDeps,
  type PayInvoiceParams,
} from "./pay-invoice.js";

const itemSchema = z.object({
  invoice: z.string().min(1).describe("bolt11 invoice string"),
  amount_override_sats: z.number().int().positive().optional().describe(
    "Amount in sats — required for amountless invoices; rejected if the invoice already encodes an amount.",
  ),
});

const inputSchema = {
  invoices: z
    .array(itemSchema)
    .min(1)
    .max(20)
    .describe(
      "Array of invoices to pay sequentially. Each is decoded + safety-checked independently. The batch's *sum* is checked against the daily budget before any payment runs; if the sum would exceed the cap, the entire batch is rejected before any HTLC is sent.",
    ),
};

type ItemPlan = {
  idx: number;
  params: PayInvoiceParams;
  effective_amount_sats: number;
};

export async function planBatch(
  deps: PayInvoiceDeps,
  items: PayInvoiceParams[],
): Promise<
  | { kind: "planned"; plan: ItemPlan[]; sum_sats: number }
  | { kind: "blocked"; idx: number; reason: string }
> {
  const plan: ItemPlan[] = [];
  let sum = 0;
  for (const [i, it] of items.entries()) {
    let decoded;
    try {
      decoded = decodeInvoice(it.invoice);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { kind: "blocked", idx: i, reason: `invoice decode failed: ${msg}` };
    }
    // Pre-check with skipConfirmGate so the per-item evaluation doesn't trip on
    // NWC_REQUIRE_CONFIRM (we manage confirm at the batch level).
    const outcome = await evaluateSafety(
      { config: deps.config, budget: deps.budget, allowlist: deps.allowlist },
      decoded,
      it.amount_override_sats,
      { skipConfirmGate: true },
    );
    if (outcome.kind === "blocked") {
      return { kind: "blocked", idx: i, reason: outcome.reason };
    }
    plan.push({ idx: i, params: it, effective_amount_sats: outcome.effective_amount_sats });
    sum += outcome.effective_amount_sats;
  }
  return { kind: "planned", plan, sum_sats: sum };
}

async function executeBatch(
  deps: PayInvoiceDeps,
  plan: ItemPlan[],
): Promise<{ batch_size: number; results: unknown[] }> {
  const results: unknown[] = [];
  for (const item of plan) {
    const toolResult = await evaluateAndExecute(deps, item.params, {
      skipConfirmGate: true,
      auditTool: "nwc_multi_pay_invoice",
      extraAuditInput: { batch_idx: item.idx },
    });
    const text = toolResult.content[0]?.text ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    results.push({
      idx: item.idx,
      invoice_prefix: item.params.invoice.slice(0, 24) + "...",
      ok: !toolResult.isError,
      result: parsed,
    });
  }
  return { batch_size: plan.length, results };
}

export async function evaluateAndExecuteMulti(
  deps: PayInvoiceDeps,
  invoices: PayInvoiceParams[],
  opts: { skipConfirmGate?: boolean } = {},
): Promise<ReturnType<typeof textResult> | ReturnType<typeof errorResult>> {
  if (deps.config.NWC_READ_ONLY) {
    await deps.audit.record({
      tool: "nwc_multi_pay_invoice",
      outcome: "blocked",
      input: { count: invoices.length },
      blocked_reason: "NWC_READ_ONLY=true — spend tools are disabled",
    });
    return errorResult("NWC_READ_ONLY=true — spend tools are disabled");
  }

  const planResult = await planBatch(deps, invoices);
  if (planResult.kind === "blocked") {
    await deps.audit.record({
      tool: "nwc_multi_pay_invoice",
      outcome: "blocked",
      input: { count: invoices.length, failing_idx: planResult.idx },
      blocked_reason: planResult.reason,
    });
    return errorResult(
      `batch pre-check failed at invoice index ${planResult.idx}: ${planResult.reason}`,
    );
  }

  const { plan, sum_sats } = planResult;
  const snap = await deps.budget.snapshot();
  const daily_remaining = snap.daily_cap_sats - snap.daily_spent_sats;
  if (sum_sats > daily_remaining) {
    const reason = `batch sum ${sum_sats} sats would exceed daily remaining ${daily_remaining} (already spent ${snap.daily_spent_sats} / ${snap.daily_cap_sats})`;
    await deps.audit.record({
      tool: "nwc_multi_pay_invoice",
      outcome: "blocked",
      input: { count: invoices.length, sum_sats },
      blocked_reason: reason,
    });
    return errorResult(reason);
  }
  if (
    snap.total_cap_sats !== null &&
    snap.total_spent_sats + sum_sats > snap.total_cap_sats
  ) {
    const reason = `batch sum ${sum_sats} sats would exceed NWC_TOTAL_BUDGET_SATS=${snap.total_cap_sats} (lifetime spent ${snap.total_spent_sats})`;
    await deps.audit.record({
      tool: "nwc_multi_pay_invoice",
      outcome: "blocked",
      input: { count: invoices.length, sum_sats },
      blocked_reason: reason,
    });
    return errorResult(reason);
  }

  if (deps.config.NWC_REQUIRE_CONFIRM && !opts.skipConfirmGate) {
    const summary = `pay batch of ${plan.length} invoices, total ${sum_sats} sats`;
    const { token, expires_at } = deps.confirm.prepare({
      tool: "nwc_multi_pay_invoice",
      params: { invoices } as Record<string, unknown>,
      amount_sats: sum_sats,
      summary,
    });
    await deps.audit.record({
      tool: "nwc_multi_pay_invoice",
      outcome: "ok",
      input: { count: invoices.length, sum_sats },
      result: { confirmation_required: true, token },
    });
    return textResult({
      status: "confirmation_required",
      token,
      expires_at: new Date(expires_at).toISOString(),
      summary,
      next_step: `Call nwc_confirm_payment with token "${token}" to execute the batch.`,
    });
  }

  const batchResult = await executeBatch(deps, plan);
  return textResult({ sum_sats, ...batchResult });
}

export function registerMultiPayInvoice(server: McpServer, deps: PayInvoiceDeps): void {
  server.registerTool(
    "nwc_multi_pay_invoice",
    {
      description:
        "Pay multiple bolt11 invoices sequentially in one tool call. Each invoice is decoded and safety-checked independently; the batch sum is checked against the daily and total budget caps upfront. If any pre-check or sum check fails, no payments are sent. Execution is per-invoice — a failure mid-batch does not roll back already-settled invoices.",
      inputSchema,
    },
    async ({ invoices }) => evaluateAndExecuteMulti(deps, invoices),
  );
}
