import { db } from "@/db";
import { managerEvents } from "@/db/schema";
import { desc, sql } from "drizzle-orm";
import { runSwarm, type SwarmRouting } from "./swarm";
import { type BYOKConfig } from "./byok-resolver";

// ── Emergency detection ──────────────────────────────────────────────────────
// W46: extracted to `detect-emergency.ts` (zero DB deps → testable in isolation).
// Re-exported below so existing imports from `manager.ts` keep working.
import { detectEmergency, EMERGENCY_PATTERNS } from "./detect-emergency";
import { detectEmergencyML } from "./detect-emergency-ml";
export { detectEmergency, EMERGENCY_PATTERNS };

// ── Off-topic detection ──────────────────────────────────────────────────────
// W18: Classifier extracted to classify-medical.ts (zero DB deps → testable).
// Re-exported here so existing imports from manager.ts keep working.
import { classifyMedical } from "./classify-medical";
export { classifyMedical };


// ── Complexity scoring → swarm size ─────────────────────────────────────────

type Complexity = "simple" | "moderate" | "complex" | "emergency";

function scoreComplexity(query: string, isEmergency: boolean): Complexity {
  if (isEmergency) return "emergency";
  const words = query.trim().split(/\s+/).length;
  const hasHistory = /\b(history\s+of|background|comorbid|polypharmacy|multiple|complex|rare|atypical|unclear|uncertain)\b/i.test(query);
  const hasMultiSystem = /\b(and|also|plus|with|alongside).{0,20}(pain|fever|cough|rash|dyspnea|confusion|weakness)\b/i.test(query);
  if (words > 60 || (hasHistory && hasMultiSystem)) return "complex";
  if (words > 25 || hasHistory || hasMultiSystem) return "moderate";
  return "simple";
}

const SWARM_SIZE_MAP: Record<Complexity, number> = {
  simple:    3,
  moderate:  4,
  complex:   5,
  emergency: 10,
};

// ── Post-answer escalation check ─────────────────────────────────────────────

const ESCALATION_MARKERS = [
  /EMERGENCY\s+ESCALATION/i,
  /RED\s+FLAG/i,
  /IMMEDIATE\s+(referral|transfer|intervention|action)/i,
  /call\s+(911|999|112|ambulance|emergency)/i,
  /\b(admit|hospitali[sz]e)\s+immediately\b/i,
];

function detectEscalation(answer: string): boolean {
  return ESCALATION_MARKERS.some((p) => p.test(answer));
}

// ── Manager run ──────────────────────────────────────────────────────────────

export type ManagerResult = {
  answer: string;
  agents: Awaited<ReturnType<typeof runSwarm>>["agents"];
  round1Agents: Awaited<ReturnType<typeof runSwarm>>["round1Agents"];
  sessionId: number | null;
  hospitalDepartments?: string[];
  pgSubjects?: string[];
  managerReport: {
    complexity: Complexity;
    isMedical: boolean;
    isEmergency: boolean;
    emergencyTriggers: string[];
    agentCountSelected: number;
    escalationTriggered: boolean;
    totalLatencyMs: number;
    preCheckPassed: boolean;
  };
};

export async function runManagedSwarm(params: {
  question: string;
  context: string;
  matches: Parameters<typeof runSwarm>[0]["matches"];
  model?: string;
  swarmSize?: number;
  mode?: "research" | "debate";
  patientContext?: string;
  labText?: string;
  queryEmbedding?: number[];
  precomputedRouting?: SwarmRouting;
  onAgentDone?: Parameters<typeof runSwarm>[0]["onAgentDone"];
  onSwarmConfig?: Parameters<typeof runSwarm>[0]["onSwarmConfig"];
  onDebateStart?: () => void;
  onSynthesisStart?: () => void;
  onSynthesisToken?: (token: string) => void;
  onManagerStatus?: (msg: string) => void;
  logSessionFn?: (opts: {
    query: string;
    queryEmbedding: number[];
    matchCount: number;
    maxScore: number;
    agentCount: number;
    agentAnswers: string[];
    consensusSnippet?: string;
    round1Agents?: any[];
    round2Agents?: any[];
  }) => Promise<number | null>;
  providerOverride?: BYOKConfig;
  abortSignal?: AbortSignal;
}): Promise<ManagerResult> {
  const {
    question, context, matches, model, patientContext, labText,
    queryEmbedding = [], onAgentDone, onSwarmConfig, onDebateStart, onSynthesisStart,
    onSynthesisToken, onManagerStatus, logSessionFn, abortSignal,
  } = params;

  const t0 = Date.now();

  // ── Pre-flight ───────────────────────────────────────────────────────────
  onManagerStatus?.("Manager: running pre-flight checks…");

  const isMedical = classifyMedical(question);
  const { isEmergency, triggers: emergencyTriggers } = await detectEmergencyML(question);
  const complexity = scoreComplexity(question, isEmergency);
  const agentCountSelected = params.swarmSize ?? SWARM_SIZE_MAP[complexity];
  const preCheckPassed = isMedical;

  if (isEmergency) {
    onManagerStatus?.(`Manager: EMERGENCY detected — ${emergencyTriggers.join(", ")}. Routing all ${agentCountSelected} agents.`);
  } else {
    onManagerStatus?.(`Manager: ${complexity} query — routing to ${agentCountSelected} agent${agentCountSelected !== 1 ? "s" : ""}.`);
  }

  let actualAgentCount = agentCountSelected;
  const wrappedOnSwarmConfig = (config: { swarmSize: number; hospitalDepartments: string[]; pgSubjects: string[] }) => {
    actualAgentCount = config.swarmSize;
    if (isEmergency) {
      onManagerStatus?.(`Manager: EMERGENCY detected — ${emergencyTriggers.join(", ")}. Routing all ${config.swarmSize} agents dynamically.`);
    } else {
      onManagerStatus?.(`Manager: ${complexity} query — dynamically routed to ${config.swarmSize} agent${config.swarmSize !== 1 ? "s" : ""}.`);
    }
    onSwarmConfig?.(config);
  };

  // ── Run swarm ────────────────────────────────────────────────────────────
  const swarm = await runSwarm({
    question,
    context,
    matches,
    model,
    swarmSize: agentCountSelected,
    mode: params.mode,
    patientContext,
    labText,
    precomputedRouting: params.precomputedRouting,
    onAgentDone,
    onSwarmConfig: wrappedOnSwarmConfig,
    onDebateStart,
    onSynthesisStart,
    onSynthesisToken,
    providerOverride: params.providerOverride,
    abortSignal,
  });

  const totalLatencyMs = Date.now() - t0;

  // ── Post-check ───────────────────────────────────────────────────────────
  const escalationTriggered = detectEscalation(swarm.answer);
  if (escalationTriggered) {
    onManagerStatus?.("Manager: escalation trigger detected in final answer — flagging for clinician review.");
  }

  // ── Session log ──────────────────────────────────────────────────────────
  const maxScore = matches.length > 0 ? Math.max(...matches.map((m) => (m as { score?: number }).score ?? 0)) : 0;
  const firstAnswer = swarm.agents[0]?.message ?? swarm.answer;
  const consensusSnippet = firstAnswer.split(/[.!?]/)[0]?.trim().slice(0, 120) ?? undefined;

  const sessionId = await logSessionFn?.({
    query: question,
    queryEmbedding,
    matchCount: matches.length,
    maxScore,
    agentCount: swarm.agents.length,
    agentAnswers: swarm.agents.map((a) => a.message),
    consensusSnippet,
    round1Agents: swarm.round1Agents,
    round2Agents: swarm.round2Agents,
  }).catch(() => null) ?? null;

  // ── Persist manager event ────────────────────────────────────────────────
  try {
    await db.insert(managerEvents).values({
      sessionId,
      complexity,
      isMedical,
      isEmergency,
      emergencyTriggers,
      agentCountSelected: actualAgentCount,
      totalLatencyMs,
      escalationTriggered,
      preCheckPassed,
      postCheckPassed: true,
      agentErrors: 0,
    });
  } catch {
    // non-fatal — don't block response
  }

  return {
    answer: swarm.answer,
    agents: swarm.agents,
    round1Agents: swarm.round1Agents,
    sessionId,
    hospitalDepartments: swarm.hospitalDepartments,
    pgSubjects: swarm.pgSubjects,
    managerReport: {
      complexity,
      isMedical,
      isEmergency,
      emergencyTriggers,
      agentCountSelected: actualAgentCount,
      escalationTriggered,
      totalLatencyMs,
      preCheckPassed,
    },
  };
}

// ── Manager stats (for dashboard) ────────────────────────────────────────────

export type ManagerStats = {
  totalQueries: number;
  emergencyCount: number;
  escalationCount: number;
  avgLatencyMs: number;
  complexityBreakdown: Record<string, number>;
  recentEvents: Array<{
    id: number;
    complexity: string;
    isEmergency: boolean;
    escalationTriggered: boolean;
    agentCountSelected: number;
    totalLatencyMs: number | null;
    createdAt: Date;
  }>;
  agentHealth: {
    avgAgentsPerQuery: number;
    offTopicBlocked: number;
  };
};

export async function getManagerStats(): Promise<ManagerStats> {
  const [totals] = await db
    .select({
      total: sql<number>`count(*)`,
      emergency: sql<number>`count(*) filter (where is_emergency = true)`,
      escalation: sql<number>`count(*) filter (where escalation_triggered = true)`,
      offTopic: sql<number>`count(*) filter (where is_medical = false)`,
      avgLatency: sql<number>`avg(total_latency_ms)`,
      avgAgents: sql<number>`avg(agent_count_selected)`,
    })
    .from(managerEvents);

  const complexityRows = await db
    .select({ complexity: managerEvents.complexity, count: sql<number>`count(*)` })
    .from(managerEvents)
    .groupBy(managerEvents.complexity);

  const recentEvents = await db
    .select({
      id: managerEvents.id,
      complexity: managerEvents.complexity,
      isEmergency: managerEvents.isEmergency,
      escalationTriggered: managerEvents.escalationTriggered,
      agentCountSelected: managerEvents.agentCountSelected,
      totalLatencyMs: managerEvents.totalLatencyMs,
      createdAt: managerEvents.createdAt,
    })
    .from(managerEvents)
    .orderBy(desc(managerEvents.createdAt))
    .limit(10);

  const complexityBreakdown: Record<string, number> = {};
  for (const row of complexityRows) {
    complexityBreakdown[row.complexity] = Number(row.count);
  }

  return {
    totalQueries: Number(totals?.total ?? 0),
    emergencyCount: Number(totals?.emergency ?? 0),
    escalationCount: Number(totals?.escalation ?? 0),
    avgLatencyMs: Math.round(Number(totals?.avgLatency ?? 0)),
    complexityBreakdown,
    recentEvents,
    agentHealth: {
      avgAgentsPerQuery: Math.round(Number(totals?.avgAgents ?? 3) * 10) / 10,
      offTopicBlocked: Number(totals?.offTopic ?? 0),
    },
  };
}
