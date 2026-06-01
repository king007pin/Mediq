import { describe, expect, it, vi, beforeEach, afterAll } from "vitest";

/**
 * Unit tests for the self-healing model-health probe (src/lib/model-health.ts).
 *
 * Everything the module reaches outside its own file is mocked so the tests are
 * deterministic and never touch the network or a real database:
 *  - @/lib/nvidia            — candidate roster + key helpers
 *  - @/lib/swarm/connection-pool — dispatcher (undefined in tests)
 *  - @/lib/logger            — silence logs
 *  - @/db                    — db.insert(...).values(...) + db.select()...orderBy()
 *  - global.fetch            — discover (/models) + probe (/chat/completions)
 */

// ── Module mocks (keyed by `@/...` specifier, matching the e2e db mock pattern) ──

vi.mock("@/lib/nvidia", () => ({
  NVIDIA_SWARM_MODELS: [
    "meta/llama-3.3-70b-instruct",
    "meta/llama-3.1-8b-instruct",
    "mistralai/ministral-14b-instruct-2512",
    "nv-mistralai/mistral-nemo-12b-instruct",
  ],
  getNvidiaApiKey: () => "test-key",
  markKeyHealthy: vi.fn(),
  markKeyUnhealthy: vi.fn(),
}));

vi.mock("@/lib/swarm/connection-pool", () => ({
  getNvidiaDispatcher: () => undefined,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

// Shared mock state. `vi.hoisted` lifts these alongside the hoisted vi.mock
// factory so the factory can reference them without a TDZ error.
const h = vi.hoisted(() => {
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const insertSpy = vi.fn(() => ({ values: insertValues }));
  // Controllable report rows the select(...).orderBy() chain resolves to.
  const state: { mockReports: Array<{ model: string; status: string; latencyMs: number | null; checkedAt: Date }> } = {
    mockReports: [],
  };
  return { insertValues, insertSpy, state };
});
const { insertValues, insertSpy, state } = h;

vi.mock("@/db", () => {
  const orderBy = vi.fn(() => Promise.resolve(h.state.mockReports));
  const where = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return {
    db: {
      insert: h.insertSpy,
      select,
    },
  };
});

// `@/db/schema` is imported only for the table handle passed to db.insert/select.
vi.mock("@/db/schema", () => ({
  swarmHealthReports: { providerId: "providerId", model: "model", checkedAt: "checkedAt" },
}));

import {
  discoverAvailableModels,
  probeModel,
  runModelHealthSweep,
  classifySamples,
  resolveLiveRoster,
  healthFilter,
  _clearRosterCache,
  SAFE_DEFAULT,
  CANDIDATE_POOL,
} from "@/lib/model-health";

const originalFetch = global.fetch;
afterAll(() => {
  global.fetch = originalFetch;
});

/** Build a fetch double routing /models → discover, /chat/completions → probe. */
function makeFetch(opts: {
  discover?: { ok: boolean; ids?: string[] } | "reject";
  probe?: { status: number } | "abort";
}): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/models")) {
      if (opts.discover === "reject") throw new Error("network down");
      const d = opts.discover ?? { ok: true, ids: [] };
      return new Response(JSON.stringify({ data: (d.ids ?? []).map((id) => ({ id })) }), {
        status: d.ok ? 200 : 500,
      });
    }
    if (url.includes("/chat/completions")) {
      if (opts.probe === "abort") {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      }
      const p = opts.probe ?? { status: 200 };
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: p.status,
      });
    }
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.MODEL_HEALTH_AUTO;
  state.mockReports = [];
  insertValues.mockResolvedValue(undefined);
  _clearRosterCache();
});

describe("discoverAvailableModels", () => {
  it("returns the served model ids on a 200", async () => {
    global.fetch = makeFetch({ discover: { ok: true, ids: ["alpha", "beta"] } });
    const ids = await discoverAvailableModels();
    expect(ids).toBeInstanceOf(Set);
    expect(ids.has("alpha")).toBe(true);
    expect(ids.has("beta")).toBe(true);
    expect(ids.size).toBe(2);
  });

  it("returns an empty Set when the fetch rejects", async () => {
    global.fetch = makeFetch({ discover: "reject" });
    const ids = await discoverAvailableModels();
    expect(ids).toBeInstanceOf(Set);
    expect(ids.size).toBe(0);
  });
});

describe("probeModel", () => {
  it("200 => healthy with a non-negative latency", async () => {
    global.fetch = makeFetch({ probe: { status: 200 } });
    const r = await probeModel("meta/llama-3.1-8b-instruct");
    expect(r.status).toBe("healthy");
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(r.errorCode).toBeUndefined();
  });

  it("500 => down with errorCode '500'", async () => {
    global.fetch = makeFetch({ probe: { status: 500 } });
    const r = await probeModel("meta/llama-3.1-8b-instruct");
    expect(r.status).toBe("down");
    expect(r.errorCode).toBe("500");
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe("runModelHealthSweep", () => {
  it("marks catalog-absent candidates 'down'/'absent' without probing, persists every candidate", async () => {
    // Catalog serves every candidate EXCEPT this one — it must be flagged 'absent'
    // and must never reach the probe (chat/completions) fetch.
    const absentModel = CANDIDATE_POOL[CANDIDATE_POOL.length - 1].model;
    const servedIds = CANDIDATE_POOL.map((c) => c.model).filter((m) => m !== absentModel);

    const fetchSpy = makeFetch({
      discover: { ok: true, ids: servedIds },
      probe: { status: 200 },
    });
    global.fetch = fetchSpy;

    const result = await runModelHealthSweep();

    // No probe fetch ever targeted the absent model.
    const probedAbsent = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls.some(
      (call: unknown[]) => {
        const url = String(call[0]);
        const body = (call[1] as RequestInit | undefined)?.body;
        return url.includes("/chat/completions") && typeof body === "string" && body.includes(absentModel);
      },
    );
    expect(probedAbsent).toBe(false);

    // One row inserted per candidate.
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const insertedRows = insertValues.mock.calls[0][0] as Array<{
      model: string;
      status: string;
      errorCode: string | null;
    }>;
    expect(insertedRows).toHaveLength(CANDIDATE_POOL.length);

    const absentRow = insertedRows.find((r) => r.model === absentModel);
    expect(absentRow?.status).toBe("down");
    expect(absentRow?.errorCode).toBe("absent");

    // A served model probed 200 should be healthy.
    const healthyRow = insertedRows.find((r) => r.model === servedIds[0]);
    expect(healthyRow?.status).toBe("healthy");

    expect(result.probed).toBe(CANDIDATE_POOL.length);
    expect(result.down).toContain(absentModel);
  });
});

describe("classifySamples", () => {
  it("[down, down] (two consecutive failures) => 'down'", () => {
    expect(
      classifySamples([
        { status: "down", latencyMs: 0 },
        { status: "down", latencyMs: 0 },
      ]),
    ).toBe("down");
  });

  it("[down, healthy-fast] rides through the blip => 'healthy-fast'", () => {
    expect(
      classifySamples([
        { status: "down", latencyMs: 0 },
        { status: "healthy", latencyMs: 2000 },
      ]),
    ).toBe("healthy-fast");
  });

  it("[healthy 2000ms] => 'healthy-fast'", () => {
    expect(classifySamples([{ status: "healthy", latencyMs: 2000 }])).toBe("healthy-fast");
  });

  it("[healthy 10000ms] => 'healthy-slow'", () => {
    expect(classifySamples([{ status: "healthy", latencyMs: 10000 }])).toBe("healthy-slow");
  });

  it("[] => 'unknown'", () => {
    expect(classifySamples([])).toBe("unknown");
  });
});

describe("resolveLiveRoster", () => {
  it("returns SAFE_DEFAULT when there are no recent reports", async () => {
    state.mockReports = [];
    const roster = await resolveLiveRoster();
    expect(roster).toEqual([...SAFE_DEFAULT]);
  });

  it("caches: a second call without _clearRosterCache returns the same reference", async () => {
    state.mockReports = [];
    const first = await resolveLiveRoster();
    const second = await resolveLiveRoster();
    expect(second).toBe(first);
  });
});

describe("healthFilter", () => {
  it("returns the input unchanged when MODEL_HEALTH_AUTO is unset", async () => {
    const input = ["meta/llama-3.3-70b-instruct", "meta/llama-3.1-8b-instruct"];
    const out = await healthFilter(input);
    expect(out).toEqual(input);
  });

  it("swaps a 'down' model for a healthy-fast peer when MODEL_HEALTH_AUTO=1", async () => {
    process.env.MODEL_HEALTH_AUTO = "1";
    const now = new Date();
    // "meta/llama-3.1-70b-instruct" classified down (>=2 consecutive failures);
    // "meta/llama-3.1-8b-instruct" is a healthy-fast peer not already in the input.
    state.mockReports = [
      { model: "meta/llama-3.1-70b-instruct", status: "down", latencyMs: 0, checkedAt: now },
      { model: "meta/llama-3.1-70b-instruct", status: "down", latencyMs: 0, checkedAt: now },
      { model: "meta/llama-3.1-8b-instruct", status: "healthy", latencyMs: 1500, checkedAt: now },
    ];

    const input = ["meta/llama-3.1-70b-instruct"];
    const out = await healthFilter(input);
    expect(out).toEqual(["meta/llama-3.1-8b-instruct"]);
    expect(out).not.toContain("meta/llama-3.1-70b-instruct");
  });
});

describe("cron route auth", () => {
  it("rejects a request with no cron secret (NODE_ENV not development) with a non-200", async () => {
    const { GET } = await import("@/app/api/cron/model-health/route");
    const res = await GET(new Request("http://localhost/api/cron/model-health"));
    expect(res.status).not.toBe(200);
  });
});
