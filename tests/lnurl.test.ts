import { bech32 } from "bech32";
import { describe, expect, it } from "vitest";
import { decodeLnurl } from "../src/lib/lnurl.js";

function encodeLnurl(url: string): string {
  const words = bech32.toWords(Buffer.from(url, "utf-8"));
  return bech32.encode("lnurl", words, 2000);
}

describe("decodeLnurl", () => {
  it("roundtrips a known URL", () => {
    const url = "https://service.example.com/lnurl-pay/callback?id=abc123";
    expect(decodeLnurl(encodeLnurl(url))).toBe(url);
  });

  it("accepts uppercase input", () => {
    const url = "https://example.com/lnurlp/alice";
    expect(decodeLnurl(encodeLnurl(url).toUpperCase())).toBe(url);
  });

  it("strips a `lightning:` prefix", () => {
    const url = "https://example.com/lnurlp/bob";
    expect(decodeLnurl("lightning:" + encodeLnurl(url))).toBe(url);
  });

  it("rejects a string that doesn't start with lnurl1", () => {
    expect(() => decodeLnurl("not-an-lnurl")).toThrow(/lnurl1/);
  });

  it("rejects a bech32 string with the wrong prefix", () => {
    // bolt11 invoice — bech32 prefix is "lnbc", not "lnurl"
    expect(() =>
      decodeLnurl(
        "lnbc1u1p4ptw0hdp4wphhxapdwfjhxarpwf6zqcmgv9hxuetvypex2cm9d9mx2gr5v4ehgnp4qghwvcs008ph2fhr2e762y4jc2akg7q04sgr73wug5gyapfs0qn7gpp5jx7w9x464s7gsn8lu5427jahrruxx9hzcgp205l6avn7c2nwcq9s",
      ),
    ).toThrow();
  });
});
