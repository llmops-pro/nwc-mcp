// LNURL-pay resolution: turn `name@domain.tld` (LUD-16) or a raw `lnurl1...`
// bech32 string (LUD-01 / LUD-06) into a bolt11 invoice.
//
// The Lightning Address path wraps @getalby/lightning-tools. The raw LNURL path
// is implemented directly here because the library doesn't surface a "bech32
// LNURL → invoice" helper; it's a tiny amount of code and keeps the dependency
// surface honest.
//
// Both paths default to direct (non-proxied) resolution. @getalby/lightning-tools
// otherwise routes the lookup through api.getalby.com — a poor fit for the
// sovereignty audience.

import { bech32 } from "bech32";
import { LightningAddress } from "@getalby/lightning-tools";

export type ResolvedInvoice = {
  invoice: string;
  amount_sats: number;
  callback_metadata: {
    min_sats: number;
    max_sats: number;
    comment_allowed: number;
    description: string | null;
  };
};

export async function resolveLightningAddress(
  address: string,
  amount_sats: number,
  comment: string | undefined,
): Promise<ResolvedInvoice> {
  const ln = new LightningAddress(address, { proxy: false });
  try {
    await ln.fetch();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`could not resolve LNURL-pay endpoint for ${address}: ${msg}`);
  }

  const data = ln.lnurlpData;
  if (!data) {
    throw new Error(`${address} did not return LNURL-pay metadata after fetch`);
  }

  const minSats = Math.ceil(data.min / 1000);
  const maxSats = Math.floor(data.max / 1000);
  if (amount_sats < minSats || amount_sats > maxSats) {
    throw new Error(
      `amount ${amount_sats} sats out of allowed range [${minSats}, ${maxSats}] advertised by ${address}`,
    );
  }

  const commentAllowed = data.commentAllowed ?? 0;
  if (comment) {
    if (commentAllowed === 0) {
      throw new Error(`${address} does not advertise comment support (LUD-12) — drop the comment`);
    }
    if (comment.length > commentAllowed) {
      throw new Error(
        `comment is ${comment.length} chars; ${address} allows max ${commentAllowed}`,
      );
    }
  }

  const invoice = await ln.requestInvoice({ satoshi: amount_sats, comment });
  if (!invoice.paymentRequest) {
    throw new Error(`${address} did not return a bolt11 invoice`);
  }

  return {
    invoice: invoice.paymentRequest,
    amount_sats,
    callback_metadata: {
      min_sats: minSats,
      max_sats: maxSats,
      comment_allowed: commentAllowed,
      description: data.description ?? null,
    },
  };
}

export function decodeLnurl(lnurl: string): string {
  const cleaned = lnurl.toLowerCase().trim().replace(/^lightning:/, "");
  if (!cleaned.startsWith("lnurl1")) {
    throw new Error("not an LNURL: must start with lnurl1...");
  }
  const { prefix, words } = bech32.decode(cleaned, 2000);
  if (prefix !== "lnurl") {
    throw new Error(`bech32 prefix is "${prefix}", expected "lnurl"`);
  }
  const bytes = bech32.fromWords(words);
  return Buffer.from(bytes).toString("utf-8");
}

type LnurlPayRawData = {
  tag?: string;
  callback?: string;
  minSendable?: number;
  maxSendable?: number;
  metadata?: string;
  commentAllowed?: number;
};

type LnurlCallbackResponse = {
  pr?: string;
  status?: string;
  reason?: string;
};

export async function resolveLnurl(
  lnurl: string,
  amount_sats: number,
  comment: string | undefined,
): Promise<ResolvedInvoice> {
  let url: string;
  try {
    url = decodeLnurl(lnurl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`could not decode LNURL: ${msg}`);
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`LNURL decoded to an invalid URL: ${url}`);
  }
  // Allow http only for .onion endpoints; otherwise require https.
  const isOnion = parsed.hostname.endsWith(".onion");
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isOnion)) {
    throw new Error(
      `LNURL endpoint must be HTTPS (got ${parsed.protocol}//${parsed.hostname})`,
    );
  }

  const metaResp = await fetch(url);
  if (!metaResp.ok) {
    throw new Error(`LNURL metadata fetch returned HTTP ${metaResp.status}`);
  }
  const raw = (await metaResp.json()) as LnurlPayRawData;
  if (raw.tag !== "payRequest") {
    throw new Error(
      `unsupported LNURL tag "${raw.tag ?? "missing"}" — only payRequest is supported`,
    );
  }
  if (
    typeof raw.callback !== "string" ||
    typeof raw.minSendable !== "number" ||
    typeof raw.maxSendable !== "number"
  ) {
    throw new Error("LNURL metadata is missing callback / minSendable / maxSendable");
  }

  const minSats = Math.ceil(raw.minSendable / 1000);
  const maxSats = Math.floor(raw.maxSendable / 1000);
  if (amount_sats < minSats || amount_sats > maxSats) {
    throw new Error(
      `amount ${amount_sats} sats out of allowed range [${minSats}, ${maxSats}] advertised by the LNURL endpoint`,
    );
  }

  const commentAllowed = raw.commentAllowed ?? 0;
  if (comment) {
    if (commentAllowed === 0) {
      throw new Error("LNURL endpoint does not advertise comment support (LUD-12) — drop the comment");
    }
    if (comment.length > commentAllowed) {
      throw new Error(`comment is ${comment.length} chars; endpoint allows max ${commentAllowed}`);
    }
  }

  const callbackUrl = new URL(raw.callback);
  callbackUrl.searchParams.set("amount", String(amount_sats * 1000));
  if (comment) callbackUrl.searchParams.set("comment", comment);
  const cbResp = await fetch(callbackUrl);
  if (!cbResp.ok) {
    throw new Error(`LNURL callback returned HTTP ${cbResp.status}`);
  }
  const cb = (await cbResp.json()) as LnurlCallbackResponse;
  if (cb.status === "ERROR") {
    throw new Error(`LNURL callback error: ${cb.reason ?? "unknown"}`);
  }
  if (!cb.pr) {
    throw new Error("LNURL callback returned no bolt11 (`pr` field missing)");
  }

  return {
    invoice: cb.pr,
    amount_sats,
    callback_metadata: {
      min_sats: minSats,
      max_sats: maxSats,
      comment_allowed: commentAllowed,
      description: null,
    },
  };
}
