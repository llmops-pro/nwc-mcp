import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NwcClient } from "../nwc-client.js";
import type { AuditLog } from "../safety/audit-log.js";
import { textResult, errorResult } from "./_result.js";

export function registerGetInfo(
  server: McpServer,
  nwc: NwcClient,
  audit: AuditLog,
): void {
  server.registerTool(
    "nwc_get_info",
    {
      description:
        "Return the connected wallet's capabilities, supported NIP-47 methods, node pubkey, network, alias, and color. Call this first in any session to discover what the wallet supports.",
    },
    async () => {
      try {
        const info = await nwc.raw.getInfo();
        await audit.record({ tool: "nwc_get_info", outcome: "ok" });
        return textResult(info);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await audit.record({ tool: "nwc_get_info", outcome: "error", error: msg });
        return errorResult(`nwc_get_info failed: ${msg}`);
      }
    },
  );
}
