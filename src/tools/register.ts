import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";
import type { NwcClient } from "../nwc-client.js";
import type { Allowlist } from "../safety/allowlist.js";
import type { AuditLog } from "../safety/audit-log.js";
import type { BudgetTracker } from "../safety/budget-tracker.js";
import type { ConfirmStore } from "../safety/confirm.js";

import { registerGetInfo } from "./get-info.js";
import { registerGetBalance } from "./get-balance.js";
import { registerLookupInvoice } from "./lookup-invoice.js";
import { registerListTransactions } from "./list-transactions.js";
import { registerDecodeInvoice } from "./decode-invoice.js";
import { registerMakeInvoice } from "./make-invoice.js";
import { registerBudgetStatus } from "./budget-status.js";
import { registerPayInvoice } from "./pay-invoice.js";
import { registerPayLightningAddress } from "./pay-lightning-address.js";
import { registerPayLnurl } from "./pay-lnurl.js";
import { registerMultiPayInvoice } from "./multi-pay-invoice.js";
import { registerPayKeysend } from "./pay-keysend.js";
import { registerConfirmPayment } from "./confirm-payment.js";

export type ToolDeps = {
  server: McpServer;
  config: Config;
  nwc: NwcClient;
  audit: AuditLog;
  budget: BudgetTracker;
  allowlist: Allowlist;
  confirm: ConfirmStore;
};

export function registerAllTools(deps: ToolDeps): void {
  const { server, config, nwc, audit, budget, allowlist, confirm } = deps;

  // Read-only tools — always enabled.
  registerGetInfo(server, nwc, audit);
  registerGetBalance(server, nwc, audit);
  registerLookupInvoice(server, nwc, audit);
  registerListTransactions(server, nwc, audit);
  registerDecodeInvoice(server, audit);
  registerBudgetStatus(server, budget, audit);

  // Receive tools — also safe (no spend).
  registerMakeInvoice(server, nwc, audit);

  // Spend tools — gated by the safety pipeline:
  //   NWC_READ_ONLY → blocked
  //   NWC_ALLOWED_DESTINATIONS → checked against payee pubkey
  //   BudgetTracker.check → daily / total / per-invoice caps
  //   NWC_REQUIRE_CONFIRM → returns token, executes only after nwc_confirm_payment
  registerPayInvoice(server, { config, nwc, audit, budget, allowlist, confirm });
  registerPayLightningAddress(server, { config, nwc, audit, budget, allowlist, confirm });
  registerPayLnurl(server, { config, nwc, audit, budget, allowlist, confirm });
  registerMultiPayInvoice(server, { config, nwc, audit, budget, allowlist, confirm });
  registerPayKeysend(server, { config, nwc, audit, budget, allowlist, confirm });
  registerConfirmPayment(server, { config, nwc, audit, budget, allowlist, confirm });
}
