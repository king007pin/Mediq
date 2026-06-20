import { db } from "@/db";
import { knowledgeGaps, querySessions, sessionFeedback } from "@/db/schema";
import { scrubPhi, scrubPhiPreview } from "./phi-scrubber";
import { and, desc, eq, sql } from "drizzle-orm";

// Called gap when: few sources OR low max score OR agent text contains "not supported"
export function detectGap(
  matchCount: number,
  maxScore: number,
  agentAnswers: string[],
): boolean {
  if (matchCount < 2) return true;
  if (maxScore < 0.45) return true;
  const notSupported = agentAnswers.some((a) =>
    a.toLowerCase().includes("not supported by provided evidence")
  );
  return notSupported;
}

// Extract main clinical topic from query (simple keyword heuristic, no LLM)
export function extractTopic(query: string): string {
  const cleaned = query
    .replace(/^(what is|how to|can you|tell me about|explain|describe|what are the)\s+/i, "")
    .replace(/\?+$/, "")
    .trim();
  return cleaned.slice(0, 60);
}

// Log session (awaited in query route — single INSERT, ~5ms)
export async function logSession(opts: {
  query: string;
  queryEmbedding: number[];
  matchCount: number;
  maxScore: number;
  agentCount: number;
  agentAnswers: string[];
  consensusSnippet?: string;
  userId?: string;
  round1Agents?: any[];
  round2Agents?: any[];
}): Promise<number | null> {
  try {
    const hadGap = detectGap(opts.matchCount, opts.maxScore, opts.agentAnswers);
    const gapTopic = hadGap ? extractTopic(opts.query) : null;

    const [row] = await db
      .insert(querySessions)
      .values({
        userId: opts.userId ?? null,
        query: opts.query,
        queryEmbedding: opts.queryEmbedding,
        matchCount: opts.matchCount,
        maxScore: opts.maxScore,
        agentCount: opts.agentCount,
        consensusSnippet: opts.consensusSnippet ?? null,
        hadGap,
        gapTopic,
        round1Agents: opts.round1Agents ?? null,
        round2Agents: opts.round2Agents ?? null,
      })
      .returning({ id: querySessions.id });

    if (hadGap && gapTopic) {
      await upsertGap(gapTopic);
    }

    return row?.id ?? null;
  } catch {
    return null;
  }
}

// Upsert knowledge gap record
async function upsertGap(topic: string): Promise<void> {
  const existing = await db
    .select()
    .from(knowledgeGaps)
    .where(eq(knowledgeGaps.topic, topic))
    .limit(1);

  if (existing[0]) {
    await db
      .update(knowledgeGaps)
      .set({
        queryCount: existing[0].queryCount + 1,
        lastSeenAt: new Date(),
      })
      .where(eq(knowledgeGaps.id, existing[0].id));
  } else {
    await db.insert(knowledgeGaps).values({ topic, pubmedQuery: topic });
  }
}

// Retrieve similar past successful sessions (for memory injection).
// Returns top-N sessions whose query embeddings are cosine-close to the given embedding.
// "Successful" = session had no gap (hadGap = false) and has a consensusSnippet.
export async function getSimilarPastCases(
  queryEmbedding: number[],
  limit = 2,
): Promise<Array<{ query: string; consensusSnippet: string | null; sessionId: number }>> {
  const vecStr = `[${queryEmbedding.join(",")}]`;

  const result = await db.execute(sql`
    SELECT id, query, consensus_snippet,
           1 - (query_embedding <=> ${vecStr}::vector) AS score
    FROM query_sessions
    WHERE had_gap = false
      AND consensus_snippet IS NOT NULL
      AND query_embedding IS NOT NULL
      AND 1 - (query_embedding <=> ${vecStr}::vector) >= 0.80
    ORDER BY query_embedding <=> ${vecStr}::vector
    LIMIT ${limit}
  `);

  const rows = (result as unknown as { rows: Array<{ id: number; query: string; consensus_snippet: string | null; score: number }> }).rows
    ?? (result as unknown as Array<{ id: number; query: string; consensus_snippet: string | null; score: number }>);

  if (!rows?.length) return [];

  // Strip obvious PHI from cross-session memory before it gets re-injected
  // into another patient's LLM context. (W33 — cross-patient leak vector.)
  // This is best-effort: free-text identifiers may still slip through. Real
  // safety requires either per-row PHI tagging at ingest time or storing
  // structured-only past-case summaries.
  return rows.map((r) => ({
    query: scrubPhi(r.query),
    consensusSnippet: r.consensus_snippet ? scrubPhi(r.consensus_snippet) : null,
    sessionId: Number(r.id),
  }));
}

// Get learning stats for admin panel
/** Recent Sessions are paginated (admin UI shows one page at a time). */
export const RECENT_SESSIONS_PAGE_SIZE = 10;

export async function getLearningStats(sessionsPage = 1) {
  const [totalSessionsRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(querySessions);

  const [totalGapsRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(knowledgeGaps);

  const [resolvedGapsRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(knowledgeGaps)
    .where(eq(knowledgeGaps.resolved, true));

  const [totalFeedbackRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(sessionFeedback);

  const recentGapsRaw = await db
    .select()
    .from(knowledgeGaps)
    .where(eq(knowledgeGaps.resolved, false))
    .orderBy(desc(knowledgeGaps.queryCount))
    .limit(10);

  const page = Math.max(1, Math.floor(sessionsPage) || 1);
  const recentSessionsRaw = await db
    .select({
      id: querySessions.id,
      query: querySessions.query,
      matchCount: querySessions.matchCount,
      maxScore: querySessions.maxScore,
      hadGap: querySessions.hadGap,
      createdAt: querySessions.createdAt,
    })
    .from(querySessions)
    .orderBy(desc(querySessions.createdAt))
    .limit(RECENT_SESSIONS_PAGE_SIZE)
    .offset((page - 1) * RECENT_SESSIONS_PAGE_SIZE);

  // W65 — decrypted PHI columns must be scrubbed before exposure to admin UI.
  // querySessions.query and knowledgeGaps.{topic,pubmedQuery} are encryptedText
  // at rest but Drizzle returns plaintext to the select. Without scrubbing, any
  // authed user opening the admin panel sees raw clinician notes / patient
  // identifiers from every prior request. Run through phi-scrubber regex and
  // truncate to a preview length so a leaked screen capture exposes less.
  const recentSessions = recentSessionsRaw.map((r) => ({
    ...r,
    query: scrubPhiPreview(r.query),
  }));
  const recentGaps = recentGapsRaw.map((r) => ({
    ...r,
    topic: scrubPhiPreview(r.topic),
    pubmedQuery: r.pubmedQuery ? scrubPhiPreview(r.pubmedQuery) : null,
  }));

  return {
    totalSessions: Number(totalSessionsRow?.count ?? 0),
    totalGaps: Number(totalGapsRow?.count ?? 0),
    resolvedGaps: Number(resolvedGapsRow?.count ?? 0),
    totalFeedback: Number(totalFeedbackRow?.count ?? 0),
    recentGaps,
    recentSessions,
    sessionsPage: page,
    sessionsPageSize: RECENT_SESSIONS_PAGE_SIZE,
  };
}

// Satisfy the unused-import linter — `and` is used in cron/learn route via re-export path
export { and };
