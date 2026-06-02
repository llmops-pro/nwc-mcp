"use strict";
// Destination allowlist for spend tools.
//
// When NWC_ALLOWED_DESTINATIONS is set, only destinations matching one of the
// configured entries are payable. Matching is case-insensitive and trimmed.
//
// Each spend tool decides what string to pass:
//  - nwc_pay_lightning_address → the LN address (e.g., "alice@getalby.com")
//  - nwc_pay_invoice           → the payee pubkey extracted from bolt11
//  - nwc_pay_lnurl             → the LNURL string
//  - nwc_pay_keysend           → the destination pubkey
Object.defineProperty(exports, "__esModule", { value: true });
exports.Allowlist = void 0;
var Allowlist = /** @class */ (function () {
    function Allowlist(allowed) {
        this.normalized = new Set(allowed
            .map(function (s) { return s.trim().toLowerCase(); })
            .filter(function (s) { return s.length > 0; }));
    }
    Object.defineProperty(Allowlist.prototype, "enabled", {
        get: function () {
            return this.normalized.size > 0;
        },
        enumerable: false,
        configurable: true
    });
    Allowlist.prototype.isAllowed = function (destination) {
        if (!this.enabled)
            return true;
        return this.normalized.has(destination.trim().toLowerCase());
    };
    Allowlist.prototype.entries = function () {
        return Array.from(this.normalized);
    };
    return Allowlist;
}());
exports.Allowlist = Allowlist;
