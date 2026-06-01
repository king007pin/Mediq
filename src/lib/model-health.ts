import { db } from "@/db";
import { swarmHealthReports } from "@/db/schema";
import { and, desc, eq, gte } from "drizzle-orm";
import {
  NVIDIA_SWARM_MODELS,
  getNvidiaApiKey,
  markKeyHealthy,
  markKeyUnhealthy,
} from "./nvidia";
import { getNvidiaDispatcher } from "./swarm/connection-pool";
import { logger } from "./logger";

/**
 * Self-healing model health probe (Phase 1 — observability).
 *
 * Periodically probes a vetted CANDIDATE_POOL of NVIDIA models for availability
 * and latency, classifies them fast / slow / down, and persists each result to
 * `swarm_health_reports` (providerId="nvidia"). Phase 2 consumes this to demote
 * slow/down models from the live swarm roster (see resolveLiveRoster).
 *
 * Probes run on the low-priority "crawl" key pool so they never starve a live
 * clinical query (which uses "triage"/"debate").
 */

const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";

export type ModelTier = "anchor" | "fast" | "reasoning";
export interface Candidate {
  model: string;
  tier: ModelTier;
  roles?: string[];
}

/**
 * Vetted, clinically-appropriate models (from the live NVIDIA catalog snapshot
 * 2026-06-01). Auto-selection only ever picks from this pool — a new catalog
 * model never enters clinical reasoning without human review.
 */
export const CANDIDATE_POOL: Candidate[] = [
  // anchors — synthesis + high-stakes specialties (latency-tolerant)
  { model: "meta/llama-3.3-70b-instruct", tier: "anchor" },
  { model: "meta/llama-3.1-70b-instruct", tier: "anchor" },
  { model: "writer/palmyra-med-70b-32k", tier: "anchor", roles: ["cancer_care", "gynae_oncology"] },
  // fast fan-out
  { model: "meta/llama-3.1-8b-instruct", tier: "fast" },
  { model: "mistralai/ministral-14b-instruct-2512", tier: "fast" },
  { model: "nv-mistralai/mistral-nemo-12b-instruct", tier: "fast" },
  { model: "nvidia/nvidia-nemotron-nano-9b-v2", tier: "fast" },
  { model: "nvidia/llama-3.1-nemotron-nano-8b-v1", tier: "fast" },
  { model: "google/gemma-3-12b-it", tier: "fast" },
  { model: "microsoft/phi-4-mini-instruct", tier: "fast" },
  // reasoning — MoE / mid (emergency / neuro / complex)
  { model: "qwen/qwen3-next-80b-a3b-instruct", tier: "reasoning" },
  { model: "nvidia/nemotron-nano-3-30b-a3b", tier: "reasoning" },
  { model: "nvidia/llama-3.3-nemotron-super-49b-v1", tier: "reasoning" },
  { model: "meta/llama-4-maverick-17b-128e-instruct", tier: "reasoning" },
];

/** The diversified static roster (7a56391) — always-safe fallback. */
export const SAFE_DEFAULT: readonly string[] = NVIDIA_SWARM_MODELS;

export const FAST_MS = Number(process.env.MODEL_HEALTH_FAST_MS) || 4000;
export const SLOW_MS = Number(process.env.MODEL_HEALTH_SLOW_MS) || 9000;
const PROBE_TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS) || 12000;

type ProbeResult = { status: "healthy" | "down"; latencyMs: number; errorCode?: string };

/** Minimal bounded-concurrency mapper (avoids a new dependency). */
async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Authoritative list of currently-served model IDs. Empty set on failure (caller treats as "do not prune"). */
export async function discoverAvailableModels(): Promise<Set<string>> {
  try {
    const key = getNvidiaApiKey("crawl");
    const res = await fetch(`${NVIDIA_BASE}/models`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      dispatcher: getNvidiaDispatcher(),
    } as RequestInit);
    if (!res.ok) return new Set();
    const json = (await res.json()) as { data?: Array<{ id?: string }> };
    return new Set((json.data ?? []).map((m) => m.id).filter((id): id is string => !!id));
  } catch {
    return new Set();
  }
}

/** Probe a single model with a tiny chat completion; measure latency + success. */
export async function probeModel(model: string): Promise<ProbeResult> {
  const key = getNvidiaApiKey("crawl");
  if (!key) return { status: "down", latencyMs: 0, errorCode: "no_key" };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(`${NVIDIA_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with exactly: ok" }],
        max_tokens: 8,
        temperature: 0,
      }),
      signal: ctrl.signal,
      dispatcher: getNvidiaDispatcher(),
    } as RequestInit);
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      markKeyUnhealthy(key, res.status);
      return { status: "down", latencyMs, errorCode: String(res.status) };
    }
    markKeyHealthy(key);
    return { status: "healthy", latencyMs };
  } catch (err) {
    const name = (err as Error).name;
    return { status: "down", latencyMs: Date.now() - start, errorCode: name === "AbortError" ? "timeout" : "fetch_error" };
  } finally {
    clearTimeout(timer);
  }
}

/** Discover → probe the pool → persist one swarm_health_reports row per candidate. */
export async function runModelHealthSweep(): Promise<{ probed: number; healthy: number; down: string[] }> {
  const available = await discoverAvailableModels();

  const rows = await mapWithConcurrency(CANDIDATE_POOL, 4, async (c) => {
    if (available.size > 0 && !available.has(c.model)) {
      return { model: c.model, status: "down" as const, latencyMs: 0, errorCode: "absent" };
    }
    const r = await probeModel(c.model);
    return { model: c.model, status: r.status, latencyMs: r.latencyMs, errorCode: r.errorCode };
  });

  try {
    await db.insert(swarmHealthReports).values(
      rows.map((r) => ({
        providerId: "nvidia",
        model: r.model,
        status: r.status,
        latencyMs: r.latencyMs,
        errorCode: r.errorCode ?? null,
        checkedAt: new Date(),
      })),
    );
  } catch (err) {
    logger.error("[model-health] failed to persist sweep", err);
  }

  const down = rows.filter((r) => r.status === "down").map((r) => r.model);
  logger.info(`[model-health] sweep: ${rows.length} probed, ${rows.length - down.length} healthy, ${down.length} down`);
  return { probed: rows.length, healthy: rows.length - down.length, down };
}

export type Classification = "healthy-fast" | "healthy-slow" | "down" | "unknown";

export interface ModelStatus {
  model: string;
  tier: ModelTier | null;
  classification: Classification;
  latencyMs: number | null;
  checkedAt: Date | null;
}

const WINDOW_H = Number(process.env.MODEL_HEALTH_WINDOW_H) || 24;

function classify(latencyMs: number | null, status: string): Classification {
  if (status !== "healthy") return "down";
  if (latencyMs == null) return "unknown";
  // <= FAST_MS is fast; anything slower is "healthy-slow" (usable but deprioritized,
  // and demoted by healthFilter under MODEL_HEALTH_AUTO). SLOW_MS marks the
  // boundary above which a model is clearly degraded (surfaced in advisory).
  if (latencyMs <= FAST_MS) return "healthy-fast";
  return "healthy-slow";
}

/** Latest classification per candidate model (for the dashboard). */
export async function getLatestModelStatuses(): Promise<ModelStatus[]> {
  const since = new Date(Date.now() - WINDOW_H * 3_600_000);
  const reports = await db
    .select()
    .from(swarmHealthReports)
    .where(and(eq(swarmHealthReports.providerId, "nvidia"), gte(swarmHealthReports.checkedAt, since)))
    .orderBy(desc(swarmHealthReports.checkedAt));

  const latest = new Map<string, (typeof reports)[number]>();
  for (const r of reports) if (!latest.has(r.model)) latest.set(r.model, r);

  const tierOf = new Map(CANDIDATE_POOL.map((c) => [c.model, c.tier]));
  return CANDIDATE_POOL.map((c) => {
    const r = latest.get(c.model);
    return {
      model: c.model,
      tier: tierOf.get(c.model) ?? null,
      classification: r ? classify(r.latencyMs, r.status) : "unknown",
      latencyMs: r?.latencyMs ?? null,
      checkedAt: r?.checkedAt ?? null,
    };
  });
}

// ── Phase 2: self-healing roster ─────────────────────────────────────────────

const MIN_HEALTHY_FOR_LIVE = 4;

/** Classify a model's recent samples (desc) with demotion hysteresis. */
export function classifySamples(samples: Array<{ status: string; latencyMs: number | null }>): Classification {
  if (samples.length === 0) return "unknown";
  const isDown = (s: { status: string }) => s.status !== "healthy";
  // Demote to "down" only on >=2 consecutive recent failures (ride through a single blip).
  if (samples.length >= 2 && isDown(samples[0]) && isDown(samples[1])) return "down";
  // Single recent blip but prior healthy -> use the prior healthy sample.
  const ref = isDown(samples[0]) && samples[1] && !isDown(samples[1]) ? samples[1] : samples[0];
  if (isDown(ref)) return "down";
  return classify(ref.latencyMs, ref.status);
}

/** Map of model -> hysteresis-classified health over the recent window. */
export async function classifyModels(): Promise<Map<string, Classification>> {
  const since = new Date(Date.now() - WINDOW_H * 3_600_000);
  const reports = await db
    .select()
    .from(swarmHealthReports)
    .where(and(eq(swarmHealthReports.providerId, "nvidia"), gte(swarmHealthReports.checkedAt, since)))
    .orderBy(desc(swarmHealthReports.checkedAt));

  const grouped = new Map<string, Array<{ status: string; latencyMs: number | null }>>();
  for (const r of reports) {
    const arr = grouped.get(r.model) ?? [];
    if (arr.length < 3) arr.push({ status: r.status, latencyMs: r.latencyMs });
    grouped.set(r.model, arr);
  }
  const out = new Map<string, Classification>();
  for (const [model, samples] of grouped) out.set(model, classifySamples(samples));
  return out;
}

function healthyFastModels(health: Map<string, Classification>): string[] {
  return CANDIDATE_POOL.filter((c) => health.get(c.model) === "healthy-fast").map((c) => c.model);
}

let rosterCache: { roster: string[]; expiresAt: number } | null = null;

/** Live roster derived from recent health, with a 10-min cache and SAFE_DEFAULT fallback. */
export async function resolveLiveRoster(): Promise<string[]> {
  if (rosterCache && Date.now() < rosterCache.expiresAt) return rosterCache.roster;
  let roster: string[];
  try {
    const health = await classifyModels();
    const fast = healthyFastModels(health);
    if (fast.length < MIN_HEALTHY_FOR_LIVE) {
      roster = [...SAFE_DEFAULT];
    } else {
      const anchor =
        CANDIDATE_POOL.find((c) => c.tier === "anchor" && health.get(c.model) === "healthy-fast")?.model ??
        SAFE_DEFAULT[0];
      roster = Array.from(new Set([anchor, ...fast, ...SAFE_DEFAULT]));
    }
  } catch {
    roster = [...SAFE_DEFAULT];
  }
  rosterCache = { roster, expiresAt: Date.now() + 10 * 60_000 };
  return roster;
}

/** Test/ops hook to clear the roster cache. */
export function _clearRosterCache(): void {
  rosterCache = null;
}

/**
 * Demote any down/slow model in `models` to a healthy-fast peer.
 * No-op unless MODEL_HEALTH_AUTO=1. Never throws — falls back to the input.
 */
export async function healthFilter(models: string[]): Promise<string[]> {
  if (process.env.MODEL_HEALTH_AUTO !== "1") return models;
  let health: Map<string, Classification>;
  try {
    health = await classifyModels();
  } catch {
    return models;
  }
  const peers = healthyFastModels(health).filter((m) => !models.includes(m));
  let p = 0;
  return models.map((m) => {
    const c = health.get(m);
    if ((c === "down" || c === "healthy-slow") && p < peers.length) return peers[p++];
    return m;
  });
}
