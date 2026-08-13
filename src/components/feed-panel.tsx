"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Crawler registry metadata (client-safe — no server imports)
type CrawlerMeta = {
  id: string;
  name: string;
  description: string;
  category: string;
  batchSize: number;
};

const CRAWLER_LIST: CrawlerMeta[] = [
  // ── Clinical Reference ──────────────────────────────────────────────────────
  {
    id: "gene-reviews",
    name: "GeneReviews — NCBI Bookshelf",
    description: "GeneReviews — NCBI Bookshelf (peer-reviewed genetic disease chapters)",
    category: "Clinical Reference",
    batchSize: 10,
  },
  {
    id: "merck-manual",
    name: "Merck Manual Professional",
    description: "Merck Manual Professional — disease symptoms, diagnosis, treatment, DDx",
    category: "Clinical Reference",
    batchSize: 8,
  },
  {
    id: "cdc-diseases",
    name: "CDC Disease Index",
    description: "CDC Disease Index — case definitions, symptoms, diagnosis, treatment",
    category: "Clinical Reference",
    batchSize: 10,
  },
  {
    id: "wiki-em",
    name: "WikiEM — Emergency Medicine",
    description: "WikiEM — free open-access emergency medicine wiki: toxicology, resuscitation, procedures, rapid bedside assessment",
    category: "Clinical Reference",
    batchSize: 8,
  },
  // ── Clinical Guidelines ─────────────────────────────────────────────────────
  {
    id: "nice-guidelines",
    name: "NICE Clinical Guidelines",
    description: "NICE Clinical Guidelines — UK evidence-based recommendations for clinical practice",
    category: "Clinical Guidelines",
    batchSize: 8,
  },
  {
    id: "cochrane-summaries",
    name: "Cochrane Systematic Reviews",
    description: "Cochrane Library — CDSR systematic reviews summarising RCT evidence for clinical practice decisions",
    category: "Clinical Guidelines",
    batchSize: 6,
  },
  {
    id: "ahrq-reviews",
    name: "AHRQ Evidence Reviews",
    description: "AHRQ — US Agency for Healthcare Research and Quality: clinical practice guidelines, systematic reviews, patient safety tools",
    category: "Clinical Guidelines",
    batchSize: 6,
  },
  {
    id: "who-guidelines",
    name: "WHO Global Clinical Guidelines",
    description: "WHO — global treatment guidelines, disease fact sheets, NCD protocols, infectious disease management",
    category: "Clinical Guidelines",
    batchSize: 8,
  },
  // ── Drug Database ───────────────────────────────────────────────────────────
  {
    id: "dailymed",
    name: "DailyMed — FDA Drug Labels",
    description: "DailyMed — FDA official drug labels: dosing, contraindications, interactions",
    category: "Drug Database",
    batchSize: 12,
  },
  {
    id: "who-essential-meds",
    name: "WHO Essential Medicines List",
    description: "WHO EML — 500+ essential medicines with evidence levels, dosing guidelines, and therapeutic equivalents",
    category: "Drug Database",
    batchSize: 8,
  },
  {
    id: "pubchem-compounds",
    name: "PubChem — Compounds & Pharmacology",
    description: "PubChem — NCBI compound database: structure, bioassay, pharmacology, toxicology, clinical trials linkage",
    category: "Drug Database",
    batchSize: 10,
  },
  // ── Scoring Systems ─────────────────────────────────────────────────────────
  {
    id: "mdcalc",
    name: "MDCalc — Clinical Scoring Systems",
    description: "MDCalc — evidence-based clinical scoring systems and diagnostic criteria",
    category: "Scoring Systems",
    batchSize: 8,
  },
  {
    id: "uspstf",
    name: "USPSTF Preventive Services",
    description: "USPSTF — evidence-based screening and preventive medication recommendations with letter-grade evidence ratings",
    category: "Scoring Systems",
    batchSize: 6,
  },
  // ── Rare Diseases ───────────────────────────────────────────────────────────
  {
    id: "orphadata",
    name: "Orphadata — Rare Diseases",
    description: "Orphadata — 10,000+ rare disease profiles (CC BY 4.0)",
    category: "Rare Diseases",
    batchSize: 8,
  },
  {
    id: "omim",
    name: "OMIM — Mendelian Inheritance",
    description: "OMIM — comprehensive catalog of human genes and genetic disorders; clinical synopses and molecular genetics",
    category: "Rare Diseases",
    batchSize: 8,
  },
  // ── India Guidelines ────────────────────────────────────────────────────────
  {
    id: "india-gov",
    name: "India Govt Clinical Guidelines",
    description: "India Govt Guidelines — MoHFW STG, NTEP TB, NCVBDC dengue/malaria, NACO HIV, ICMR",
    category: "India Guidelines",
    batchSize: 5,
  },
  {
    id: "icmr-guidelines",
    name: "ICMR Research Guidelines",
    description: "ICMR — Indian Council of Medical Research: national disease guidelines, COVID-19, TB, NCD, and outbreak protocols",
    category: "India Guidelines",
    batchSize: 6,
  },
  {
    id: "aiims-protocols",
    name: "AIIMS Clinical Protocols",
    description: "AIIMS — All India Institute of Medical Sciences treatment protocols and clinical practice guidelines",
    category: "India Guidelines",
    batchSize: 5,
  },
  // ── Research Databases ──────────────────────────────────────────────────────
  {
    id: "clinicaltrials",
    name: "ClinicalTrials.gov",
    description: "NIH ClinicalTrials.gov — registered clinical trials: interventions, eligibility criteria, endpoints, and outcomes",
    category: "Research Databases",
    batchSize: 10,
  },
  {
    id: "pubmed-central",
    name: "PubMed Central — Open Access",
    description: "PubMed Central — NIH free full-text archive of biomedical and life sciences journal articles",
    category: "Research Databases",
    batchSize: 12,
  },
  // ── Pharmacovigilance ───────────────────────────────────────────────────────
  {
    id: "openfda-faers",
    name: "OpenFDA — Adverse Events (FAERS)",
    description: "OpenFDA FAERS — FDA adverse event reports, drug safety signals, post-market surveillance data (public API)",
    category: "Pharmacovigilance",
    batchSize: 10,
  },
  {
    id: "who-drug-safety",
    name: "WHO Drug Safety — VigiAccess",
    description: "WHO VigiAccess — global pharmacovigilance database of individual case safety reports from 130+ countries",
    category: "Pharmacovigilance",
    batchSize: 8,
  },
];

type Feed = {
  id: number;
  name: string;
  type: string;
  intervalHours: number;
  lastFetchedAt: string | null;
  lastFetchCount: number | null;
  errorCount: number | null;
  lastError: string | null;
  enabled: boolean;
};

type CrawlStatus = {
  exists: boolean;
  offset: number;
  lastFetchedAt: string | null;
  lastFetchCount: number;
  errorCount: number;
  lastError: string | null;
};

type BatchResult = {
  ok: boolean;
  ingested: number;
  skipped: number;
  errors: number;
  nextOffset: number;
  totalUrls: number;
  done: boolean;
  progress: string;
  error?: string;
  // Set by route when SKIP LOCKED returned no row (concurrent crawl holds the lock).
  reason?: string;
};

// Sleep helper for backoff between batch retries.
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Calls `apiBase` (POST) with a JSON body. On 429, parses Retry-After (header or
// body), waits, retries up to `maxAttempts`. On 409 (skipped: true), returns the
// body so the caller can break out of its batch loop with a clear message.
function errorResult(error: string, progress = "failed"): BatchResult {
  return { ok: false, ingested: 0, skipped: 0, errors: 0, nextOffset: 0, totalUrls: 0, done: false, progress, error };
}

async function postBatchWithRetry(
  apiBase: string,
  body: object,
  shouldStop: () => boolean,
  maxAttempts = 4,
  signal?: AbortSignal,
): Promise<BatchResult> {
  // Cancellable sleep: resolves early when shouldStop flips true. Polls every 250ms.
  const cancellableSleep = async (ms: number): Promise<boolean> => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (shouldStop() || signal?.aborted) return true;
      await sleep(Math.min(250, ms - (Date.now() - start)));
    }
    return shouldStop() || Boolean(signal?.aborted);
  };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (shouldStop() || signal?.aborted) return { ...errorResult("Stopped", "0 / 0"), done: true };
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    if (signal) {
      if (signal.aborted) ctrl.abort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    const watchdog = setInterval(() => {
      if (shouldStop() || signal?.aborted) ctrl.abort();
    }, 250);
    let res: Response;
    try {
      if (shouldStop() || signal?.aborted) {
        ctrl.abort();
        return { ...errorResult("Stopped", "0 / 0"), done: true };
      }
      res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (shouldStop() || signal?.aborted) {
        ctrl.abort();
        return { ...errorResult("Stopped", "0 / 0"), done: true };
      }
    } catch (err) {
      const e = err as Error;
      // AbortController fired from shouldStop — exit cleanly so outer loop stops.
      if (e.name === "AbortError" || ctrl.signal.aborted || signal?.aborted) {
        return { ...errorResult("Stopped", "0 / 0"), done: true };
      }
      // Network failure (offline, dev server restart mid-batch). Retry once with
      // a short backoff, then surface — don't crash the calling component.
      if (attempt === maxAttempts) return errorResult(`Network error — ${e.message}`);
      if (await cancellableSleep(1000)) return { ...errorResult("Stopped", "0 / 0"), done: true };
      continue;
    } finally {
      clearInterval(watchdog);
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    }
    if (res.status === 429 || res.status === 503) {
      const retryAfterHdr = Number(res.headers.get("Retry-After"));
      const fallback = Math.min(30, 2 ** attempt); // 2s, 4s, 8s, 16s, cap 30s
      const waitSec = Number.isFinite(retryAfterHdr) && retryAfterHdr > 0 ? retryAfterHdr : fallback;
      if (attempt === maxAttempts) return errorResult(`Rate-limited — please retry in ${waitSec}s`, "rate-limited");
      if (await cancellableSleep(waitSec * 1000)) return { ...errorResult("Stopped", "0 / 0"), done: true };
      continue;
    }
    try {
      return await (res.json() as Promise<BatchResult>);
    } catch (err) {
      // Server returned non-JSON (e.g. HTML error page from Next dev overlay).
      return errorResult(`Bad response — ${(err as Error).message}`);
    }
  }
  return errorResult("Exceeded retry attempts");
}

function nextFetchIn(feed: Feed): string {
  if (!feed.lastFetchedAt) return "pending";
  const next = new Date(feed.lastFetchedAt).getTime() + feed.intervalHours * 3_600_000;
  const diff = next - Date.now();
  if (diff <= 0) return "due now";
  const m = Math.round(diff / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

function intervalLabel(h: number): string {
  if (h < 2) return "1h";
  if (h < 24) return `${h}h`;
  if (h === 24) return "daily";
  if (h === 168) return "weekly";
  return `${h}h`;
}

// Bar fades to 0 over ~2s post-completion, then is replaced by a checkmark badge.
// W50 — setState inside the effect is intentional: the phase transition is
// scheduled by timers (not derivable in render), and the reset branch needs
// to fire when `completed` flips back to false.
/* eslint-disable react-hooks/set-state-in-effect */
function useCompletionFade(completed: boolean) {
  const [phase, setPhase] = useState<"active" | "badge">("active");
  const [opacity, setOpacity] = useState(1);
  useEffect(() => {
    if (!completed) {
      setPhase("active");
      setOpacity(1);
      return;
    }
    const t1 = setTimeout(() => setOpacity(0), 100);
    const t2 = setTimeout(() => setPhase("badge"), 2500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [completed]);
  return { phase, opacity };
}
/* eslint-enable react-hooks/set-state-in-effect */

// ── StatPearls Deep Crawl Panel ──────────────────────────────────────────────
function StatpearlsCrawl() {
  const [status, setStatus] = useState<CrawlStatus | null>(null);
  const [crawling, setCrawling] = useState(false);
  const [totalUrls, setTotalUrls] = useState(0);
  const [currentOffset, setCurrentOffset] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  // Sticky completion flag — see GenericCrawlCard for rationale (server
  // resets offset to 0 on `done`).
  const [justFinished, setJustFinished] = useState(false);
  const stopRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const loadStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/admin/crawl-statpearls", { cache: "no-store", signal });
      if (signal?.aborted) return;
      const data = (await res.json()) as CrawlStatus;
      if (signal?.aborted) return;
      setStatus(data);
      setCurrentOffset(data.offset);
    } catch {
      // ignore
    }
  }, []);

  // W50 — fetch-on-mount; setState is network-driven (see insights-panel.tsx).
  useEffect(() => {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStatus(controller.signal);
    return () => {
      controller.abort();
    };
  }, [loadStatus]);

  async function startCrawl() {
    const signal = abortControllerRef.current?.signal;
    stopRef.current = false;
    if (signal?.aborted) return;
    setCrawling(true);
    setJustFinished(false);
    setMsg("Crawling StatPearls…");

    let sessionTotal = 0;
    while (!stopRef.current && !signal?.aborted) {
      const result = await postBatchWithRetry(
        "/api/admin/crawl-statpearls",
        { batchSize: 15 },
        () => stopRef.current || Boolean(signal?.aborted),
        4,
        signal,
      );
      if (signal?.aborted) return;
      if (result.reason) {
        setMsg(`Skipped — ${result.reason}`);
        break;
      }
      if (result.error) { setMsg(`Error: ${result.error}`); break; }
      sessionTotal += result.ingested;
      if (signal?.aborted) return;
      setCurrentOffset(result.nextOffset);
      setTotalUrls(result.totalUrls);
      setMsg(`${result.progress} articles processed · ${sessionTotal} ingested this session`);
      if (result.done) {
        setMsg(`Crawl complete — all ${result.totalUrls} StatPearls articles ingested! Auto-refreshes weekly.`);
        setJustFinished(true);
        break;
      }
    }
    if (signal?.aborted) return;
    setCrawling(false);
    await loadStatus(signal);
  }

  async function resetCrawl() {
    const signal = abortControllerRef.current?.signal;
    try {
      await fetch("/api/admin/crawl-statpearls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
        signal,
      });
      if (signal?.aborted) return;
      setCurrentOffset(0);
      setJustFinished(false);
      setMsg("Crawl progress reset to beginning.");
      await loadStatus(signal);
    } catch {
      // ignore
    }
  }

  const pct = totalUrls > 0 ? Math.round((currentOffset / totalUrls) * 100) : 0;
  const totalIngested = (status?.lastFetchCount ?? 0);
  const completed = justFinished && !crawling;
  const { phase: barPhase, opacity: barOpacity } = useCompletionFade(completed);

  return (
    <div
      className="min-w-0 rounded-2xl border p-3 sm:p-4 space-y-3 overflow-hidden"
      style={{ borderColor: "var(--accent)", backgroundColor: "color-mix(in srgb, var(--accent) 5%, var(--card))" }}
    >
      <div className="flex flex-col items-center text-center gap-2">
        <span
          className="rounded-full px-3 py-0.5 text-[10px] font-bold uppercase tracking-wide"
          style={{ backgroundColor: "rgba(74,222,128,0.15)", color: "#4ade80" }}
        >
          Free · NCBI
        </span>
        <p className="text-base font-bold uppercase tracking-wide" style={{ color: "var(--text)" }}>
          StatPearls — Clinical Reference
        </p>
        <p className="text-xs max-w-sm leading-relaxed" style={{ color: "var(--muted)" }}>
          Harrison&apos;s-equivalent — 3,000+ peer-reviewed disease articles covering symptoms, diagnosis, and treatment. Auto-refreshes weekly.
        </p>
      </div>

      {/* Progress bar */}
      {totalUrls > 0 && barPhase === "active" && (
        <div style={{ opacity: barOpacity, transition: "opacity 2s ease-out" }}>
          <div className="flex justify-between text-[11px] mb-1" style={{ color: "var(--muted)" }}>
            <span>{currentOffset} / {totalUrls} articles processed</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 w-full rounded-full overflow-hidden" style={{ backgroundColor: "var(--pill)" }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${pct}%`, background: "linear-gradient(90deg, #818cf8, #4ade80)" }}
            />
          </div>
        </div>
      )}
      {completed && barPhase === "badge" && (
        <div className="flex justify-center">
          <span
            className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide"
            style={{ backgroundColor: "rgba(74,222,128,0.15)", color: "#4ade80", border: "1px solid rgba(74,222,128,0.3)" }}
          >
            ✓ Complete · {totalUrls} articles
          </span>
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-xs" style={{ color: "var(--muted)" }}>
        {totalIngested > 0 && <span>{totalIngested} articles in knowledge base</span>}
        {status?.lastFetchedAt && (
          <span>· last run {new Date(status.lastFetchedAt).toLocaleDateString()}</span>
        )}
        {currentOffset > 0 && !crawling && totalUrls > 0 && currentOffset < totalUrls && (
          <span style={{ color: "var(--accent)" }}>· paused at {currentOffset}</span>
        )}
      </div>

      {msg && (
        <p className="rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "var(--card-border)", color: "var(--accent)" }}>
          {msg}
        </p>
      )}

      <div className="flex flex-wrap justify-center gap-2">
        {!crawling ? (
          <button
            onClick={startCrawl}
            className="rounded-full px-6 py-2 text-sm font-bold uppercase tracking-wide shadow transition hover:opacity-90"
            style={{ background: "linear-gradient(90deg,#818cf8,#4ade80)", color: "#0f172a" }}
          >
            {currentOffset > 0 && totalUrls > 0 && currentOffset < totalUrls
              ? `Resume (from ${currentOffset})`
              : "▶ Start Crawl"}
          </button>
        ) : (
          <button
            onClick={() => { stopRef.current = true; }}
            className="rounded-full px-6 py-2 text-sm font-bold uppercase tracking-wide transition"
            style={{ background: "rgba(239,68,68,0.15)", color: "#f87171", border: "1px solid rgba(239,68,68,0.3)" }}
          >
            ⏸ Pause
          </button>
        )}
        {currentOffset > 0 && !crawling && (
          <button
            onClick={resetCrawl}
            className="rounded-full px-6 py-2 text-sm transition"
            style={{ backgroundColor: "var(--pill)", color: "var(--muted)", border: "1px solid var(--pill-border)" }}
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

// ── Category badge colours ───────────────────────────────────────────────────
const CATEGORY_COLOURS: Record<string, { bg: string; fg: string }> = {
  "Clinical Reference":  { bg: "rgba(129,140,248,0.15)", fg: "#818cf8" },
  "Scoring Systems":     { bg: "rgba(251,191,36,0.15)",  fg: "#fbbf24" },
  "Drug Database":       { bg: "rgba(239,68,68,0.15)",   fg: "#f87171" },
  "Clinical Guidelines": { bg: "rgba(34,197,94,0.15)",   fg: "#4ade80" },
  "India Guidelines":    { bg: "rgba(249,115,22,0.15)",  fg: "#fb923c" },
  "Rare Diseases":       { bg: "rgba(168,85,247,0.15)",  fg: "#c084fc" },
  "Research Databases":  { bg: "rgba(20,184,166,0.15)",  fg: "#2dd4bf" },
  "Pharmacovigilance":   { bg: "rgba(244,114,182,0.15)", fg: "#f472b6" },
};

function categoryStyle(cat: string) {
  return CATEGORY_COLOURS[cat] ?? { bg: "rgba(100,116,139,0.15)", fg: "#94a3b8" };
}

// ── GenericCrawlCard ─────────────────────────────────────────────────────────
function GenericCrawlCard({ crawler }: { crawler: CrawlerMeta }) {
  const [status, setStatus] = useState<CrawlStatus | null>(null);
  const [crawling, setCrawling] = useState(false);
  const [totalUrls, setTotalUrls] = useState(0);
  const [currentOffset, setCurrentOffset] = useState(0);
  const [sessionIngested, setSessionIngested] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  // Sticky flag set when the route reports `done:true`. Survives the
  // server-side offset reset (route returns `nextOffset = 0` after done),
  // which would otherwise make `currentOffset >= totalUrls` false and
  // suppress the completion badge.
  const [justFinished, setJustFinished] = useState(false);
  const stopRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const apiBase = `/api/admin/crawl/${crawler.id}`;

  const loadStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(apiBase, { cache: "no-store", signal });
      if (signal?.aborted) return;
      const data = (await res.json()) as CrawlStatus;
      if (signal?.aborted) return;
      setStatus(data);
      setCurrentOffset(data.offset);
    } catch {
      // ignore load errors
    }
  }, [apiBase]);

  // W50 — fetch-on-mount; setState is network-driven (see insights-panel.tsx).
  useEffect(() => {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStatus(controller.signal);
    return () => {
      controller.abort();
    };
  }, [loadStatus]);

  async function startCrawl() {
    const signal = abortControllerRef.current?.signal;
    stopRef.current = false;
    if (signal?.aborted) return;
    setCrawling(true);
    setJustFinished(false);
    setSessionIngested(0);
    setMsg(`Crawling ${crawler.name}…`);

    let sessionTotal = 0;
    while (!stopRef.current && !signal?.aborted) {
      const result = await postBatchWithRetry(
        apiBase,
        { batchSize: crawler.batchSize },
        () => stopRef.current || Boolean(signal?.aborted),
        4,
        signal,
      );
      if (signal?.aborted) return;
      if (result.reason) { setMsg(`Skipped — ${result.reason}`); break; }
      if (result.error) { setMsg(`Error: ${result.error}`); break; }
      sessionTotal += result.ingested;
      if (signal?.aborted) return;
      setSessionIngested(sessionTotal);
      setCurrentOffset(result.nextOffset);
      setTotalUrls(result.totalUrls);
      setMsg(`${result.progress} processed · ${sessionTotal} ingested this session`);
      if (result.done) {
        setMsg(`Crawl complete — all ${result.totalUrls} articles ingested!`);
        setJustFinished(true);
        break;
      }
    }
    if (signal?.aborted) return;
    setCrawling(false);
    await loadStatus(signal);
  }

  async function resetCrawl() {
    const signal = abortControllerRef.current?.signal;
    try {
      await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
        signal,
      });
      if (signal?.aborted) return;
      setCurrentOffset(0);
      setSessionIngested(0);
      setJustFinished(false);
      setMsg("Crawl progress reset to beginning.");
      await loadStatus(signal);
    } catch {
      // ignore
    }
  }

  const pct = totalUrls > 0 ? Math.round((currentOffset / totalUrls) * 100) : 0;
  const totalIngested = status?.lastFetchCount ?? 0;
  const catStyle = categoryStyle(crawler.category);
  const completed = justFinished && !crawling;
  const { phase: barPhase, opacity: barOpacity } = useCompletionFade(completed);

  return (
    <div
      className="min-w-0 rounded-2xl border p-3 sm:p-4 space-y-3 overflow-hidden"
      style={{ borderColor: "var(--card-border)", backgroundColor: "var(--card)" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 min-w-0">
        <div className="min-w-0 flex-1 basis-full sm:basis-auto">
          <p className="text-sm font-semibold truncate" style={{ color: "var(--text)" }}>
            {crawler.name}
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
            {crawler.description}
          </p>
        </div>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase shrink-0 max-w-full truncate"
          style={{ backgroundColor: catStyle.bg, color: catStyle.fg }}
        >
          {crawler.category}
        </span>
      </div>

      {/* Progress bar */}
      {totalUrls > 0 && barPhase === "active" && (
        <div style={{ opacity: barOpacity, transition: "opacity 2s ease-out" }}>
          <div className="flex justify-between text-[11px] mb-1" style={{ color: "var(--muted)" }}>
            <span>{currentOffset} / {totalUrls} articles processed</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 w-full rounded-full overflow-hidden" style={{ backgroundColor: "var(--pill)" }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${catStyle.fg}, #4ade80)` }}
            />
          </div>
        </div>
      )}
      {completed && barPhase === "badge" && (
        <div>
          <span
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
            style={{ backgroundColor: "rgba(74,222,128,0.15)", color: "#4ade80", border: "1px solid rgba(74,222,128,0.3)" }}
          >
            ✓ Complete · {totalUrls} articles
          </span>
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-xs" style={{ color: "var(--muted)" }}>
        {totalIngested > 0 && <span>{totalIngested} articles in knowledge base</span>}
        {status?.lastFetchedAt && (
          <span>· last run {new Date(status.lastFetchedAt).toLocaleDateString()}</span>
        )}
        {currentOffset > 0 && !crawling && totalUrls > 0 && currentOffset < totalUrls && (
          <span style={{ color: catStyle.fg }}>· paused at {currentOffset}</span>
        )}
        {sessionIngested > 0 && crawling && (
          <span style={{ color: catStyle.fg }}>· {sessionIngested} ingested this session</span>
        )}
      </div>

      {msg && (
        <p className="rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "var(--card-border)", color: catStyle.fg }}>
          {msg}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {!crawling ? (
          <button
            onClick={startCrawl}
            className="rounded-2xl px-4 py-2 text-sm font-semibold shadow transition"
            style={{ background: `linear-gradient(90deg, ${catStyle.fg}, #4ade80)`, color: "#0f172a" }}
          >
            {currentOffset > 0 && totalUrls > 0 && currentOffset < totalUrls
              ? `Resume (from ${currentOffset})`
              : "Start crawl"}
          </button>
        ) : (
          <button
            onClick={() => { stopRef.current = true; }}
            className="rounded-2xl px-4 py-2 text-sm font-semibold shadow transition"
            style={{ background: "rgba(239,68,68,0.15)", color: "#f87171", border: "1px solid rgba(239,68,68,0.3)" }}
          >
            Pause
          </button>
        )}
        {currentOffset > 0 && !crawling && (
          <button
            onClick={resetCrawl}
            className="rounded-2xl px-4 py-2 text-sm transition"
            style={{ backgroundColor: "var(--pill)", color: "var(--muted)", border: "1px solid var(--pill-border)" }}
          >
            Reset progress
          </button>
        )}
      </div>
    </div>
  );
}

// ── DeepCrawlsSection ─────────────────────────────────────────────────────────
const CATEGORY_ORDER = [
  "Clinical Reference",
  "Clinical Guidelines",
  "Drug Database",
  "Scoring Systems",
  "Rare Diseases",
  "India Guidelines",
  "Research Databases",
  "Pharmacovigilance",
];

function DeepCrawlsSection() {
  const grouped = CATEGORY_ORDER.map((cat) => ({
    label: cat,
    crawlers: CRAWLER_LIST.filter((c) => c.category === cat),
    style: CATEGORY_COLOURS[cat] ?? { bg: "rgba(100,116,139,0.15)", fg: "#94a3b8" },
  })).filter((g) => g.crawlers.length > 0);

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px" style={{ backgroundColor: "var(--card-border)" }} />
        <p className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: "var(--accent)" }}>
          Deep Crawl Sources
        </p>
        <div className="flex-1 h-px" style={{ backgroundColor: "var(--card-border)" }} />
      </div>

      {/* Category grid — 2 categories per row on md+ */}
      <div className="grid gap-6 md:grid-cols-2">
        {grouped.map((group) => {
          const totalSourcesCount = group.crawlers.length + (group.label === "Clinical Reference" ? 1 : 0);
          return (
            <div key={group.label}
              className="min-w-0 rounded-2xl border p-3 sm:p-4 space-y-3 overflow-hidden"
              style={{ borderColor: `${group.style.fg}33`, backgroundColor: `${group.style.fg}08` }}>
              {/* Category header */}
              <div className="flex items-center gap-2 pb-2 border-b min-w-0" style={{ borderColor: `${group.style.fg}33` }}>
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: group.style.fg }} />
                <p className="text-xs font-bold uppercase tracking-wider truncate min-w-0 flex-1" style={{ color: group.style.fg }}>
                  {group.label}
                </p>
                <span className="text-[10px] rounded-full px-2 py-0.5 shrink-0 whitespace-nowrap"
                  style={{ backgroundColor: group.style.bg, color: group.style.fg }}>
                  {totalSourcesCount} source{totalSourcesCount !== 1 ? "s" : ""}
                </span>
              </div>
              {/* Crawl cards stacked inside each category */}
              <div className="space-y-3">
                {group.label === "Clinical Reference" && <StatpearlsCrawl />}
                {group.crawlers.map((crawler) => (
                  <GenericCrawlCard key={crawler.id} crawler={crawler} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main FeedPanel ───────────────────────────────────────────────────────────
export default function FeedPanel() {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [feedsOpen, setFeedsOpen] = useState(false);
  const [masterCrawling, setMasterCrawling] = useState(false);
  const [masterProgress, setMasterProgress] = useState(0);
  const [masterIngested, setMasterIngested] = useState(0);
  const [masterMsg, setMasterMsg] = useState<string | null>(null);
  const [masterCompleted, setMasterCompleted] = useState(false);
  const masterStopRef = useRef(false);
  const autoRunRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const { phase: masterBarPhase, opacity: masterBarOpacity } = useCompletionFade(masterCompleted);

  const loadFeeds = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/admin/feeds", { signal });
      if (signal?.aborted) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { feeds: Feed[] };
      if (signal?.aborted) return;
      setFeeds(data.feeds ?? []);
    } catch (err) {
      if (signal?.aborted) return;
      setMsg(`Could not load feeds: ${(err as Error).message}`);
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, []);

  // W50 — fetch-on-mount; setState is network-driven (see insights-panel.tsx).
  useEffect(() => {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFeeds(controller.signal);
    return () => {
      controller.abort();
    };
  }, [loadFeeds]);

  async function seed() {
    const signal = abortControllerRef.current?.signal;
    setSeeding(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/seed", { method: "POST", signal });
      if (signal?.aborted) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { seeded: number };
      if (signal?.aborted) return;
      setMsg(`Seeded ${data.seeded} feed(s). Click "Refresh now" to start ingesting.`);
      await loadFeeds(signal);
    } catch (err) {
      if (signal?.aborted) return;
      setMsg(`Seed failed: ${(err as Error).message}`);
    } finally {
      if (!signal?.aborted) setSeeding(false);
    }
  }

  async function resetAndReseed() {
    const signal = abortControllerRef.current?.signal;
    setSeeding(true);
    setMsg(null);
    try {
      await fetch("/api/admin/feeds", { method: "DELETE", signal });
      if (signal?.aborted) return;
      const res = await fetch("/api/admin/seed", { method: "POST", signal });
      if (signal?.aborted) return;
      const data = (await res.json()) as { seeded: number };
      if (signal?.aborted) return;
      setMsg(`Reset complete. Seeded ${data.seeded} feed(s) with verified URLs. Click "Refresh now" to ingest.`);
      await loadFeeds(signal);
    } catch (err) {
      if (signal?.aborted) return;
      setMsg(`Reset failed: ${(err as Error).message}`);
    } finally {
      if (!signal?.aborted) setSeeding(false);
    }
  }

  async function refresh() {
    const signal = abortControllerRef.current?.signal;
    setRefreshing(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/refresh", { method: "POST", signal });
      if (signal?.aborted) return;
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        processed?: number;
        results?: Array<{ name: string; ingested: number; error?: string; autoDisabled?: boolean }>;
      };
      if (signal?.aborted) return;
      if (!res.ok || data.error) {
        setMsg(`Refresh error: ${data.error ?? `HTTP ${res.status}`}`);
      } else {
        const total = (data.results ?? []).reduce((s, r) => s + r.ingested, 0);
        const failed = (data.results ?? []).filter(r => r.error);
        const disabled = (data.results ?? []).filter(r => r.autoDisabled);
        let summary = `Processed ${data.processed ?? 0} feed(s), ingested ${total} article(s).`;
        if (failed.length) summary += ` ${failed.length} feed(s) failed: ${failed.map(f => f.name).join(", ")}.`;
        if (disabled.length) summary += ` ${disabled.length} feed(s) auto-disabled after 3 consecutive errors.`;
        setMsg(summary);
      }
      await loadFeeds(signal);
    } catch (err) {
      if (signal?.aborted) return;
      setMsg(`Refresh failed — ${(err as Error).message}. Check NEXT_PUBLIC_APP_URL env var on Vercel.`);
    } finally {
      if (!signal?.aborted) setRefreshing(false);
    }
  }

  async function startMasterCrawl(overrideSignal?: AbortSignal) {
    const signal = overrideSignal ?? abortControllerRef.current?.signal;
    masterStopRef.current = false;
    if (signal?.aborted) return;
    setMasterCrawling(true);
    setMasterCompleted(false);
    setMasterProgress(0);
    setMasterIngested(0);
    setMasterMsg("Initialising master crawl...");
    let totalIngested = 0;

    // 1. Crawl StatPearls (loop until done or stopped)
    if (!signal?.aborted) {
      setMasterMsg("Crawling StatPearls (Clinical Reference) (1 / 23)…");
      setMasterProgress(1);
    }
    try {
      while (!masterStopRef.current && !signal?.aborted) {
        const data = await postBatchWithRetry(
          "/api/admin/crawl-statpearls",
          { batchSize: 15 },
          () => masterStopRef.current || Boolean(signal?.aborted),
          4,
          signal,
        );
        if (signal?.aborted) return;
        if (data.reason || data.error) break;
        totalIngested += data.ingested ?? 0;
        if (signal?.aborted) return;
        setMasterIngested(totalIngested);
        if (data.done) break;
      }
    } catch {
      // skip failed crawler, continue
    }

    // 2. Crawl all other 22 sources
    for (let i = 0; i < CRAWLER_LIST.length; i++) {
      if (masterStopRef.current || signal?.aborted) break;
      const crawler = CRAWLER_LIST[i];
      if (signal?.aborted) return;
      setMasterMsg(`Crawling ${crawler.name} (${i + 2} / 23)…`);
      setMasterProgress(i + 2);
      try {
        while (!masterStopRef.current && !signal?.aborted) {
          const data = await postBatchWithRetry(
            `/api/admin/crawl/${crawler.id}`,
            { batchSize: crawler.batchSize },
            () => masterStopRef.current || Boolean(signal?.aborted),
            4,
            signal,
          );
          if (signal?.aborted) return;
          if (data.reason || data.error) break;
          totalIngested += data.ingested ?? 0;
          if (signal?.aborted) return;
          setMasterIngested(totalIngested);
          if (data.done) break;
        }
      } catch {
        // skip failed crawler, continue
      }
    }
    if (signal?.aborted) return;
    setMasterMsg(
      masterStopRef.current
        ? `Stopped — ${totalIngested} article(s) ingested from 23 sources.`
        : `Done — ${totalIngested} article(s) ingested from 23 sources.`
    );
    if (!masterStopRef.current && !signal?.aborted) setMasterCompleted(true);
    if (!signal?.aborted) setMasterCrawling(false);
  }

  async function toggleFeed(id: number, enabled: boolean) {
    const signal = abortControllerRef.current?.signal;
    try {
      await fetch("/api/admin/feeds", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, enabled }),
        signal,
      });
      if (signal?.aborted) return;
      setFeeds((prev) => prev.map((f) => (f.id === id ? { ...f, enabled } : f)));
    } catch {
      // ignore
    }
  }

  // Auto-trigger feed refresh + master crawl on page load.
  // Guards: StrictMode-safe useRef lock + 6h localStorage dedupe + silent
  // 403 skip for non-admin users. Refresh runs first (auto-heals errored
  // feeds via fetchWithRetry + re-enable pass in feed-refresh.ts). Master
  // crawl then runs in the background — server-side SKIP LOCKED makes
  // concurrent runs idempotent.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => {
    if (autoRunRef.current) return;
    autoRunRef.current = true;
    const controller = new AbortController();
    const { signal } = controller;
    const KEY = "mediq-last-auto-crawl";
    const SIX_HOURS = 6 * 3600 * 1000;
    let last = 0;
    try { last = Number(localStorage.getItem(KEY) ?? 0); } catch { /* storage blocked */ }
    if (Number.isFinite(last) && Date.now() - last < SIX_HOURS) return;

    void (async () => {
      try {
        const res = await fetch("/api/admin/refresh", { method: "POST", signal });
        if (signal.aborted) return;
        if (res.status === 401 || res.status === 403) return; // non-admin, skip silently
      } catch { /* network blip, skip */ return; }
      if (signal.aborted) return;
      try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ }
      // Probe master-crawl endpoint admin gating before kicking off the long-running loop
      try {
        const probe = await fetch("/api/admin/crawl-statpearls", { cache: "no-store", signal });
        if (signal.aborted) return;
        if (probe.status === 401 || probe.status === 403) return;
      } catch { return; }
      if (signal.aborted) return;
      void startMasterCrawl(signal);
    })();

    return () => {
      controller.abort();
    };
  }, []);

  const indiaFeeds = feeds.filter((f) =>
    f.name.startsWith("India") ||
    f.name.startsWith("PubMed — India") ||
    f.name.startsWith("PubMed — Tuberculosis") ||
    f.name.startsWith("PubMed — Dengue") ||
    f.name.startsWith("PubMed — Diabetes") ||
    f.name.startsWith("PubMed — COVID") ||
    f.name.startsWith("PubMed — ICMR") ||
    f.name.startsWith("WHO SEARO"),
  );
  const globalFeeds = feeds.filter(
    (f) => !indiaFeeds.includes(f) && !f.name.startsWith("StatPearls"),
  );

  return (
    <div className="space-y-5">
      {/* ── Master Crawl ───────────────────────────────────────────────────────── */}
      <div
        className="rounded-2xl border p-5 space-y-4"
        style={{
          borderColor: "var(--accent)",
          backgroundColor: "color-mix(in srgb, var(--accent) 6%, var(--card))",
          boxShadow: "0 0 24px color-mix(in srgb, var(--accent) 12%, transparent)",
        }}
      >
        <div className="flex flex-col items-center text-center gap-1">
          <p className="text-[11px] uppercase tracking-[0.28em]" style={{ color: "var(--accent)" }}>
            Master Control
          </p>
          <h3 className="text-lg font-bold uppercase tracking-wide" style={{ color: "var(--text)" }}>
            Crawl All Sources
          </h3>
          <p className="text-xs max-w-sm" style={{ color: "var(--muted)" }}>
            Triggers all 23 knowledge crawlers sequentially — including StatPearls and all 22 other databases. Saves directly to Neon Postgres.
          </p>
        </div>

        {/* Progress bar */}
        {(masterCrawling || masterProgress > 0) && masterBarPhase === "active" && (
          <div className="space-y-1.5" style={{ opacity: masterBarOpacity, transition: "opacity 2s ease-out" }}>
            <div className="h-2 w-full rounded-full overflow-hidden" style={{ backgroundColor: "var(--card-border)" }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.round((masterProgress / 23) * 100)}%`,
                  backgroundColor: "var(--accent)",
                  boxShadow: "0 0 8px var(--accent)",
                }}
              />
            </div>
            <div className="flex justify-between text-[10px]" style={{ color: "var(--muted)" }}>
              <span>{masterProgress} / 23 sources</span>
              <span>{masterIngested} articles ingested</span>
            </div>
          </div>
        )}
        {masterCompleted && masterBarPhase === "badge" && (
          <div className="flex justify-center">
            <span
              className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide"
              style={{ backgroundColor: "rgba(74,222,128,0.15)", color: "#4ade80", border: "1px solid rgba(74,222,128,0.3)" }}
            >
              ✓ Complete · {masterIngested} articles · 23 sources
            </span>
          </div>
        )}

        {masterMsg && (
          <p className="text-center text-xs" style={{ color: masterCrawling ? "var(--accent)" : "var(--muted)" }}>
            {masterCrawling ? "⟳ " : "✓ "}{masterMsg}
          </p>
        )}

        <div className="flex justify-center">
          {!masterCrawling ? (
            <button
              onClick={() => void startMasterCrawl()}
              className="rounded-full px-8 py-2.5 text-sm font-bold uppercase tracking-wide transition hover:opacity-90 shadow"
              style={{
                backgroundColor: "var(--accent)",
                color: "var(--bg)",
                boxShadow: "0 0 16px color-mix(in srgb, var(--accent) 40%, transparent)",
              }}
            >
              ▶ Start Master Crawl
            </button>
          ) : (
            <button
              onClick={() => { masterStopRef.current = true; }}
              className="rounded-full px-8 py-2.5 text-sm font-bold uppercase tracking-wide transition hover:opacity-90"
              style={{
                background: "rgba(239,68,68,0.15)",
                color: "#f87171",
                border: "1px solid rgba(239,68,68,0.3)",
              }}
            >
              ⏸ Pause Master Crawl
            </button>
          )}
        </div>
      </div>

      {/* Multi-source deep crawl section */}
      <DeepCrawlsSection />

      {/* RSS Feeds — collapsed by default */}
      <div
        className="rounded-2xl border overflow-hidden"
        style={{ borderColor: "var(--card-border)" }}
      >
        <button
          onClick={() => setFeedsOpen((o) => !o)}
          className="relative flex w-full flex-col items-center justify-center px-4 py-4 text-center transition hover:opacity-80"
          style={{ backgroundColor: "color-mix(in srgb, var(--accent) 6%, var(--card))", color: "var(--text)" }}
        >
          <span
            className="absolute right-4 top-1/2 -translate-y-1/2"
            style={{ color: "var(--accent)", transition: "transform 0.2s", transform: feedsOpen ? "rotate(180deg)" : "rotate(0deg)", display: "inline-block" }}
          >
            ▼
          </span>
          <span className="text-lg font-bold uppercase tracking-wide" style={{ color: "var(--accent)" }}>
            RSS News Feeds
          </span>
          <span className="mt-1 text-[11px] font-normal rounded-full px-2 py-0.5"
            style={{ backgroundColor: "var(--pill)", color: "var(--muted)" }}>
            {feeds.length > 0
              ? `${feeds.filter((f) => f.enabled).length}/${feeds.length} active`
              : "not seeded"}
          </span>
        </button>

        {feedsOpen && (
          <div className="space-y-4 px-4 pb-4 pt-3">
            <div className="flex flex-wrap items-center gap-3">
              {feeds.length === 0 && !loading && (
                <button
                  onClick={seed}
                  disabled={seeding}
                  className="rounded-2xl px-4 py-2 text-sm font-semibold shadow transition disabled:opacity-60"
                  style={{ background: "linear-gradient(90deg,#818cf8,#f472b6)", color: "#0f172a" }}
                >
                  {seeding ? "Seeding…" : "Seed all feeds"}
                </button>
              )}
              {feeds.length > 0 && (
                <button
                  onClick={resetAndReseed}
                  disabled={seeding}
                  className="rounded-2xl px-4 py-2 text-sm font-semibold shadow transition disabled:opacity-60"
                  style={{ background: "rgba(239,68,68,0.15)", color: "#f87171", border: "1px solid rgba(239,68,68,0.3)" }}
                >
                  {seeding ? "Resetting…" : "Reset & Reseed"}
                </button>
              )}
              {feeds.length > 0 && (
                <button
                  onClick={refresh}
                  disabled={refreshing}
                  className="rounded-2xl px-4 py-2 text-sm font-semibold shadow transition disabled:opacity-60"
                  style={{ background: "linear-gradient(90deg,#22c55e,#06b6d4)", color: "#0f172a" }}
                >
                  {refreshing ? "Refreshing…" : "Refresh now"}
                </button>
              )}
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                {feeds.length > 0 ? "auto-updates hourly" : "No feeds configured yet"}
              </span>
            </div>

            {msg && (
              <p className="rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--card-border)", color: "var(--accent)" }}>
                {msg}
              </p>
            )}
            {loading && <p className="text-sm" style={{ color: "var(--muted)" }}>Loading feeds…</p>}

            {[
              { label: "🇮🇳 India — Primary", list: indiaFeeds },
              { label: "🌐 Global — Secondary", list: globalFeeds },
            ]
              .filter((g) => g.list.length > 0)
              .map((group) => (
                <div key={group.label}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--accent)" }}>
                    {group.label}
                  </p>
                  <div className="grid gap-2 md:grid-cols-2">
                    {group.list.map((feed) => (
                      <div
                        key={feed.id}
                        className="flex items-start justify-between gap-3 rounded-xl border p-3 text-xs"
                        style={{
                          borderColor: feed.errorCount && feed.errorCount > 0 ? "rgba(239,68,68,0.4)" : "var(--card-border)",
                          backgroundColor: "var(--card)",
                          opacity: feed.enabled ? 1 : 0.5,
                        }}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium" style={{ color: "var(--text)" }}>{feed.name}</p>
                          <p className="mt-0.5" style={{ color: "var(--muted)" }}>
                            <span className="uppercase">{feed.type}</span>
                            {" · "}every {intervalLabel(feed.intervalHours)}
                            {" · "}next: {nextFetchIn(feed)}
                            {feed.lastFetchCount != null && feed.lastFetchCount > 0 && (
                              <> · {feed.lastFetchCount} ingested</>
                            )}
                          </p>
                          {feed.lastError && (
                            <p className="mt-0.5 truncate text-red-400">{feed.lastError}</p>
                          )}
                        </div>
                        <button
                          onClick={() => toggleFeed(feed.id, !feed.enabled)}
                          className="mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium transition"
                          style={{
                            backgroundColor: feed.enabled ? "rgba(34,197,94,0.15)" : "rgba(100,116,139,0.15)",
                            color: feed.enabled ? "#4ade80" : "var(--muted)",
                          }}
                        >
                          {feed.enabled ? "ON" : "OFF"}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
