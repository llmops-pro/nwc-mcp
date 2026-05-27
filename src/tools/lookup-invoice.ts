import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { NwcClient } from "../nwc-client.js";
import type { AuditLog } from "../safety/audit-log.js";
import { errorResult, textResult } from "./_result.js";

const inputSchema = {
  payment_hash: z
    .string()
    .optional()
    .describe("The payment hash of the invoice to look up."),
  invoice: z
    .string()
    .optional()
    .describe("The bolt11 invoice string to look up (alternative to payment_hash)."),
};

export function registerLookupInvoice(
  server: McpServer,
  nwc: NwcClient,
  audit: AuditLog,
): void {
  server.registerTool(
    "nwc_lookup_invoice",
    {
      description:
        "Look up an invoice by payment hash or bolt11 string. Returns the invoice state (paid/unpaid), settled timestamp, amount, fees paid, and preimage if settled. Provide either payment_hash OR invoice.",
      inputSchema,
    },
    async ({ payment_hash, invoice }) => {
      if (!payment_hash && !invoice) {
        await audit.record({
          tool: "nwc_lookup_invoice",
          outcome: "error",
          error: "must provide payment_hash or invoice",
        });
        return errorResult("Must provide either payment_hash or invoice.");
      }
      try {
        const lookup = await nwc.raw.lookupInvoice(
          payment_hash ? { payment_hash } : { invoice: invoice! },
        );
        await audit.record({
          tool: "nwc_lookup_invoice",
          outcome: "ok",
          input: { payment_hash, invoice: invoice ? "<bolt11>" : undefined },
        });
        return textResult(lookup);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await audit.record({ tool: "nwc_lookup_invoice", outcome: "error", error: msg });
        return errorResult(`nwc_lookup_invoice failed: ${msg}`);
      }
    },
  );
}
