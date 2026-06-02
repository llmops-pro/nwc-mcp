"use strict";
// Two-step confirmation token store for spend tools.
//
// When NWC_REQUIRE_CONFIRM=true, a spend tool returns a short-lived token
// instead of executing immediately. The agent calls `nwc_confirm_payment`
// with the token to actually run the payment. Trades agent autonomy for
// safety; opt-in via env.
//
// Tokens are in-memory only — confirm flow does not survive a server
// restart. That's intentional: if the server bounced, the agent should
// re-evaluate before retrying a payment.
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfirmStore = void 0;
var node_crypto_1 = require("node:crypto");
var DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
var ConfirmStore = /** @class */ (function () {
    function ConfirmStore(ttlMs) {
        if (ttlMs === void 0) { ttlMs = DEFAULT_TTL_MS; }
        this.ttlMs = ttlMs;
        this.pending = new Map();
    }
    ConfirmStore.prototype.prepare = function (action) {
        this.pruneExpired();
        var token = (0, node_crypto_1.randomBytes)(16).toString("hex");
        var expires_at = Date.now() + this.ttlMs;
        this.pending.set(token, __assign(__assign({}, action), { token: token, expires_at: expires_at }));
        return { token: token, expires_at: expires_at };
    };
    ConfirmStore.prototype.consume = function (token) {
        this.pruneExpired();
        var stored = this.pending.get(token);
        if (!stored)
            return null;
        this.pending.delete(token);
        return stored;
    };
    ConfirmStore.prototype.peek = function (token) {
        var _a;
        this.pruneExpired();
        return (_a = this.pending.get(token)) !== null && _a !== void 0 ? _a : null;
    };
    ConfirmStore.prototype.pruneExpired = function () {
        var now = Date.now();
        for (var _i = 0, _a = this.pending; _i < _a.length; _i++) {
            var _b = _a[_i], token = _b[0], action = _b[1];
            if (action.expires_at <= now)
                this.pending.delete(token);
        }
    };
    return ConfirmStore;
}());
exports.ConfirmStore = ConfirmStore;
