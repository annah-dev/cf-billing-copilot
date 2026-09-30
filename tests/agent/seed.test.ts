// Real rows written (SQLite's own rowsWritten) for seeding and for idle deletion with the real
// engine seed, each bounded at 2,500 (D-7 sizing, docs/ARCHITECTURE.md "Budgets"). No vi.mock here:
// this file uses src/engine as it is. While the engine lane's stub is in place, seed() throws and
// the suite is skipped; it runs as soon as the real engine is on the branch.
import { describe, expect, it } from "vitest";
import { EngineError } from "../../src/contracts";
import { engine } from "../../src/engine";
import { randomHex } from "../../src/http/config";
import { ledgerOf } from "./support/helpers";

const ROWS_WRITTEN_LIMIT = 2_500;

/** True once the real engine is present. Only the foundation stub's own error means "not yet". */
function engineReady(): boolean {
  try {
    engine.seed();
    return true;
  } catch (err) {
    if (
      err instanceof EngineError &&
      err.code === "unsupported" &&
      /not implemented yet/.test(err.message)
    ) {
      return false;
    }
    throw err;
  }
}

describe.skipIf(!engineReady())("real engine seed", () => {
  it("seeds a sandbox and deletes it within 2,500 rows written each", async () => {
    const sandboxId = randomHex(16);
    const ledger = ledgerOf(sandboxId);
    const seeded = await ledger.seed({ sandboxId, tokenHash: "0".repeat(64) });
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    console.log(`seed rowsWritten=${seeded.rowsWritten}`);
    expect(seeded.rowsWritten).toBeGreaterThan(1_000);
    expect(seeded.rowsWritten).toBeLessThan(ROWS_WRITTEN_LIMIT);

    const deleted = await ledger.deleteSandboxData();
    console.log(`delete rowsWritten=${deleted.rowsWritten}`);
    expect(deleted.rowsWritten).toBeGreaterThan(1_000);
    expect(deleted.rowsWritten).toBeLessThan(ROWS_WRITTEN_LIMIT);
    // The first Durable Object call in a file pays the module load, several seconds under a
    // full parallel run; a warm seed takes well under 100 ms.
  }, 30_000);
});
