import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";

// Option B (fast-model cascade) + Option C (primary token cap) for runAgent.
// Mock the NVIDIA layer so we control the per-call success/throw, and stub
// the Ruflo client so the agent falls through to the NVIDIA path.
vi.mock("@/lib/nvidia", () => ({
  hasNvidiaKey: vi.fn(() => true),
  nvidiaChat: vi.fn(),
  nvidiaChatHedged: vi.fn(),
  nvidiaChatStream: vi.fn(),
}));

vi.mock("@/lib/swarm/ruflo-client", () => ({
  callRufloApi: vi.fn(async () => null),
}));

import { runAgent } from "@/lib/swarm/agent-runner";
import { nvidiaChat, nvidiaChatHedged } from "@/lib/nvidia";
import type { SpecialtyMeta } from "@/lib/swarm/types";

const specialty: SpecialtyMeta = {
  id: "cardio",
  role: "Cardiology Specialist",
  focus: "Cardiac diagnostics",
  keywords: [],
  foundations: [],
  rulesets: [],
};

const hedged = nvidiaChatHedged as unknown as Mock;
const chat = nvidiaChat as unknown as Mock;

function abortError() {
  const e = new Error("The operation was aborted");
  e.name = "AbortError";
  return e;
}

describe("Round-1 agent timeout hardening (Option B + C)", () => {
  beforeEach(() => {
    hedged.mockReset();
    chat.mockReset();
    delete process.env.SWARM_FAST_CASCADE;
  });

  it("B: on a hedged timeout, one fast-model retry yields a REAL answer (reasoning not 'fallback')", async () => {
    hedged.mockRejectedValueOnce(abortError());
    chat.mockResolvedValueOnce("FAST REAL ANSWER");

    const reply = await runAgent("meta/llama-3.3-70b-instruct", "q", "ctx", [], 0, specialty);

    expect(reply.message).toBe("FAST REAL ANSWER");
    // Critical UX assertion: the scary banner only renders when reasoning starts
    // with "fallback". A successful cascade must NOT start with it.
    expect(reply.reasoning.startsWith("fallback")).toBe(false);
    expect(reply.reasoning).toContain("fast:");
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("B: when even the fast model fails, it degrades to the local stub with 'fallback' reasoning", async () => {
    hedged.mockRejectedValueOnce(abortError());
    chat.mockRejectedValueOnce(abortError());

    const reply = await runAgent("meta/llama-3.3-70b-instruct", "q", "ctx", [], 0, specialty);

    expect(reply.reasoning.startsWith("fallback")).toBe(true);
  });

  it("B: SWARM_FAST_CASCADE=0 disables the retry and falls straight to the stub", async () => {
    process.env.SWARM_FAST_CASCADE = "0";
    hedged.mockRejectedValueOnce(abortError());

    const reply = await runAgent("meta/llama-3.3-70b-instruct", "q", "ctx", [], 0, specialty);

    expect(chat).not.toHaveBeenCalled();
    expect(reply.reasoning.startsWith("fallback")).toBe(true);
  });

  it("C: the Round-1 primary (agentIndex 0) is capped at 2048 tokens, non-primary at 1500", async () => {
    hedged.mockResolvedValue("ok");

    await runAgent("meta/llama-3.3-70b-instruct", "q", "ctx", [], 0, specialty);
    expect(hedged.mock.calls[0][4]).toBe(2048);

    hedged.mockClear();
    await runAgent("meta/llama-3.3-70b-instruct", "q", "ctx", [], 1, specialty);
    expect(hedged.mock.calls[0][4]).toBe(1500);
  });
});
