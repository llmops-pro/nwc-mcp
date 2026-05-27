import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveLnurl } from "../lib/lnurl.js";
import { errorResult } from "./_result.js";
import { evaluateAndExecute, type PayInvoiceDeps } from "./pay-invoice.js";

const inputSchema = {
  lnurl: z
    .string()
    .min(1)
    .describe(
      "A raw LNURL string (bech32, starts with lnurl1...; an optional lightning: prefix is stripped).",
    ),
  amount_sats: z
    .number()
    .int()
    .positive()
    .describe("Amount to send in satoshis. Must fall within the endpoint's [min, max] range."),
  comment: z
    .string()
    .max(640)
    .optional()
    .describe("Optional comment, only sent if the endpoint advertises LUD-12 comment support."),
};

export function registerPayLnurl(server: McpServer, deps: PayInvoiceDeps): void {
  server.registerTool(
    "nwc_pay_lnurl",
    {
      description:
        "Pay a raw LNURL-pay endpoint (bech32 lnurl1... string). Decodes the LNURL, resolves the pay request, then runs the safety pipeline (read-only gate, allowlist check on the LNURL, budget cap, optional two-step confirmation). Use nwc_pay_lightning_address when you have a name@domain.tld instead.",
      inputSchema,
    },
    async ({ lnurl, amount_sats, comment }) => {
      const lnurlNormalized = lnurl.toLowerCase().trim().replace(/^lightning:/, "");

      if (deps.config.NWC_READ_ONLY) {
        await deps.audit.record({
          tool: "nwc_pay_lnurl",
          outcome: "blocked",
          input: { lnurl_prefix: lnurlNormalized.slice(0, 16) + "...", amount_sats },
          blocked_reason: "NWC_READ_ONLY=true — spend tools are disabled",
        });
        return errorResult("NWC_READ_ONLY=true — spend tools are disabled");
      }
      if (deps.allowlist.enabled && !deps.allowlist.isAllowed(lnurlNormalized)) {
        await deps.audit.record({
          tool: "nwc_pay_lnurl",
          outcome: "blocked",
          input: { lnurl_prefix: lnurlNormalized.slice(0, 16) + "...", amount_sats },
          blocked_reason: "LNURL is not in NWC_ALLOWED_DESTINATIONS",
        });
        return errorResult("LNURL is not in NWC_ALLOWED_DESTINATIONS");
      }

      let resolved;
      try {
        resolved = await resolveLnurl(lnurlNormalized, amount_sats, comment);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await deps.audit.record({
          tool: "nwc_pay_lnurl",
          outcome: "error",
          input: { lnurl_prefix: lnurlNormalized.slice(0, 16) + "...", amount_sats },
          error: msg,
        });
        return errorResult(msg);
      }

      return evaluateAndExecute(
        deps,
        { invoice: resolved.invoice },
        {
          auditTool: "nwc_pay_lnurl",
          destinationLabel: lnurlNormalized,
          extraAuditInput: {
            lnurl_prefix: lnurlNormalized.slice(0, 16) + "...",
            amount_sats: resolved.amount_sats,
          },
        },
      );
    },
  );
}
