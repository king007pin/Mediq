import { assembleContext } from "./rag";
import { hasNvidiaKey, nvidiaChat, nvidiaChatStream, NVIDIA_SWARM_MODELS } from "./nvidia";
import { type BYOKConfig } from "./byok-resolver";
import { logger } from "./logger";

// Import core types
import { AgentReply, MatchMeta, SpecialtyMeta } from "./swarm/types";

// Import specialty configurations and routing helpers
import {
  SPECIALTY_POOL,
  MODEL_SPECIALTY_MAP,
  SPECIALTY_MODEL_PREFERENCE,
  allocateModelsToSpecialties,
  getCognitiveStrategyForSpecialty,
  getSpecialtyForModel,
  selectSpecialtiesForQuery,
} from "./swarm/specialty";

// Import quorum gating logic
import {
  LATENCY_V2,
  QUORUM_RATIO,
  ROUND1_WALLCLOCK_MS,
  ROUND2_WALLCLOCK_MS,
  awaitWithQuorum,
} from "./swarm/quorum-gating";

// Import agent runners
import {
  runAgent,
  runDebateAgent,
  runSynthesisAgent,
} from "./swarm/agent-runner";

// Self-healing roster: demotes down/slow models to healthy peers (no-op unless MODEL_HEALTH_AUTO=1)
import { healthFilter } from "./model-health";

// Re-export shared types and helpers for external API integrity (W87)
export type { AgentReply, MatchMeta, SpecialtyMeta };
export { getCognitiveStrategyForSpecialty, allocateModelsToSpecialties };

// Re-export citation verifier (Q4)
export { verifyAndStripOrphanCitations } from "./citation-verify";

// Quality rider: synthesis is a single call OUTSIDE the latency-bounded fan-out,
// so pinning the strongest stable model here costs no extra round-trip latency.
// An explicit caller `model` override still wins.
const STRONGEST_SYNTH_MODEL = "meta/llama-3.3-70b-instruct";

/**
 * W87 — Clean modular orchestrator replacement for the swarm.ts monolith.
 * Retains identical parameter signatures, return types, and operational flow.
 */

function cleanAndParseJSON(text: string) {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "");
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3).trim();
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }
  return JSON.parse(cleaned);
}

export async function routeQueryAndAllocateSwarm(
  question: string,
  patientContext?: string,
  labText?: string,
  targetSwarmSize?: number,
): Promise<{
  hospitalDepartments: string[];
  pgSubjects: string[];
  swarmSize: number;
  specialties: SpecialtyMeta[];
  models: string[];
}> {
  if (!hasNvidiaKey()) {
    throw new Error("NVIDIA_API_KEY is not configured");
  }

  const userPrompt = `USER QUESTION: "${question}"
${patientContext ? `PATIENT HISTORY: "${patientContext}"` : ""}
${labText ? `LAB/DIAGNOSTIC DATA: "${labText}"` : ""}

Analyze the user's clinical presentation, map it to relevant Hospital Specialties (Dataset 1) and MBBS PG Subjects (Dataset 2), gauge clinical complexity, and output the dynamic swarm configuration. Only output valid JSON.`;

  const ROUTER_SYSTEM_PROMPT = `You are the MedIQ Clinical Swarm Router, an expert AI medical triage director.
Your job is to analyze the patient's symptoms/query, map it to our clinical datasets, gauge clinical complexity, and dynamically configure a collaborative specialist swarm of 3 to 10 AI agents.

${targetSwarmSize ? `Note: The user-suggested maximum swarm size is ${targetSwarmSize} agents. You must dynamically select the swarm size N between 3 and ${targetSwarmSize} based strictly on the clinical complexity of the query. Do not allocate more than N = ${targetSwarmSize} agents, and prioritize a compact, highly specialized team matching the complexity (e.g. 3-4 agents for low complexity, 5-7 for medium complexity, and up to ${targetSwarmSize} only for high complexity/emergencies).` : ""}

DATASET 1: HOSPITAL SPECIALTIES / DEPARTMENTS
1. System Entryway (Triage & Intake)
2. Cardiac Care
3. Cancer Care
4. Neurosciences
5. Gastrosciences
6. Orthopaedics
7. Renal Care
8. Liver Transplant
9. Bone Marrow Transplant
10. Lung Transplant
11. Chest Surgery
12. Gynae-Oncology
13. Pediatric Care
14. Obstetrics
15. Emergency
16. Otolaryngology (ENT)
17. Reconstructive Surgery (Plastic Surgery)
18. Diagnostic Imaging (Radiology)
19. Pathology
20. Clinical Pharmacist
21. Psychiatry

DATASET 2: 19 MBBS PG SUBJECTS
- Pre-Clinical: Anatomy, Physiology, Biochemistry
- Para-Clinical: Pathology, Pharmacology, Microbiology, Forensic Medicine, Social & Preventive Medicine (Community Medicine)
- Clinical: General Medicine, General Surgery, Obstetrics & Gynaecology, Pediatrics, ENT, Ophthalmology, Orthopaedics, Anaesthesiology, Radiology, Psychiatry, Dermatology

AVAILABLE MEDIQ SPECIALTIES (Choose only from these exact IDs):
${SPECIALTY_POOL.map(s => `- ID: "${s.id}" (Role: ${s.role}, Focus: ${s.focus})`).join("\n")}

COMPLEXITY AND SWARM SIZE CRITERIA:
- Low Complexity (3-4 agents): Isolated single-system symptoms, simple outpatient cases, routine follow-ups.
- Medium Complexity (5-7 agents): Multi-system presentations, chronic illnesses with comorbidities, atypical common conditions.
- High Complexity (8-10 agents): Medical emergencies, transplant cases, complex oncology/staging, highly atypical or rare differentials.

TASK:
1. Analyze the user's question, patient context, and lab results.
2. Determine which Hospital Specialties / Departments (Dataset 1) are relevant.
3. Determine which MBBS PG Subjects (Dataset 2) are relevant.
4. Determine the clinical complexity (Low, Medium, High) and select a swarm size N (3 to 10).
5. Select exactly N unique specialties from the MedIQ Specialty IDs list. Choose the best fitting ones for the query.

You MUST respond with a single, valid JSON object containing exactly these keys. No other text, markdown blocks, or conversational filler is allowed.

JSON SCHEMA:
{
  "hospitalDepartments": ["<Department Name 1>", "<Department Name 2>"],
  "pgSubjects": ["<Subject Name 1>", "<Subject Name 2>"],
  "swarmSize": <number between 3 and 10>,
  "specialties": ["<specialty_id_1>", "<specialty_id_2>", ... (length must match swarmSize exactly)]
}`;

  const routerModel = "meta/llama-3.3-70b-instruct";
  const rawResponse = await nvidiaChat(routerModel, ROUTER_SYSTEM_PROMPT, userPrompt, 0.1, 2048, "triage");
  const parsed = cleanAndParseJSON(rawResponse);

  const hospitalDepartments = Array.isArray(parsed.hospitalDepartments) ? parsed.hospitalDepartments : [];
  const pgSubjects = Array.isArray(parsed.pgSubjects) ? parsed.pgSubjects : [];
  let swarmSize = typeof parsed.swarmSize === "number" ? parsed.swarmSize : (typeof parsed.swarmSize === "string" ? parseInt(parsed.swarmSize, 10) : 5);
  if (isNaN(swarmSize)) swarmSize = 5;
  swarmSize = Math.max(3, Math.min(10, swarmSize));

  let specialtiesList: string[] = Array.isArray(parsed.specialties) ? parsed.specialties : [];
  
  let validSpecialties = specialtiesList
    .map(id => SPECIALTY_POOL.find(s => s.id === id))
    .filter((s): s is SpecialtyMeta => !!s);

  const uniqueSpecs = new Map<string, SpecialtyMeta>();
  for (const s of validSpecialties) {
    uniqueSpecs.set(s.id, s);
  }
  validSpecialties = Array.from(uniqueSpecs.values());

  const gp = SPECIALTY_POOL.find(s => s.id === "system_entryway")!;
  while (validSpecialties.length < swarmSize) {
    const nextSpec = SPECIALTY_POOL.find(s => !validSpecialties.some(v => v.id === s.id));
    if (nextSpec) {
      validSpecialties.push(nextSpec);
    } else {
      validSpecialties.push(gp);
    }
  }

  validSpecialties = validSpecialties.slice(0, swarmSize);

  if (swarmSize >= 3 && !validSpecialties.some((s) => s.id === "emergency")) {
    const em = SPECIALTY_POOL.find((s) => s.id === "emergency");
    if (em) {
      validSpecialties[validSpecialties.length - 1] = em;
    }
  }

  const selectedSpecialtyIds = validSpecialties.map(s => s.id);
  const models = allocateModelsToSpecialties(selectedSpecialtyIds);

  return {
    hospitalDepartments,
    pgSubjects,
    swarmSize,
    specialties: validSpecialties,
    models,
  };
}

function getFallbackAllocation(question: string, defaultSwarmSize = 10) {
  const swarmSize = Math.max(3, Math.min(10, defaultSwarmSize));
  const defaultModels = NVIDIA_SWARM_MODELS.slice(0, swarmSize);
  const selectedSpecialties = selectSpecialtiesForQuery(question, [...defaultModels]);
  
  const hospitalDepartments: string[] = [];
  const pgSubjects: string[] = [];
  const q = question.toLowerCase();
  
  if (q.includes("heart") || q.includes("chest") || q.includes("cardiac")) {
    hospitalDepartments.push("Cardiac Care");
    pgSubjects.push("General Medicine");
  }
  if (q.includes("cancer") || q.includes("tumor") || q.includes("biopsy")) {
    hospitalDepartments.push("Cancer Care");
    pgSubjects.push("Pathology");
  }
  if (q.includes("brain") || q.includes("stroke") || q.includes("neuro")) {
    hospitalDepartments.push("Neurosciences");
    pgSubjects.push("Anatomy");
  }
  if (q.includes("child") || q.includes("pedi") || q.includes("neonate")) {
    hospitalDepartments.push("Paediatric Care");
    pgSubjects.push("Pediatrics");
  }
  if (q.includes("pregnant") || q.includes("obstetric")) {
    hospitalDepartments.push("Obstetrics & Gynaecology");
    pgSubjects.push("Obstetrics & Gynaecology");
  }
  if (q.includes("acute") || q.includes("sudden") || q.includes("severe")) {
    hospitalDepartments.push("Emergency");
    pgSubjects.push("Anaesthesiology");
  }
  
  if (hospitalDepartments.length === 0) {
    hospitalDepartments.push("Emergency");
  }
  if (pgSubjects.length === 0) {
    pgSubjects.push("General Medicine");
  }

  return {
    hospitalDepartments,
    pgSubjects,
    swarmSize,
    specialties: selectedSpecialties,
    models: defaultModels as string[],
  };
}

export type SwarmRouting = {
  hospitalDepartments: string[];
  pgSubjects: string[];
  swarmSize: number;
  specialties: SpecialtyMeta[];
  models: string[];
};

export async function precomputeSwarmRouting(
  question: string,
  patientContext?: string,
  labText?: string,
  fallbackSwarmSize = 10,
): Promise<SwarmRouting> {
  try {
    return await routeQueryAndAllocateSwarm(question, patientContext, labText, fallbackSwarmSize);
  } catch (err) {
    logger.error("[AI Swarm Router] Router failed, falling back to static keyword allocation", err);
    return getFallbackAllocation(question, fallbackSwarmSize);
  }
}

export async function runSwarm({
  question,
  context,
  matches,
  model,
  swarmSize = 10,
  mode = "debate",
  patientContext,
  labText,
  precomputedRouting,
  onAgentDone,
  onDebateStart,
  onSynthesisStart,
  onSynthesisToken,
  onSwarmConfig,
  providerOverride,
}: {
  question: string;
  context: string;
  matches: MatchMeta[];
  model?: string;
  swarmSize?: number;
  mode?: "research" | "debate";
  patientContext?: string;
  labText?: string;
  precomputedRouting?: SwarmRouting;
  onAgentDone?: (agent: AgentReply & { round: 1 | 2 }) => void;
  onDebateStart?: () => void;
  onSynthesisStart?: () => void;
  onSynthesisToken?: (token: string) => void;
  onSwarmConfig?: (config: { swarmSize: number; hospitalDepartments: string[]; pgSubjects: string[] }) => void;
  providerOverride?: BYOKConfig;
}) {
  let selected: string[] = [];
  let specialties: SpecialtyMeta[] = [];
  let hospitalDepts: string[] = [];
  let pgSubjs: string[] = [];

  const routing = precomputedRouting ?? (await precomputeSwarmRouting(question, patientContext, labText, swarmSize));
  selected = routing.models;
  specialties = routing.specialties;
  hospitalDepts = routing.hospitalDepartments;
  pgSubjs = routing.pgSubjects;

  if (model) {
    selected = [model, ...selected.filter((m) => m !== model)].slice(0, selected.length);
  }

  // Self-healing: swap out any model currently classified down/slow for a healthy
  // peer. No-op (identity) unless MODEL_HEALTH_AUTO=1; never throws.
  selected = await healthFilter(selected);

  const byokLabel = providerOverride ? ` [BYOK: ${providerOverride.provider.name}]` : "";
  logger.info(`[AI Swarm Router] Routed query to ${selected.length} agents.${byokLabel} Departments: ${hospitalDepts.join(", ")}, PG Subjects: ${pgSubjs.join(", ")}`);
  onSwarmConfig?.({ swarmSize: selected.length, hospitalDepartments: hospitalDepts, pgSubjects: pgSubjs });

  // ── Round 1: Independent analysis ───────────────────────────────────────
  const round1Map = new Map<string, AgentReply & { round: 1 }>();
  const round1Promises = selected.map((m, idx) =>
    runAgent(m, question, context, matches, idx, specialties[idx], patientContext, labText, providerOverride).then((reply) => {
      const r1 = { ...reply, round: 1 as const };
      onAgentDone?.(r1);
      round1Map.set(m, r1);
      return r1;
    }),
  );

  if (LATENCY_V2) {
    const quorum = Math.max(1, Math.ceil(selected.length * QUORUM_RATIO));
    await awaitWithQuorum(round1Promises, quorum, ROUND1_WALLCLOCK_MS);
    // Wait for all remaining background agents to settle so they are fully included in the analysis and shown in the UI
    await Promise.allSettled(round1Promises);
  } else {
    await Promise.all(round1Promises);
  }
  const round1Agents = selected.map((m) => round1Map.get(m)).filter((a): a is AgentReply & { round: 1 } => a !== undefined);

  // ── Round 2: Peer debate — only for complex/emergency (4+ agents) ────────
  let round2Agents: Array<AgentReply & { round: 2 }> = [];

  if (mode === "debate" && selected.length >= 4 && round1Agents.length >= 2) {
    onDebateStart?.();

    const specialtyByModel = new Map(selected.map((m, i) => [m, specialties[i]]));
    const round2Map = new Map<string, AgentReply & { round: 2 }>();
    const round2Promises = selected
      .map((m, idx) => {
        const own = round1Map.get(m);
        if (!own) return null;
        const peers = round1Agents
          .filter((a) => a.model !== m)
          .map((a) => ({
            model: a.model,
            role: specialtyByModel.get(a.model)?.role ?? a.model,
            message: a.message,
          }));
        return runDebateAgent(m, question, context, own.message, peers, matches, idx, round1Agents.length, specialties[idx], providerOverride).then((reply) => {
          onAgentDone?.(reply);
          round2Map.set(m, reply);
          return reply;
        });
      })
      .filter((p): p is Promise<AgentReply & { round: 2 }> => p !== null);

    if (LATENCY_V2) {
      const quorum2 = Math.max(1, Math.ceil(round2Promises.length * QUORUM_RATIO));
      await awaitWithQuorum(round2Promises, quorum2, ROUND2_WALLCLOCK_MS);
      // Wait for all remaining background agents to settle so they are fully included in the analysis and shown in the UI
      await Promise.allSettled(round2Promises);
    } else {
      await Promise.all(round2Promises);
    }
    round2Agents = selected.map((m) => round2Map.get(m)).filter((a): a is AgentReply & { round: 2 } => a !== undefined);
  }

  // ── Round 3: Synthesis ───────────────────────────────────────────────────
  onSynthesisStart?.();
  const synthesisModel = model ?? STRONGEST_SYNTH_MODEL; // honor explicit override, else pin strongest stable
  const answer = await runSynthesisAgent(
    synthesisModel,
    question,
    context,
    round1Agents,
    round2Agents,
    matches,
    onSynthesisToken,
    providerOverride,
  );

  const finalAgents = round2Agents.length > 0 ? round2Agents : round1Agents;

  return { answer, agents: finalAgents, round1Agents, round2Agents, hospitalDepartments: hospitalDepts, pgSubjects: pgSubjs };
}

export function buildContextFromMatches(
  matches: Array<{ chunk: string; sourceTitle?: string | null; sourceUrl?: string | null }>,
) {
  return assembleContext(
    matches.map((m, idx) => ({
      chunk: m.chunk,
      embedding: [],
      sourceId: idx,
      sourceTitle: m.sourceTitle,
      sourceUrl: m.sourceUrl,
      sourceType: undefined,
      position: idx,
      score: 0,
    })) as Parameters<typeof assembleContext>[0],
  );
}
