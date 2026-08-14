import { Agent } from "undici";
import { getNvidiaDispatcher } from "./swarm/connection-pool";

const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";

// Per-call chat abort budget. 45s is safe: with hedging peak concurrency is
// <=20 (10 agents x 2 keys) << 50-conn Undici pool, so the socket-starvation
// that motivated the old 32s no longer binds; 45s lets slow-but-valid
// generations finish instead of degrading to a "fallback" stub. Embeddings
// (fast endpoint) and Vision OCR (pinned) keep their own budgets.
const CHAT_TIMEOUT_MS = Number(process.env.NVIDIA_CHAT_TIMEOUT_MS) || 45_000;

type NvidiaFetchInit = RequestInit & { dispatcher?: Agent };
function nvidiaFetchInit(init: RequestInit): NvidiaFetchInit {
  return { ...init, dispatcher: getNvidiaDispatcher() };
}

export const NVIDIA_EMBED_MODEL = "nvidia/nv-embedqa-e5-v5";
export const NVIDIA_EMBED_DIMS = 1024;

// Verified against this account's actual provisioned models on 2026-08-13 —
// several previous entries were either globally retired by NVIDIA (410 Gone,
// explicit end-of-life dates) or never enabled for this account (404 "Not
// found for account", regardless of being listed in the general /v1/models
// catalog). Every ID below was confirmed with a real successful chat
// completion against this account's key before being added. See
// [[04_Security/Security Audit Findings]] / Active Session Context 2026-08-13
// in the Obsidian vault for the full investigation.
export const NVIDIA_SWARM_MODELS = [
  "meta/llama-3.3-70b-instruct",                 // primary / synthesis anchor — IM attending, 70B
  "meta/llama-3.1-8b-instruct",                  // renal care / fast, 8B
  "meta/llama-3.1-70b-instruct",                 // system entryway, 70B
  "nvidia/nemotron-3-super-120b-a12b",           // orthopaedics / rheumatology, 120B MoE
  "nvidia/nvidia-nemotron-nano-9b-v2",           // clinical pathology / metabolic, 9B
  "nvidia/llama-3.1-nemotron-nano-8b-v1",        // diagnostic radiology / fast, 8B
  "nvidia/llama-3.3-nemotron-super-49b-v1.5",    // gastrosciences / gastroenterology, 49B
  "nvidia/nemotron-mini-4b-instruct",            // emergency specialist / fast, mini
  "nvidia/nemotron-3-nano-30b-a3b"               // cardiac care / cardiovascular, 30B MoE — was "nemotron-nano-3-30b-a3b" (404), the ID is "nemotron-3-nano" (order swapped)
] as const;

export type NvidiaModel = (typeof NVIDIA_SWARM_MODELS)[number];

export type NvidiaTaskType = "triage" | "debate" | "vision" | "crawl" | "default";

const poolIndexes: Record<NvidiaTaskType, number> = {
  triage: 0,
  debate: 0,
  vision: 0,
  crawl: 0,
  default: 0,
};

// Stateful Key Health Registry (Pillar 1)
type KeyHealth = {
  key: string;
  quarantinedUntil: number; // timestamp
  consecutiveFailures: number;
};
const keyRegistry = new Map<string, KeyHealth>();

function getKeyHealthRecord(key: string): KeyHealth {
  let record = keyRegistry.get(key);
  if (!record) {
    record = { key, quarantinedUntil: 0, consecutiveFailures: 0 };
    keyRegistry.set(key, record);
  }
  return record;
}

export function markKeyHealthy(key: string): void {
  const record = getKeyHealthRecord(key);
  record.consecutiveFailures = 0;
  record.quarantinedUntil = 0;
}

export function markKeyUnhealthy(key: string, status: number): void {
  const record = getKeyHealthRecord(key);
  record.consecutiveFailures += 1;
  // Quarantine key: 3 mins for 429 rate limit, 1 min for other 5xx errors
  const cooldownMs = status === 429 ? 180_000 : 60_000;
  record.quarantinedUntil = Date.now() + cooldownMs;
  console.warn(`[NVIDIA Key Registry] Key starting with ${key.slice(0, 12)}... marked unhealthy (status ${status}). Quarantined for ${cooldownMs / 1000}s. Consecutive failures: ${record.consecutiveFailures}`);
}

export function resetApiKeyRotation(): void {
  poolIndexes.triage = 0;
  poolIndexes.debate = 0;
  poolIndexes.vision = 0;
  poolIndexes.crawl = 0;
  poolIndexes.default = 0;
  keyRegistry.clear();
}

/**
 * Retrieves the next healthy NVIDIA API key, load-balanced dynamically.
 * Incorporates active health circuit-breaking and dynamic cooperative pool borrowing (Pillar 2).
 */
export function getNvidiaApiKey(task: NvidiaTaskType = "default"): string {
  const envMap: Record<NvidiaTaskType, string | undefined> = {
    triage: process.env.NVIDIA_KEY_TRIAGE_POOL,
    debate: process.env.NVIDIA_KEY_DEBATE_POOL,
    vision: process.env.NVIDIA_KEY_VISION_POOL,
    crawl: process.env.NVIDIA_KEY_CRAWL_POOL,
    default: undefined,
  };

  const keysStr = envMap[task] || process.env.NVIDIA_API_KEY || "";
  if (!keysStr) return "";
  const keys = keysStr.split(",").map(k => k.trim()).filter(Boolean);
  if (keys.length === 0) return "";

  // 1. Try to find a healthy key in the dedicated pool
  const healthyKeys = keys.filter(k => {
    const health = keyRegistry.get(k);
    return !health || health.quarantinedUntil <= Date.now();
  });

  if (healthyKeys.length > 0) {
    const idx = poolIndexes[task];
    poolIndexes[task] = (idx + 1) % healthyKeys.length;
    return healthyKeys[idx % healthyKeys.length];
  }

  // 2. Cooperative borrowing failover: dedicated pool exhausted, borrow a healthy key from the cooperative fabric
  const masterKeysStr = process.env.NVIDIA_API_KEY || "";
  const masterKeys = masterKeysStr.split(",").map(k => k.trim()).filter(Boolean);
  const healthyMasterKeys = masterKeys.filter(k => {
    const health = keyRegistry.get(k);
    return !health || health.quarantinedUntil <= Date.now();
  });

  if (healthyMasterKeys.length > 0) {
    console.warn(`[NVIDIA Key Router] Dedicated "${task}" pool has no healthy keys. Borrowing healthy key from Cooperative Key Fabric.`);
    const idx = poolIndexes[task];
    poolIndexes[task] = (idx + 1) % healthyMasterKeys.length;
    return healthyMasterKeys[idx % healthyMasterKeys.length];
  }

  // 3. Disaster recovery: all 20 keys quarantined! Fallback to round-robin on original keys
  const idx = poolIndexes[task];
  poolIndexes[task] = (idx + 1) % keys.length;
  return keys[idx % keys.length];
}

async function nvidiaFetch(path: string, body: unknown, timeoutMs = 32_000, task: NvidiaTaskType = "default"): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const start = Date.now();
    let attempt = 0;
    let res: Response;
    while (true) {
      const apiKey = getNvidiaApiKey(task);
      if (!apiKey) throw new Error("NVIDIA_API_KEY not configured");
      const init = nvidiaFetchInit({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      }) as RequestInit;

      res = await fetch(`${NVIDIA_BASE}${path}`, init);
      if (res.ok) {
        markKeyHealthy(apiKey);
        break;
      }

      markKeyUnhealthy(apiKey, res.status);
      // 404/410 usually means the model itself was retired or renamed on NVIDIA's
      // side (not a key problem) -- log the body so that shows up immediately
      // instead of silently degrading through the whole fallback cascade.
      if (res.status === 404 || res.status === 410) {
        const bodyText = await res.clone().text().catch(() => "");
        console.warn(`[NVIDIA] Model unavailable (${res.status}) on ${path}, model=${(body as Record<string, unknown>)?.model}: ${bodyText.slice(0, 300)}`);
      }

      const isTransient = (res.status >= 500 && res.status < 600) || res.status === 429;
      if (isTransient && attempt < 3) {
        const elapsed = Date.now() - start;
        // Calculate backoff: 500ms, 1000ms, 2000ms with random jitter
        const backoffBase = Math.pow(2, attempt) * 500;
        const jitter = Math.random() * 400;
        const delay = backoffBase + jitter;

        if (elapsed + delay + 500 < timeoutMs) {
          attempt++;
          
          // Model Fallback Cascade (Pillar 4) on 3rd attempt
          if (attempt >= 2 && typeof body === "object" && body !== null) {
            const mutableBody = body as Record<string, unknown>;
            if (typeof mutableBody.model === "string" && mutableBody.model !== "meta/llama-3.3-70b-instruct") {
              const prevModel = mutableBody.model;
              mutableBody.model = "meta/llama-3.3-70b-instruct";
              console.warn(`[NVIDIA Fetch] Model ${prevModel} failing. Cascading to ultra-stable meta/llama-3.3-70b-instruct on attempt ${attempt + 1}.`);
            }
          }

          console.warn(`[NVIDIA Fetch] Transient failure (${res.status}) on ${path}. Retrying with next rotated key in ${delay.toFixed(0)}ms (attempt ${attempt}/3)...`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }

      const text = await res.text().catch(() => "");
      throw new Error(`NVIDIA API ${path} failed (${res.status}): ${text.slice(0, 200)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function nvidiaEmbedBatch(
  texts: string[],
  inputType: "query" | "passage" = "passage",
  task: NvidiaTaskType = "default",
): Promise<number[][]> {
  const BATCH = 64;
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH);
    const data = (await nvidiaFetch("/embeddings", {
      input: slice,
      model: NVIDIA_EMBED_MODEL,
      encoding_format: "float",
      input_type: inputType,
    }, 32_000, task)) as { data: Array<{ embedding: number[] }> };
    results.push(...data.data.map((d) => d.embedding));
  }
  return results;
}

export async function nvidiaEmbed(
  text: string,
  inputType: "query" | "passage" = "passage",
  task: NvidiaTaskType = "default",
): Promise<number[]> {
  const [vec] = await nvidiaEmbedBatch([text], inputType, task);
  if (!vec) throw new Error("NVIDIA embeddings returned no vector");
  return vec;
}

// Per-model NIM constraints — wrong values cause 400/410
const MODEL_CONFIGS: Record<string, { maxTokens: number; temperature: number }> = {
  "meta/llama-3.3-70b-instruct":                 { maxTokens: 4096, temperature: 0.3 },
  "meta/llama-3.1-70b-instruct":                 { maxTokens: 4096, temperature: 0.3 },
  "meta/llama-3.1-8b-instruct":                  { maxTokens: 4096, temperature: 0.3 },
  "openai/gpt-oss-120b":                          { maxTokens: 4096, temperature: 0.3 },
  "meta/llama-4-maverick-17b-128e-instruct":      { maxTokens: 4096, temperature: 0.4 },
  "qwen/qwen3-next-80b-a3b-instruct":             { maxTokens: 4096, temperature: 0.4 },
  "mistralai/ministral-14b-instruct-2512":        { maxTokens: 4096, temperature: 0.3 },
  "nvidia/nemotron-3-super-120b-a12b":            { maxTokens: 4096, temperature: 0.3 },
  "nvidia/nemotron-nano-12b-v2-vl":              { maxTokens: 2048, temperature: 0.3 },
  "nvidia/llama-3.1-nemotron-70b-instruct":      { maxTokens: 4096, temperature: 0.3 },
  "microsoft/phi-3-mini-128k-instruct":          { maxTokens: 2048, temperature: 0.2 },
  // Fast natives added for endpoint diversification (anti-collapse roster).
  "google/gemma-3-12b-it":                        { maxTokens: 4096, temperature: 0.3 },
  "nv-mistralai/mistral-nemo-12b-instruct":       { maxTokens: 4096, temperature: 0.3 },
  "nvidia/nvidia-nemotron-nano-9b-v2":            { maxTokens: 4096, temperature: 0.3 },
  "nvidia/llama-3.1-nemotron-nano-8b-v1":         { maxTokens: 4096, temperature: 0.3 },
  "microsoft/phi-4-mini-instruct":                { maxTokens: 2048, temperature: 0.2 },
  "nvidia/nemotron-nano-3-30b-a3b":               { maxTokens: 4096, temperature: 0.3 },
};

export function mapUnstableModel(model: string): string {
  // Map obsolete, experimental, or custom models to active, high-performance SOTA models on build.nvidia.com.
  // Targets verified alive for this account 2026-08-13 (see NVIDIA_SWARM_MODELS comment above) —
  // several previous targets here were themselves retired/unprovisioned and had to be swapped.
  const mappings: Record<string, string> = {
    // nvidia/nemotron-3-super-120b-a12b is now confirmed alive and used directly in
    // NVIDIA_SWARM_MODELS, so it's no longer a redirect source.
    "nvidia/llama-3.1-nemotron-70b-instruct":  "nvidia/nvidia-nemotron-nano-9b-v2",
    "mistralai/mixtral-8x22b-instruct-v0.1":   "nv-mistralai/mistral-nemo-12b-instruct",

    // v1 superseded by v1.5 (v1.5 confirmed alive, used directly in NVIDIA_SWARM_MODELS)
    "nvidia/llama-3.3-nemotron-super-49b-v1":  "nvidia/llama-3.3-nemotron-super-49b-v1.5",
    "mistralai/ministral-14b-instruct-2512":   "nvidia/nemotron-mini-4b-instruct",
    "nv-mistralai/mistral-nemo-12b-instruct":  "nvidia/nemotron-mini-4b-instruct",
    "google/gemma-3-12b-it":                   "nvidia/llama-3.3-nemotron-super-49b-v1.5",
    "qwen/qwen3-next-80b-a3b-instruct":        "meta/llama-3.1-70b-instruct",
    "nvidia/nemotron-nano-3-30b-a3b":          "nvidia/nemotron-3-nano-30b-a3b", // word order fix

    // Lightweight / VL / experimental models mapped to DISTINCT fast text endpoints
    "nvidia/nemotron-nano-12b-v2-vl":          "nvidia/llama-3.1-nemotron-nano-8b-v1",
    "meta/llama-4-maverick-17b-128e-instruct": "nvidia/nemotron-mini-4b-instruct",
    "microsoft/phi-4-mini-instruct":           "nvidia/nemotron-mini-4b-instruct",
    "microsoft/phi-3-mini-128k-instruct":      "meta/llama-3.1-8b-instruct",

    // Primary/Oncology stays on high-quality meta/llama-3.3-70b-instruct
    "openai/gpt-oss-120b":                     "meta/llama-3.3-70b-instruct",
  };
  return mappings[model] ?? model;
}

export async function nvidiaChat(
  model: string,
  system: string,
  user: string,
  temperatureOverride?: number,
  maxTokensOverride?: number,
  task: NvidiaTaskType = "default",
): Promise<string> {
  const targetModel = mapUnstableModel(model);
  const cfg = MODEL_CONFIGS[targetModel] ?? { maxTokens: 4096, temperature: 0.3 };
  const data = (await nvidiaFetch("/chat/completions", {
    model: targetModel,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: maxTokensOverride ?? cfg.maxTokens,
    temperature: temperatureOverride ?? cfg.temperature,
    top_p: 0.9,
  }, CHAT_TIMEOUT_MS, task)) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (content == null) throw new Error("NVIDIA chat returned no choices");
  return content;
}

// ── Latency hedging (Pillar 5) ───────────────────────────────────────────────
// Fire the SAME request on a few distinct healthy keys and take the first to
// return; the slow-key / queue tail is what makes agents miss the swarm quorum
// wallclock, so racing 2 keys cuts that tail. Hedging changes the KEY only,
// never the model.
const HEDGE_TIMEOUT_MS = CHAT_TIMEOUT_MS;
const HEDGE_DISABLED = process.env.NVIDIA_HEDGE === "0";

/** Pick up to `n` DISTINCT healthy keys for a hedged dispatch, walking the same
 *  dedicated→cooperative tiers as getNvidiaApiKey. Returns fewer than `n`
 *  (possibly 0/1) when the pool is small or unhealthy. */
function pickDistinctHealthyKeys(task: NvidiaTaskType, n: number): string[] {
  const envMap: Record<NvidiaTaskType, string | undefined> = {
    triage: process.env.NVIDIA_KEY_TRIAGE_POOL,
    debate: process.env.NVIDIA_KEY_DEBATE_POOL,
    vision: process.env.NVIDIA_KEY_VISION_POOL,
    crawl: process.env.NVIDIA_KEY_CRAWL_POOL,
    default: undefined,
  };
  const collectHealthy = (keysStr: string | undefined): string[] => {
    const keys = (keysStr || "").split(",").map((k) => k.trim()).filter(Boolean);
    return keys.filter((k) => {
      const health = keyRegistry.get(k);
      return !health || health.quarantinedUntil <= Date.now();
    });
  };

  // Tier 1: dedicated pool (or master if no dedicated pool for this task)
  const healthy = collectHealthy(envMap[task] || process.env.NVIDIA_API_KEY);
  // Tier 2: borrow distinct healthy keys from the cooperative master fabric
  if (healthy.length < n) {
    for (const k of collectHealthy(process.env.NVIDIA_API_KEY)) {
      if (!healthy.includes(k)) healthy.push(k);
    }
  }
  if (healthy.length === 0) return [];

  // Round-robin offset so concurrent agents fan out across the pool.
  const offset = poolIndexes[task] % healthy.length;
  poolIndexes[task] = (poolIndexes[task] + n) % healthy.length;
  const picked: string[] = [];
  for (let i = 0; i < Math.min(n, healthy.length); i++) {
    picked.push(healthy[(offset + i) % healthy.length]);
  }
  return picked;
}

/** One hedged chat attempt against a pinned key, abortable via `signal`. */
async function hedgedChatAttempt(
  body: Record<string, unknown>,
  apiKey: string,
  signal: AbortSignal,
): Promise<string> {
  const res = await fetch(`${NVIDIA_BASE}/chat/completions`, nvidiaFetchInit({
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal,
  }) as RequestInit);
  if (!res.ok) {
    markKeyUnhealthy(apiKey, res.status);
    const text = await res.text().catch(() => "");
    throw new Error(`NVIDIA hedged failed (${res.status}): ${text.slice(0, 120)}`);
  }
  markKeyHealthy(apiKey);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (content == null) throw new Error("NVIDIA hedged returned no content");
  return content;
}

/**
 * Latency-hedged chat. Fires the same request on up to `hedge` distinct healthy
 * keys, returns the first success, and cancels the losers. Falls back to the
 * standard rotating-retry nvidiaChat when hedging is unavailable (< 2 keys) or
 * every hedged copy fails — that fallback preserves the model-cascade safety
 * net. The model is mapped once and identical across copies: hedging never
 * substitutes the model, only the key.
 */
export async function nvidiaChatHedged(
  model: string,
  system: string,
  user: string,
  temperatureOverride?: number,
  maxTokensOverride?: number,
  task: NvidiaTaskType = "default",
  hedge = 2,
): Promise<string> {
  const keys = HEDGE_DISABLED ? [] : pickDistinctHealthyKeys(task, hedge);
  // Hedging only helps with ≥2 distinct keys; otherwise use the resilient
  // single-call path (which itself does rotating retry + model cascade).
  if (keys.length < 2) {
    return nvidiaChat(model, system, user, temperatureOverride, maxTokensOverride, task);
  }

  const targetModel = mapUnstableModel(model);
  const cfg = MODEL_CONFIGS[targetModel] ?? { maxTokens: 4096, temperature: 0.3 };
  const body = {
    model: targetModel,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: maxTokensOverride ?? cfg.maxTokens,
    temperature: temperatureOverride ?? cfg.temperature,
    top_p: 0.9,
  };

  const controllers = keys.map(() => new AbortController());
  const timers = controllers.map((c) => setTimeout(() => c.abort(), HEDGE_TIMEOUT_MS));
  try {
    const attempts = keys.map((key, i) => hedgedChatAttempt(body, key, controllers[i].signal));
    return await Promise.any(attempts);
  } catch {
    // Every hedged copy failed (AggregateError) — fall back to the resilient
    // single-call path with rotating retry + model cascade.
    return nvidiaChat(model, system, user, temperatureOverride, maxTokensOverride, task);
  } finally {
    timers.forEach(clearTimeout);
    controllers.forEach((c) => c.abort()); // cancel any still-running losers
  }
}

export function hasNvidiaKey(): boolean {
  return Boolean(getNvidiaApiKey());
}

export async function nvidiaChatStream(
  model: string,
  system: string,
  user: string,
  temperatureOverride?: number,
  maxTokensOverride?: number,
  task: NvidiaTaskType = "default",
  abortSignal?: AbortSignal,
): Promise<ReadableStream<string>> {
  let targetModel = mapUnstableModel(model);
  const cfg = MODEL_CONFIGS[targetModel] ?? { maxTokens: 4096, temperature: 0.3 };

  const start = Date.now();
  let attempt = 0;
  let res: Response;
  const timeoutMs = CHAT_TIMEOUT_MS;

  while (true) {
    const apiKey = getNvidiaApiKey(task);
    if (!apiKey) throw new Error("NVIDIA_API_KEY not configured");

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    if (abortSignal) {
      if (abortSignal.aborted) ctrl.abort();
      else abortSignal.addEventListener("abort", () => ctrl.abort(), { once: true });
    }

    try {
      res = await fetch(`${NVIDIA_BASE}/chat/completions`, nvidiaFetchInit({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: targetModel,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          max_tokens: maxTokensOverride ?? cfg.maxTokens,
          temperature: temperatureOverride ?? cfg.temperature,
          top_p: 0.9,
          stream: true,
        }),
        signal: ctrl.signal,
      }) as RequestInit);
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) {
      markKeyHealthy(apiKey);
      break;
    }

    markKeyUnhealthy(apiKey, res.status);

    const isTransient = (res.status >= 500 && res.status < 600) || res.status === 429;
    if (isTransient && attempt < 3) {
      const elapsed = Date.now() - start;
      // Calculate backoff: 500ms, 1000ms, 2000ms with random jitter
      const backoffBase = Math.pow(2, attempt) * 500;
      const jitter = Math.random() * 400;
      const delay = backoffBase + jitter;

      if (elapsed + delay + 500 < timeoutMs) {
        attempt++;
        
        // Model Fallback Cascade on final attempts
        if (attempt >= 2 && targetModel !== "meta/llama-3.3-70b-instruct") {
          console.warn(`[NVIDIA ChatStream] Model ${targetModel} failing repeatedly. Cascading stream to ultra-stable meta/llama-3.3-70b-instruct...`);
          targetModel = "meta/llama-3.3-70b-instruct";
        }

        console.warn(`[NVIDIA ChatStream] Transient failure (${res.status}). Retrying with next rotated key in ${delay.toFixed(0)}ms (attempt ${attempt}/3)...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
    }

    const text = await res.text().catch(() => "");
    throw new Error(`NVIDIA stream failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return new ReadableStream<string>({
    async pull(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            if (buffer.trim()) {
              const lines = buffer.split("\n");
              for (const line of lines) {
                if (line.startsWith("data: ")) {
                  const data = line.slice(6);
                  if (data === "[DONE]") {
                    controller.close();
                    return;
                  }
                  try {
                    const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
                    const delta = parsed.choices?.[0]?.delta?.content;
                    if (delta) controller.enqueue(delta);
                  } catch { /* ignore */ }
                }
              }
            }
            controller.close();
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          let enqueued = false;
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") {
                controller.close();
                try {
                  await reader.cancel();
                } catch {}
                return;
              }
              try {
                const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) {
                  controller.enqueue(delta);
                  enqueued = true;
                }
              } catch { /* ignore */ }
            }
          }
          if (enqueued) {
            return;
          }
        }
      } catch (err) {
        controller.error(err);
        reader.cancel().catch(() => {});
      }
    },
  });
}

// ── Vision OCR — Llama 3.2 11B Vision (Multimodal Vision OCR) ──────────────────────────────────
//
// HARD CONSTRAINTS (do not relax without sign-off):
//   • Model is PINNED to OCR_MODEL. No mapUnstableModel, no model cascade/fallback,
//     no substitution. A text-only model can't see images — silently swapping the
//     OCR model (as the old nvidiaFetch cascade does) would produce hallucinated
//     "transcriptions" of clinical documents. Retry rotates the API KEY only, never
//     the model.
//   • BYOK NEVER reaches OCR. There is no providerOverride parameter on purpose —
//     OCR always uses the built-in NVIDIA vision pool even when the user has their
//     own API key configured. Do not add an override param here.
const OCR_MODEL = process.env.NVIDIA_OCR_MODEL || "nvidia/nemotron-nano-12b-v2-vl";
const OCR_ENDPOINT =
  process.env.NVIDIA_OCR_ENDPOINT || "https://integrate.api.nvidia.com/v1/chat/completions";
const OCR_CONCURRENCY = 5;

export type OcrImage = { buffer: Buffer; mimeType: string };

/** Run async tasks with a bounded concurrency, preserving result order. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * OCR a batch of images with the pinned Llama 3.2 Vision model.
 * All requests run in parallel up to OCR_CONCURRENCY. Returns text per image, in order.
 */
export async function ocrImages(images: OcrImage[]): Promise<string[]> {
  if (images.length === 0) return [];
  const out = new Array<string>(images.length).fill("");

  await mapWithConcurrency(images, OCR_CONCURRENCY, async (img, i) => {
    const base64 = img.buffer.toString("base64");
    const dataUrl = `data:${img.mimeType};base64,${base64}`;
    
    let attempt = 0;
    const start = Date.now();
    const timeoutMs = 45_000;

    while (true) {
      const apiKey = getNvidiaApiKey("vision");
      if (!apiKey) {
        throw new Error("NVIDIA_API_KEY is not configured. Vision OCR requires an API key.");
      }

      try {
        const res = await fetch(OCR_ENDPOINT, nvidiaFetchInit({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: OCR_MODEL,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "Analyze the provided medical image objectively. " +
                          "If the image is a document (e.g., printed/handwritten prescription, lab report page, clinical letter): transcribe all text, handwritten notes, and values exactly as written without commentary. " +
                          "If the image is a scan or radiograph (e.g., X-ray, MRI, CT, Ultrasound, ECG): state the modality and anatomical region, and list all visible structural or density abnormalities objectively using medical terminology. " +
                          "Return ONLY the output. Do not add any greetings, commentary, or conversational filler.",
                  },
                  {
                    type: "image_url",
                    image_url: {
                      url: dataUrl,
                    },
                  },
                ],
              },
            ],
            max_tokens: 2048,
            temperature: 0.1,
          }),
        }) as RequestInit);

        if (res.ok) {
          markKeyHealthy(apiKey);
          const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
          const content = data.choices?.[0]?.message?.content ?? "";
          out[i] = content.trim();
          break;
        }

        markKeyUnhealthy(apiKey, res.status);
        const transient = (res.status >= 500 && res.status < 600) || res.status === 429;
        if (transient && attempt < 3) {
          const delay = Math.pow(2, attempt) * 500 + Math.random() * 400;
          if (Date.now() - start + delay + 500 < timeoutMs) {
            attempt++;
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
        }
        const text = await res.text().catch(() => "");
        throw new Error(`NVIDIA OCR (${OCR_MODEL}) failed (${res.status}): ${text.slice(0, 200)}`);
      } catch (err) {
        if (attempt < 3 && !((err as Error).name === "AbortError")) {
          attempt++;
          const delay = Math.pow(2, attempt) * 500 + Math.random() * 400;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
  });

  return out;
}

/** Single-image convenience wrapper (used by tests and single-file callers). */
export async function extractTextFromImage(buffer: Buffer, mimeType: string): Promise<string> {
  const [text] = await ocrImages([{ buffer, mimeType }]);
  return text ?? "";
}
