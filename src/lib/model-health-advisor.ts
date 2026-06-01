import { nvidiaChat } from "@/lib/nvidia";
import { logger } from "@/lib/logger";
import {
  CANDIDATE_POOL,
  discoverAvailableModels,
  getLatestModelStatuses,
  type ModelStatus,
} from "@/lib/model-health";

/**
 * Self-healing model health — Phase 3 (AI advisory + human-gated intake).
 *
 * This module never mutates the live roster or CANDIDATE_POOL. It surfaces
 * an advisory: which pooled models are degrading, which fresh catalog models
 * look worth a human evaluation, and an LLM-authored "best-for-job" summary.
 * A human still has to vet + promote any new catalog model into CANDIDATE_POOL
 * before it can ever touch clinical reasoning.
 *
 * Probes/advice run on the low-priority "crawl" key pool so they never starve
 * a live clinical query (which uses "triage"/"debate").
 */

const ADVISOR_MODEL = "meta/llama-3.3-70b-instruct";

const ADVISOR_SYSTEM =
  "You are MedIQ's model-operations advisor. Given live NVIDIA model health, " +
  "recommend the best fast+reliable models per tier for a clinical reasoning swarm. " +
  "Be concise and specific. Advisory only — do not invent models not in the data.";

// Positive heuristic: looks like a chat/instruct model worth evaluating.
const CHAT_HINTS = ["nemotron", "llama", "mistral", "qwen", "gemma", "phi"];
const CHAT_SUFFIX = /-(it|flash|pro)$/;

// Negative heuristic: not a general chat model (embedders, vision, guards, etc.).
const EXCLUDE_HINTS = [
  "embed",
  "vision",
  "-vl",
  "guard",
  "safety",
  "rerank",
  "ocr",
  "parse",
  "clip",
  "reward",
  "translate",
  "embedqa",
  "nemoretriever",
];

function looksLikeChatModel(id: string): boolean {
  const lower = id.toLowerCase();
  if (EXCLUDE_HINTS.some((bad) => lower.includes(bad))) return false;
  if (lower.includes("instruct") || lower.includes("chat")) return true;
  if (CHAT_SUFFIX.test(lower)) return true;
  return CHAT_HINTS.some((hint) => lower.includes(hint));
}

/**
 * Diff the live NVIDIA catalog against CANDIDATE_POOL and return plausible
 * chat/instruct catalog ids that are NOT already vetted. Returns [] on failure.
 */
export async function findNewCatalogModels(): Promise<string[]> {
  try {
    const available = await discoverAvailableModels();
    if (available.size === 0) return [];
    const pooled = new Set(CANDIDATE_POOL.map((c) => c.model));
    return Array.from(available)
      .filter((id) => !pooled.has(id))
      .filter(looksLikeChatModel)
      .sort();
  } catch (err) {
    logger.error("[model-advisor] findNewCatalogModels failed", err);
    return [];
  }
}

export interface ModelAdvice {
  recommendation: string;
  degrading: string[];
  newModels: string[];
}

function fallbackRecommendation(degrading: string[], newModels: string[]): string {
  const degradingLine = degrading.length
    ? `Degrading models to avoid for now: ${degrading.join(", ")}.`
    : "No models are currently degrading.";
  const newLine = newModels.length
    ? `New catalog models worth human evaluation: ${newModels.join(", ")}.`
    : "No new catalog models detected.";
  return `Advisor LLM unavailable — deterministic summary. ${degradingLine} ${newLine}`;
}

function buildStatusTable(statuses: ModelStatus[]): string {
  const header = "model\ttier\tclassification\tlatencyMs";
  const rows = statuses.map(
    (s) => `${s.model}\t${s.tier ?? "unknown"}\t${s.classification}\t${s.latencyMs ?? "n/a"}`,
  );
  return [header, ...rows].join("\n");
}

/**
 * Run one advisory pass: classify pooled models, diff the catalog for new
 * candidates, and ask the advisor model for a concise best-for-job summary.
 * Purely advisory — never mutates roster/pool. Never throws.
 */
export async function runAdvisorPass(): Promise<ModelAdvice> {
  const [statuses, newModels] = await Promise.all([getLatestModelStatuses(), findNewCatalogModels()]);

  const degrading = statuses
    .filter((s) => s.classification === "down" || s.classification === "healthy-slow")
    .map((s) => s.model);

  const table = buildStatusTable(statuses);
  const user = [
    "Live NVIDIA model health for MedIQ's clinical reasoning swarm:",
    "",
    table,
    "",
    `Currently degrading (down/slow): ${degrading.length ? degrading.join(", ") : "none"}.`,
    `New catalog models not yet in the vetted pool: ${newModels.length ? newModels.join(", ") : "none"}.`,
    "",
    "Recommend the best fast+reliable models to prefer per tier (anchor/fast/reasoning),",
    "note what is degrading and should be avoided, and flag which new catalog models look",
    "worth evaluating. Keep it concise.",
  ].join("\n");

  let recommendation: string;
  try {
    recommendation = await nvidiaChat(ADVISOR_MODEL, ADVISOR_SYSTEM, user, 0.2, 700, "crawl");
  } catch (err) {
    logger.error("[model-advisor] advisor LLM call failed", err);
    recommendation = fallbackRecommendation(degrading, newModels);
  }

  return { recommendation, degrading, newModels };
}
