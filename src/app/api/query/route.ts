import { assembleContext, embedBatch, embedText, searchByVectors, rewriteQueryForRetrieval, searchPubMedLive, type Match } from "@/lib/rag";
import { getSimilarPastCases, logSession } from "@/lib/session-learning";
import { runManagedSwarm, classifyMedical } from "@/lib/manager";
import { precomputeSwarmRouting, verifyAndStripOrphanCitations } from "@/lib/swarm";
import { resolveBYOK } from "@/lib/byok-resolver";
import { auditSections } from "@/lib/section-completeness";
import { checkDrugInteractions, extractDrugNamesFromReport } from "@/lib/drug-safety";
import { rateLimit, RL_QUERY } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-guard";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({
  question: z.string().optional(),
  model: z.string().optional(),
  swarmSize: z.number().int().min(1).max(10).optional(),
  mode: z.enum(["research", "debate"]).optional(),
  topK: z.number().int().min(1).max(20).optional(),
  patientContext: z.string().max(800).optional(),
  labText: z.string().max(12000).optional(),
});

export async function POST(req: NextRequest) {
  const rl = rateLimit(req, RL_QUERY);
  if (rl) return rl;

  const auth = await requireRole(req, ["admin", "clinician"]);
  if (auth instanceof NextResponse) return auth;

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  let { question, model, swarmSize, mode, topK = 10, patientContext, labText } = parsed.data;

  const hasClinicalPayload = !!(labText?.trim() || patientContext?.trim());
  const hasQuestion = !!(question?.trim());

  if (!hasClinicalPayload && !hasQuestion) {
    return NextResponse.json(
      { error: "Please enter a clinical question or upload a medical document / report." },
      { status: 400 },
    );
  }

  // Fallback default query if user just uploaded document/patientContext but left question empty
  if (!hasQuestion && hasClinicalPayload) {
    question = "Analyze the uploaded clinical findings and provide a comprehensive diagnostic evaluation and management plan.";
  } else if (!question) {
    question = "";
  }

  // W18: Early off-topic gate — reject non-medical queries before embedding
  // to avoid burning NVIDIA quota on irrelevant content. Bypassed if we have a clinical payload.
  if (!hasClinicalPayload && !classifyMedical(question)) {
    return NextResponse.json(
      { error: "This query does not appear to be medical or clinical in nature. Mediq is a clinical decision support tool — please rephrase your question with relevant medical context." },
      { status: 422 },
    );
  }

  // Item 5: multi-query retrieval with deduplication
  // T1.4: embed the original question in parallel with the rewrite-LLM call,
  // then batch the rewritten queries into a single embeddings round-trip.
  // Prior code issued N sequential single-item embed calls (~3× HTTPS RTT).
  // T1.3: precomputeSwarmRouting fires in the same parallel block so the
  // 2-8s router LLM call overlaps fully with embedding + rewrite.
  const [qEmbedding, rewrittenQueries, precomputedRouting] = await Promise.all([
    embedText(question, "query"),
    rewriteQueryForRetrieval(question),
    precomputeSwarmRouting(question, patientContext, labText, swarmSize ?? 10),
  ]);

  const extraQueries = rewrittenQueries.slice(1);
  const queryEmbeddings = extraQueries.length > 0 ? await embedBatch(extraQueries, "query") : [];

  const allEmbeddings = [qEmbedding, ...queryEmbeddings];

  // Parallelize local vector search with real-time PubMed E-utilities search for absolute 2026 currency
  const [allResults, liveMatches] = await Promise.all([
    searchByVectors(allEmbeddings, topK),
    searchPubMedLive(question, 4).catch(() => []),
  ]);

  const seen = new Set<string>();
  const matches: Match[] = [];

  // Add live 2026 PubMed guidelines first to prioritize them
  for (const m of liveMatches) {
    if (!seen.has(m.chunk)) {
      seen.add(m.chunk);
      matches.push(m);
    }
  }

  // Add local vector DB results
  for (const batch of allResults) {
    for (const m of batch) {
      if (!seen.has(m.chunk)) {
        seen.add(m.chunk);
        matches.push(m);
      }
    }
  }
  matches.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const topMatches = matches.slice(0, topK);

  if (!topMatches.length) {
    topMatches.push({
      chunk: "Standard Clinical Knowledge Base: Apply established medical literature, clinical practice guidelines, diagnostic criteria, and evidence-based treatment protocols.",
      sourceTitle: "General Clinical Knowledge",
      sourceUrl: null,
      score: 1.0,
    });
  }

  const pastCases = await getSimilarPastCases(qEmbedding, 2).catch(() => []);
  const pastCasesContext =
    pastCases.length > 0
      ? "\n\nRelevant prior cases from knowledge base:\n" +
        pastCases.map((c, i) => `[PC${i + 1}] Query: "${c.query}" -> Summary: ${c.consensusSnippet}`).join("\n")
      : "";

  const context = assembleContext(topMatches);
  const contextWithMemory = context + pastCasesContext;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      // Send 2KB of comment padding to force CDN/Proxy buffers to flush and establish the SSE stream immediately
      controller.enqueue(encoder.encode(":" + " ".repeat(2048) + "\n\n"));

      let ping: ReturnType<typeof setInterval> | null = null;
      ping = setInterval(() => {
        try { controller.enqueue(encoder.encode(": ping\n\n")); } catch { /* stream closed */ }
      }, 5000);

      try {
        send({ type: "status", message: "Manager: initialising swarm…" });

        // BYOK: resolve user-configured provider key (e.g., OpenRouter)
        // If found, the swarm will automatically use it instead of the built-in NVIDIA pool
        const byokConfig = await resolveBYOK();
        if (byokConfig) {
          send({ type: "status", message: `Manager: using your ${byokConfig.provider.name} key for analysis…` });
          logger.info(`[BYOK] Resolved user provider: ${byokConfig.provider.name} (${byokConfig.providerId})`);
        }

        const result = await runManagedSwarm({
          question,
          context: contextWithMemory,
          matches: topMatches,
          model,
          swarmSize,
          mode,
          patientContext,
          labText,
          queryEmbedding: qEmbedding,
          precomputedRouting,
          providerOverride: byokConfig ?? undefined,
          onAgentDone: (agent) => send({ type: "agent", ...agent }),
          onSwarmConfig: (config) => send({ type: "swarm_config", ...config }),
          onDebateStart: () =>
            send({ type: "debate_start", message: "Agents reviewing each other's reasoning…" }),
          onSynthesisStart: () =>
            send({ type: "synthesis_start", message: "Synthesizing final report…" }),
          // Item 2: stream synthesis tokens to client
          onSynthesisToken: (token) => send({ type: "synthesis_token", token }),
          onManagerStatus: (msg) => send({ type: "status", message: msg }),
          logSessionFn: (opts) => logSession({ ...opts, userId: auth.userId }),
        });

        // Q4: strip any [S#] that points outside the retrieved-evidence range
        // before persistence and before the done event. The streamed
        // synthesis_token events keep the raw output (the UI re-renders the
        // cleaned answer when done arrives), but the archived/shared answer
        // never contains a hallucinated citation.
        const cleaned = verifyAndStripOrphanCitations(result.answer, topMatches.length);
        if (cleaned.strippedCount > 0) {
          logger.warn(
            `[query] stripped ${cleaned.strippedCount} orphan citation(s) from synthesis: ${cleaned.orphanIds.join(",")}`,
          );
        }
        const finalAnswer = cleaned.cleaned;

        // Q5: audit mandatory section presence before emitting done. Missing
        // sections are logged and surfaced via the (additive) sectionAudit
        // field on the done event so the UI/ops can show a banner without
        // breaking any existing consumer.
        const sectionAudit = auditSections(finalAnswer);
        if (!sectionAudit.allMandatoryPresent) {
          logger.warn(
            `[query] synthesis missing mandatory section(s): ${sectionAudit.missingMandatory.join(", ")}`,
          );
        }

        // Item 6: DDI check post-synthesis
        const drugNames = extractDrugNamesFromReport(finalAnswer);
        const ddiFlags = await checkDrugInteractions(drugNames).catch(() => []);

        send({
          type: "done",
          answer: finalAnswer,
          sectionAudit,
          agents: result.agents,
          round1Agents: result.round1Agents,
          sessionId: result.sessionId,
          managerReport: result.managerReport,
          hospitalDepartments: result.hospitalDepartments,
          pgSubjects: result.pgSubjects,
          ddiFlags,
          matches: topMatches.map((m) => ({
            sourceId: m.sourceId,
            sourceTitle: m.sourceTitle,
            sourceType: m.sourceType,
            sourceUrl: m.sourceUrl,
            position: m.position,
            chunk: m.chunk,
            score: m.score,
          })),
        });
      } catch (err) {
        // W17: never leak internal error messages over the SSE stream.
        // Internal errors include DB connection strings, PG error codes,
        // file paths, and stack-trace fragments. Log the real error
        // server-side; emit a generic message to the browser.
        logger.error("[query] swarm run failed", err);
        send({ type: "error", message: "Query failed. Please try again." });
      } finally {
        if (ping) clearInterval(ping);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
