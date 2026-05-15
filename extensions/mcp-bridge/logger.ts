import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const SECRET_KEY = /(TOKEN|KEY|SECRET|PASSWORD|PASSWD|AUTH|CREDENTIAL|PRIVATE)/i;
const LOG_PATH = join(homedir(), ".pi", "mcp-bridge.log");

export function getLogPath(): string {
  return LOG_PATH;
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) ? "[REDACTED]" : redact(child);
    }
    return out;
  }
  if (typeof value === "string") {
    return value.replace(/(token|key|secret|password|auth|credential)=([^\s&]+)/gi, "$1=[REDACTED]");
  }
  return value;
}

export async function logDebug(message: string, details?: unknown): Promise<void> {
  await mkdir(dirname(LOG_PATH), { recursive: true });
  const entry = {
    ts: new Date().toISOString(),
    message,
    details: details === undefined ? undefined : redact(details),
  };
  await appendFile(LOG_PATH, `${JSON.stringify(entry)}\n`, "utf8");
}
