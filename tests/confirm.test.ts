import { describe, expect, it } from "vitest";
import { ConfirmStore } from "../src/safety/confirm.js";

const action = {
  tool: "nwc_pay_invoice",
  params: { invoice: "lnbc1u1p..." },
  amount_sats: 100,
  summary: "pay 100 sats to lnbc1u1p...",
};

describe("ConfirmStore", () => {
  it("issues a unique token per prepare()", () => {
    const store = new ConfirmStore();
    const a = store.prepare(action);
    const b = store.prepare(action);
    expect(a.token).not.toEqual(b.token);
    expect(a.token).toHaveLength(32); // 16 bytes hex
  });

  it("consume() returns the stored action and removes it", () => {
    const store = new ConfirmStore();
    const { token } = store.prepare(action);
    const first = store.consume(token);
    expect(first).not.toBeNull();
    expect(first?.tool).toBe(action.tool);
    expect(first?.amount_sats).toBe(action.amount_sats);
    // Second consume returns null — single-use.
    expect(store.consume(token)).toBeNull();
  });

  it("peek() returns the action without removing it", () => {
    const store = new ConfirmStore();
    const { token } = store.prepare(action);
    expect(store.peek(token)?.tool).toBe(action.tool);
    expect(store.peek(token)?.tool).toBe(action.tool);
    expect(store.consume(token)).not.toBeNull();
    expect(store.peek(token)).toBeNull();
  });

  it("consume() returns null for unknown tokens", () => {
    const store = new ConfirmStore();
    expect(store.consume("not-a-real-token")).toBeNull();
  });

  it("expires tokens after the TTL", async () => {
    const store = new ConfirmStore(10); // 10ms TTL
    const { token } = store.prepare(action);
    await new Promise((r) => setTimeout(r, 30));
    expect(store.consume(token)).toBeNull();
    expect(store.peek(token)).toBeNull();
  });
});
