import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "../config.js";
import type { NwcClient } from "../nwc-client.js";
import type { Allowlist } from "../safety/allowlist.js";
import type { AuditLog } from "../safety/audit-log.js";
import type { BudgetTracker } from "../safety/budget-tracker.js";
import type { ConfirmStore } from "../safety/confirm.js";
import { errorResult } from "./_result.js";
import { evaluateAndExecuteMulti } from "./multi-pay-invoice.js";
import { evaluateAndExecute, type PayInvoiceParams } from "./pay-invoice.js";
import { evaluateAndExecuteKeysend, type PayKeysendParams } from "./pay-keysend.js";

const inputSchema = {
  token: z
    .string()
    .min(1)
    .describe("The confirmation token returned by a previous spend tool call."),
};

export type ConfirmPaymentDeps = {
  config: Config;
  nwc: NwcClient;
  audit: AuditLog;
  budget: BudgetTracker;
  allowlist: Allowlist;
  confirm: ConfirmStore;
};

export function registerConfirmPayment(
  server: McpServer,
  deps: ConfirmPaymentDeps,
): void {
  server.registerTool(
    "nwc_confirm_payment",
    {
      description:
        "Execute a previously prepared payment, identified by its one-time token. Only meaningful when NWC_REQUIRE_CONFIRM=true. The token is consumed (single use) and safety checks (budget, allowlist) are re-run before execution.",
      inputSchema,
    },
    async ({ token }) => {
      const action = deps.confirm.consume(token);
      if (!action) {
        await deps.audit.record({
          tool: "nwc_confirm_payment",
          outcome: "blocked",
          input: { token_prefix: token.slice(0, 8) + "..." },
          blocked_reason: "token unknown or expired",
        });
        return errorResult(
          "Token is unknown or expired. Call the original spend tool again to get a fresh token.",
        );
      }

      if (
        action.tool === "nwc_pay_invoice" ||
        action.tool === "nwc_pay_lightning_address" ||
        action.tool === "nwc_pay_lnurl"
      ) {
        const raw = action.params as Record<string, unknown>;
        const params: PayInvoiceParams = {
          invoice: raw.invoice as string,
          amount_override_sats: raw.amount_override_sats as number | undefined,
        };
        const destinationLabel =
          typeof raw.destinationLabel === "string" ? raw.destinationLabel : undefined;
        return evaluateAndExecute(deps, params, {
          skipConfirmGate: true,
          auditTool: "nwc_confirm_payment",
          destinationLabel,
          extraAuditInput: { confirmed_for: action.tool },
        });
      }

      if (action.tool === "nwc_multi_pay_invoice") {
        const raw = action.params as { invoices: PayInvoiceParams[] };
        return evaluateAndExecuteMulti(deps, raw.invoices, { skipConfirmGate: true });
      }

      if (action.tool === "nwc_pay_keysend") {
        const params = action.params as unknown as PayKeysendParams;
        return evaluateAndExecuteKeysend(deps, params, {
          skipConfirmGate: true,
          auditTool: "nwc_confirm_payment",
        });
      }

      await deps.audit.record({
        tool: "nwc_confirm_payment",
        outcome: "error",
        error: `unsupported tool in confirm token: ${action.tool}`,
      });
      return errorResult(
        `unsupported tool in confirm token: ${action.tool}. Supported: nwc_pay_invoice, nwc_pay_lightning_address, nwc_pay_lnurl, nwc_multi_pay_invoice, nwc_pay_keysend.`,
      );
    },
  );
}
