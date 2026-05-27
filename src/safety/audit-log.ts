import { appendFile } from "node:fs/promises";

export type AuditEvent = {
  ts: string;
  tool: string;
  outcome: "ok" | "error" | "blocked";
  input?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  blocked_reason?: string;
};

export class AuditLog {
  constructor(private readonly path: string) {}

  async record(event: Omit<AuditEvent, "ts">): Promise<void> {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
    try {
      await appendFile(this.path, line, "utf8");
    } catch (err) {
      process.stderr.write(`nwc-mcp: failed to append audit log: ${String(err)}\n`);
    }
  }
}
