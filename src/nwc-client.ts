import { nwc } from "@getalby/sdk";

export type NwcInfo = Awaited<ReturnType<nwc.NWCClient["getInfo"]>>;
export type NwcBalance = Awaited<ReturnType<nwc.NWCClient["getBalance"]>>;
export type NwcInvoice = Awaited<ReturnType<nwc.NWCClient["makeInvoice"]>>;
export type NwcLookup = Awaited<ReturnType<nwc.NWCClient["lookupInvoice"]>>;
export type NwcTxList = Awaited<ReturnType<nwc.NWCClient["listTransactions"]>>;

export class NwcClient {
  readonly raw: nwc.NWCClient;

  constructor(connectionString: string) {
    this.raw = new nwc.NWCClient({ nostrWalletConnectUrl: connectionString });
  }

  async close(): Promise<void> {
    try {
      this.raw.close?.();
    } catch {
      // best-effort
    }
  }
}
