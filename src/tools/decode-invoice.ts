import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AuditLog } from "../safety/audit-log.js";
import { decodeInvoice } from "../lib/bolt11.js";
import { errorResult, textResult } from "./_result.js";

const inputSchema = {
  invoice: z.string().min(1).describe("The bolt11 invoice string to decode."),
};

export function registerDecodeInvoice(server: McpServer, audit: AuditLog): void {
  server.registerTool(
    "nwc_decode_invoice",
    {
      description:
        "Decode a bolt11 Lightning invoice locally (no network call). Returns amount in sats, description, payment hash, expiry, payee pubkey, and network. Use this before pay_invoice to confirm the invoice contents.",
      inputSchema,
    },
    async ({ invoice }) => {
      try {
        const decoded = decodeInvoice(invoice);
        await audit.record({ tool: "nwc_decode_invoice", outcome: "ok" });
        return textResult(decoded);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await audit.record({
          tool: "nwc_decode_invoice",
          outcome: "error",
          error: msg,
        });
        return errorResult(`nwc_decode_invoice failed: ${msg}`);
      }
    },
  );
}
