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

import { randomBytes } from "node:crypto";

export type PendingAction = {
  tool: string;
  params: Record<string, unknown>;
  amount_sats: number;
  summary: string;
};

export type StoredPendingAction = PendingAction & {
  token: string;
  expires_at: number;
};

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class ConfirmStore {
  private readonly pending = new Map<string, StoredPendingAction>();

  constructor(private readonly ttlMs: number = DEFAULT_TTL_MS) {}

  prepare(action: PendingAction): { token: string; expires_at: number } {
    this.pruneExpired();
    const token = randomBytes(16).toString("hex");
    const expires_at = Date.now() + this.ttlMs;
    this.pending.set(token, { ...action, token, expires_at });
    return { token, expires_at };
  }

  consume(token: string): StoredPendingAction | null {
    this.pruneExpired();
    const stored = this.pending.get(token);
    if (!stored) return null;
    this.pending.delete(token);
    return stored;
  }

  peek(token: string): StoredPendingAction | null {
    this.pruneExpired();
    return this.pending.get(token) ?? null;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [token, action] of this.pending) {
      if (action.expires_at <= now) this.pending.delete(token);
    }
  }
}
