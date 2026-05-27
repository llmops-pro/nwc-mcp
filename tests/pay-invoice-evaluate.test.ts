import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Config } from "../src/config.js";
import type { DecodedInvoice } from "../src/lib/bolt11.js";
import { Allowlist } from "../src/safety/allowlist.js";
import { BudgetTracker } from "../src/safety/budget-tracker.js";
import { evaluateSafety } from "../src/tools/pay-invoice.js";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    NWC_CONNECTION_STRING: "nostr+walletconnect://example",
    NWC_DAILY_BUDGET_SATS: 10_000,
    NWC_TOTAL_BUDGET_SATS: undefined,
    NWC_MAX_INVOICE_SATS: undefined,
    NWC_READ_ONLY: false,
    NWC_REQUIRE_CONFIRM: false,
    NWC_KEYSEND_ENABLED: false,
    NWC_ALLOWED_DESTINATIONS: [],
    NWC_LOG_PATH: "./nwc-mcp.log",
    NWC_BUDGET_STATE_PATH: "./nwc-mcp-state.json",
    ...overrides,
  };
}

function makeDecoded(overrides: Partial<DecodedInvoice> = {}): DecodedInvoice {
  return {
    payment_request: "lnbc1u1p...",
    amount_sats: 100,
    description: "test memo",
    payment_hash: "deadbeef",
    expiry_seconds: 3600,
    payee_pubkey: "022ee6620f79c37526e3567da512b2c2bb64780fac103f45dc45104e85307827e4",
    network: "mainnet",
    expires_at: null,
    ...overrides,
  };
}

let tmpDir: string;
let budgetPath: string;
function freshBudget(
  config: Partial<Config> = {},
): BudgetTracker {
  return new BudgetTracker(
    budgetPath,
    config.NWC_DAILY_BUDGET_SATS ?? 10_000,
    config.NWC_TOTAL_BUDGET_SATS,
    config.NWC_MAX_INVOICE_SATS,
  );
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "nwc-mcp-test-"));
  budgetPath = join(tmpDir, "budget.json");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("evaluateSafety", () => {
  it("blocks when NWC_READ_ONLY=true", async () => {
    const result = await evaluateSafety(
      {
        config: makeConfig({ NWC_READ_ONLY: true }),
        budget: freshBudget(),
        allowlist: new Allowlist([]),
      },
      makeDecoded(),
      undefined,
    );
    expect(result.kind).toBe("blocked");
    if (result.kind === "blocked") expect(result.reason).toMatch(/READ_ONLY/);
  });

  it("blocks when amount_override conflicts with invoice amount", async () => {
    const result = await evaluateSafety(
      { config: makeConfig(), budget: freshBudget(), allowlist: new Allowlist([]) },
      makeDecoded({ amount_sats: 100 }),
      200,
    );
    expect(result.kind).toBe("blocked");
    if (result.kind === "blocked")
      expect(result.reason).toMatch(/fixed amount 100/);
  });

  it("blocks when amountless invoice has no override", async () => {
    const result = await evaluateSafety(
      { config: makeConfig(), budget: freshBudget(), allowlist: new Allowlist([]) },
      makeDecoded({ amount_sats: null }),
      undefined,
    );
    expect(result.kind).toBe("blocked");
    if (result.kind === "blocked")
      expect(result.reason).toMatch(/amountless/);
  });

  it("accepts override for an amountless invoice", async () => {
    const result = await evaluateSafety(
      { config: makeConfig(), budget: freshBudget(), allowlist: new Allowlist([]) },
      makeDecoded({ amount_sats: null }),
      500,
    );
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") expect(result.effective_amount_sats).toBe(500);
  });

  it("blocks when destination is not in a non-empty allowlist", async () => {
    const result = await evaluateSafety(
      {
        config: makeConfig(),
        budget: freshBudget(),
        allowlist: new Allowlist(["someone-else-pubkey"]),
      },
      makeDecoded(),
      undefined,
    );
    expect(result.kind).toBe("blocked");
    if (result.kind === "blocked")
      expect(result.reason).toMatch(/not in NWC_ALLOWED_DESTINATIONS/);
  });

  it("allows when destination IS in the allowlist", async () => {
    const decoded = makeDecoded();
    const result = await evaluateSafety(
      {
        config: makeConfig(),
        budget: freshBudget(),
        allowlist: new Allowlist([decoded.payee_pubkey!]),
      },
      decoded,
      undefined,
    );
    expect(result.kind).toBe("ready");
  });

  it("blocks when budget cap would be exceeded", async () => {
    const result = await evaluateSafety(
      {
        config: makeConfig({ NWC_DAILY_BUDGET_SATS: 50 }),
        budget: freshBudget({ NWC_DAILY_BUDGET_SATS: 50 }),
        allowlist: new Allowlist([]),
      },
      makeDecoded({ amount_sats: 100 }),
      undefined,
    );
    expect(result.kind).toBe("blocked");
    if (result.kind === "blocked")
      expect(result.reason).toMatch(/NWC_DAILY_BUDGET_SATS=50/);
  });

  it("blocks when NWC_MAX_INVOICE_SATS would be exceeded", async () => {
    const result = await evaluateSafety(
      {
        config: makeConfig({ NWC_MAX_INVOICE_SATS: 50 }),
        budget: freshBudget({ NWC_MAX_INVOICE_SATS: 50 }),
        allowlist: new Allowlist([]),
      },
      makeDecoded({ amount_sats: 100 }),
      undefined,
    );
    expect(result.kind).toBe("blocked");
    if (result.kind === "blocked")
      expect(result.reason).toMatch(/NWC_MAX_INVOICE_SATS=50/);
  });

  it("returns needs_confirm when NWC_REQUIRE_CONFIRM=true", async () => {
    const result = await evaluateSafety(
      {
        config: makeConfig({ NWC_REQUIRE_CONFIRM: true }),
        budget: freshBudget(),
        allowlist: new Allowlist([]),
      },
      makeDecoded(),
      undefined,
    );
    expect(result.kind).toBe("needs_confirm");
    if (result.kind === "needs_confirm") {
      expect(result.effective_amount_sats).toBe(100);
      expect(result.summary).toContain("100 sats");
    }
  });

  it("skipConfirmGate=true bypasses NWC_REQUIRE_CONFIRM", async () => {
    const result = await evaluateSafety(
      {
        config: makeConfig({ NWC_REQUIRE_CONFIRM: true }),
        budget: freshBudget(),
        allowlist: new Allowlist([]),
      },
      makeDecoded(),
      undefined,
      { skipConfirmGate: true },
    );
    expect(result.kind).toBe("ready");
  });

  it("blocks when allowlist is set but invoice has no payee pubkey", async () => {
    const result = await evaluateSafety(
      {
        config: makeConfig(),
        budget: freshBudget(),
        allowlist: new Allowlist(["some-pubkey"]),
      },
      makeDecoded({ payee_pubkey: null }),
      undefined,
    );
    expect(result.kind).toBe("blocked");
    if (result.kind === "blocked")
      expect(result.reason).toMatch(/no payee pubkey/);
  });
});
