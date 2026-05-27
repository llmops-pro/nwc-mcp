import { describe, expect, it } from "vitest";
import { Allowlist } from "../src/safety/allowlist.js";

describe("Allowlist", () => {
  it("is disabled when empty — allows everything", () => {
    const a = new Allowlist([]);
    expect(a.enabled).toBe(false);
    expect(a.isAllowed("alice@getalby.com")).toBe(true);
    expect(a.isAllowed("anything")).toBe(true);
  });

  it("matches case-insensitively and trims whitespace", () => {
    const a = new Allowlist(["Alice@Getalby.com", "  bob@walletofsatoshi.com  "]);
    expect(a.enabled).toBe(true);
    expect(a.isAllowed("alice@getalby.com")).toBe(true);
    expect(a.isAllowed("ALICE@GETALBY.COM")).toBe(true);
    expect(a.isAllowed("  bob@walletofsatoshi.com")).toBe(true);
    expect(a.isAllowed("eve@evil.com")).toBe(false);
  });

  it("ignores empty entries in the configured list", () => {
    const a = new Allowlist(["alice@getalby.com", "", "  "]);
    expect(a.entries()).toHaveLength(1);
    expect(a.isAllowed("alice@getalby.com")).toBe(true);
    expect(a.isAllowed("")).toBe(false);
  });

  it("works with hex pubkeys (no special casing — Set lookup)", () => {
    const pk = "022ee6620f79c37526e3567da512b2c2bb64780fac103f45dc45104e85307827e4";
    const a = new Allowlist([pk]);
    expect(a.isAllowed(pk)).toBe(true);
    expect(a.isAllowed(pk.toUpperCase())).toBe(true);
    expect(a.isAllowed("03" + pk.slice(2))).toBe(false);
  });
});
