// Runtime helpers shared by the Worker, the Durable Objects and the Workflow: parsed config,
// UTC day arithmetic, durations, hashing and constant-time comparison. No money here.
import { EnvConfigSchema, type EnvConfig } from "../contracts";

let cached: { source: unknown; config: EnvConfig } | undefined;

/** The wrangler `vars`, parsed and validated once per env object (EnvConfigSchema). */
export function getConfig(env: Env): EnvConfig {
  if (cached?.source === env) return cached.config;
  const config = EnvConfigSchema.parse(env);
  cached = { source: env, config };
  return config;
}

const MS_PER_UNIT: Record<string, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000
};

/** "24 hours" -> milliseconds. The format is enforced by EnvConfigSchema.APPROVAL_TIMEOUT. */
export function durationMs(duration: string): number {
  const match = /^(\d+) (second|minute|hour|day)s?$/.exec(duration);
  if (!match) throw new Error(`unsupported duration: ${duration}`);
  return Number(match[1]) * MS_PER_UNIT[match[2]];
}

export const DAY_MS = MS_PER_UNIT.day;

/** UTC calendar day, YYYY-MM-DD, of an instant. */
export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** The next 00:00 UTC after an instant, as ISO-8601 (when every daily cap resets). */
export function nextUtcMidnight(nowMs: number): string {
  const d = new Date(nowMs);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
  ).toISOString();
}

export function iso(nowMs: number): string {
  return new Date(nowMs).toISOString();
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** workerd's SubtleCrypto extension (env.d.ts); the DOM lib's SubtleCrypto type hides it here. */
type WorkerdSubtle = {
  timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean;
};

/** Constant-time comparison of two equal-length hex digests (D-4). */
export function hexDigestsEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const left = enc.encode(a);
  const right = enc.encode(b);
  if (left.byteLength !== right.byteLength) return false;
  return (crypto.subtle as unknown as WorkerdSubtle).timingSafeEqual(
    left,
    right
  );
}

export function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function randomBase64Url(bytes: number): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
