import { z } from "zod";

const boolish = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const csv = z
  .string()
  .optional()
  .transform((v) =>
    v
      ? v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  );

const positiveInt = z.coerce.number().int().positive();

const ConfigSchema = z.object({
  NWC_CONNECTION_STRING: z
    .string()
    .min(1, "NWC_CONNECTION_STRING is required (nostr+walletconnect://...)")
    .refine(
      (s) => s.startsWith("nostr+walletconnect://") || s.startsWith("nostrwalletconnect://"),
      "NWC_CONNECTION_STRING must start with nostr+walletconnect:// or nostrwalletconnect://",
    ),
  NWC_DAILY_BUDGET_SATS: positiveInt,
  NWC_TOTAL_BUDGET_SATS: z.coerce.number().int().positive().optional(),
  NWC_MAX_INVOICE_SATS: z.coerce.number().int().positive().optional(),
  NWC_READ_ONLY: boolish,
  NWC_REQUIRE_CONFIRM: boolish,
  NWC_KEYSEND_ENABLED: boolish,
  NWC_ALLOWED_DESTINATIONS: csv,
  NWC_LOG_PATH: z.string().default("./nwc-mcp.log"),
  NWC_BUDGET_STATE_PATH: z.string().default("./nwc-mcp-state.json"),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    // stderr because stdout is reserved for the MCP transport
    process.stderr.write(
      `nwc-mcp: invalid configuration:\n${issues}\n\nSet the required env vars and try again.\n`,
    );
    process.exit(1);
  }
  return parsed.data;
}
