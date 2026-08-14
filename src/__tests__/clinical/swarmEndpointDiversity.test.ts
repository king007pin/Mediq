import { describe, expect, it } from "vitest";
import { mapUnstableModel, NVIDIA_SWARM_MODELS } from "@/lib/nvidia";
import { allocateModelsToSpecialties } from "@/lib/swarm/specialty";

// Models confirmed present in the live NVIDIA catalog (integrate.api.nvidia.com/v1/models,
// 2026-06-01). Guards against re-introducing a dead ID (like the old mixtral-8x22b-instruct).
const AVAILABLE = new Set<string>([
  "meta/llama-3.3-70b-instruct",
  "meta/llama-3.1-70b-instruct",
  "meta/llama-3.1-8b-instruct",
  "meta/llama-3.2-3b-instruct",
  "mistralai/ministral-14b-instruct-2512",
  "nv-mistralai/mistral-nemo-12b-instruct",
  "nvidia/nvidia-nemotron-nano-9b-v2",
  "nvidia/llama-3.1-nemotron-nano-8b-v1",
  "nvidia/nemotron-nano-3-30b-a3b",
  "nvidia/nemotron-3-super-120b-a12b",
  "nvidia/llama-3.3-nemotron-super-49b-v1.5",
  "nvidia/nemotron-mini-4b-instruct",
  "nvidia/nemotron-3-nano-30b-a3b",
  "google/gemma-3-12b-it",
  "microsoft/phi-4-mini-instruct",
  "qwen/qwen3-next-80b-a3b-instruct",
  "writer/palmyra-med-70b-32k",
]);

function tally(models: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const model of models) m.set(model, (m.get(model) ?? 0) + 1);
  return m;
}

describe("Swarm endpoint diversification (anti-collapse)", () => {
  it("the roster maps to many DISTINCT backends, not a single hot endpoint", () => {
    const targets = NVIDIA_SWARM_MODELS.map((m) => mapUnstableModel(m));
    const distinct = new Set(targets);
    // Before the fix this was ~2–4 (everything funneled to meta/llama-3.1-70b).
    expect(distinct.size).toBeGreaterThanOrEqual(7);
  });

  it("every map target resolves to a currently-available model (no dead IDs)", () => {
    for (const source of NVIDIA_SWARM_MODELS) {
      const target = mapUnstableModel(source);
      expect(AVAILABLE.has(target), `${source} -> ${target} not in live catalog`).toBe(true);
    }
  });

  it("the dead mixtral-8x22b id no longer maps to a heavy 70B", () => {
    const target = mapUnstableModel("mistralai/mixtral-8x22b-instruct-v0.1");
    expect(target).toBe("nv-mistralai/mistral-nemo-12b-instruct");
    expect(target).not.toContain("70b");
  });

  it("a 10-specialty swarm spreads load — no endpoint serves a burst", () => {
    const specialtyIds = [
      "system_entryway", "cardiac_care", "cancer_care", "neurosciences", "gastrosciences",
      "orthopaedics", "renal_care", "liver_transplant", "bone_marrow_transplant", "lung_transplant",
    ];
    const allocated = allocateModelsToSpecialties(specialtyIds);
    const backends = allocated.map((m) => mapUnstableModel(m));
    const counts = tally(backends);
    const maxPerEndpoint = Math.max(...counts.values());

    // The bug: 5–7 of 10 agents collapsed onto one endpoint -> 429 storm.
    // After diversification no single backend should serve more than 3 of 10.
    expect(maxPerEndpoint).toBeLessThanOrEqual(3);
    expect(counts.size).toBeGreaterThanOrEqual(7);
  });
});
