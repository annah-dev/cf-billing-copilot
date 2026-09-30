// Quota Durable Object: atomic daily counters (D-7).
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { quota } from "./support/helpers";

function usedToday(q: ReturnType<typeof quota>, neurons: number) {
  const day = new Date().toISOString().slice(0, 10);
  return runInDurableObject(q, (_i, s) => {
    s.storage.sql.exec(
      "INSERT INTO counters (name, day, count) VALUES ('neurons_used', ?, ?) ON CONFLICT (name, day) DO UPDATE SET count = excluded.count",
      day,
      neurons
    );
  });
}

describe("neuron reservations", () => {
  it("grants concurrent reservations only while used plus reserved stays within the stop", async () => {
    const q = quota();
    const stop = 50_000;
    const before = await q.neuronsToday();
    await usedToday(q, stop - 250);
    try {
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          q.reserveNeurons({ estimate: 100, stop })
        )
      );
      const granted = results.filter((r) => r.ok);
      expect(granted).toHaveLength(2);
      const refused = results.find((r) => !r.ok);
      expect(refused && !refused.ok && refused.code).toBe("budget_exhausted");
      const mid = await q.neuronsToday();
      expect(mid.used + mid.reserved).toBeLessThanOrEqual(stop);

      for (const r of granted) {
        if (r.ok)
          await q.settleNeurons({ reservationId: r.reservationId, actual: 40 });
      }
      // Settling twice is a no-op.
      if (granted[0].ok) {
        await q.settleNeurons({
          reservationId: granted[0].reservationId,
          actual: 40
        });
      }
      const after = await q.neuronsToday();
      expect(after.reserved).toBe(before.reserved);
      expect(after.used).toBe(stop - 250 + 80);
    } finally {
      await usedToday(q, before.used);
    }
  });

  it("counts sandboxes per hashed IP and globally, refusing without writing", async () => {
    const q = quota();
    const ipHash = "f".repeat(64);
    expect((await q.admitSandbox({ ipHash, perIp: 1, global: 1_000 })).ok).toBe(
      true
    );
    const refused = await q.admitSandbox({ ipHash, perIp: 1, global: 1_000 });
    expect(refused.ok).toBe(false);
    const rows = await runInDurableObject(
      q,
      (_i, s) =>
        s.storage.sql
          .exec<{ count: number }>(
            "SELECT count FROM counters WHERE name = ?",
            `sandboxes_ip:${ipHash}`
          )
          .one().count
    );
    expect(rows).toBe(1);
  });
});
