import { db } from "@/db";
import { providerCredentials, swarmConfigs, querySessions } from "@/db/schema";
import { decrypt } from "@/lib/secretVault";
import { PROVIDERS, callProvider, resolveProvider } from "@/lib/providerRegistry";
import { requireRole } from "@/lib/auth-guard";
import { rateLimit, RL_SWARM } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { eq, desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { scrubPhi } from "@/lib/phi-scrubber";
import { buildSynthesisSystemPrompt } from "@/lib/swarm/agent-runner";
import { embedText, searchByVectors, assembleContext, type Match } from "@/lib/rag";
import { hasNvidiaKey, nvidiaChatStream } from "@/lib/nvidia";
import { resolveBYOK } from "@/lib/byok-resolver";
import { verifyAndStripOrphanCitations } from "@/lib/swarm";
import { auditSections } from "@/lib/section-completeness";
import { checkDrugInteractions, extractDrugNamesFromReport } from "@/lib/drug-safety";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({
  sessionId: z.number().int().positive(),
  message: z.string().min(1).max(4000),
  patientContext: z.string().max(800).optional(),
  labText: z.string().max(12000).optional(),
});

export async function POST(req: NextRequest) {
  const rl = rateLimit(req, RL_SWARM);
  if (rl) return rl;

  const auth = await requireRole(req, ["admin", "clinician"]);
  if (auth instanceof NextResponse) return auth;

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  const { sessionId, message, patientContext, labText } = parsed.data;

  // Retrieve the prior session
  const [session] = await db
    .select()
    .from(querySessions)
    .where(eq(querySessions.id, sessionId))
    .limit(1);

  if (!session) {
    return NextResponse.json({ error: "Query session not found" }, { status: 404 });
  }

  // Get active swarm config to pick the Synthesis model
  const [activeConfig] = await db
    .select()
    .from(swarmConfigs)
    .where(eq(swarmConfigs.isActive, true))
    .orderBy(desc(swarmConfigs.createdAt))
    .limit(1);

  let synthesisModel = "meta/llama-3.3-70b-instruct";
  if (activeConfig && Array.isArray(activeConfig.config)) {
    const synthSlot = activeConfig.config.find((s: any) => s.role === "Final Synthesis");
    if (synthSlot?.model) {
      synthesisModel = synthSlot.model;
    }
  }

  // Scrub the clinician message and any extra clinical payload
  const cleanMessage = scrubPhi(message);
  const cleanPatientContext = patientContext ? scrubPhi(patientContext) : "";
  const cleanLabText = labText ? scrubPhi(labText) : "";

  // Perform vector search with combined original + critique queries to pull fresh relevant evidence
  const queryToSearch = `${session.query}\nClinician follow-up: ${cleanMessage}`;
  const qEmbedding = await embedText(queryToSearch, "query");
  const allResults = await searchByVectors([qEmbedding], 10);
  const seen = new Set<string>();
  const matches: Match[] = [];
  for (const batch of allResults) {
    for (const m of batch) {
      if (!seen.has(m.chunk)) {
        seen.add(m.chunk);
        matches.push(m);
      }
    }
  }
  matches.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const topMatches = matches.slice(0, 10);
  const context = assembleContext(topMatches);

  // Construct prompts for synthesis model re-run
  const agentCount = session.agentCount ?? 0;
  const baseSystemPrompt = buildSynthesisSystemPrompt(agentCount);
  const systemPrompt = `${baseSystemPrompt}

## CLINICAL CRITIQUE & ITERATIVE DIALOGUE INSTRUCTIONS
You are conducting a multi-turn, interactive dialogue with the attending clinician who has reviewed the previous consensus report and provided follow-up details, concerns, or critiques.
Address the clinician's comments directly. Re-evaluate diagnostic assessments, drug selections, or surveillance plans based on the new information they provided.

When responding:
- Incorporate the clinician's critique into the clinical reasoning.
- You MUST maintain the exact 13-section output format.
- Prepend "[REVISED]" or "[UPDATED]" to the section headers or specific paragraphs that have changed due to the clinician's critique.
- Address the challenge directly in the relevant sections, and explain any changes under the "DEBATE SUMMARY" or "EVIDENCE GAPS" sections.
- Keep the language professional, objective, and evidence-supported.`;

  const priorConsensus = session.consensusSnippet
    ? `\nPrior Consensus Report:\n${session.consensusSnippet}`
    : "";

  const userPrompt = `Patient Query: ${session.query}
${priorConsensus}

Prior Specialist Assessments:
${(session.round1Agents ?? []).map((a: any, idx: number) => `--- Agent ${idx + 1} (${a.model}) ---\n${a.message}`).join("\n\n")}

${(session.round2Agents ?? []).length > 0 ? `Prior Peer Debate:\n${(session.round2Agents ?? []).map((a: any, idx: number) => `--- Agent ${idx + 1} Refinement (${a.model}) ---\n${a.message}`).join("\n\n")}` : ""}

Clinician Follow-up / Critique:
"${cleanMessage}"

${cleanPatientContext ? `New Patient Context: ${cleanPatientContext}\n` : ""}
${cleanLabText ? `New Lab Findings: ${cleanLabText}\n` : ""}

Retrieved Evidence Snippets:
${context}

Generate the updated clinical consensus report now:`;

  const encoder = new TextEncoder();
  const streamAbortController = new AbortController();
  let ping: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      // 2KB of padding to flush CDN/Proxy buffers
      controller.enqueue(encoder.encode(":" + " ".repeat(2048) + "\n\n"));

      ping = setInterval(() => {
        try { controller.enqueue(encoder.encode(": ping\n\n")); } catch { /* closed */ }
      }, 5000);

      try {
        send({ type: "status", message: "Manager: processing clinician critique…" });

        const byokConfig = await resolveBYOK();
        if (byokConfig) {
          send({ type: "status", message: `Manager: using ${byokConfig.provider.name} for updated synthesis…` });
        }

        let answer = "";
        if (byokConfig) {
          const creds = await db.select().from(providerCredentials);
          const cred = creds.find((c) => c.providerId === byokConfig.providerId);
          const effectiveProvider = resolveProvider(byokConfig.provider, cred?.customBaseUrl);
          
          const messages = [
            { role: "system" as const, content: systemPrompt },
            { role: "user" as const, content: userPrompt },
          ];
          const result = await callProvider(effectiveProvider, byokConfig.apiKey, synthesisModel, messages, 60_000, streamAbortController.signal);
          answer = result;
          const words = result.split(/(?<=\s)/);
          for (const word of words) {
            send({ type: "synthesis_token", token: word });
          }
        } else if (hasNvidiaKey()) {
          const chatStream = await nvidiaChatStream(synthesisModel, systemPrompt, userPrompt, 0.15, 5120, "triage", streamAbortController.signal);
          const reader = chatStream.getReader();
          const chunks: string[] = [];
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            send({ type: "synthesis_token", token: value });
          }
          answer = chunks.join("");
        } else {
          answer = `[Local Fallback] Checked critique: "${cleanMessage}" against prior report. Re-synthesis requires configured NVIDIA_API_KEY.`;
          send({ type: "synthesis_token", token: answer });
        }

        const cleaned = verifyAndStripOrphanCitations(answer, topMatches.length);
        const finalAnswer = cleaned.cleaned;
        const sectionAudit = auditSections(finalAnswer);

        // Check for drug interactions
        const drugNames = extractDrugNamesFromReport(finalAnswer);
        const ddiFlags = await checkDrugInteractions(drugNames).catch(() => []);

        // Update the session record in DB
        await db
          .update(querySessions)
          .set({
            consensusSnippet: finalAnswer,
          })
          .where(eq(querySessions.id, sessionId));

        send({
          type: "done",
          answer: finalAnswer,
          sectionAudit,
          agents: session.round2Agents || session.round1Agents || [],
          round1Agents: session.round1Agents || [],
          sessionId: session.id,
          hospitalDepartments: session.round2Agents ? (session.round2Agents as any[]).map(a => a.specialty).filter(Boolean) : [],
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
        logger.error("[chat] critique re-run failed", err);
        send({ type: "error", message: "Critique re-run failed. Please try again." });
      } finally {
        if (ping) {
          clearInterval(ping);
          ping = null;
        }
        controller.close();
      }
    },
    cancel(reason) {
      if (ping) {
        clearInterval(ping);
        ping = null;
      }
      streamAbortController.abort(reason);
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
