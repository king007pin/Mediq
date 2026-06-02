import { describe, expect, it, vi, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { POST as extractPOST } from "@/app/api/lab-extract/route";
import { POST as queryPOST } from "@/app/api/query/route";

const originalFetch = global.fetch;

afterAll(() => {
  global.fetch = originalFetch;
});

// Mock dependencies to run in isolation
vi.mock("@/lib/auth-guard", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    userId: "user-123",
    sessionId: "session-123",
    role: "clinician",
  }),
  requireRole: vi.fn().mockResolvedValue({
    userId: "user-123",
    sessionId: "session-123",
    role: "clinician",
  }),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockReturnValue(undefined),
  RL_QUERY: "query",
  RL_EXTRACT: "extract",
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
      { sourceId: 1, sourceTitle: "Test Article", sourceType: "pdf", chunk: "My clinical evidence text.", score: 0.9 }
    ]),
    searchByVectors: vi.fn().mockResolvedValue([
      [{ sourceId: 1, sourceTitle: "Test Article", sourceType: "pdf", chunk: "My clinical evidence text.", score: 0.9 }],
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

describe("Multimodal Image OCR & Swarm Query E2E Integration", () => {
  beforeEach(() => {
    process.env.NVIDIA_API_KEY = "mock-nvidia-key";
  });

  it("successfully parses a prescription image, highlights critical values, and triggers the full query swarm debate", async () => {
    let callCount = 0;
    
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      callCount++;

      // 1. Intercept Vision OCR call — Llama 3.2 Vision chat completion
      const isOcr = init?.body && typeof init.body === "string" && init.body.includes("llama-3.2-90b-vision-instruct");
      if (isOcr || url.includes("nemoretriever-ocr") || url.includes("/cv/nvidia/")) {
        const lines = [
          "Doctor's Prescription Notes:",
          "Patient has severe crushing chest pressure.",
          "troponin 0.5 ng/mL",
          "potassium 7.2 mEq/L",
        ];
        return new Response(JSON.stringify({
          choices: [{
            message: {
              content: lines.join("\n")
            }
          }]
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      // 2. Intercept streaming Synthesis agent completion call
      if (url.includes("/chat/completions") && callCount >= 8) {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            const text = `CLINICAL ASSESSMENT REPORT
----------------------------------------
CLINICAL INTERPRETATION
Acute coronary syndrome with severe hyperkalemia.

DIFFERENTIAL DIAGNOSIS
- STEMI
- Hyperkalemia cardiac risk

MOST LIKELY DIAGNOSIS
STEMI secondary to LAD occlusion.

RECOMMENDED EVALUATION NOW
Urgent cardiology consultation and ECG.

EVIDENCE GAPS
None.

REFERENCES
[S1] Cardiac guidelines.`;

            const parsedJson = {
              choices: [{ delta: { content: text } }]
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

      // 3. Intercept Rounds 1 & 2 debate completions
      if (url.includes("/chat/completions")) {
        return new Response(JSON.stringify({
          choices: [{
            message: {
              content: "Reviewed chest pain and high troponin. Suggest urgent reperfusion."
            }
          }]
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    // --- STEP 1: Simulate Clinical Image File Ingestion ---
    const mockImageBuffer = Buffer.from("fake-png-image-bytes");
    const blob = new Blob([mockImageBuffer], { type: "image/png" });
    const file = new File([blob], "prescription.png", { type: "image/png" });

    const formData = new FormData();
    formData.append("file", file);

    const extractReq = new NextRequest("http://localhost/api/lab-extract", {
      method: "POST",
      body: formData,
    });

    const extractRes = await extractPOST(extractReq);
    expect(extractRes.status).toBe(200);

    const extractData = await extractRes.json() as {
      text: string;
      panel: { structuredText: string; criticals: Array<{ name: string; value: number | string }> };
    };

    expect(extractData.text).toContain("Doctor's Prescription Notes");
    expect(extractData.text).toContain("troponin 0.5");
    expect(extractData.panel.criticals).toHaveLength(2);

    const names = extractData.panel.criticals.map((c) => c.name);
    expect(names).toContain("troponin");
    expect(names).toContain("potassium");

    // --- STEP 2: Trigger Swarm Query with Extracted Lab Text Context ---
    const queryReq = new NextRequest("http://localhost/api/query", {
      method: "POST",
      body: JSON.stringify({
        question: "Is this patient stable?",
        labText: extractData.panel.structuredText,
        swarmSize: 4,
      }),
    });

    const queryRes = await queryPOST(queryReq);
    expect(queryRes.status).toBe(200);
    expect(queryRes.headers.get("Content-Type")).toBe("text/event-stream");

    // Read and verify SSE stream events
    const reader = queryRes.body!.getReader();
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

    const sseLines = accumulatedText
      .split("\n\n")
      .filter((line) => line.trim().startsWith("data: "))
      .map((line) => JSON.parse(line.replace("data: ", "")));

    const eventTypes = sseLines.map((e) => e.type);
    expect(eventTypes).toContain("status");
    expect(eventTypes).toContain("swarm_config");
    expect(eventTypes).toContain("agent");
    expect(eventTypes).toContain("debate_start");
    expect(eventTypes).toContain("synthesis_start");
    expect(eventTypes).toContain("synthesis_token");
    expect(eventTypes).toContain("done");

    const doneEvent = sseLines.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    expect(doneEvent.answer).toContain("CLINICAL ASSESSMENT REPORT");
    expect(doneEvent.answer).toContain("Acute coronary syndrome");
  });

  it("successfully parses multiple file uploads in parallel and aggregates their extracted data", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      // Intercept OCR calls — Llama 3.2 Vision chat completion
      const isOcr = init?.body && typeof init.body === "string" && init.body.includes("llama-3.2-90b-vision-instruct");
      if (isOcr || url.includes("nemoretriever-ocr") || url.includes("/cv/nvidia/")) {
        const lines = ["Doctor's Prescription Notes:", "troponin 0.5 ng/mL", "potassium 7.2 mEq/L"];
        return new Response(JSON.stringify({
          choices: [{
            message: {
              content: lines.join("\n")
            }
          }]
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    const file1 = new File([Buffer.from("Doctor's note: Under observation. Condition is stable.")], "note.txt", { type: "text/plain" });
    const file2 = new File([Buffer.from("fake-png-image-bytes")], "image.png", { type: "image/png" });

    const formData = new FormData();
    formData.append("files", file1);
    formData.append("files", file2);

    const req = new NextRequest("http://localhost/api/lab-extract", {
      method: "POST",
      body: formData,
    });

    const res = await extractPOST(req);
    expect(res.status).toBe(200);

    const data = await res.json() as {
      text: string;
      panel: { structuredText: string; criticals: Array<{ name: string; value: number | string }> };
    };

    expect(data.text).toContain("--- FILE: note.txt ---");
    expect(data.text).toContain("--- FILE: image.png ---");
    expect(data.text).toContain("Condition is stable.");
    expect(data.text).toContain("Doctor's Prescription Notes");
    expect(data.panel.criticals).toHaveLength(2);
  });

  it("successfully runs the clinical swarm assessment when question is empty but labText is provided", async () => {
    let callCount = 0;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      callCount++;

      // Intercept routing / debate / synthesis calls
      if (url.includes("/chat/completions")) {
        if (callCount >= 6) {
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              const text = `CLINICAL ASSESSMENT REPORT\nCLINICAL INTERPRETATION\nReport verified.`;
              const parsedJson = { choices: [{ delta: { content: text } }] };
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
        return new Response(JSON.stringify({
          choices: [{ message: { content: "Reviewed findings. Suggest monitoring." } }]
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    const queryReq = new NextRequest("http://localhost/api/query", {
      method: "POST",
      body: JSON.stringify({
        question: "",
        labText: "Patient CBC: WBC 14.5, Hb 11.2, Platelets 450k",
        swarmSize: 3,
      }),
    });

    const queryRes = await queryPOST(queryReq);
    expect(queryRes.status).toBe(200);

    const reader = queryRes.body!.getReader();
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

    const sseLines = accumulatedText
      .split("\n\n")
      .filter((line) => line.trim().startsWith("data: "))
      .map((line) => JSON.parse(line.replace("data: ", "")));

    const doneEvent = sseLines.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    expect(doneEvent.answer).toContain("Report verified.");
  });
});
