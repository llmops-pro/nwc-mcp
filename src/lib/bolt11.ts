import { decode } from "light-bolt11-decoder";

export type DecodedInvoice = {
  payment_request: string;
  amount_sats: number | null;
  description: string | null;
  payment_hash: string | null;
  expiry_seconds: number | null;
  payee_pubkey: string | null;
  network: string | null;
  expires_at: string | null;
};

type Section = { name: string; value?: unknown; letters?: string };

function findSection(sections: Section[], name: string): Section | undefined {
  return sections.find((s) => s.name === name);
}

export function decodeInvoice(invoice: string): DecodedInvoice {
  const decoded = decode(invoice) as {
    paymentRequest: string;
    sections: Section[];
    expiry?: number;
  };
  const sections = decoded.sections;

  const amountMsatSection = findSection(sections, "amount");
  const amountMsat = amountMsatSection?.value;
  const amountSats =
    typeof amountMsat === "string" || typeof amountMsat === "number"
      ? Math.floor(Number(amountMsat) / 1000)
      : null;

  const description = findSection(sections, "description")?.value;
  const paymentHash = findSection(sections, "payment_hash")?.value;
  const payee = findSection(sections, "payee")?.value;
  const network = findSection(sections, "coin_network")?.value as
    | { name?: string }
    | string
    | undefined;
  const timestampSec = Number(findSection(sections, "timestamp")?.value ?? 0);
  const expirySec = decoded.expiry ?? null;
  const expiresAt =
    timestampSec && expirySec
      ? new Date((timestampSec + expirySec) * 1000).toISOString()
      : null;

  return {
    payment_request: decoded.paymentRequest,
    amount_sats: amountSats,
    description: typeof description === "string" ? description : null,
    payment_hash: typeof paymentHash === "string" ? paymentHash : null,
    expiry_seconds: expirySec,
    payee_pubkey: typeof payee === "string" ? payee : null,
    network:
      typeof network === "string"
        ? network
        : network && typeof network === "object" && "name" in network
          ? (network.name ?? null)
          : null,
    expires_at: expiresAt,
  };
}
