import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { NwcClient } from "../nwc-client.js";
import type { AuditLog } from "../safety/audit-log.js";
import { errorResult, textResult } from "./_result.js";

const inputSchema = {
  from: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Unix timestamp (seconds). Filter transactions at or after this time."),
  until: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Unix timestamp (seconds). Filter transactions at or before this time."),
  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe("Max number of transactions to return (default per the wallet)."),
  offset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Pagination offset."),
  unpaid: z
    .boolean()
    .optional()
    .describe("If true, include unpaid invoices in the result."),
  type: z
    .enum(["incoming", "outgoing"])
    .optional()
    .describe("Filter by direction."),
};

export function registerListTransactions(
  server: McpServer,
  nwc: NwcClient,
  audit: AuditLog,
): void {
  server.registerTool(
    "nwc_list_transactions",
    {
      description:
        "List transactions on the connected wallet. Supports filtering by time range, direction (incoming/outgoing), and inclusion of unpaid invoices.",
      inputSchema,
    },
    async (args) => {
      try {
        const txs = await nwc.raw.listTransactions(args);
        await audit.record({
          tool: "nwc_list_transactions",
          outcome: "ok",
          input: args,
        });
        return textResult(txs);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await audit.record({
          tool: "nwc_list_transactions",
          outcome: "error",
          error: msg,
        });
        return errorResult(`nwc_list_transactions failed: ${msg}`);
      }
    },
  );
}
