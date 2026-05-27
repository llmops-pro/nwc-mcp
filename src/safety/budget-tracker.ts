import { readFile, writeFile } from "node:fs/promises";

const DAY_MS = 24 * 60 * 60 * 1000;

type SpendEntry = { ts: number; sats: number };
type State = { entries: SpendEntry[]; total_spent_sats: number };

export type BudgetCheck = { ok: true } | { ok: false; reason: string };

export class BudgetTracker {
  private state: State = { entries: [], total_spent_sats: 0 };
  private loaded = false;

  constructor(
    private readonly path: string,
    private readonly dailyCapSats: number,
    private readonly totalCapSats: number | undefined,
    private readonly maxInvoiceSats: number | undefined,
  ) {}

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as State;
      if (
        parsed &&
        Array.isArray(parsed.entries) &&
        typeof parsed.total_spent_sats === "number"
      ) {
        this.state = parsed;
      }
    } catch {
      // file may not exist yet — fine
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await writeFile(this.path, JSON.stringify(this.state, null, 2), "utf8");
  }

  private pruneOld(): void {
    const cutoff = Date.now() - DAY_MS;
    this.state.entries = this.state.entries.filter((e) => e.ts >= cutoff);
  }

  private rollingDailySats(): number {
    this.pruneOld();
    return this.state.entries.reduce((acc, e) => acc + e.sats, 0);
  }

  async check(amountSats: number): Promise<BudgetCheck> {
    await this.load();
    if (this.maxInvoiceSats !== undefined && amountSats > this.maxInvoiceSats) {
      return {
        ok: false,
        reason: `amount ${amountSats} sats exceeds NWC_MAX_INVOICE_SATS=${this.maxInvoiceSats}`,
      };
    }
    const dailySoFar = this.rollingDailySats();
    if (dailySoFar + amountSats > this.dailyCapSats) {
      return {
        ok: false,
        reason: `would exceed NWC_DAILY_BUDGET_SATS=${this.dailyCapSats} (already spent ${dailySoFar} in the last 24h)`,
      };
    }
    if (
      this.totalCapSats !== undefined &&
      this.state.total_spent_sats + amountSats > this.totalCapSats
    ) {
      return {
        ok: false,
        reason: `would exceed NWC_TOTAL_BUDGET_SATS=${this.totalCapSats} (lifetime spent ${this.state.total_spent_sats})`,
      };
    }
    return { ok: true };
  }

  async recordSpend(amountSats: number): Promise<void> {
    await this.load();
    this.state.entries.push({ ts: Date.now(), sats: amountSats });
    this.state.total_spent_sats += amountSats;
    this.pruneOld();
    await this.save();
  }

  async snapshot(): Promise<{
    daily_spent_sats: number;
    daily_cap_sats: number;
    total_spent_sats: number;
    total_cap_sats: number | null;
    max_invoice_sats: number | null;
  }> {
    await this.load();
    return {
      daily_spent_sats: this.rollingDailySats(),
      daily_cap_sats: this.dailyCapSats,
      total_spent_sats: this.state.total_spent_sats,
      total_cap_sats: this.totalCapSats ?? null,
      max_invoice_sats: this.maxInvoiceSats ?? null,
    };
  }
}
