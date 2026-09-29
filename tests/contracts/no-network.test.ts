import { describe, expect, it } from "vitest";

describe("test isolation (unit project)", () => {
  it("fails any global fetch instead of reaching the network", async () => {
    await expect(fetch("https://example.com")).rejects.toThrow(
      /Network access is disabled/
    );
  });
});
