import { describe, expect, test } from "vitest";
import { buildCases } from "./cases";
import { deployedUrl, runLive, type RunResult } from "./live-runner";
import type { Recording } from "./recording";

const cases = buildCases();
const sandboxId = "a".repeat(32);
const sandbox = {
  sandboxId,
  approverToken: "a".repeat(43),
  customers: [{ customerId: "cus_1", name: "Synthetic" }],
  createdAt: "2026-10-03T00:00:00Z",
  idleDeletionDays: 7
};
const now = () => new Date("2026-10-03T00:00:00Z");
const reply = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });

function setup(selected = [cases[0]]) {
  const recordings: Recording[] = [];
  const results: RunResult[] = [];
  return {
    recordings,
    results,
    options: {
      baseUrl: "https://synthetic.invalid",
      cases: selected,
      now,
      saveRecording: (recording: Recording) => {
        const previous = recordings.findIndex(
          (item) => item.caseId === recording.caseId
        );
        if (previous < 0) recordings.push(recording);
        else recordings[previous] = recording;
      },
      saveResult: (result: RunResult) => {
        results.push(result);
      }
    }
  };
}

describe("live harness with an injected offline transport", () => {
  test.each(["budget_exhausted", "cap_reached", "rate_limited"])(
    "stops immediately on %s at sandbox creation without calling /turn",
    async (code) => {
      const { options, results, recordings } = setup(cases.slice(0, 2));
      const paths: string[] = [];
      const fetcher: typeof fetch = async (input) => {
        paths.push(String(input));
        return reply({ error: { code, message: "Synthetic cap" } }, 429);
      };
      const result = await runLive({ ...options, fetcher });
      expect(paths).toEqual(["https://synthetic.invalid/api/sandboxes"]);
      expect(result.status).toBe("stopped");
      expect(result.stopCode).toBe(code);
      expect(result.passRate).toBe("0/2");
      expect(result.usage.modelCalls).toBe(0);
      expect(recordings).toEqual([]);
      expect(results).toHaveLength(1);
    }
  );

  test.each(["budget_exhausted", "cap_reached", "rate_limited"])(
    "stops immediately on %s during a turn and never starts the next case",
    async (code) => {
      const { options } = setup(cases.slice(0, 2));
      let requests = 0;
      const fetcher: typeof fetch = async () => {
        requests++;
        return requests === 1
          ? reply(sandbox)
          : reply({ error: { code, message: "Synthetic cap" } }, 429);
      };
      const result = await runLive({ ...options, fetcher });
      expect(requests).toBe(2);
      expect(result.turnsPosted).toBe(1);
      expect(result.completedCases).toBe(0);
      expect(result.status).toBe("stopped");
    }
  );

  test("uses one sandbox for memory turns, new requests without history, and accounts for model usage", async () => {
    const memory = cases.find((item) => item.id === "remember-credit")!;
    const { options, results, recordings } = setup([memory]);
    const requests: { url: string; body: unknown }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const body: unknown = JSON.parse(String(init?.body));
      requests.push({ url: String(input), body });
      if (requests.length === 1) return reply(sandbox);
      const turn = memory.turns[requests.length - 2];
      return reply({
        ...turn.fixture,
        usage: { inputTokens: 10, outputTokens: 5, modelCalls: 2 }
      });
    };
    const result = await runLive({ ...options, fetcher });
    expect(result.status).toBe("complete");
    expect(result.passRate).toBe("1/1");
    expect(result.usage).toEqual({
      inputTokens: 20,
      outputTokens: 10,
      modelCalls: 4
    });
    expect(requests.slice(1).map((request) => request.url)).toEqual([
      `https://synthetic.invalid/api/sandboxes/${sandboxId}/customers/cus_1/turn`,
      `https://synthetic.invalid/api/sandboxes/${sandboxId}/customers/cus_1/turn`
    ]);
    expect(requests.slice(1).map((request) => request.body)).toEqual(
      memory.turns.map((turn) => turn.request)
    );
    expect(recordings[0].source).toBe("live");
    expect(recordings[0].recordedAt).toBe(now().toISOString());
    expect(JSON.stringify({ results, recordings })).not.toContain(
      "approverToken"
    );
  });

  test("creates a fresh sandbox for each case and reports failed numeric answers", async () => {
    const { options, recordings } = setup(cases.slice(0, 2));
    let creates = 0;
    let currentCase = -1;
    const fetcher: typeof fetch = async (input) => {
      if (String(input).endsWith("/api/sandboxes")) {
        creates++;
        currentCase++;
        return reply({ ...sandbox, sandboxId: String(creates).repeat(32) });
      }
      const turn = options.cases[currentCase].turns[0];
      return reply({
        ...turn.fixture,
        text: `${turn.fixture.text} Extra $999,999.99.`,
        usage: { inputTokens: 10, outputTokens: 5, modelCalls: 1 }
      });
    };
    const result = await runLive({ ...options, fetcher });
    expect(creates).toBe(2);
    expect(result.completedCases).toBe(2);
    expect(result.passRate).toBe("0/2");
    expect(
      result.cases.every((item) =>
        item.issues.some((issue) => issue.includes("ungrounded money"))
      )
    ).toBe(true);
    expect(recordings).toHaveLength(2);
  });

  test("preserves completed counts and usage when a later sandbox hits the cap", async () => {
    const { options, results, recordings } = setup(cases.slice(0, 2));
    let requests = 0;
    const fetcher: typeof fetch = async () => {
      requests++;
      if (requests === 1) return reply(sandbox);
      if (requests === 2)
        return reply({
          ...cases[0].turns[0].fixture,
          usage: { inputTokens: 10, outputTokens: 5, modelCalls: 2 }
        });
      return reply(
        { error: { code: "cap_reached", message: "Synthetic cap" } },
        429
      );
    };
    const result = await runLive({ ...options, fetcher });
    expect(result.status).toBe("stopped");
    expect(result.attemptedCases).toBe(2);
    expect(result.completedCases).toBe(1);
    expect(result.passRate).toBe("1/2");
    expect(result.usage.modelCalls).toBe(2);
    expect(recordings).toHaveLength(1);
    expect(results.map((snapshot) => snapshot.status)).toEqual([
      "running",
      "stopped"
    ]);
  });

  test("fails closed on a transport or malformed HTTP response without retries", async () => {
    for (const mode of ["transport", "schema"] as const) {
      const { options } = setup();
      let requests = 0;
      const fetcher: typeof fetch = async () => {
        requests++;
        if (mode === "transport")
          throw new Error("Synthetic transport failure");
        return reply({ invalid: true });
      };
      const result = await runLive({ ...options, fetcher });
      expect(result.status).toBe("failed");
      expect(result.stopCode).toBe("transport_or_schema_error");
      expect(requests).toBe(1);
    }
  });

  test("preserves a partial memory recording when its follow-up hits the cap", async () => {
    const memory = cases.find((item) => item.id === "remember-plan")!;
    const { options, recordings } = setup([memory]);
    let requests = 0;
    const fetcher: typeof fetch = async () => {
      requests++;
      if (requests === 1) return reply(sandbox);
      if (requests === 2)
        return reply({
          ...memory.turns[0].fixture,
          usage: { inputTokens: 10, outputTokens: 5, modelCalls: 2 }
        });
      return reply(
        { error: { code: "cap_reached", message: "Synthetic cap" } },
        429
      );
    };
    const result = await runLive({ ...options, fetcher });
    expect(result.status).toBe("stopped");
    expect(result.completedCases).toBe(0);
    expect(result.usage.modelCalls).toBe(2);
    expect(recordings[0].turns).toHaveLength(1);
  });

  test.each([
    undefined,
    "http://synthetic.invalid",
    "https://user:secret@synthetic.invalid",
    "https://synthetic.invalid?token=secret",
    "https://synthetic.invalid/path"
  ])("rejects unsafe or missing deployed origin %s", (url) => {
    expect(() => deployedUrl(url)).toThrow();
  });
});
