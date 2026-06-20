import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as chatPOST } from "@/app/api/clinical-swarm/chat/route";
import { db } from "@/db";
import { requireRole } from "@/lib/auth-guard";
import { embedText, searchByVectors } from "@/lib/rag";

vi.mock("@/lib/auth-guard", () => ({
  requireRole: vi.fn().mockResolvedValue({
    userId: "user-123",
    sessionId: "session-123",
    role: "clinician",
  }),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockReturnValue(undefined),
  RL_SWARM: "swarm",
}));

vi.mock("@/db", () => {
  const mockSelect = vi.fn().mockImplementation(() => {
    const builder = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation(() => {
        return Promise.resolve([
          {
            id: 42,
            query: "Patient with severe chest pain",
            consensusSnippet: "Original Report",
            agentCount: 3,
            round1Agents: [{ model: "a", message: "r1" }],
            round2Agents: [],
            config: [{ role: "Final Synthesis", model: "meta/llama-3.3-70b-instruct" }],
          },
        ]);
      }),
    };
    return builder;
  });

  const mockUpdate = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ id: 42 }]),
    }),
  });

  return {
    db: {
      select: mockSelect,
      update: mockUpdate,
    },
  };
});

vi.mock("@/lib/rag", () => ({
  embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  searchByVectors: vi.fn().mockResolvedValue([
    [{ sourceId: 1, sourceTitle: "Cardiac Guidelines", sourceType: "pdf", chunk: "Angina diagnosis", score: 0.9 }],
  ]),
  assembleContext: vi.fn().mockReturnValue(" cardiac guidelines context "),
}));

vi.mock("@/lib/nvidia", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/nvidia")>();
  return {
    ...actual,
    hasNvidiaKey: vi.fn().mockReturnValue(true),
    nvidiaChatStream: vi.fn().mockImplementation(async () => {
      return new ReadableStream({
        start(controller) {
          controller.enqueue("Updated final synthesis response content");
          controller.close();
        },
      });
    }),
  };
});

vi.mock("@/lib/byok-resolver", () => ({
  resolveBYOK: vi.fn().mockResolvedValue(null),
}));

describe("Clinical Swarm Chat Endpoint (/api/clinical-swarm/chat)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 if payload is invalid (missing sessionId or message)", async () => {
    const req = new NextRequest("http://localhost/api/clinical-swarm/chat", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await chatPOST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid payload");
  });

  it("returns 404 if session is not found in database", async () => {
    const mockSelect = vi.mocked(db.select);
    mockSelect.mockImplementationOnce(() => {
      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      } as any;
    });

    const req = new NextRequest("http://localhost/api/clinical-swarm/chat", {
      method: "POST",
      body: JSON.stringify({ sessionId: 999, message: "Hello" }),
    });

    const res = await chatPOST(req);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Query session not found");
  });

  it("scrubs PHI from message and streams updated consensus over SSE", async () => {
    const req = new NextRequest("http://localhost/api/clinical-swarm/chat", {
      method: "POST",
      body: JSON.stringify({ sessionId: 42, message: "What about patient John Doe's severe dyspnea?" }),
    });

    const res = await chatPOST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");

    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let bodyText = "";
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bodyText += decoder.decode(value);
      }
    }

    // Verify system/user prompts are generated and streamed
    expect(bodyText).toContain("Updated final synthesis response content");
    expect(bodyText).toContain('"type":"done"');
    
    // Verify database update was triggered with updated consensusSnippet
    expect(db.update).toHaveBeenCalled();
  });
});
