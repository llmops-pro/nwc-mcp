# nwc-mcp

**A Lightning wallet for your LLM agent.** MCP server that exposes Nostr Wallet Connect (NIP-47) wallet operations as tools your agent can call — read balance, generate invoices, pay invoices, pay Lightning Addresses, pay LNURLs, batch payments, keysend — all wrapped in a defense-in-depth safety stack.

Drop it into Claude Desktop, Claude Code, Cursor, or any MCP-speaking client. Hand the agent a sub-wallet (not your main one). Set a daily cap. Let it spend sats on your behalf within rails you control.

> **v0.2 — all spend tools shipped.** Twelve tools (7 read/receive + 5 spend + 1 confirm), four safety gates, full audit log. Validated end-to-end against Alby Hub + Olympus by ZEUS routing — real outbound payment settled in 8 seconds.

---

## What you can do with this

- **A coding agent that pays for its own paywalled tool calls** (L402-style paid MCP servers).
- **A NOSTR bot that zaps interesting notes** under a daily cap you set.
- **An evaluation harness that pays a small fee per task** to a worker agent it consumes.
- **A storefront agent that issues receive invoices** in response to incoming DMs.
- **Personal sats-aware agents** — "every Friday, send 1,000 sats to my favorite OSS maintainers via their LN addresses."

The safety stack is the load-bearing reason this is usable in production: the agent can request a payment, but the *server* refuses anything that breaches your configured limits, demands a second-step confirmation if you set one, and writes every call to a structured audit log.

---

## The twelve tools

### Read-only (always enabled, no spend risk)

| Tool | Purpose |
|---|---|
| `nwc_get_info` | Wallet capabilities, supported NIP-47 methods, node pubkey, network, alias. Call first. |
| `nwc_get_balance` | Spendable balance in sats (and msat). |
| `nwc_lookup_invoice` | Look up an invoice by payment hash or bolt11; returns state + preimage if settled. |
| `nwc_list_transactions` | List transactions with filters (time range, direction, unpaid). |
| `nwc_decode_invoice` | Parse a bolt11 locally — amount, memo, expiry, payee pubkey. No network call. |
| `nwc_budget_status` | Current spend budget state — daily spent, caps, lifetime spent. |

### Receive (safe — only generates invoices, no spend)

| Tool | Purpose |
|---|---|
| `nwc_make_invoice` | Create a bolt11 invoice for a given amount of sats. |

### Spend (gated by the safety pipeline)

| Tool | Purpose |
|---|---|
| `nwc_pay_invoice` | Pay a bolt11. Amount-resolution for amountless invoices via `amount_override_sats`. |
| `nwc_pay_lightning_address` | Pay `name@domain.tld` (LUD-16). Direct LNURL-pay resolution, non-proxied by default. |
| `nwc_pay_lnurl` | Pay a raw `lnurl1...` bech32 string (LUD-01). |
| `nwc_multi_pay_invoice` | Pay up to 20 invoices in one call. Sum is checked against the budget cap atomically. |
| `nwc_pay_keysend` | Spontaneous payment direct to a pubkey. **Default-off** — opt in via `NWC_KEYSEND_ENABLED=true`. |
| `nwc_confirm_payment` | Execute a two-step-confirm payment by consuming its one-time token. |

---

## Requirements

- Node 20+
- A NWC connection string from a NIP-47-compatible wallet (Alby Hub, Mutiny, Coinos, Phoenix, …)

The canonical buyer setup is **Alby Hub PRO** with a dedicated sub-wallet for the agent — that's what this server has been smoke-tested against. But the protocol is wallet-agnostic; anything that speaks NIP-47 works.

## Install

```bash
# From npm (once published)
npx -y nwc-mcp

# From source
git clone <repo>
cd nwc-mcp
corepack enable pnpm
pnpm install
pnpm build
```

## Configure

Copy `.env.example` to `.env` and fill in your NWC connection string:

```bash
cp .env.example .env
# edit .env: NWC_CONNECTION_STRING=nostr+walletconnect://...
```

The server auto-loads `.env` from the current working directory and from the project root (one level up from `dist/`). Env vars passed by the parent process (e.g., `claude mcp add --env ...`) take precedence over `.env`. `.env` is gitignored — keep your NWC string out of any committed file.

### Required

| Var | Purpose |
|---|---|
| `NWC_CONNECTION_STRING` | `nostr+walletconnect://...` — get this from your wallet (in Alby Hub: Sub-wallets → Connections). **Treat as a secret** — anyone holding it can spend up to the daily cap. |
| `NWC_DAILY_BUDGET_SATS` | Rolling 24h spend cap. Server refuses to start without this set. |

### Optional safety knobs

| Var | Default | Purpose |
|---|---|---|
| `NWC_TOTAL_BUDGET_SATS` | unset | Lifetime spend cap. |
| `NWC_MAX_INVOICE_SATS` | unset | Per-payment cap. |
| `NWC_READ_ONLY` | `false` | If `true`, disables all spend tools — useful for dev / eval / curious mode. |
| `NWC_REQUIRE_CONFIRM` | `false` | If `true`, spend tools return a one-time token; payment only executes after `nwc_confirm_payment` with the token. Trades agent autonomy for safety. |
| `NWC_KEYSEND_ENABLED` | `false` | Opt-in toggle for `nwc_pay_keysend`. Off because keysend is power-user (no payment hash, weaker safety surface than bolt11). |
| `NWC_ALLOWED_DESTINATIONS` | unset | Comma-separated allowlist of LN addresses / pubkeys / LNURLs. If set, ONLY those can be paid. |
| `NWC_LOG_PATH` | `./nwc-mcp.log` | Path to the structured audit log file. |
| `NWC_BUDGET_STATE_PATH` | `./nwc-mcp-state.json` | Path to the persisted budget tracker state. |

---

## Wire into an MCP client

### Claude Code (project-scoped, recommended)

From this directory:

```bash
claude mcp add nwc -s project node "$(pwd)/dist/index.js"
```

This writes a `.mcp.json` in the project root. Project-scoped servers load only when Claude Code starts from this directory tree. Use `/mcp` inside a session to inspect what's loaded. Restart the CLI to pick up a fresh `dist/index.js` after a rebuild.

Switch `-s project` to `-s user` if you want the server available everywhere.

### Claude Desktop / Cursor / other clients

See [`examples/claude-desktop-config.json`](./examples/claude-desktop-config.json) for the manifest snippet. Copy it into your client's config, replace the path placeholder. Because the server loads `.env` itself, you don't need to pass `NWC_*` vars through the client config — leave the `env` block empty.

---

## Safety model

This server is designed for use by autonomous LLM agents that hold the keys to spend real sats. The defense in depth runs in this order on every spend tool call:

1. **`NWC_READ_ONLY` gate** — if set, blocks at the first gate. No decode, no network, audit log entry only.
2. **Invoice decode + amount resolution** — for bolt11-based tools. Rejects ambiguity (amount-override conflicting with embedded amount).
3. **Allowlist check** — if `NWC_ALLOWED_DESTINATIONS` is set, the payee (pubkey for bolt11, LN address for LUD-16, LNURL string for LUD-01, pubkey for keysend) must match. Empty allowlist = no-op.
4. **Budget check** — daily rolling cap + optional total cap + optional per-invoice cap. State is persisted to `NWC_BUDGET_STATE_PATH`.
5. **Two-step confirmation gate** — if `NWC_REQUIRE_CONFIRM=true`, returns a 16-byte hex token with 5-minute TTL instead of executing. Agent must call `nwc_confirm_payment` with the token. Safety re-runs on consume.
6. **Execute** — calls the wallet via NIP-47. On success: budget records principal + (over-rounded) fees.
7. **Audit log** — every attempt (success, blocked, error) is appended as one structured JSON line per call.

**The floor is your NWC connection's own daily cap, set in your wallet.** This server's checks are belt-and-suspenders on top — if you trust nothing about the server, the wallet still won't spend past its connection-level cap.

### Verifying calls actually went through

Independent of what the LLM tells you, `tail` the audit log:

```bash
tail -n 5 nwc-mcp.log
```

Successful call: `{"ts":"...","tool":"nwc_pay_invoice","outcome":"ok","result":{"paid_sats":50,...}}`. Blocked: `{"ts":"...","tool":"nwc_pay_invoice","outcome":"blocked","blocked_reason":"..."}`. The audit log is **append-only by intent**; rotate it as part of your operational hygiene.

---

## Testing

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # 25 vitest cases covering Allowlist, ConfirmStore, evaluateSafety, decodeLnurl
pnpm build       # produces dist/index.js (~47 KB ESM bundle)
```

`evaluateSafety` is a pure function that the unit tests exercise across the full safety matrix (read-only / amount-conflict / allowlist / budget / confirm) without touching a real wallet.

For end-to-end smoke testing against a live wallet, see [`paywall-mcp-test/`](../paywall-mcp-test/) in the parent project — a throwaway second MCP server that exposes one paid tool (`premium_compliment`) and validates the full agent → invoice → pay → redeem loop.

---

## License

MIT — see [`LICENSE`](./LICENSE).

## Contact / Issues

Built by **LLMOps.Pro**.

- **NOSTR:** [`npub1hdg932jvwc3jdvkqywgqv0ue4nn60exrf92asy8mtazt3hjg7d2s2yw0nw`](https://njump.me/npub1hdg932jvwc3jdvkqywgqv0ue4nn60exrf92asy8mtazt3hjg7d2s2yw0nw) — follow, DM, zap.
- **Lightning Address:** `sovereigncitizens@getalby.com` — for support zaps and "this was useful" tips.
- **Bug reports / feature requests:** open a GitHub issue (https://github.com/llmops-pro/nwc-mcp).
- **Security issues:** please disclose privately via NOSTR DM before opening a public issue.
