import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorResult, textResult } from "./_result.js";
import type { PayInvoiceDeps } from "./pay-invoice.js";

const inputSchema = {
  pubkey: z
    .string()
    .regex(/^[0-9a-fA-F]{66}$/, "must be a 33-byte (66-hex-char) Lightning pubkey")
    .describe("Destination node's public key (33 bytes hex)."),
  amount_sats: z.number().int().positive().describe("Amount to send in satoshis."),
  tlv_records: z
    .array(
      z.object({
        type: z.number().int().nonnegative(),
        value: z.string().describe("Hex-encoded TLV value."),
      }),
    )
    .optional()
    .describe(
      "Optional TLV records (e.g., podcasting 2.0 metadata, LNURL-pay sender data). Empty/omitted is fine for most uses.",
    ),
};

export type PayKeysendParams = {
  pubkey: string;
  amount_sats: number;
  tlv_records?: { type: number; value: string }[];
};

export async function evaluateAndExecuteKeysend(
  deps: PayInvoiceDeps,
  params: PayKeysendParams,
  opts: { skipConfirmGate?: boolean; auditTool?: string } = {},
): Promise<ReturnType<typeof textResult> | ReturnType<typeof errorResult>> {
  const auditTool = opts.auditTool ?? "nwc_pay_keysend";
  const inputForAudit = {
    pubkey: params.pubkey,
    amount_sats: params.amount_sats,
    tlv_record_count: params.tlv_records?.length ?? 0,
  };

  if (!deps.config.NWC_KEYSEND_ENABLED) {
    await deps.audit.record({
      tool: auditTool,
      outcome: "blocked",
      input: inputForAudit,
      blocked_reason: "NWC_KEYSEND_ENABLED is false — keysend is opt-in only",
    });
    return errorResult(
      "nwc_pay_keysend is disabled. Set NWC_KEYSEND_ENABLED=true in the env to enable. Keysend is opt-in because it sends sats directly to a pubkey without an invoice, with no receipt mechanism and weaker safety surface than bolt11.",
    );
  }

  if (deps.config.NWC_READ_ONLY) {
    await deps.audit.record({
      tool: auditTool,
      outcome: "blocked",
      input: inputForAudit,
      blocked_reason: "NWC_READ_ONLY=true — spend tools are disabled",
    });
    return errorResult("NWC_READ_ONLY=true — spend tools are disabled");
  }

  if (deps.allowlist.enabled && !deps.allowlist.isAllowed(params.pubkey)) {
    await deps.audit.record({
      tool: auditTool,
      outcome: "blocked",
      input: inputForAudit,
      blocked_reason: `pubkey ${params.pubkey} is not in NWC_ALLOWED_DESTINATIONS`,
    });
    return errorResult(`pubkey ${params.pubkey} is not in NWC_ALLOWED_DESTINATIONS`);
  }

  const budgetCheck = await deps.budget.check(params.amount_sats);
  if (!budgetCheck.ok) {
    await deps.audit.record({
      tool: auditTool,
      outcome: "blocked",
      input: inputForAudit,
      blocked_reason: budgetCheck.reason,
    });
    return errorResult(budgetCheck.reason);
  }

  if (deps.config.NWC_REQUIRE_CONFIRM && !opts.skipConfirmGate) {
    const summary = `keysend ${params.amount_sats} sats to ${params.pubkey}${
      params.tlv_records?.length ? ` (with ${params.tlv_records.length} TLV records)` : ""
    }`;
    const { token, expires_at } = deps.confirm.prepare({
      tool: "nwc_pay_keysend",
      params: params as unknown as Record<string, unknown>,
      amount_sats: params.amount_sats,
      summary,
    });
    await deps.audit.record({
      tool: auditTool,
      outcome: "ok",
      input: inputForAudit,
      result: { confirmation_required: true, token, amount_sats: params.amount_sats },
    });
    return textResult({
      status: "confirmation_required",
      token,
      expires_at: new Date(expires_at).toISOString(),
      summary,
      next_step: `Call nwc_confirm_payment with token "${token}" to execute.`,
    });
  }

  try {
    const result = (await deps.nwc.raw.payKeysend({
      pubkey: params.pubkey,
      amount: params.amount_sats * 1000,
      tlv_records: params.tlv_records,
    })) as { preimage: string; fees_paid?: number };
    // Round msat fees UP — see comment in pay-invoice.ts executePayment.
    const fees_paid_sats = Math.ceil((result.fees_paid ?? 0) / 1000);
    await deps.budget.recordSpend(params.amount_sats + fees_paid_sats);
    await deps.audit.record({
      tool: auditTool,
      outcome: "ok",
      input: inputForAudit,
      result: {
        paid_sats: params.amount_sats,
        fees_paid_sats,
        destination: params.pubkey,
      },
    });
    return textResult({
      preimage: result.preimage,
      paid_sats: params.amount_sats,
      fees_paid_sats,
      destination: params.pubkey,
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

export function registerPayKeysend(server: McpServer, deps: PayInvoiceDeps): void {
  server.registerTool(
    "nwc_pay_keysend",
    {
      description:
        "Send sats directly to a node pubkey via keysend (spontaneous payment, no invoice). Default-off — must be opt-in via NWC_KEYSEND_ENABLED=true. Power-user feature: no payment hash receipt, weaker safety surface than bolt11. Use bolt11 invoices when available. Runs the full safety pipeline (read-only gate, allowlist on pubkey, budget cap, optional two-step confirmation).",
      inputSchema,
    },
    async ({ pubkey, amount_sats, tlv_records }) =>
      evaluateAndExecuteKeysend(deps, { pubkey, amount_sats, tlv_records }),
  );
}
