import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetPubMedState, searchPubMedLive } from "../../lib/rag";

vi.mock("dns", () => ({
  promises: {
    lookup: vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]),
  },
}));

const originalFetch = global.fetch;

afterAll(() => {
  global.fetch = originalFetch;
});

describe("searchPubMedLive — cache + circuit breaker (W47)", () => {
  beforeEach(() => {
    _resetPubMedState();
  });

  it("caches successful results — second call hits cache, no extra fetch", async () => {
    let calls = 0;
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      if (url.includes("esearch.fcgi")) {
        return new Response(
          JSON.stringify({ esearchresult: { idlist: ["12345"] } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      const xml =
        '<?xml version="1.0"?><article><article-title>Test Title</article-title>' +
        "<abstract>" + "X".repeat(150) + "</abstract></article>";
      return new Response(xml, { status: 200 });
    }) as typeof fetch;

    const first = await searchPubMedLive("acute pancreatitis management", 1);
    const fetchesAfterFirst = calls;
    expect(first.length).toBeGreaterThan(0);

    const second = await searchPubMedLive("acute pancreatitis management", 1);
    expect(calls).toBe(fetchesAfterFirst);
    expect(second).toEqual(first);
  });

  it("opens breaker after threshold failures", async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls += 1;
      throw new Error("network down");
    }) as typeof fetch;

    // Threshold = 5. Fire 5 distinct queries (distinct cache keys) so each
    // call actually attempts a fetch.
    for (let i = 0; i < 5; i++) {
      const out = await searchPubMedLive(`query variant ${i}`, 1);
      expect(out).toEqual([]);
    }
    expect(calls).toBeGreaterThanOrEqual(5);

    // Breaker now open. Next call short-circuits — no new fetch.
    const callsBefore = calls;
    const out = await searchPubMedLive("query variant 99", 1);
    expect(out).toEqual([]);
    expect(calls).toBe(callsBefore);
  });
});
