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

export class Allowlist {
  private readonly normalized: ReadonlySet<string>;

  constructor(allowed: readonly string[]) {
    this.normalized = new Set(
      allowed
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0),
    );
  }

  get enabled(): boolean {
    return this.normalized.size > 0;
  }

  isAllowed(destination: string): boolean {
    if (!this.enabled) return true;
    return this.normalized.has(destination.trim().toLowerCase());
  }

  entries(): string[] {
    return Array.from(this.normalized);
  }
}
