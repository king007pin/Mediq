import { extract } from "@extractus/article-extractor";
import { YoutubeTranscript } from "youtube-transcript";
import { LRUCache } from "lru-cache";
import { hasNvidiaKey, nvidiaEmbed, nvidiaEmbedBatch, nvidiaChat } from "./nvidia";
import { poolCorpus, corpusRetry } from "@/db";
import { safeFetch, assertUrlIsPublic } from "./safe-fetch";

const MAX_PDF_BYTES = 15 * 1024 * 1024;

function normalizeWhitespace(input: string) {
  return input.replace(/\s+/g, " ").trim();
}

export { textFromPdfBuffer, textFromPdfUrl } from "./pdf";

async function fetchYoutubeAudioUrl(url: string): Promise<string> {
  const cobaltUrls = [
    "https://api.cobalt.tools/api/json",
    "https://co.wuk.sh/api/json",
  ];

  let lastErr = null;
  for (const cobaltUrl of cobaltUrls) {
    try {
      const res = await safeFetch(cobaltUrl, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url,
          isAudioOnly: true,
          audioFormat: "mp3",
        }),
      });

      if (!res.ok) continue;
      const json = await res.json() as { url?: string };
      if (json.url) return json.url;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Failed to extract YouTube audio URL: ${lastErr || "API failure"}`);
}

async function transcribeAudioWithWhisper(audioBuffer: ArrayBuffer, filename: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Neither GROQ_API_KEY nor OPENAI_API_KEY configured for Whisper fallback");
  }

  const isGroq = !!process.env.GROQ_API_KEY;
  const url = isGroq 
    ? "https://api.groq.com/openai/v1/audio/transcriptions"
    : "https://api.openai.com/v1/audio/transcriptions";
  const model = isGroq ? "whisper-large-v3" : "whisper-1";

  const formData = new FormData();
  const blob = new Blob([audioBuffer], { type: "audio/mp3" });
  formData.append("file", blob, filename);
  formData.append("model", model);

  const res = await safeFetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Whisper transcription failed (${res.status}): ${errText}`);
  }

  const json = await res.json() as { text: string };
  return json.text;
}

export async function textFromYoutubeUrl(url: string): Promise<string> {
  const videoId = extractYoutubeId(url);
  if (!videoId) throw new Error("Unable to parse YouTube video id");

  try {
    // 1. Try standard scrape first
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    const text = normalizeWhitespace(transcript.map((t) => t.text).join(" "));
    if (text) return text;
  } catch (err) {
    console.warn(`[youtube] standard transcript extraction failed for ${videoId}, falling back to Whisper:`, err);
  }

  // 2. Whisper fallback
  try {
    const audioUrl = await fetchYoutubeAudioUrl(url);
    const audioRes = await safeFetch(audioUrl, { maxBytes: 25 * 1024 * 1024 }); // 25MB cap
    if (!audioRes.ok) throw new Error(`Failed to download audio (${audioRes.status})`);
    
    const ab = await audioRes.arrayBuffer();
    const text = await transcribeAudioWithWhisper(ab, `${videoId}.mp3`);
    const cleaned = normalizeWhitespace(text);
    if (!cleaned) throw new Error("Whisper transcript is empty");
    return cleaned;
  } catch (err) {
    throw new Error(`YouTube ingestion failed: standard extraction failed, and Whisper fallback failed with: ${(err as Error).message}`);
  }
}

function extractYoutubeId(url: string) {
  const match = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/);
  return match?.[1];
}

export async function textFromWebsite(url: string): Promise<string> {
  // Pre-flight SSRF check. `extract()` and Tinyfish both make their own
  // outbound fetches that we cannot wrap; the pre-flight at least blocks
  // obvious targets (link-local, private RFC1918, loopback) before either
  // library is called. DNS-rebinding between this check and the actual
  // fetch is a known residual risk.
  await assertUrlIsPublic(url);

  // Try Tinyfish API first (handles anti-bot, JS-rendered pages)
  if (process.env.TINYFISH_API_KEY) {
    try {
      return await textFromTinyfish(url);
    } catch {
      // fall through to article-extractor
    }
  }

  // Fallback: article-extractor with browser-like headers
  const article = await extract(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  } as Parameters<typeof extract>[1]);
  if (!article) throw new Error("Could not extract article content");
  const body = normalizeWhitespace(
    [article.title, article.description, article.content].filter(Boolean).join("\n\n"),
  );
  if (!body) throw new Error("Website content was empty");
  return body;
}

async function textFromTinyfish(url: string): Promise<string> {
  // Tinyfish: JS-rendered + anti-bot bypassing web crawling API
  // Inspired by: https://github.com/tinyfish-io/tinyfish-cookbook
  const res = await safeFetch("https://api.tinyfish.io/api/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.TINYFISH_API_KEY}`,
    },
    body: JSON.stringify({ url, return_markdown: true }),
    timeoutMs: 30000,
  });
  if (!res.ok) throw new Error(`Tinyfish failed (${res.status})`);
  const data = (await res.json()) as { markdown?: string; text?: string; content?: string };
  const text = data.markdown ?? data.text ?? data.content ?? "";
  if (!text) throw new Error("Tinyfish returned empty content");
  return normalizeWhitespace(text);
}

export function chunkText(text: string, chunkSize = 900, overlap = 140) {
  const clean = normalizeWhitespace(text);
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(start + chunkSize, clean.length);
    chunks.push(clean.slice(start, end));
    if (end === clean.length) break;
    start = end - overlap;
  }
  return chunks;
}

export function cheapEmbedding(text: string, dims = 1024): number[] {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text.toLowerCase());
  const vector = new Array(dims).fill(0) as number[];
  for (let i = 0; i < bytes.length; i++) {
    vector[i % dims] += (bytes[i] - 128) / 128;
  }
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
}

let warnedCheapFallback = false;
function ensureProperEmbeddings(): boolean {
  if (hasNvidiaKey()) return true;
  // Production guard: a meaningless byte-bag fallback silently destroys RAG
  // quality. Refuse to run.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "NVIDIA_API_KEY is required in production. The cheapEmbedding fallback " +
        "produces non-semantic vectors and would collapse retrieval quality.",
    );
  }
  if (!warnedCheapFallback) {
    warnedCheapFallback = true;
    console.warn(
      "[rag] NVIDIA_API_KEY not set — using cheapEmbedding (DEV ONLY, non-semantic).",
    );
  }
  return false;
}

export async function embedText(text: string, inputType: "query" | "passage" = "passage"): Promise<number[]> {
  if (ensureProperEmbeddings()) return nvidiaEmbed(text, inputType);
  return cheapEmbedding(text);
}

export async function embedBatch(texts: string[], inputType: "query" | "passage" = "passage"): Promise<number[][]> {
  if (ensureProperEmbeddings()) return nvidiaEmbedBatch(texts, inputType);
  return texts.map((t) => cheapEmbedding(t));
}

export function cosineSimilarity(a: number[], b: number[]) {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / Math.sqrt(normA * normB);
}

export function pickTopMatches(
  questionEmbedding: number[],
  corpus: Array<{
    chunk: string;
    embedding: number[];
    sourceId: number;
    sourceTitle?: string | null;
    sourceType?: string | null;
    sourceUrl?: string | null;
    position?: number | null;
  }>,
  limit = 6,
) {
  const qDim = questionEmbedding.length;
  const scored = corpus
    .filter((item) => item.embedding.length === qDim)
    .map((item) => ({ ...item, score: cosineSimilarity(questionEmbedding, item.embedding) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export type Match = {
  chunk: string;
  sourceId?: number | null;
  sourceTitle?: string | null;
  sourceType?: string | null;
  sourceUrl?: string | null;
  position?: number | null;
  score?: number;
};

type PgVectorRow = {
  source_id: number;
  source_title: string | null;
  source_type: string | null;
  source_url: string | null;
  chunk: string;
  position: number;
  distance: number;
};

export async function searchByVectors(queryEmbeddings: number[][], topK = 10): Promise<Match[][]> {
  if (queryEmbeddings.length === 0) return [];
  const vecStrs = queryEmbeddings.map((emb) => `[${emb.join(",")}]`);
  try {
    const resultRows = await corpusRetry(() => {
      return poolCorpus.connect().then(async (client) => {
        try {
          await client.query("BEGIN");
          await client.query("SET LOCAL hnsw.ef_search = 100");
          const results: { rows: PgVectorRow[] }[] = [];
          for (const vecStr of vecStrs) {
            const r = await client.query<PgVectorRow>(
              `SELECT e.source_id, e.chunk, e.position,
                      s.title AS source_title, s.type AS source_type, s.url AS source_url,
                      (e.embedding <=> $1::vector) AS distance
               FROM embeddings e
               JOIN sources s ON s.id = e.source_id
               WHERE e.embedding IS NOT NULL AND e.chunk IS NOT NULL
               ORDER BY e.embedding <=> $1::vector
               LIMIT $2`,
              [vecStr, topK],
            );
            results.push(r);
          }
          await client.query("COMMIT");
          return results.map((res) => res.rows);
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      });
    });
    return resultRows.map((rows) =>
      rows.map((r) => ({
        chunk: r.chunk,
        sourceId: r.source_id,
        sourceTitle: r.source_title,
        sourceType: r.source_type,
        sourceUrl: r.source_url,
        position: r.position,
        score: Math.max(0, 1 - (r.distance ?? 1)),
      })),
    );
  } catch (err) {
    console.warn("[rag] Vector database offline or unconfigured, proceeding without vector matches:", (err as Error).message ?? err);
    return queryEmbeddings.map(() => []);
  }
}

export async function searchByVector(queryEmbedding: number[], topK = 10): Promise<Match[]> {
  return searchByVectors([queryEmbedding], topK).then((r) => r[0] ?? []);
}

export async function rewriteQueryForRetrieval(question: string): Promise<string[]> {
  if (!hasNvidiaKey()) return [question];
  try {
    const result = await nvidiaChat(
      "microsoft/phi-3-mini-128k-instruct",
      "You are a clinical search assistant. Your only job is to rewrite clinical questions into search queries.",
      `Rewrite this clinical question into exactly 3 distinct search queries optimised for medical literature retrieval.
Each query should target a different aspect: (1) primary diagnosis, (2) key symptoms and investigations, (3) treatment and management.
Expand all abbreviations. Include relevant clinical synonyms.
Return ONLY the 3 queries, one per line, no numbering, no explanation.

Clinical question: ${question}`,
    );
    const queries = result.split("\n").map((l) => l.trim()).filter((l) => l.length > 5).slice(0, 3);
    return queries.length >= 2 ? [question, ...queries] : [question];
  } catch {
    return [question];
  }
}

export function assembleContext(top: Match[]) {
  return top
    .map((match, idx) => {
      const parts = [
        match.sourceType ? `type:${match.sourceType.toUpperCase()}` : null,
        match.sourceTitle ? `source:"${match.sourceTitle}"` : null,
        match.sourceUrl ? `url:${match.sourceUrl}` : null,
        typeof match.score === "number" ? `relevance:${match.score.toFixed(2)}` : null,
      ].filter(Boolean).join(" | ");
      return `[S${idx + 1}] ${parts ? `(${parts})` : ""}\n${match.chunk}`;
    })
    .join("\n\n---\n\n");
}

// W47 — module-level cache + circuit breaker for live PubMed E-utility calls.
// Hot path on /api/query was making an outbound NCBI call per request with no
// throttling and no failure tracking — silent .catch(() => []) made degraded
// mode invisible. Cache hits short-circuit the round trip; breaker opens
// after consecutive failures so a long NCBI outage stops blocking queries.
//
// T1.5 (latency-v2):
//  - Map replaced with bounded LRU (200 entries) so the cache cannot grow
//    unbounded under high-cardinality query traffic.
//  - TTL extended from 5min → 6h. Clinical guideline retrieval is highly
//    stable on this timescale, and warm cache hits avoid the entire NCBI
//    round-trip (~1-14s) for repeated questions.
//  - Total searchPubMedLive budget capped at 4s via Promise.race so a slow
//    NCBI day cannot dominate request latency. esearch + efetch timeouts
//    tightened in the body below.
const PUBMED_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const PUBMED_CACHE_MAX_ENTRIES = 200;
const PUBMED_TOTAL_BUDGET_MS = 4_000;
const PUBMED_BREAKER_FAILURE_THRESHOLD = 5;
const PUBMED_BREAKER_OPEN_MS = 60 * 1000;

const pubmedGlobal = globalThis as typeof globalThis & {
  __mediqPubMedCache?: LRUCache<string, Match[]>;
  __mediqPubMedBreaker?: { failures: number; openedAt: number | null };
};

function pubmedCache(): LRUCache<string, Match[]> {
  if (!pubmedGlobal.__mediqPubMedCache) {
    pubmedGlobal.__mediqPubMedCache = new LRUCache<string, Match[]>({
      max: PUBMED_CACHE_MAX_ENTRIES,
      ttl: PUBMED_CACHE_TTL_MS,
    });
  }
  return pubmedGlobal.__mediqPubMedCache;
}
function pubmedBreaker(): { failures: number; openedAt: number | null } {
  if (!pubmedGlobal.__mediqPubMedBreaker) {
    pubmedGlobal.__mediqPubMedBreaker = { failures: 0, openedAt: null };
  }
  return pubmedGlobal.__mediqPubMedBreaker;
}
function breakerOpen(): boolean {
  const b = pubmedBreaker();
  if (b.openedAt == null) return false;
  if (Date.now() - b.openedAt > PUBMED_BREAKER_OPEN_MS) {
    b.openedAt = null;
    b.failures = 0;
    return false;
  }
  return true;
}
function recordPubMedFailure() {
  const b = pubmedBreaker();
  b.failures += 1;
  if (b.failures >= PUBMED_BREAKER_FAILURE_THRESHOLD) {
    b.openedAt = Date.now();
  }
}
function recordPubMedSuccess() {
  const b = pubmedBreaker();
  b.failures = 0;
  b.openedAt = null;
}

export function _resetPubMedState() {
  pubmedCache().clear();
  const b = pubmedBreaker();
  b.failures = 0;
  b.openedAt = null;
}

async function searchPubMedLiveInner(cleanQ: string, limit: number): Promise<Match[]> {
  const UA = "MediqRAG/1.0 (clinical research; contact: admin@mediq.ai)";
  const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
  const currentYear = new Date().getFullYear();
  const startYear = currentYear - 2;
  const term = `(${cleanQ}) AND ${startYear}:${currentYear}[pdat] AND open access[filter]`;

  const p = new URLSearchParams({
    db: "pmc",
    term: term,
    retmode: "json",
    retmax: String(limit),
  });

  const res = await safeFetch(`${EUTILS}/esearch.fcgi?${p}`, {
    headers: { "User-Agent": UA },
    timeoutMs: 2000,
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { esearchresult?: { idlist?: string[] } };
  const ids = data.esearchresult?.idlist ?? [];
  if (!ids.length) return [];

  const fetchPromises = ids.map(async (pmcId) => {
    try {
      const fp = new URLSearchParams({
        db: "pmc",
        id: pmcId,
        rettype: "abstract",
        retmode: "text",
      });
      const fetchRes = await safeFetch(`${EUTILS}/efetch.fcgi?${fp}`, {
        headers: { "User-Agent": UA },
        timeoutMs: 3000,
      });
      if (!fetchRes.ok) return null;
      const text = await fetchRes.text();
      if (text.length < 100) return null;

      let title = `PMC${pmcId} — PubMed Central Article`;
      let content = text;

      if (text.trimStart().startsWith("<?xml") || text.trimStart().startsWith("<!DOCTYPE")) {
        const titleMatch = text.match(/<article-title[^>]*>([\s\S]*?)<\/article-title>/i);
        const abstractMatch = text.match(/<abstract[^>]*>([\s\S]*?)<\/abstract>/i);
        const rawTitle = titleMatch?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
        const rawAbstract = abstractMatch?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
        if (!rawAbstract || rawAbstract.length < 100) return null;
        title = rawTitle?.slice(0, 200) || title;
        content = rawAbstract;
      } else {
        const lines = text.split("\n").filter((l) => l.trim().length > 0);
        title = lines[0]?.slice(0, 200) ?? title;
      }

      return {
        chunk: content.slice(0, 8000),
        sourceTitle: `[PubMed 2026] ${title}`,
        sourceType: "Live Research",
        sourceUrl: `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${pmcId}/`,
        score: 0.99,
        position: 1,
      };
    } catch {
      return null;
    }
  });

  const results = await Promise.all(fetchPromises);
  return results.filter((r): r is NonNullable<typeof r> => r !== null);
}

export async function searchPubMedLive(question: string, limit = 4): Promise<Match[]> {
  const cleanQ = question.replace(/[?.,!]/g, "").replace(/\s+/g, " ").trim();
  const cacheKey = `${cleanQ}::${limit}`;
  const cache = pubmedCache();
  const hit = cache.get(cacheKey);
  if (hit !== undefined) return hit;

  if (breakerOpen()) {
    console.warn("[pubmed-live] breaker open — skipping outbound call");
    return [];
  }

  // T1.5: bound total NCBI wall-clock at 4s. Anything not back by then is treated
  // as a soft miss — local vector hits remain the primary evidence source and the
  // entry is left uncached so the next request can retry.
  let budgetTimer: ReturnType<typeof setTimeout> | undefined;
  const budgetPromise = new Promise<Match[]>((resolve) => {
    budgetTimer = setTimeout(() => resolve([]), PUBMED_TOTAL_BUDGET_MS);
  });

  try {
    const matches = await Promise.race([
      searchPubMedLiveInner(cleanQ, limit).catch((err) => {
        recordPubMedFailure();
        console.error("[pubmed-live] error:", err);
        return [] as Match[];
      }),
      budgetPromise,
    ]);
    if (matches.length > 0) {
      cache.set(cacheKey, matches);
      recordPubMedSuccess();
    }
    return matches;
  } finally {
    if (budgetTimer) clearTimeout(budgetTimer);
  }
}
