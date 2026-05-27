#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.js";

// Load env from a .env file if present. Tries cwd first, then the project
// root (one level up from the compiled binary in dist/). Silent on absence —
// env vars passed by the parent process (e.g., Claude Code via `--env`) win.
function tryLoadEnvFiles(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(process.cwd(), ".env"), resolve(here, "..", ".env")];
  for (const path of candidates) {
    try {
      process.loadEnvFile(path);
    } catch {
      // file missing or unreadable — fine, keep going
    }
  }
}
tryLoadEnvFiles();
import { NwcClient } from "./nwc-client.js";
import { Allowlist } from "./safety/allowlist.js";
import { AuditLog } from "./safety/audit-log.js";
import { BudgetTracker } from "./safety/budget-tracker.js";
import { ConfirmStore } from "./safety/confirm.js";
import { registerAllTools } from "./tools/register.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const audit = new AuditLog(config.NWC_LOG_PATH);
  const budget = new BudgetTracker(
    config.NWC_BUDGET_STATE_PATH,
    config.NWC_DAILY_BUDGET_SATS,
    config.NWC_TOTAL_BUDGET_SATS,
    config.NWC_MAX_INVOICE_SATS,
  );
  const allowlist = new Allowlist(config.NWC_ALLOWED_DESTINATIONS);
  const confirm = new ConfirmStore();
  const nwc = new NwcClient(config.NWC_CONNECTION_STRING);

  const server = new McpServer(
    { name: "nwc-mcp", version: "0.2.1" },
    { capabilities: { tools: {} } },
  );

  registerAllTools({ server, config, nwc, audit, budget, allowlist, confirm });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  await audit.record({
    tool: "_startup",
    outcome: "ok",
    result: {
      read_only: config.NWC_READ_ONLY,
      daily_budget_sats: config.NWC_DAILY_BUDGET_SATS,
      total_budget_sats: config.NWC_TOTAL_BUDGET_SATS ?? null,
      max_invoice_sats: config.NWC_MAX_INVOICE_SATS ?? null,
      require_confirm: config.NWC_REQUIRE_CONFIRM,
      keysend_enabled: config.NWC_KEYSEND_ENABLED,
      allowlist_size: allowlist.entries().length,
    },
  });

  const shutdown = async (signal: string): Promise<void> => {
    await audit.record({ tool: "_shutdown", outcome: "ok", result: { signal } });
    await nwc.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  process.stderr.write(`nwc-mcp: fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
