import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveLightningAddress } from "../lib/lnurl.js";
import { errorResult } from "./_result.js";
import { evaluateAndExecute, type PayInvoiceDeps } from "./pay-invoice.js";

const LN_ADDRESS_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

const inputSchema = {
  address: z
    .string()
    .regex(LN_ADDRESS_REGEX, "must be a valid lightning address: name@domain.tld")
    .describe("The Lightning Address to pay (e.g., alice@getalby.com)."),
  amount_sats: z
    .number()
    .int()
    .positive()
    .describe("Amount to send in satoshis."),
  comment: z
    .string()
    .max(640)
    .optional()
    .describe(
      "Optional comment for the recipient. Only sent if the LNURL-pay endpoint advertises comment support (LUD-12); otherwise rejected.",
    ),
};

export function registerPayLightningAddress(
  server: McpServer,
  deps: PayInvoiceDeps,
): void {
  server.registerTool(
    "nwc_pay_lightning_address",
    {
      description:
        "Pay a Lightning Address (e.g., alice@getalby.com). Resolves the LNURL-pay endpoint to a bolt11 invoice, then runs the safety pipeline (read-only gate, allowlist check on the LN address, budget cap, optional two-step confirmation). Returns preimage on success.",
      inputSchema,
    },
    async ({ address, amount_sats, comment }) => {
      // Early gates — block before the LNURL-pay HTTP round-trip so we don't
      // leak the lookup attempt to the recipient's server when the request
      // would have been rejected locally.
      if (deps.config.NWC_READ_ONLY) {
        await deps.audit.record({
          tool: "nwc_pay_lightning_address",
          outcome: "blocked",
          input: { address, amount_sats },
          blocked_reason: "NWC_READ_ONLY=true — spend tools are disabled",
        });
        return errorResult("NWC_READ_ONLY=true — spend tools are disabled");
      }
      if (deps.allowlist.enabled && !deps.allowlist.isAllowed(address)) {
        await deps.audit.record({
          tool: "nwc_pay_lightning_address",
          outcome: "blocked",
          input: { address, amount_sats },
          blocked_reason: `destination ${address} is not in NWC_ALLOWED_DESTINATIONS`,
        });
        return errorResult(
          `destination ${address} is not in NWC_ALLOWED_DESTINATIONS`,
        );
      }

      let resolved;
      try {
        resolved = await resolveLightningAddress(address, amount_sats, comment);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await deps.audit.record({
          tool: "nwc_pay_lightning_address",
          outcome: "error",
          input: { address, amount_sats },
          error: msg,
        });
        return errorResult(msg);
      }

      // Hand off to the shared pipeline. destinationLabel keeps the human-readable
      // LN address in the allowlist re-check (no-op here, already validated) and
      // the confirm-token summary. The bolt11 LNURL returns has the amount baked
      // in, so no amount_override is needed.
      return evaluateAndExecute(
        deps,
        { invoice: resolved.invoice },
        {
          auditTool: "nwc_pay_lightning_address",
          destinationLabel: address,
          extraAuditInput: { address, amount_sats: resolved.amount_sats },
        },
      );
    },
  );
}
