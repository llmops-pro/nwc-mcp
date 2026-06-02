"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var vitest_1 = require("vitest");
var allowlist_js_1 = require("../src/safety/allowlist.js");
(0, vitest_1.describe)("Allowlist", function () {
    (0, vitest_1.it)("is disabled when empty — allows everything", function () {
        var a = new allowlist_js_1.Allowlist([]);
        (0, vitest_1.expect)(a.enabled).toBe(false);
        (0, vitest_1.expect)(a.isAllowed("alice@getalby.com")).toBe(true);
        (0, vitest_1.expect)(a.isAllowed("anything")).toBe(true);
    });
    (0, vitest_1.it)("matches case-insensitively and trims whitespace", function () {
        var a = new allowlist_js_1.Allowlist(["Alice@Getalby.com", "  bob@walletofsatoshi.com  "]);
        (0, vitest_1.expect)(a.enabled).toBe(true);
        (0, vitest_1.expect)(a.isAllowed("alice@getalby.com")).toBe(true);
        (0, vitest_1.expect)(a.isAllowed("ALICE@GETALBY.COM")).toBe(true);
        (0, vitest_1.expect)(a.isAllowed("  bob@walletofsatoshi.com")).toBe(true);
        (0, vitest_1.expect)(a.isAllowed("eve@evil.com")).toBe(false);
    });
    (0, vitest_1.it)("ignores empty entries in the configured list", function () {
        var a = new allowlist_js_1.Allowlist(["alice@getalby.com", "", "  "]);
        (0, vitest_1.expect)(a.entries()).toHaveLength(1);
        (0, vitest_1.expect)(a.isAllowed("alice@getalby.com")).toBe(true);
        (0, vitest_1.expect)(a.isAllowed("")).toBe(false);
    });
    (0, vitest_1.it)("works with hex pubkeys (no special casing — Set lookup)", function () {
        var pk = "022ee6620f79c37526e3567da512b2c2bb64780fac103f45dc45104e85307827e4";
        var a = new allowlist_js_1.Allowlist([pk]);
        (0, vitest_1.expect)(a.isAllowed(pk)).toBe(true);
        (0, vitest_1.expect)(a.isAllowed(pk.toUpperCase())).toBe(true);
        (0, vitest_1.expect)(a.isAllowed("03" + pk.slice(2))).toBe(false);
    });
});
