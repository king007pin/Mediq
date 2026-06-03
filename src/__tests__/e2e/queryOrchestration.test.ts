import { describe, expect, it, vi, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/query/route";

const originalFetch = global.fetch;

afterAll(() => {
  global.fetch = originalFetch;
});

// Mock dependencies to run in isolation
vi.mock("@/lib/auth-guard", () => ({
  requireRole: vi.fn().mockResolvedValue({
    userId: "user-123",
    sessionId: "session-123",
    role: "clinician",
  }),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockReturnValue(undefined),
  RL_QUERY: "query",
}));

vi.mock("@/db", () => {
  const mockInsert = vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 1 }]),
    }),
  });
  const mockSelect = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([{ id: 1 }]),
      }),
    }),
  });
  return {
    db: {
      insert: mockInsert,
      select: mockSelect,
      update: vi.fn(),
    },
    dbCorpus: {
      insert: mockInsert,
      select: mockSelect,
      update: vi.fn(),
      transaction: vi.fn(async (cb) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 1 }]),
            }),
          }),
        };
        return cb(tx);
      }),
    },
    corpusRetry: vi.fn(async (fn) => fn()),
    pool: { connect: vi.fn() },
    poolCorpus: { connect: vi.fn() },
  };
});

vi.mock("@/lib/rag", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rag")>("@/lib/rag");
  return {
    ...actual,
    embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    rewriteQueryForRetrieval: vi.fn().mockResolvedValue(["rewritten query"]),
    embedBatch: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    searchByVector: vi.fn().mockResolvedValue([
      { sourceId: 1, sourceTitle: "Test Article", sourceType: "pdf", chunk: "My clinical evidence text about cardiac pain.", score: 0.9 }
    ]),
    searchByVectors: vi.fn().mockResolvedValue([
      [{ sourceId: 1, sourceTitle: "Test Article", sourceType: "pdf", chunk: "My clinical evidence text about cardiac pain.", score: 0.9 }],
    ]),
    searchPubMedLive: vi.fn().mockResolvedValue([]),
    assembleContext: vi.fn().mockReturnValue("Some assembled context"),
  };
});

vi.mock("@/lib/swarm", async () => {
  const actual = await vi.importActual<typeof import("@/lib/swarm")>("@/lib/swarm");
  return {
    ...actual,
    precomputeSwarmRouting: vi.fn().mockResolvedValue({
      hospitalDepartments: ["Cardiology", "Emergency"],
      pgSubjects: ["Cardiology"],
      swarmSize: 4,
      specialties: [
        { id: "cardio", role: "Cardiology Specialist", focus: "Heart stuff", keywords: ["cardio"], foundations: [], rulesets: [] },
        { id: "neuro", role: "Neurology Specialist", focus: "Brain stuff", keywords: ["neuro"], foundations: [], rulesets: [] },
        { id: "em", role: "Emergency Medicine Specialist", focus: "Acute care", keywords: ["em"], foundations: [], rulesets: [] },
        { id: "cc", role: "Critical Care Specialist", focus: "ICU stuff", keywords: ["cc"], foundations: [], rulesets: [] },
      ],
      models: [
        "meta/llama-3.3-70b-instruct",
        "openai/gpt-oss-120b",
        "meta/llama-4-maverick-17b-128e-instruct",
        "qwen/qwen3-next-80b-a3b-instruct",
      ]
    }),
  };
});

describe("Swarm Orchestration E2E query tests", () => {
  beforeEach(() => {
    process.env.NVIDIA_API_KEY = "mock-nvidia-key";
  });

  it("orchestrates debate, synthesis, and streams SSE events properly", async () => {
    let callCount = 0;
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      callCount++;

      if (url.includes("/chat/completions")) {
        // If it's a streaming request (synthesis agent)
        if (url.includes("/chat/completions") && callCount >= 8) {
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              const text = `CLINICAL ASSESSMENT REPORT
----------------------------------------
## • CLINICAL SUMMARY
Some clinical summary details here.

## • DIFFERENTIAL DIAGNOSIS
| Diagnosis | Likelihood | Evidence | Agent Consensus |
| --- | --- | --- | --- |
| ACS | High | Chest pressure | 7/7 agents |

## • MOST LIKELY DIAGNOSIS
The most likely diagnosis is **ACS**.
Panel agreement: 7 of 7 agents agreed on ACS as the primary diagnosis after debate.

## • DEBATE SUMMARY
Points of agreement:
- ACS is primary
Points debated:
- None

## • IMMEDIATE NEXT STEPS
1. **ECG**: Do immediate ECG. - Rationale: Settle the ACS diagnosis.

## • TREATMENT APPROACH
Stabilization priorities.

## • FIRST-LINE PHARMACOTHERAPY
| Drug (generic) | Class | Dose & Route | Frequency | Duration | Evidence | Contraindications |
| --- | --- | --- | --- | --- | --- | --- |
| Aspirin | Antiplatelet | 300mg PO | Once | Immediate | Standard of care | Allergy |

## • SECOND-LINE / ALTERNATIVES
| Drug / Intervention | Indication | Evidence | When to switch |
| --- | --- | --- | --- |

## • MONITORING PLAN
– **Lab or vital**: ECG monitoring.

## • DRUG INTERACTIONS
– No major drug-drug interaction.

## • DOSE ADJUSTMENTS
– Renal impairment: None.

## • SAFETY NOTES
Concise safety notes.

## • CAVEATS AND LIMITATIONS
* What is uncertain.`;

              const parsedJson = {
                choices: [{
                  delta: {
                    content: text
                  }
                }]
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(parsedJson)}\n\n`));
              controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
              controller.close();
            },
          });

          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }

        // Otherwise it is non-streaming (Rounds 1 & 2)
        const responseJson = {
          choices: [
            {
              message: {
                content: `Response from agent. Reviewed evidence [S1]. Severe chest pain noted.`
              }
            }
          ]
        };

        return new Response(JSON.stringify(responseJson), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    const req = new NextRequest("http://localhost/api/query", {
      method: "POST",
      body: JSON.stringify({
        question: "54M with crushing substernal chest pressure and radiating left arm pain with severe dyspnea.",
        swarmSize: 4,
      }),
    });

    const response = await POST(req);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");

    // Read stream events
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let done = false;
    let accumulatedText = "";

    while (!done) {
      const { value, done: isDone } = await reader.read();
      done = isDone;
      if (value) {
        accumulatedText += decoder.decode(value);
      }
    }

    // Verify SSE lines
    const sseLines = accumulatedText
      .split("\n\n")
      .filter((line) => line.trim().startsWith("data: "))
      .map((line) => JSON.parse(line.replace("data: ", "")));

    // Verify we have all required stream stages
    const eventTypes = sseLines.map((e) => e.type);
    
    // Should have status, swarm_config, agent (for round 1 & 2), debate_start, synthesis_start, synthesis_token, and done events
    expect(eventTypes).toContain("status");
    expect(eventTypes).toContain("swarm_config");
    expect(eventTypes).toContain("agent");
    expect(eventTypes).toContain("debate_start");
    expect(eventTypes).toContain("synthesis_start");
    expect(eventTypes).toContain("synthesis_token");
    expect(eventTypes).toContain("done");

    // The final done event should contain the audited sections and final answer
    const doneEvent = sseLines.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    expect(doneEvent.answer).toContain("CLINICAL SUMMARY");
    expect(doneEvent.answer).toContain("DIFFERENTIAL DIAGNOSIS");
    expect(doneEvent.answer).toContain("MOST LIKELY DIAGNOSIS");
    expect(doneEvent.sectionAudit.allMandatoryPresent).toBe(true);
    expect(doneEvent.agents.length).toBeGreaterThanOrEqual(2);
  });

  // Detect a synthesis (streaming) request by its body `stream: true` flag rather
  // than a call-count heuristic — research mode fires fewer calls (no Round 2).
  function mockSwarmFetch() {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!url.includes("/chat/completions")) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      const body = typeof init?.body === "string" ? init.body : "";
      if (body.includes("\"stream\":true")) {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            const text = `CLINICAL ASSESSMENT REPORT
----------------------------------------
## • CLINICAL SUMMARY
Some clinical summary details here.

## • DIFFERENTIAL DIAGNOSIS
| Diagnosis | Likelihood | Evidence | Agent Consensus |
| --- | --- | --- | --- |
| ACS | High | Chest pressure | 7/7 agents |

## • MOST LIKELY DIAGNOSIS
The most likely diagnosis is **ACS**.
Panel agreement: 7 of 7 agents agreed on ACS as the primary diagnosis after debate.

## • DEBATE SUMMARY
Points of agreement:
- ACS is primary
Points debated:
- None

## • IMMEDIATE NEXT STEPS
1. **ECG**: Do immediate ECG. - Rationale: Settle the ACS diagnosis.

## • TREATMENT APPROACH
Stabilization priorities.

## • FIRST-LINE PHARMACOTHERAPY
| Drug (generic) | Class | Dose & Route | Frequency | Duration | Evidence | Contraindications |
| --- | --- | --- | --- | --- | --- | --- |
| Aspirin | Antiplatelet | 300mg PO | Once | Immediate | Standard of care | Allergy |

## • SECOND-LINE / ALTERNATIVES
| Drug / Intervention | Indication | Evidence | When to switch |
| --- | --- | --- | --- |

## • MONITORING PLAN
– **Lab or vital**: ECG monitoring.

## • DRUG INTERACTIONS
– No major drug-drug interaction.

## • DOSE ADJUSTMENTS
– Renal impairment: None.

## • SAFETY NOTES
Concise safety notes.

## • CAVEATS AND LIMITATIONS
* What is uncertain.`;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            controller.close();
          },
        });
        return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: `Round response. Reviewed evidence [S1].` } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
  }

  async function collectSseEvents(response: Response): Promise<Array<Record<string, unknown>>> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let acc = "";
    let done = false;
    while (!done) {
      const { value, done: isDone } = await reader.read();
      done = isDone;
      if (value) acc += decoder.decode(value);
    }
    return acc
      .split("\n\n")
      .filter((l) => l.trim().startsWith("data: "))
      .map((l) => JSON.parse(l.replace("data: ", "")));
  }

  it("research mode skips Round 2 — no debate_start, still synthesizes a full report", async () => {
    global.fetch = mockSwarmFetch();

    const req = new NextRequest("http://localhost/api/query", {
      method: "POST",
      body: JSON.stringify({
        question: "54M with crushing substernal chest pressure and radiating left arm pain with severe dyspnea.",
        swarmSize: 4,
        mode: "research",
      }),
    });

    const response = await POST(req);
    expect(response.status).toBe(200);

    const events = await collectSseEvents(response);
    const types = events.map((e) => e.type);

    // Research mode: Round 2 gated off → no debate phase emitted …
    expect(types).not.toContain("debate_start");
    // … but synthesis still runs and a full report is produced.
    expect(types).toContain("synthesis_start");
    expect(types).toContain("synthesis_token");
    expect(types).toContain("done");
    const done = events.find((e) => e.type === "done") as { answer: string } | undefined;
    expect(done?.answer).toContain("MOST LIKELY DIAGNOSIS");
  });

  it("debate mode still emits debate_start (default behavior preserved)", async () => {
    global.fetch = mockSwarmFetch();

    const req = new NextRequest("http://localhost/api/query", {
      method: "POST",
      body: JSON.stringify({
        question: "54M with crushing substernal chest pressure and radiating left arm pain with severe dyspnea.",
        swarmSize: 4,
        mode: "debate",
      }),
    });

    const response = await POST(req);
    expect(response.status).toBe(200);
    const events = await collectSseEvents(response);
    expect(events.map((e) => e.type)).toContain("debate_start");
  });

  it("rejects an invalid mode value with 400 before any swarm work", async () => {
    const req = new NextRequest("http://localhost/api/query", {
      method: "POST",
      body: JSON.stringify({ question: "chest pain", mode: "argue" }),
    });

    const response = await POST(req);
    expect(response.status).toBe(400);
  });
});
