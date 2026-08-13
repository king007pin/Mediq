import { AgentReply, MatchMeta, SpecialtyMeta } from "./types";
import { getCognitiveStrategyForSpecialty } from "./specialty";
import { callRufloApi } from "./ruflo-client";
import { hasNvidiaKey, nvidiaChat, nvidiaChatHedged, nvidiaChatStream } from "../nvidia";
import { callProvider, type ChatMessage } from "../providerRegistry";
import { type BYOKConfig, mapModelForProvider } from "../byok-resolver";
import { logger } from "../logger";

const NVIDIA_SWARM_MODELS_FAST = [
  "meta/llama-3.1-8b-instruct",
  "mistralai/ministral-14b-instruct-2512",
  "nvidia/nvidia-nemotron-nano-9b-v2",
  "google/gemma-3-12b-it",
] as const;

function truncate(text: string, len: number) {
  return text.length > len ? `${text.slice(0, len)}…` : text;
}

function formatCitation(m: MatchMeta) {
  const parts = [
    m.sourceTitle ? `"${m.sourceTitle}"` : "",
    m.sourceUrl ? `(${m.sourceUrl})` : "",
    m.position != null ? `¶${m.position}` : "",
  ].filter(Boolean);
  return parts.length ? `[${parts.join(" ")}]` : "";
}

export function buildSystemPrompt(specialty: SpecialtyMeta, cognitiveStrategy?: { strategy: string; mandate: string }): string {
  const framework = DIAGNOSTIC_FRAMEWORKS[specialty.id] ?? "Apply evidence-based systematic clinical reasoning.";
  const strategyBlock = cognitiveStrategy
    ? `\nCOGNITIVE APPROACH — ${cognitiveStrategy.strategy.toUpperCase()}:\n${cognitiveStrategy.mandate}\nThis approach is NON-NEGOTIABLE — it is your primary analytical lens throughout all sections.\n`
    : "";
  return `You are a board-certified ${specialty.role} on a multidisciplinary MEDIQ clinical panel.
Your role is to analyze the clinician's question through your specialty lens, using only the provided evidence snippets [S#] plus standard clinical reasoning.
Specialty lens: ${specialty.focus}.
Diagnostic framework: ${framework}
${strategyBlock}

TASK ALIGNMENT FIRST

Before answering, identify what the clinician is asking for:
- diagnosis
- diagnostic criteria
- differential diagnosis
- workup
- surveillance
- genetic/family screening
- treatment
- pharmacology
- emergency triage
- patient counseling

Your response must cover diagnosis, workup, AND treatment/pharmacology as a complete clinical assessment.
Suppress pharmacology only when the query is exclusively about diagnostic criteria, genetic screening, or surveillance with no management component.

MANDATORY RESPONSE STRUCTURE

1. SPECIALTY INTERPRETATION
State what your specialty sees as the leading clinical issue.

2. CRITERIA / EVIDENCE MATCH
If a diagnosis is being considered, state whether the case meets formal criteria.
Use this table when applicable:
| Feature | Formal criterion? | Present? | Evidence / comment |
|---|---|---|---|

3. MOST LIKELY DIAGNOSIS OR CONCLUSION
State: suspected / possible / probable / definite clinical / molecularly confirmed.
What evidence supports it. What evidence is missing.

4. PLAUSIBLE DIFFERENTIALS
List only plausible alternatives. For each: why considered, what would distinguish it, why less likely.

5. RECOMMENDED NEXT EVALUATION
Prioritized next steps. Each: test/action | urgency | what result changes management.

6. SURVEILLANCE / SCREENING
Only include if relevant to the condition or asked by the user.
Include frequency, modality, age range, escalation triggers.

7. GENETIC / FAMILY IMPLICATIONS
Include whenever relevant. State: inheritance pattern, proband-first testing, parental/sibling testing,
clinical screening if genetic testing is negative or unavailable, recurrence risk, mosaicism caveat.

8. TREATMENT / PHARMACOLOGY
Always include. For every medication: exact indication, dose only if evidence-supported, route, specific and accurate frequency (e.g. q8h, daily), specific duration (e.g. 5 days, 7-10 days),
contraindications, monitoring, interactions, evidence citation. Do not use vague frequencies/durations (avoid "N/A" or "as directed" without details).
Include first-line drugs, second-line alternatives, monitoring plan, and key drug interactions.

9. RED FLAGS
List emergency or urgent specialist-referral triggers.

10. EVIDENCE GAPS
List missing information that would materially change the answer.

RULES
- Cite each factual claim with [S#]. If not in retrieved evidence, write: [not in retrieved evidence].
- Do not invent citations. Do not invent drug doses.
- Do not over-diagnose. Do not treat agent consensus as evidence.
- Do not include internal audit instructions.
- For serious conditions: flag any RED FLAG or emergency escalation trigger.`;
}

export function buildDebateSystemPrompt(specialty: SpecialtyMeta, cognitiveStrategy?: { strategy: string; mandate: string }): string {
  const strategyBlock = cognitiveStrategy
    ? `\nYour analytical lens remains ${cognitiveStrategy.strategy.toUpperCase()} — apply it when critiquing peers:\n${cognitiveStrategy.mandate}\n`
    : "";
  return `You are the ${specialty.role} on a multidisciplinary expert panel in structured peer-debate.
Specialty lens: ${specialty.focus}.
${strategyBlock}
You submitted your initial assessment. You have now read every colleague's analysis — each is labelled by their medical specialty. Debate from YOUR specialty's perspective: defend what your training sees that others missed, and concede only where another specialty genuinely out-reasons yours on the evidence.

ROLE-OVERLAY ASSIGNMENTS (SAFETY & ACUITY):
- If your specialty aligns with acute care, triage, or surgery (e.g. Emergency, Cardiac Care, Trauma): act also as a **Red Flag Urgency Analyst**. Explicitly identify, verify, and cross-examine any time-sensitive critical findings, and call out colleagues who missed or minimized urgent clinical details.
- If your specialty is a diagnostic or evidence specialist (e.g. Oncology, Radiology, Pathology, Pharmacology): act also as a **Skeptic Safety Reviewer**. Challenge overconfident conclusions, call out diagnostic anchoring, flag unsupported or un-cited claims, and ensure peer claims strictly match retrieved evidence [S#].

MANDATORY STRUCTURE:

1. PEER CRITIQUES (address each colleague by their specialty, individually)
   For each colleague:
   - One specific agreement with clinical reasoning and [S#] citation
   - One specific disagreement or gap — state exactly what they missed or got wrong from your specialty lens, cite [S#] or flag "not in evidence"
   - What their specialty contributed that your initial assessment lacked

2. DIRECT CHALLENGE (mandatory — this is the core of the debate)
   Identify the ONE colleague whose primary diagnosis most conflicts with yours. Mount a mechanism-based counter-argument: name the specific finding [S#] their leading diagnosis fails to explain, and state what your specialty prioritises instead and why. Generic disagreement is unacceptable — attack the pathophysiology.

3. REVISED DIFFERENTIAL
   Update likelihood estimates post-debate. Explicitly state what changed and why.
   Format: "I upgraded [diagnosis] from Moderate to High because Colleague (Cardiology) identified [specific finding] [S#]"

4. CONSOLIDATED DIAGNOSIS
   Your updated primary diagnosis. Has it changed from Round 1? If yes, what specific peer argument or evidence forced the change?

5. TEAM CONSENSUS POINTS
   What the panel has collectively established with high confidence — specific clinical facts, not generalities.

6. UNRESOLVED DISPUTES + DISCRIMINATOR
   Each diagnostic disagreement the panel could not resolve. For each, name the SINGLE highest-yield investigation that would settle it and the exact result that discriminates between the competing diagnoses.

RULES:
- Reference colleagues by specialty: "Colleague (Cardiology)", "Colleague (Emergency Medicine)", etc.
- Cite every claim [S#]. Flag anything not in evidence.
- Direct, specific disagreement is required — blanket agreement or hedging is a failure of this round and weakens the final report.
- Stay in your specialty character throughout; do not become a generic physician.
- Minimum 300 words.`;
}

export function buildSynthesisSystemPrompt(agentCount: number): string {
  return `You are the final clinical synthesis physician for MEDIQ.

You receive:
1. The clinician's original question.
2. Retrieved evidence snippets labeled [S#].
3. Round 1 specialist assessments (${agentCount} agents).
4. Round 2 peer-review refinements (debate).

Your job is to produce ONE clean clinician-facing final consensus report.

CORE DIRECTIVE

Produce a comprehensive, structured clinical analysis based strictly on the uploaded report text, extracted data, and dynamic debate findings. Do not default to a generic answer.
Do not use majority agent vote as evidence. Evidence outranks agent agreement.
Never expose raw peer critique text, self-audit instructions, hidden chain-of-thought, or unfinished QA scaffolding.

EVIDENCE RULES

- Use retrieved evidence snippets [S#] for every major factual claim.
- Do not invent citations.
- If a required clinical claim is not supported by retrieved snippets, write: [UNSUPPORTED BY RETRIEVED EVIDENCE — source needed].
- Prefer current consensus guidelines: GeneReviews, FDA/EMA labels, WHO, CDC, NICE, ICMR, AAP, AAN, ACMG, ACR, KDIGO, IDSA, Cochrane, or equivalent authoritative sources.
- If retrieved evidence is outdated, conflicting, or incomplete, state that clearly.

DIAGNOSTIC REASONING RULES

- Distinguish between: suspected / possible / probable / definite clinical / molecularly confirmed.
- State which diagnostic criteria are met, not met, and unknown.
- Do not count supportive features as formal diagnostic criteria unless a guideline explicitly defines them as criteria.
- State thresholds explicitly (count, imaging feature, lab value, age cutoff, variant classification).
- A VUS must not be treated as pathogenic unless the cited guideline allows it.

GENETIC / FAMILY SCREENING RULES

For suspected inherited or genetic conditions, include:
- inheritance pattern
- proband-first testing strategy
- parental testing if familial pathogenic/LP variant identified
- sibling/at-risk relative screening when appropriate
- clinical screening if molecular testing is negative, unavailable, or mosaicism suspected
- recurrence-risk counseling
- mosaicism caveat when relevant

SURVEILLANCE RULES

When user asks for surveillance:
- Provide modality, frequency, age range, escalation triggers.
- Separate baseline evaluation from ongoing surveillance.
- Use a table.
- Do not substitute weaker tests without labeling them as alternatives.

PHARMACOLOGY RULES

Always include pharmacology and drug tables as part of a complete clinical assessment.
For every medication mentioned in the report, you MUST provide specific, accurate details. The frequency and duration of the medication must be clearly and properly defined (do not write 'N/A', 'as needed', or 'as directed' unless clinically justified and accompanied by specific clinical parameters).
For every medication: exact indication, dose only if source-supported, route, specific frequency (e.g. q8h, daily), specific duration (e.g. 5 days, 7-10 days), age/weight assumptions, contraindications, monitoring, major adverse effects, major interactions, evidence source. Never leave frequency or duration vague (avoid "N/A" or "as directed" unless accompanied by precise parameters).
Include RECOMMENDED DRUG TREATMENT PLAN table, ALTERNATIVE DRUG TREATMENT PLAN table, MONITORING PLAN, and DRUG INTERACTIONS.
Do not recommend disease-modifying drugs unless the patient meets indication criteria.
Do not invent drug doses — cite [S#] or label as "standard of care".

MANDATORY 13-SECTION OUTPUT FORMAT

You MUST structure the final clinical analysis report using exactly the following 13-section professional layout. Each section header must start with "## • " followed by the uppercase section name, and must be preceded by a dashed line/divider "---".

---
## • CLINICAL SUMMARY
Write one concise paragraph summarizing:
* Patient demographics
* Key history and comorbidities
* Presenting symptoms
* Relevant medications
* Key lab/imaging/vital abnormalities
* Why this is clinically significant
Avoid long explanations here. This section should orient the clinician quickly.

---
## • DIFFERENTIAL DIAGNOSIS
Create a table with exactly these columns:
| Diagnosis | Likelihood | Evidence | Agent Consensus |
Rules:
* Include 4–6 diagnoses.
* Likelihood must be: High, Moderate, Low, or Very Low.
* Evidence must be concise and case-specific.
* Agent Consensus should be written like “6/7 agents”, “4/7 agents”, etc.
* Rank diagnoses from most likely to least likely.

---
## • MOST LIKELY DIAGNOSIS
Write:
“The most likely diagnosis is **[diagnosis]**.”

Write a concise, patient-friendly summary (approximately 60 words) explaining the disease in plain, non-clinical, and non-medical language, so that non-medical people can read and understand what the disease is. Format this summary as a blockquote:
> **Patient-Friendly Summary**: [Plain-language description of the disease, its mechanism, and standard symptoms, keeping it under 60 words].

Provide a structured, text-based ASCII flow diagram (wrapped in a markdown code block starting with \`\`\`) showing the pathophysiology/mechanism or diagnostic path of the most likely diagnosis. Explain what happens and why step-by-step using text boxes and arrows (e.g., \`[Symptom/Trigger] --> [Pathology/Mechanism] --> [Clinical Outcome/Diagnosis]\`). Use vertical or horizontal alignments clearly. Example:
\`\`\`
[Trigger (e.g., Allergen/Infection)]
       │ (triggers immune response)
       ▼
[Histamine/Mediator Release]
       │ (causes bronchoconstriction)
       ▼
[Airway Narrowing & Wheezing (Asthma)]
\`\`\`
Explain the steps clearly inside the diagram to make it highly professional, visual, and easy to understand.

Then explain:
* Why this diagnosis best fits the case
* Which findings support it
* Which competing diagnoses were considered
* Why the alternatives are less likely
* Any missing confirmatory tests

End this section with:
Panel agreement: [X] of ${agentCount} agents agreed on [diagnosis] as the primary diagnosis after debate.

---
## • DEBATE SUMMARY
Use this structure:
Points of agreement:
– [point 1]
– [point 2]
– [point 3]

Points debated:
– [point 1]
– [point 2]

This section should show clinical reasoning, not just repeat the diagnosis.

---
## • IMMEDIATE NEXT STEPS
Numbered list. Include 3–6 steps.
Each step must follow this structure:
1. **[Action]**: [Specific clinical action]. — Rationale: [Why this matters clinically].
Rules:
* Prioritize stabilization, confirmatory testing, medication holds, escalation, and urgent referrals.
* Include thresholds for escalation when relevant.
* Do not over-prescribe. Keep it clinician-facing.

---
## • TREATMENT APPROACH
Write one short paragraph consolidating the recommended treatment strategy.
Include:
* Stabilization priorities
* Disease-specific management
* Supportive care
* Escalation pathway
* Need for clinician/local protocol verification

---
## • FIRST-LINE PHARMACOTHERAPY
Create a table with exactly these columns:
| Drug (generic) | Class | Dose & Route | Frequency | Duration | Evidence | Contraindications |
Rules:
* Include only clinically relevant first-line medications.
* Use generic drug names.
* Every drug listed must specify a specific, accurate frequency (e.g. "q8h", "daily", "once daily") and duration (e.g. "5 days", "7-10 days", "until clinical stabilization"). Do not leave these blank or use vague terms like "N/A" or "as directed" without details.
* If dosing depends on weight, renal function, severity, or protocol, state that clearly.
* If exact dose cannot be safely determined from the case, write: “Per local protocol / clinician judgment.”
* Do not invent evidence citations.

---
## • SECOND-LINE / ALTERNATIVES
Create a table with exactly these columns:
| Drug / Intervention | Indication | Evidence | When to switch |
Rules:
* Include alternatives, escalation therapies, procedures, dialysis, ICU-level care, or specialist interventions when relevant.
* If recommending drugs in this section, ensure their specific dose, frequency, and duration are either detailed in the table or the accompanying text.

---
## • MONITORING PLAN
Use bullet points in this exact format:
– **Lab or vital**: [what to monitor, how often if known, and why].
– **Act if threshold**: [specific threshold or clinical deterioration trigger].
– **Clinical reassessment**: [what symptoms/signs should be reassessed].

---
## • DRUG INTERACTIONS
Use bullet points.
Format:
– **Drug A + Drug B**: [interaction risk and recommended monitoring/action].
If no major interaction is identifiable from the provided case, write:
– No major drug-drug interaction can be confirmed from the available information; clinician should verify complete medication list.

---
## • DOSE ADJUSTMENTS
Use bullet points:
– **Renal impairment**: [dose adjustment considerations].
– **Hepatic impairment**: [dose adjustment considerations].
– **Elderly / paediatric**: [age-specific considerations].
– **Pregnancy / lactation**, if relevant: [considerations].

---
## • SAFETY NOTES
Include:
– Red flags
– Black box warnings if relevant
– Contraindications
– ICU/emergency escalation triggers
– Important diagnostic limitations
Keep this concise but clinically serious.

---
## • CAVEATS AND LIMITATIONS
Use 3–5 bullet points.
Each bullet should explain:
* What is uncertain
* What data is missing
* What must be confirmed by examination, labs, imaging, cultures, ECG, medication reconciliation, or specialist input

MEDICAL SAFETY AUDIT — DO NOT PRINT — REVISE BEFORE OUTPUT

Before showing the report to the user, silently audit and correct every item below. Do not output the audit. Output only the corrected final report.
1. DIAGNOSTIC ANCHORING: Did the report anchor on one diagnosis? Ensure alternative diagnoses are ranked.
2. CRITERIA COMPLETENESS: Are all required criteria listed? Flag which criteria are met vs unmet vs unknown.
3. DANGEROUS ALTERNATIVES: Are life-threatening diagnoses ranked? Elevate them.
4. ACUITY LEVEL: Is patient's acuity stated at the top of CLINICAL SUMMARY?
5. EMERGENCY ACTIONS FIRST: Are STAT recommendations placed before routine ones?
6. MEDICATION SAFETY: Are contraindications and renal/hepatic adjustments stated?
7. PREREQUISITES: Are safety screening prerequisites stated before dangerous treatments?
8. ESCALATION THRESHOLDS: Are triggers specific and actionable?
9. REFERENCE QUALITY: Are citations directly relevant?
10. TEMPLATE BLOAT: Omit pharmacology or genetic sections only if they have absolutely no clinical relevance.

After completing the audit, output only the corrected final report.`;
}

export const DIAGNOSTIC_FRAMEWORKS: Record<string, string> = {
  system_entryway: "Initial clinical screening. Apply directed acyclic graph routing, automated symptom indexing, and real-time acuity escalations using ESI/SATS protocols.",
  cardiac_care: "ACS rule-out pathway. Stable vs unstable stratification. ASCVD/TIMI risk scoring tools. Structural/ischemic/arrhythmic ECG analysis, telemetry stream integration, and cardiology guideline retrieval.",
  cancer_care: "Tumor board staging. RECIST 1.1 progression tracking. Screen for paraneoplastic syndromes and oncologic emergencies (hypercalcemia, SVC obstruction, spinal cord compression, febrile neutropenia) using FAISS-based oncology guidelines.",
  neurosciences: "Neurological examination checklists. Localize lesion first (cortex/subcortex/brainstem/cord/PNS/NMJ/muscle) then determine etiology. NIHSS scoring tools and acute stroke intervention timers.",
  gastrosciences: "Upper vs lower GI luminal pathology. Hepatic vs biliary vs pancreatic. Glasgow-Blatchford and Child-Pugh scoring tools, endoscopy report analyzers, and dietary guideline retrievers.",
  orthopaedics: "Autoimmune marker interpretation and inflammatory joint patterns. ACR/EULAR diagnostic criteria, joint fluid analysis calculators, mobility tracking, and osteoarthritis tracking.",
  renal_care: "KDIGO AKI staging. Pre-renal/intra-renal/post-renal framework. GFR calculations via CKD-EPI/MDRD equations, fluid-electrolyte monitoring, and nephrotoxic drug alert tools.",
  liver_transplant: "Immunology and transplant surgery. Calculated MELD/PELD scores for severity, immunosuppressive drug level monitors, and graft-versus-host/rejection pathology classifiers.",
  bone_marrow_transplant: "Leukemia/lymphoma typing. HLA matching databases, bone marrow pathology interpreters, immune reconstitution trackers, and GVHD grading.",
  lung_transplant: "Pulmonary transplant matching. Mechanical ventilation guidelines, arterial blood gas (ABG) evaluators, pulmonary function test calculators, and bronchiolitis obliterans tracking.",
  chest_surgery: "Pre-operative surgical risk indices and anatomical mapping databases. Post-operative pulmonary complication predictors, chest tube output monitoring, and mediastinal space evaluation.",
  gynae_oncology: "FIGO oncology staging engines, cervical pathology database integrators (PAP), and pelvic lymph node mapping. Chemotherapy regimen trackers.",
  paediatric_care: "Age-specific vital sign verifiers and developmental milestone indices. Weight-based dosing (mg/kg) and fluid requirements. Safety-netting thresholds for caregivers.",
  obstetrics_gynaecology: "Gestational age calculators, maternal-fetal telemetry monitors, and teratogenic drug screening engines. Rule out ectopic pregnancy, preeclampsia, and placental abruption.",
  emergency: "ATLS primary survey (Airway, Breathing, Circulation, Disability, Exposure). Advanced cardiac life support (ACLS) algorithms, toxicological databases, and time-critical intervention trackers.",
  ent: "Airway management guidelines, vestibular diagnostic calculators (Dix-Hallpike / HINTS), local auditory/vestibular assessments, and local antibiotic selection tools.",
  plastic_surgery: "Perfusion tracking modules, wound healing classification databases, graft viability scoring calculators, and microvascular flap monitoring.",
  diagnostic_radiology: "Vision-language model segmentations, RadGraph and CheXbert clinical metrics, imaging metadata processors, and structured reporting (BI-RADS, LI-RADS, PI-RADS, LUNG-RADS).",
  clinical_pathology: "Whole-slide histopathological visual analyzers, cytological assays, and molecular tumor markers database.",
  pharmacology_safety: "Holliday-Segar calculators, Clark's rule verifiers, DrugBank/RxNorm API tools, and SMILES molecular interaction models. Screen for drug-drug interactions and Beers criteria.",
  psychiatry: "Diagnostic and Statistical Manual (DSM-5) metrics, psychiatric safety monitors, psychological screening indicators, and organic etiology rule-out.",
};

export function buildUserPrompt(question: string, context: string, patientContext?: string, labText?: string): string {
  const patientSection = patientContext
    ? `\nPATIENT DEMOGRAPHICS:\n${patientContext}\nIncorporate these demographics into contraindication and dosing decisions.\n`
    : "";
  const labSection = labText
    ? `\nLAB REPORT DATA (uploaded by clinician — treat as primary evidence):\n${labText}\nCite specific lab values in your analysis. Flag any critical values.\n`
    : "";
  return `EVIDENCE BASE — engage with every snippet individually in section 3:
${context}
${patientSection}${labSection}
CLINICAL QUESTION:
${question}

Apply your specialty diagnostic framework now. Produce all 7 required sections. Minimum 450 words. Be clinically specific.`;
}

const ESSENTIAL_DEBATE_SECTIONS = [
  "WORKING DIFFERENTIAL",
  "MOST LIKELY DIAGNOSIS",
  "INVESTIGATIONS",
  "PHARMACOLOGICAL RECOMMENDATIONS",
  "EVIDENCE GAPS",
];

export function compressAgentResponse(response: string, targetWords = 500): string {
  const words = response.split(/\s+/);
  if (words.length <= targetWords) return response;
  const floor = Math.max(250, targetWords);

  const lines = response.split("\n");
  const important: string[] = [];
  let capturing = false;
  let capturedWords = 0;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const isEssentialHeader = ESSENTIAL_DEBATE_SECTIONS.some((s) => line.toUpperCase().includes(s));

    if (isEssentialHeader) {
      capturing = true;
      important.push(line);
      continue;
    }

    const isCriticalLine =
      /\[S\d+\]/.test(line) ||
      /likelihood|probability|%/i.test(line) ||
      /mg|mcg|units|dose|route|daily|bid|tid/i.test(line);

    if (capturing || isCriticalLine) {
      important.push(line);
      capturedWords += line.split(/\s+/).length;
    }

    if (capturedWords >= floor && !isEssentialHeader) {
      const remaining = lines.slice(li + 1);
      const hasMoreEssential = remaining.some((l) =>
        ESSENTIAL_DEBATE_SECTIONS.some((s) => l.toUpperCase().includes(s))
      );
      if (!hasMoreEssential) break;
    }
  }

  const compressed = important.join("\n").trim();
  return compressed.split(/\s+/).length >= 200
    ? compressed
    : words.slice(0, floor).join(" ") + "\n…[truncated for debate efficiency]";
}

export function buildDebateUserPrompt(
  question: string,
  context: string,
  ownRole: string,
  myAssessment: string,
  peers: Array<{ role: string; message: string }>,
  swarmSize = 1,
): string {
  const shouldCompress = swarmSize >= 5;
  const peerBlock = peers
    .map((p) => {
      const content = shouldCompress ? compressAgentResponse(p.message) : p.message;
      return `=== Colleague (${p.role}) ===\n${content}`;
    })
    .join("\n\n");
  return `Evidence:\n${context}\n\nClinical question: ${question}\n\nYOU are the ${ownRole} on this panel — debate in that character.\n\n=== YOUR Initial Assessment ===\n${myAssessment}\n\n=== PEER ASSESSMENTS FOR REVIEW (each labelled by specialty) ===\n${peerBlock}\n\nProvide your REFINED peer-reviewed response, critiquing each colleague by their specialty from your ${ownRole} perspective:`;
}

const TSC_KEYWORDS = [
  "tsc", "tuberous sclerosis", "tsc1", "tsc2", "subependymal nodule", "sega",
  "cortical tuber", "infantile spasm", "angiomyolipoma", "hypomelanotic macule",
];

export function buildTSCModule(question: string, context: string): string {
  const q = question.toLowerCase();
  const c = context.toLowerCase();
  const isTSC = TSC_KEYWORDS.some((kw) => q.includes(kw) || c.includes(kw));
  if (!isTSC) return "";

  return `

SPECIALTY MODULE: TUBEROUS SCLEROSIS COMPLEX

When TSC is suspected, the final answer must apply these rules:

DIAGNOSTIC CRITERIA (2021 framework):
- Definite clinical TSC: 2 major features OR 1 major + ≥2 minor features.
- Possible TSC: 1 major feature OR ≥2 minor features.
- Molecular diagnosis: pathogenic or likely pathogenic variant in TSC1 or TSC2.
- A VUS does NOT confirm TSC.
- Subependymal nodules count as major criterion only when ≥2 are present.
- Macrocephaly, developmental delay, seizures, and infantile spasms are supportive but NOT formal major/minor criteria.

BASELINE EVALUATION (newly diagnosed):
- Three-generation family history.
- TSC1/TSC2 genetic testing + genetic counseling.
- Dermatologic exam.
- Brain MRI: tubers, subependymal nodules, migration defects, SEGA.
- EEG if seizures known/suspected; baseline awake/sleep EEG in newly diagnosed pediatric cases.
- TAND assessment.
- Abdominal MRI: renal angiomyolipomas + renal cysts.
- Blood pressure + renal function/GFR.
- Echocardiogram in pediatric patients (especially <3 years).
- ECG in all ages.
- Ophthalmology exam with dilated fundoscopy.
- Dental/oral exam.

SURVEILLANCE:
- Brain MRI every 1–3 years until age 25 (asymptomatic TSC); more frequent for large/growing SEGA or ventricular enlargement.
- Abdominal MRI every 1–3 years lifelong for angiomyolipomas and renal cystic disease.
- Annual blood pressure + renal function/GFR.
- Annual TAND screening; formal evaluations at key developmental stages.
- Neurology follow-up + EEG as clinically indicated.
- Annual dermatology exam.
- Annual ophthalmology exam (or per ophthalmology recommendation).
- Dental exam every 6 months.
- Echocardiogram every 1–3 years in asymptomatic pediatric patients with rhabdomyomas until regression.
- Pulmonary LAM screening primarily in adult females and symptomatic individuals.

PARENT / FAMILY SCREENING:
- TSC is autosomal dominant.
- Test affected child/proband first.
- If pathogenic/LP TSC1/TSC2 variant identified: offer targeted parental testing.
- If molecular testing is negative, unavailable, or mosaicism suspected: offer clinical screening of parents (skin exam, ophthalmology, renal imaging, brain imaging).
- Offer sibling/relative evaluation when indicated.
- Recurrence risk: 50% if a parent carries the familial pathogenic variant.
- If apparently de novo: recurrence risk is lower but not zero (germline mosaicism possible).

TREATMENT CAUTION:
- Vigabatrin is first-line for TSC-associated infantile spasms. Do NOT imply it is first-line for all focal seizures.
- For focal seizures: recommend pediatric neurology-led antiseizure therapy.
- Everolimus: discuss only when there is a specific indication (growing SEGA, qualifying renal angiomyolipoma, refractory TSC-associated seizures). Do NOT generate everolimus dosing unless treatment is asked and source support is available.`;
}

export function buildSynthesisUserPrompt(
  question: string,
  context: string,
  round1Agents: AgentReply[],
  round2Agents: AgentReply[],
): string {
  const compress = round1Agents.length >= 4;
  const r1Block = round1Agents
    .map((a, i) => {
      const text = compress ? compressAgentResponse(a.message, 280) : a.message;
      return `--- Agent ${i + 1} Initial (${a.model}) ---\n${text}`;
    })
    .join("\n\n");
  const r2Block = round2Agents.length > 0
    ? "\n\nROUND 2 - PEER-REVIEWED REFINEMENTS:\n\n" +
      round2Agents
        .map((a, i) => {
          const text = compress ? compressAgentResponse(a.message, 200) : a.message;
          return `--- Agent ${i + 1} Refined (${a.model}) ---\n${text}`;
        })
        .join("\n\n")
    : "";
  const tscModule = buildTSCModule(question, context);
  return `Evidence base:\n${context}\n\nClinical question: ${question}${tscModule}\n\nROUND 1 - INITIAL ASSESSMENTS:\n\n${r1Block}${r2Block}\n\nGenerate the definitive clinical report now:`;
}

const ROUND1_NONPRIMARY_MAX_TOKENS = 1500;
// Debate replies are short (≥300 words); cap so agents finish before the Round-2
// quorum wallclock. Only affects intermediate debate bubbles, never the final
// synthesized clinical report.
const ROUND2_DEBATE_MAX_TOKENS = 1024;

// Option C: cap the Round-1 primary (was uncapped 4096). It is compressed to
// ~280 words before synthesis anyway, so 2048 is ample and cuts the worst-case
// generation time that most often tripped the per-call abort.
const ROUND1_PRIMARY_MAX_TOKENS = 2048;
// Option B: on a per-agent timeout/throw, attempt ONE fast-model retry before
// the local stub. A success returns a real answer whose reasoning does NOT
// start with "fallback", so the UI shows it as a normal (faster) reply instead
// of the "⚠ API timeout — partial result shown" banner.
const FAST_FALLBACK_MAX_TOKENS = 1024;
/** Pick a fast model distinct from the failed one (timeout cascade, Option B). */
function pickFastModel(exclude: string): string {
  return NVIDIA_SWARM_MODELS_FAST.find((m) => m !== exclude) ?? "meta/llama-3.1-8b-instruct";
}

export async function runAgent(
  model: string,
  question: string,
  context: string,
  matches: MatchMeta[],
  agentIndex: number,
  specialty: SpecialtyMeta,
  patientContext?: string,
  labText?: string,
  providerOverride?: BYOKConfig,
): Promise<AgentReply> {
  const cognitiveStrategy = getCognitiveStrategyForSpecialty(specialty, model);
  const system = buildSystemPrompt(specialty, cognitiveStrategy);
  const user = buildUserPrompt(question, context, patientContext, labText);
  const tag = cognitiveStrategy ? `${specialty.role} · ${cognitiveStrategy.strategy}` : specialty.role;
  const maxTokens = agentIndex === 0 ? ROUND1_PRIMARY_MAX_TOKENS : ROUND1_NONPRIMARY_MAX_TOKENS;

  const rufloMsg = await callRufloApi({ model, system, question, context, evidence: matches });
  if (rufloMsg) return { model, message: rufloMsg, reasoning: `Ruflo · ${tag}`, round: 1 };

  // BYOK: use user's provider key if available
  if (providerOverride) {
    const mappedModel = mapModelForProvider(model, providerOverride);
    try {
      const messages: ChatMessage[] = [
        { role: "system", content: system },
        { role: "user", content: user },
      ];
      const message = await callProvider(providerOverride.provider, providerOverride.apiKey, mappedModel, messages, 45_000);
      return { model, message, reasoning: `${tag} · ${providerOverride.provider.name}`, round: 1 };
    } catch (err) {
      logger.warn(`[BYOK Agent] ${providerOverride.provider.name} failed for ${model}→${mappedModel}, falling back to NVIDIA: ${(err as Error).message.slice(0, 80)}`);
      // Fall through to NVIDIA
    }
  }

  if (hasNvidiaKey()) {
    try {
      const message = await nvidiaChatHedged(model, system, user, undefined, maxTokens, "debate");
      return { model, message, reasoning: tag, round: 1 };
    } catch (err) {
      if (process.env.SWARM_FAST_CASCADE !== "0") {
        try {
          const fast = pickFastModel(model);
          const message = await nvidiaChat(fast, system, user, undefined, FAST_FALLBACK_MAX_TOKENS, "debate");
          return { model, message, reasoning: `${tag} · fast:${fast.split("/").pop()}`, round: 1 };
        } catch { /* fall through to local stub */ }
      }
      return { model, message: buildLocalFallback(question, matches, agentIndex), reasoning: `fallback (${(err as Error).message.slice(0, 60)})`, round: 1 };
    }
  }

  return { model, message: buildLocalFallback(question, matches, agentIndex), reasoning: `local · ${tag}`, round: 1 };
}

export async function runDebateAgent(
  model: string,
  question: string,
  context: string,
  myAssessment: string,
  peers: Array<{ model: string; role: string; message: string }>,
  matches: MatchMeta[],
  agentIndex: number,
  swarmSize: number,
  specialty: SpecialtyMeta,
  providerOverride?: BYOKConfig,
): Promise<AgentReply & { round: 2 }> {
  const cognitiveStrategy = getCognitiveStrategyForSpecialty(specialty, model);
  const system = buildDebateSystemPrompt(specialty, cognitiveStrategy);
  const user = buildDebateUserPrompt(
    question,
    context,
    specialty.role,
    myAssessment,
    peers.map((p) => ({ role: p.role, message: p.message })),
    swarmSize,
  );
  const tag = `${specialty.role} (debate)`;

  const rufloMsg = await callRufloApi({ model, system, question, context, evidence: matches, debateMode: true, peers });
  if (rufloMsg) return { model, message: rufloMsg, reasoning: `Ruflo · ${tag}`, round: 2 };

  // BYOK: use user's provider key if available
  if (providerOverride) {
    const mappedModel = mapModelForProvider(model, providerOverride);
    try {
      const messages: ChatMessage[] = [
        { role: "system", content: system },
        { role: "user", content: user },
      ];
      const message = await callProvider(providerOverride.provider, providerOverride.apiKey, mappedModel, messages, 45_000);
      return { model, message, reasoning: `${tag} · ${providerOverride.provider.name}`, round: 2 };
    } catch (err) {
      logger.warn(`[BYOK Debate] ${providerOverride.provider.name} failed for ${model}→${mappedModel}, falling back to NVIDIA: ${(err as Error).message.slice(0, 80)}`);
      // Fall through to NVIDIA
    }
  }

  if (hasNvidiaKey()) {
    try {
      const message = await nvidiaChatHedged(model, system, user, undefined, ROUND2_DEBATE_MAX_TOKENS, "debate");
      return { model, message, reasoning: tag, round: 2 };
    } catch (err) {
      if (process.env.SWARM_FAST_CASCADE !== "0") {
        try {
          const fast = pickFastModel(model);
          const message = await nvidiaChat(fast, system, user, undefined, FAST_FALLBACK_MAX_TOKENS, "debate");
          return { model, message, reasoning: `${tag} · fast:${fast.split("/").pop()}`, round: 2 };
        } catch { /* fall through to local stub */ }
      }
      return { model, message: buildDebateFallback(question, myAssessment, peers, agentIndex), reasoning: `fallback (${(err as Error).message.slice(0, 60)})`, round: 2 };
    }
  }

  return { model, message: buildDebateFallback(question, myAssessment, peers, agentIndex), reasoning: `local · ${tag}`, round: 2 };
}

export async function runSynthesisAgent(
  model: string,
  question: string,
  context: string,
  round1Agents: AgentReply[],
  round2Agents: AgentReply[],
  matches: MatchMeta[],
  onSynthesisToken?: (token: string) => void,
  providerOverride?: BYOKConfig,
): Promise<string> {
  const system = buildSynthesisSystemPrompt(round1Agents.length);
  const user = buildSynthesisUserPrompt(question, context, round1Agents, round2Agents);

  const rufloMsg = await callRufloApi({ model, system, question, context, synthesisMode: true });
  if (rufloMsg) return rufloMsg;

  // BYOK: use user's provider key for synthesis if available
  if (providerOverride) {
    const mappedModel = mapModelForProvider(model, providerOverride);
    try {
      const messages: ChatMessage[] = [
        { role: "system", content: system },
        { role: "user", content: user },
      ];
      const result = await callProvider(providerOverride.provider, providerOverride.apiKey, mappedModel, messages, 60_000);
      // Emit synthesis token-by-token for streaming UI effect
      if (onSynthesisToken) {
        const words = result.split(/(?<=\s)/);
        for (const word of words) {
          onSynthesisToken(word);
        }
      }
      return result;
    } catch (err) {
      logger.warn(`[BYOK Synthesis] ${providerOverride.provider.name} failed for ${model}→${mappedModel}, falling back to NVIDIA: ${(err as Error).message.slice(0, 80)}`);
      // Fall through to NVIDIA
    }
  }

  if (hasNvidiaKey()) {
    try {
      if (onSynthesisToken) {
        const stream = await nvidiaChatStream(model, system, user, 0.15, 3500, "triage");
        const reader = stream.getReader();
        const chunks: string[] = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          onSynthesisToken(value);
        }
        return chunks.join("");
      }
      return await nvidiaChat(model, system, user, 0.15, undefined, "triage");
    } catch (err) {
      logger.warn(`[Synthesis] NVIDIA call failed, falling back to local template: ${(err as Error).message.slice(0, 200)}`);
    }
  }

  return buildLocalSynthesis(question, round2Agents.length > 0 ? round2Agents : round1Agents, matches);
}

export function buildLocalFallback(question: string, matches: MatchMeta[], agentIndex: number): string {
  const slice = matches.slice(agentIndex, agentIndex + 3);
  const evidence = slice
    .map((m, i) => `[S${i + 1 + agentIndex}] ${truncate(m.chunk, 200)} ${formatCitation(m)}`)
    .join("\n");
  return `Assessment for: ${question}\n\nEvidence reviewed:\n${evidence}\n\n[AI specialist analysis unavailable — showing evidence review only]`;
}

export function buildDebateFallback(
  question: string,
  myAssessment: string,
  peers: Array<{ model: string; message: string }>,
  _agentIndex: number,
): string {
  return `Refined Assessment for: ${question}\n\nAGREEMENTS: Differentials align on the primary presentation.\n\nREFINEMENTS: Colleagues raised ${peers.length} perspective(s). Key additions noted.\n\nMy initial position stands: ${truncate(myAssessment, 300)}\n\n[AI debate refinement unavailable — showing initial assessment only]`;
}

export function buildLocalSynthesis(question: string, agents: AgentReply[], matches: MatchMeta[]): string {
  const evidenceRows = matches.slice(0, 5)
    .map((m, i) => `| [S${i + 1}] | ${truncate(m.chunk, 80)} | ${m.sourceTitle ?? "unknown"} |`)
    .join("\n");

  const agentSummaries = agents
    .map((a, i) => `${i + 1}.  ${a.model} -- ${truncate(a.message, 200)}`)
    .join("\n");

  return `CLINICAL ASSESSMENT REPORT
----------------------------------------

CLINICAL SUMMARY
----------------------------------------
${question}

EVIDENCE BASE
----------------------------------------
| Ref  | Snippet                          | Source       |
|------|----------------------------------|--------------|
${evidenceRows}

AGENT SUMMARIES
----------------------------------------
${agentSummaries}

CAVEATS AND LIMITATIONS
----------------------------------------
-  This is an abbreviated report — the AI synthesis service was unavailable when this report was generated, so it shows individual specialist summaries and evidence only, without a unified consensus assessment.
-  Evidence limited to provided snippets only
-  Please retry the query, or consult a clinician directly if this report is needed urgently.`;
}
