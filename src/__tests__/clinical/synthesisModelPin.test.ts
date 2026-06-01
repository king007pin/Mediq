import { describe, expect, it, vi, beforeEach } from "vitest";

// Quality rider: synthesis pins the strongest stable model unless the caller
// passes an explicit `model` override. Mock the agent-runner so runSwarm runs
// without any network calls and we can capture the model handed to synthesis.
vi.mock("@/lib/swarm/agent-runner", () => ({
  runAgent: vi.fn(async (model: string) => ({ model, message: "r1", reasoning: "tag", round: 1 })),
  runDebateAgent: vi.fn(async (model: string) => ({ model, message: "r2", reasoning: "tag", round: 2 })),
  runSynthesisAgent: vi.fn(async () => "REPORT"),
}));

import { runSwarm, type SwarmRouting } from "@/lib/swarm";
import { runSynthesisAgent } from "@/lib/swarm/agent-runner";

const routing: SwarmRouting = {
  hospitalDepartments: [],
  pgSubjects: [],
  swarmSize: 4,
  specialties: ["a", "b", "c", "d"].map((id) => ({
    id,
    role: `${id} specialist`,
    focus: "focus",
    keywords: [],
    foundations: [],
    rulesets: [],
  })),
  models: ["model/a", "model/b", "model/c", "model/d"],
};

const synth = vi.mocked(runSynthesisAgent);

describe("Synthesis model pin (quality rider)", () => {
  beforeEach(() => synth.mockClear());

  it("pins STRONGEST_SYNTH_MODEL when no caller override is given", async () => {
    await runSwarm({
      question: "q",
      context: "ctx",
      matches: [],
      precomputedRouting: routing,
    });

    expect(synth.mock.calls[0][0]).toBe("meta/llama-3.3-70b-instruct");
  });

  it("honors an explicit caller `model` override for synthesis", async () => {
    await runSwarm({
      question: "q",
      context: "ctx",
      matches: [],
      model: "custom/override-model",
      precomputedRouting: routing,
    });

    expect(synth.mock.calls[0][0]).toBe("custom/override-model");
  });
});
