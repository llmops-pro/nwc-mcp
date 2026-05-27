import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NwcClient } from "../nwc-client.js";
import type { AuditLog } from "../safety/audit-log.js";
import { errorResult, textResult } from "./_result.js";

export function registerGetBalance(
  server: McpServer,
  nwc: NwcClient,
  audit: AuditLog,
): void {
  server.registerTool(
    "nwc_get_balance",
    {
      description:
        "Return the current spendable balance of the connected wallet, in satoshis.",
    },
    async () => {
      try {
        const raw = await nwc.raw.getBalance();
        // NIP-47 returns balance in msats; normalize to sats at the MCP boundary.
        const balanceMsat = (raw as { balance?: number }).balance ?? 0;
        const balanceSats = Math.floor(balanceMsat / 1000);
        const result = { balance_sats: balanceSats, balance_msat: balanceMsat };
        await audit.record({ tool: "nwc_get_balance", outcome: "ok", result });
        return textResult(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await audit.record({ tool: "nwc_get_balance", outcome: "error", error: msg });
        return errorResult(`nwc_get_balance failed: ${msg}`);
      }
    },
  );
}
