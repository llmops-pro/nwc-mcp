import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { NwcClient } from "../nwc-client.js";
import type { AuditLog } from "../safety/audit-log.js";
import { errorResult, textResult } from "./_result.js";

const inputSchema = {
  amount_sats: z
    .number()
    .int()
    .positive()
    .describe("Invoice amount in satoshis."),
  description: z
    .string()
    .max(640)
    .optional()
    .describe("Memo / description shown to the payer."),
  expiry_seconds: z
    .number()
    .int()
    .positive()
    .max(60 * 60 * 24 * 30)
    .optional()
    .describe("Invoice expiry in seconds (defaults to wallet's setting)."),
};

export function registerMakeInvoice(
  server: McpServer,
  nwc: NwcClient,
  audit: AuditLog,
): void {
  server.registerTool(
    "nwc_make_invoice",
    {
      description:
        "Create a bolt11 Lightning invoice for the given amount in sats. Safe — does not move funds; only generates a payment request. Returns the bolt11 string and payment hash.",
      inputSchema,
    },
    async ({ amount_sats, description, expiry_seconds }) => {
      try {
        const result = await nwc.raw.makeInvoice({
          amount: amount_sats * 1000, // NIP-47 takes msats
          description,
          expiry: expiry_seconds,
        });
        await audit.record({
          tool: "nwc_make_invoice",
          outcome: "ok",
          input: { amount_sats, description, expiry_seconds },
        });
        return textResult(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await audit.record({
          tool: "nwc_make_invoice",
          outcome: "error",
          error: msg,
          input: { amount_sats },
        });
        return errorResult(`nwc_make_invoice failed: ${msg}`);
      }
    },
  );
}
