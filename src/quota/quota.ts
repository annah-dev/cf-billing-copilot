// One global instance (named "global"): daily counters for the public demo (DECISIONS.md D-7).
// A single Durable Object serialises every call, so each check-and-increment below is atomic:
// concurrent callers cannot both take the last sandbox or the last neurons of the day.
import { DurableObject } from "cloudflare:workers";
import { nextUtcMidnight, utcDay } from "../http/config";
import { capMessage, refusal, type Result } from "../http/errors";

export const QUOTA_NAME = "global";

export class Quota extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS counters (name TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (name, day)) WITHOUT ROWID"
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, day TEXT NOT NULL, neurons INTEGER NOT NULL) WITHOUT ROWID"
    );
  }

  /** Kept from the foundation: a binding smoke check that never writes. */
  ping(): string {
    return "quota";
  }

  private count(name: string, day: string): number {
    const row = this.ctx.storage.sql
      .exec<{
        count: number;
      }>("SELECT count FROM counters WHERE name = ? AND day = ?", name, day)
      .toArray()[0];
    return row?.count ?? 0;
  }

  private add(name: string, day: string, delta: number): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO counters (name, day, count) VALUES (?, ?, ?) ON CONFLICT (name, day) DO UPDATE SET count = count + excluded.count",
      name,
      day,
      delta
    );
  }

  /** Drop counters and reservations from earlier UTC days (a write only when some exist). */
  private prune(day: string): void {
    this.ctx.storage.sql.exec("DELETE FROM counters WHERE day < ?", day);
    this.ctx.storage.sql.exec("DELETE FROM reservations WHERE day < ?", day);
  }

  /**
   * Admit one new sandbox: per-IP (hashed, never stored raw) and global caps per UTC day.
   * A refusal writes nothing.
   */
  admitSandbox(input: {
    ipHash: string;
    perIp: number;
    global: number;
  }): Result<object> {
    const nowMs = Date.now();
    const day = utcDay(nowMs);
    const resetsAt = nextUtcMidnight(nowMs);
    const ipKey = `sandboxes_ip:${input.ipHash}`;
    if (this.count(ipKey, day) >= input.perIp) {
      return refusal(
        429,
        "cap_reached",
        capMessage("new sandboxes from one address", input.perIp),
        { name: "sandboxes_per_ip", limit: input.perIp, resetsAt }
      );
    }
    if (this.count("sandboxes", day) >= input.global) {
      return refusal(
        429,
        "cap_reached",
        capMessage("new sandboxes", input.global),
        { name: "sandboxes_global", limit: input.global, resetsAt }
      );
    }
    this.ctx.storage.transactionSync(() => {
      this.prune(day);
      this.add(ipKey, day, 1);
      this.add("sandboxes", day, 1);
    });
    return { ok: true };
  }

  /**
   * Reserve an estimated neuron cost before a model call. Granted only while used plus reserved
   * plus this estimate stays within the daily stop, so concurrent turns cannot overspend it.
   */
  reserveNeurons(input: {
    estimate: number;
    stop: number;
  }): Result<{ reservationId: string }> {
    const nowMs = Date.now();
    const day = utcDay(nowMs);
    const committed =
      this.count("neurons_used", day) + this.count("neurons_reserved", day);
    if (committed + input.estimate > input.stop) {
      return refusal(
        429,
        "budget_exhausted",
        "The demo has used its AI budget for today. It resets at 00:00 UTC.",
        {
          name: "neurons_per_day",
          limit: input.stop,
          resetsAt: nextUtcMidnight(nowMs)
        }
      );
    }
    const reservationId = crypto.randomUUID();
    this.ctx.storage.transactionSync(() => {
      this.prune(day);
      this.add("neurons_reserved", day, input.estimate);
      this.ctx.storage.sql.exec(
        "INSERT INTO reservations (id, day, neurons) VALUES (?, ?, ?)",
        reservationId,
        day,
        input.estimate
      );
    });
    return { ok: true, reservationId };
  }

  /** Replace a reservation with the neurons the call actually used (its own UTC day). */
  settleNeurons(input: { reservationId: string; actual: number }): void {
    this.ctx.storage.transactionSync(() => {
      const row = this.ctx.storage.sql
        .exec<{
          day: string;
          neurons: number;
        }>(
          "SELECT day, neurons FROM reservations WHERE id = ?",
          input.reservationId
        )
        .toArray()[0];
      if (!row) return;
      this.ctx.storage.sql.exec(
        "DELETE FROM reservations WHERE id = ?",
        input.reservationId
      );
      this.add("neurons_reserved", row.day, -row.neurons);
      this.add("neurons_used", row.day, input.actual);
    });
  }

  /** Today's neuron accounting, for tests and diagnostics. */
  neuronsToday(): { used: number; reserved: number } {
    const day = utcDay(Date.now());
    return {
      used: this.count("neurons_used", day),
      reserved: this.count("neurons_reserved", day)
    };
  }
}
