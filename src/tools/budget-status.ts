import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BudgetTracker } from "../safety/budget-tracker.js";
import type { AuditLog } from "../safety/audit-log.js";
import { textResult } from "./_result.js";

export function registerBudgetStatus(
  server: McpServer,
  budget: BudgetTracker,
  audit: AuditLog,
): void {
  server.registerTool(
    "nwc_budget_status",
    {
      description:
        "Show the current spend-budget state: rolling-24h spent, daily cap, lifetime spent, optional total cap, and per-invoice max. Useful before attempting a payment to know whether it will be allowed.",
    },
    async () => {
      const snap = await budget.snapshot();
      await audit.record({
        tool: "nwc_budget_status",
        outcome: "ok",
        result: snap as unknown as Record<string, unknown>,
      });
      return textResult(snap);
    },
  );
}
