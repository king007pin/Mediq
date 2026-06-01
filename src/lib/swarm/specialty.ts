import { SpecialtyMeta } from "./types";
import { NVIDIA_SWARM_MODELS } from "../nvidia";

export const SPECIALTY_POOL: SpecialtyMeta[] = [
  {
    id: "system_entryway",
    role: "Triage & Intake Coordinator",
    focus: "Initial screening, patient history capture, ESI/SATS acuity scoring, task routing.",
    keywords: ["triage", "intake", "screening", "acuity", "history", "routing", "symptom", "assessment", "complaint"],
    foundations: ["Emergency Triage", "Clinical Assessment", "Public Health"],
    rulesets: ["Automated symptom indexing", "routing via Directed Acyclic Graphs", "real-time acuity escalations"]
  },
  {
    id: "cardiac_care",
    role: "Cardiology Agent",
    focus: "Hemodynamic tracking, ischemic workups, arrhythmia ECG analyses, predictive cardiovascular risk scoring.",
    keywords: ["chest pain", "palpitation", "cardiac", "heart", "ECG", "MI", "syncope", "arrhythmia", "hypertension", "edema", "hemodynamic", "ischemic"],
    foundations: ["Cardiology", "Physiology (Hemodynamics)", "Anatomy"],
    rulesets: ["Integration with telemetry streams", "automated risk scoring tools (such as ASCVD/TIMI)", "cardiology guideline retrieval"]
  },
  {
    id: "cancer_care",
    role: "Oncology Agent",
    focus: "Tumor board staging, RECIST 1.1 progression tracking, paraneoplastic syndrome management, oncologic emergencies.",
    keywords: ["cancer", "malignancy", "tumor", "lymphoma", "leukemia", "mass", "metastasis", "biopsy", "oncology", "staging", "paraneoplastic"],
    foundations: ["Oncology", "Pathology (Cytology)", "Radiotherapy"],
    rulesets: ["FAISS-based oncology guidelines retrieval", "virtual multidisciplinary board debate mechanisms"]
  },
  {
    id: "neurosciences",
    role: "Neurological Agent",
    focus: "Neuro exam interpretation, stroke localization, seizure management, rare neuromuscular syndrome identification.",
    keywords: ["headache", "seizure", "stroke", "weakness", "numbness", "confusion", "altered", "consciousness", "tremor", "paralysis", "neurological", "neuromuscular"],
    foundations: ["Neurology", "Orthopaedics", "Anatomy (Neuro)"],
    rulesets: ["Integration with neurological examination checklists", "NIHSS scoring tools", "acute stroke intervention timers"]
  },
  {
    id: "gastrosciences",
    role: "Gastroenterology Agent",
    focus: "Malabsorption differentials, acute abdomen evaluations, luminal pathology workups, inflammatory bowel disease tracking.",
    keywords: ["abdominal", "vomiting", "diarrhea", "nausea", "liver", "jaundice", "hepatic", "bowel", "GI bleed", "dysphagia", "malabsorption", "gastroenterology", "endoscopy"],
    foundations: ["Gastroenterology", "General Surgery", "Physiology (Absorption)"],
    rulesets: ["Endoscopy report analyzers", "scoring tools (such as Glasgow-Blatchford and Child-Pugh)", "dietary guideline retrievers"]
  },
  {
    id: "orthopaedics",
    role: "Rheumatology Agent",
    focus: "Autoimmune marker interpretation, inflammatory joint patterns, vasculitis scoring, osteoarthritis tracking.",
    keywords: ["arthritis", "joint", "lupus", "autoimmune", "inflammatory", "rheumatoid", "ANA", "vasculitis", "myositis", "orthopaedic", "osteoarthritis"],
    foundations: ["Orthopaedics", "Joint Anatomy", "Microbiology"],
    rulesets: ["Diagnostic criteria parsers (such as ACR/EULAR)", "joint fluid analysis calculators", "mobility tracking tools"]
  },
  {
    id: "renal_care",
    role: "Nephrology Agent",
    focus: "Glomerular filtration tracking, acid-base balance, acute kidney injury staging, electrolyte management.",
    keywords: ["kidney", "renal", "AKI", "creatinine", "electrolyte", "proteinuria", "uremia", "oliguria", "dialysis", "glomerular", "filtration", "acid-base"],
    foundations: ["Nephrology", "Physiology (Filtration)", "Biochemistry"],
    rulesets: ["Equations for GFR calculation (such as CKD-EPI and MDRD)", "fluid-electrolyte monitors", "nephrotoxic drug alert tools"]
  },
  {
    id: "liver_transplant",
    role: "Transplant Immunology Agent",
    focus: "Allograft rejection monitoring, immunosuppressant dosing, opportunistic infection tracking.",
    keywords: ["liver transplant", "allograft", "rejection", "immonosuppressant", "immunusuppressive", "tacrolimus", "MELD", "PELD", "hepatology", "graft"],
    foundations: ["Transplant Surgery", "Hepatology", "Pathology (Rejection)"],
    rulesets: ["Calculated MELD/PELD scores", "immunosuppressive drug level monitors", "rejection pathology classifiers"]
  },
  {
    id: "bone_marrow_transplant",
    role: "Hematopoietic Agent",
    focus: "Leukemia/lymphoma typing, graft-versus-host-disease (GVHD) grading, cytopenia management.",
    keywords: ["bone marrow", "BMT", "hematopoietic", "leukemia", "lymphoma", "graft-versus-host", "GVHD", "cytopenia", "HLA", "immune reconstitution"],
    foundations: ["Hematology", "Oncology", "Immunology", "Pathology"],
    rulesets: ["Immune reconstitution trackers", "HLA matching databases", "bone marrow pathology interpreters"]
  },
  {
    id: "lung_transplant",
    role: "Pulmonary Transplant Agent",
    focus: "Bronchiolitis obliterans tracking, ventilator compliance, rejection evaluations, lung injury scores.",
    keywords: ["lung transplant", "bronchiolitis", "ventilator", "ventilation", "pulmonary function", "ABG", "lung injury", "rejection", "thoracic"],
    foundations: ["Pulmonology", "Thoracic Surgery", "Physiology (Ventilation)"],
    rulesets: ["Mechanical ventilation guidelines", "arterial blood gas evaluators", "pulmonary function test calculators"]
  },
  {
    id: "chest_surgery",
    role: "Thoracic Surgical Agent",
    focus: "Mediastinal space evaluations, anatomical resections, post-surgical lung dynamics, chest tube monitoring.",
    keywords: ["chest surgery", "thoracic surgery", "mediastinal", "mediastinum", "resection", "chest tube", "pulmonary complication", "thoracotomy"],
    foundations: ["Thoracic Surgery", "Anatomy (Mediastinum)", "Anaesthesia"],
    rulesets: ["Pre-operative risk indices", "anatomical mapping databases", "post-operative pulmonary complication predictors"]
  },
  {
    id: "gynae_oncology",
    role: "Gynae-Oncology Specialist",
    focus: "FIGO staging, pelvic lymph node mapping, cervical cytological assays (PAP), chemotherapy tracking.",
    keywords: ["gynae-oncology", "gynaecology", "FIGO", "PAP smear", "cervical cancer", "ovarian cancer", "uterine cancer", "pelvic lymph node", "chemotherapy"],
    foundations: ["Gynecology", "Pathology (FIGO, PAP)", "Surgery"],
    rulesets: ["FIGO oncology staging engines", "cervical pathology database integrators", "chemo regimen calculators"]
  },
  {
    id: "paediatric_care",
    role: "Pediatric Care Agent",
    focus: "Pediatric development tracking, age-specific diagnostics, adolescent medicine, pediatric triage.",
    keywords: ["child", "pediatric", "infant", "neonate", "year-old", "adolescent", "febrile child", "growth", "milestones", "developmental"],
    foundations: ["Pediatrics", "Developmental Medicine", "Pharmacology"],
    rulesets: ["Developmental milestone indices", "age-specific vital sign verifiers", "integration with the Pharmacology Agent"]
  },
  {
    id: "obstetrics_gynaecology",
    role: "Obstetrics Agent",
    focus: "Gestational tracking, maternal-fetal monitoring, high-risk pregnancy evaluations, teratogenic screening.",
    keywords: ["pregnant", "pregnancy", "obstetric", "gestational", "maternal-fetal", "teratogenic", "preeclampsia", "HELLP", "ectopic", "trimester"],
    foundations: ["Obstetrics", "Gynecology", "Teratology", "Embryology"],
    rulesets: ["Gestational age calculators", "maternal-fetal telemetry monitors", "teratogenic drug screening engines"]
  },
  {
    id: "emergency",
    role: "Emergency Specialist",
    focus: "High-acuity trauma care, toxicological syndromic screens, immediate cardiopulmonary stabilization.",
    keywords: ["acute", "sudden", "severe", "emergency", "trauma", "collapse", "unconscious", "poisoning", "overdose", "toxidrome", "antidote", "stabilization"],
    foundations: ["Emergency Medicine", "Toxicology", "Trauma Surgery"],
    rulesets: ["Advanced cardiac life support algorithms", "toxicological databases", "time-critical intervention trackers"]
  },
  {
    id: "ent",
    role: "Otolaryngology Agent",
    focus: "Deep neck space infection tracking, airway patency monitoring, local auditory/vestibular assessments.",
    keywords: ["ENT", "otolaryngology", "neck space", "airway", "auditory", "vestibular", "sinusitis", "hearing loss", "vertigo", "epistaxis", "tonsillitis"],
    foundations: ["Otolaryngology", "Anatomy (Neck Spaces)", "Microbiology"],
    rulesets: ["Airway management guidelines", "vestibular diagnostic calculators", "local antibiotic selection tools"]
  },
  {
    id: "plastic_surgery",
    role: "Reconstructive Surgical Agent",
    focus: "Tissue perfusion metrics, microvascular flap monitoring, wound healing classifications, graft matching.",
    keywords: ["plastic surgery", "reconstructive", "perfusion", "microvascular flap", "wound healing", "graft", "burn", "debridement", "necrotizing fasciitis"],
    foundations: ["Reconstructive Surgery", "Anatomy (Grafts)", "Orthopaedics"],
    rulesets: ["Perfusion tracking modules", "wound healing classification databases", "graft viability scoring calculators"]
  },
  {
    id: "diagnostic_radiology",
    role: "Diagnostic Imaging Agent",
    focus: "2D/3D imaging analyses, anatomical segmentations, urgent findings notifications, radiological reports.",
    keywords: ["X-ray", "CT scan", "MRI", "ultrasound", "imaging", "radiology", "radiological", "segmentation", "RadGraph", "CheXbert"],
    foundations: ["Radiographic Imaging", "Tomography", "MRI", "Ultrasonography"],
    rulesets: ["Vision-language model segmentations", "RadGraph and CheXbert clinical metrics", "imaging metadata processors"]
  },
  {
    id: "clinical_pathology",
    role: "Pathological Agent",
    focus: "Tissue biopsy analyses, cytology classifications, cellular pathology reports, molecular diagnostic staging.",
    keywords: ["pathology", "biopsy", "cytology", "histopathology", "tissue biopsy", "molecular diagnostics", "neoplastic markers", "slide"],
    foundations: ["Histopathology", "Cytology", "Hematopathology", "Molecular Diagnostics"],
    rulesets: ["Whole-slide histopathological visual analyzers", "cytological assays", "molecular tumor markers database"]
  },
  {
    id: "pharmacology_safety",
    role: "Clinical Pharmacist",
    focus: "Drug-drug interaction checks, pediatric dosing math, Holliday-Segar rates, medication reconciliation.",
    keywords: ["pharmacology", "pharmacokinetics", "clearance", "half-life", "CYP450", "toxicity", "dose-adjust", "agonist", "antagonist", "receptor", "drug-drug", "Holliday-Segar", "dosing math", "reconciliation"],
    foundations: ["Pharmacokinetics", "Pharmacodynamics", "Toxicology"],
    rulesets: ["Holliday-Segar calculators", "Clark's rule verifiers", "DrugBank and RxNorm API tools", "SMILES molecular interaction models"]
  },
  {
    id: "psychiatry",
    role: "Psychiatric Agent",
    focus: "Psychiatric evaluations, therapeutic trust-building, pharmacological balance, patient suicide screening.",
    keywords: ["psychiatric", "mental", "anxiety", "depression", "psychosis", "delirium", "substance", "overdose", "somatisation", "DSM-5", "suicide", "screening"],
    foundations: ["Clinical Psychiatry", "Psychotherapy", "Psychopharmacology"],
    rulesets: ["Diagnostic and Statistical Manual (DSM-5) metrics", "psychological screening indicators", "psychiatric safety monitors"]
  }
];

export function getCognitiveStrategyForSpecialty(specialty: SpecialtyMeta, model: string): { strategy: string; mandate: string } {
  const id = specialty.id;

  if (id === "emergency") {
    return {
      strategy: "time-critical life-threat triage",
      mandate: "ABCDE first — what can kill or permanently harm this patient in the next 60 minutes? Rule out life-threatening pathologies (e.g. cardiac tamponade, tension pneumothorax, pulmonary embolism, aortic dissection, hemorrhagic shock, airway obstruction) before anything else. Every investigation and treatment recommendation MUST include a time-to-action (STAT <1h / urgent <6h / routine <24h). Do not move to lower-acuity diagnoses until life threats are stabilized."
    };
  }

  if (id === "cancer_care" || id === "gynae_oncology") {
    return {
      strategy: "worst-case and red flag hunter",
      mandate: "Screen systematically for serious, life-altering, or malignant pathologies. Primary vs metastatic assessment. Staging indicators (FIGO, AJCC). Oncologic emergencies (hypercalcemia, SVC obstruction, spinal cord compression, febrile neutropenia). Address whether this presentation could represent an atypical paraneoplastic syndrome or autoimmune masquerader."
    };
  }

  if (id === "obstetrics_gynaecology") {
    return {
      strategy: "maternal-fetal safety shield",
      mandate: "Evaluate maternal risk, fetal status (CTG, biophysical profile, Dopplers), and gestational age milestones. Rule out ectopic pregnancy, preeclampsia with severe features, placental abruption, and uterine rupture first. Every pharmacological recommendation must be explicitly cross-referenced with pregnancy safety/teratogenicity by trimester."
    };
  }

  if (id === "paediatric_care") {
    return {
      strategy: "age-adapted developmental triage",
      mandate: "Tailor diagnostic ranges and pharmacology strictly to age and pediatric development. Address weight-based dosing (mg/kg) and fluid requirements. Rule out neonatal sepsis, neonatal respiratory distress, and pediatric emergency conditions (e.g. Kawasaki disease, febrile status epilepticus, intussusception). Safety-netting must be extremely specific for caregivers."
    };
  }

  if (id === "chest_surgery" || id === "plastic_surgery" || id === "ent") {
    return {
      strategy: "operative viability & surgical safety audit",
      mandate: "Assess surgical vs conservative indications. Map anatomical landmarks and pathophysiology. Define operative risk scores (e.g. ASA classification, Goldman index). Outline clear clinical thresholds or signs that trigger immediate conversion from conservative trial to emergency surgery (laparotomy, craniotomy, decompression)."
    };
  }

  if (id === "diagnostic_radiology") {
    return {
      strategy: "structured imaging & multimodality staging",
      mandate: "Interpret multi-modal imaging findings systematically. Anchor findings to structured reporting classifications (e.g. BI-RADS, LI-RADS, PI-RADS, LUNG-RADS). Rank differential diagnoses by radiologic probability and define specific contrast or procedure-related safety checks (e.g., eGFR targets for contrast safety)."
    };
  }

  if (
    id === "clinical_pathology" ||
    id === "pharmacology_safety" ||
    id === "liver_transplant" ||
    id === "bone_marrow_transplant" ||
    id === "lung_transplant"
  ) {
    return {
      strategy: "mechanistic pathophysiology & laboratory anchor",
      mandate: "Anchor your reasoning in the foundational pre-clinical and para-clinical science. Mechanistically trace the disease process from cellular pathology, micro-organisms, anatomical boundaries, or biochemical pathway disruption to the clinical symptoms. Clarify where evidence is assumption vs laboratory-proven, and suggest targeted lab tests to isolate the pathobiology."
    };
  }

  if (id === "psychiatry" || id === "system_entryway") {
    return {
      strategy: "holistic outpatient parsimony & Occam's razor",
      mandate: "Apply Occam's Razor — prioritize a single, unified diagnosis explaining all symptoms. Build a pragmatic, community-feasible management plan optimized for outpatient resource constraints. Focus on patient concerns, functional rehabilitation goals, polypharmacy reconciliation (Beers criteria), and safety-netting thresholds."
    };
  }

  return {
    strategy: "Bayesian differential & organ-system review",
    mandate: "Start from population base rates for this patient's demographic. Review symptoms systematically across organ systems using a diagnostic mnemonic (like VINDICATE). For each diagnosis, state the pre-test probability, update it based on specific clinical findings, and show your probabilistic probability chain."
  };
}

export const MODEL_SPECIALTY_MAP: Record<string, string> = {
  "meta/llama-3.3-70b-instruct":                 "cancer_care",
  "meta/llama-3.1-8b-instruct":                  "renal_care",
  "mistralai/ministral-14b-instruct-2512":        "system_entryway",
  "nv-mistralai/mistral-nemo-12b-instruct":       "orthopaedics",
  "nvidia/nvidia-nemotron-nano-9b-v2":            "clinical_pathology",
  "nvidia/llama-3.1-nemotron-nano-8b-v1":         "diagnostic_radiology",
  "google/gemma-3-12b-it":                        "gastrosciences",
  "microsoft/phi-4-mini-instruct":                "emergency",
  "qwen/qwen3-next-80b-a3b-instruct":             "neurosciences",
  "nvidia/nemotron-nano-3-30b-a3b":               "cardiac_care",
};

export function getSpecialtyForModel(modelId: string, fallbackIndex: number): SpecialtyMeta {
  const id = MODEL_SPECIALTY_MAP[modelId];
  return SPECIALTY_POOL.find((s) => s.id === id) ?? SPECIALTY_POOL[fallbackIndex % SPECIALTY_POOL.length];
}

export function selectSpecialtiesForQuery(question: string, models: string[]): SpecialtyMeta[] {
  const q = question.toLowerCase();
  const count = models.length;
  const gp = SPECIALTY_POOL.find((s) => s.id === "system_entryway")!;
  const em = SPECIALTY_POOL.find((s) => s.id === "emergency")!;

  const scored = SPECIALTY_POOL
    .filter((s) => s.id !== "system_entryway")
    .map((s) => ({
      specialty: s,
      score: s.keywords.filter((kw) => q.includes(kw.toLowerCase())).length,
    }))
    .sort((a, b) => b.score - a.score);

  const primary = scored[0]?.specialty ?? gp;
  const selected: SpecialtyMeta[] = [primary];

  if (count > 1 && !selected.find((s) => s.id === "emergency")) {
    selected.push(em);
  }

  for (const { specialty } of scored.slice(1)) {
    if (selected.length >= count - 1) break;
    if (!selected.find((s) => s.id === specialty.id)) selected.push(specialty);
  }

  if (count > 1 && !selected.find((s) => s.id === "system_entryway")) {
    selected.push(gp);
  }

  while (selected.length < count) {
    const modelAtIdx = models[selected.length];
    const fallbackId = MODEL_SPECIALTY_MAP[modelAtIdx] ?? "system_entryway";
    const fallback = SPECIALTY_POOL.find((s) => s.id === fallbackId) ?? gp;
    selected.push(selected.find((s) => s.id === fallback.id) ? gp : fallback);
  }

  const uniqueIds = new Set(selected.map((s) => s.id));
  if (uniqueIds.size < Math.min(count, 3)) {
    return models.map((m, idx) => getSpecialtyForModel(m, idx));
  }

  return selected.slice(0, count);
}

export const SPECIALTY_MODEL_PREFERENCE: Record<string, string[]> = {
  system_entryway: ["mistralai/ministral-14b-instruct-2512", "nvidia/llama-3.1-nemotron-nano-8b-v1", "meta/llama-3.3-70b-instruct"],
  cardiac_care: ["nvidia/nemotron-nano-3-30b-a3b", "meta/llama-3.3-70b-instruct", "microsoft/phi-4-mini-instruct"],
  cancer_care: ["meta/llama-3.3-70b-instruct", "meta/llama-3.1-8b-instruct", "nvidia/nvidia-nemotron-nano-9b-v2"],
  neurosciences: ["qwen/qwen3-next-80b-a3b-instruct", "nv-mistralai/mistral-nemo-12b-instruct", "meta/llama-3.3-70b-instruct"],
  gastrosciences: ["google/gemma-3-12b-it", "meta/llama-3.3-70b-instruct", "qwen/qwen3-next-80b-a3b-instruct"],
  orthopaedics: ["nv-mistralai/mistral-nemo-12b-instruct", "meta/llama-3.3-70b-instruct", "nvidia/nvidia-nemotron-nano-9b-v2"],
  renal_care: ["meta/llama-3.1-8b-instruct", "meta/llama-3.3-70b-instruct", "nvidia/nemotron-nano-3-30b-a3b"],
  liver_transplant: ["meta/llama-3.3-70b-instruct", "google/gemma-3-12b-it", "meta/llama-3.1-8b-instruct"],
  bone_marrow_transplant: ["nvidia/nvidia-nemotron-nano-9b-v2", "meta/llama-3.3-70b-instruct", "meta/llama-3.1-8b-instruct"],
  lung_transplant: ["meta/llama-3.3-70b-instruct", "nvidia/nemotron-nano-3-30b-a3b", "google/gemma-3-12b-it"],
  chest_surgery: ["meta/llama-3.3-70b-instruct", "nvidia/nemotron-nano-3-30b-a3b", "microsoft/phi-4-mini-instruct"],
  gynae_oncology: ["meta/llama-3.3-70b-instruct", "nvidia/nvidia-nemotron-nano-9b-v2", "meta/llama-3.1-8b-instruct"],
  paediatric_care: ["nvidia/llama-3.1-nemotron-nano-8b-v1", "meta/llama-3.3-70b-instruct", "google/gemma-3-12b-it"],
  obstetrics_gynaecology: ["meta/llama-3.3-70b-instruct", "nvidia/llama-3.1-nemotron-nano-8b-v1", "meta/llama-3.1-8b-instruct"],
  emergency: ["microsoft/phi-4-mini-instruct", "nvidia/nemotron-nano-3-30b-a3b", "nvidia/llama-3.1-nemotron-nano-8b-v1"],
  ent: ["mistralai/ministral-14b-instruct-2512", "meta/llama-3.3-70b-instruct", "nvidia/llama-3.1-nemotron-nano-8b-v1"],
  plastic_surgery: ["meta/llama-3.3-70b-instruct", "nvidia/nemotron-nano-3-30b-a3b", "nvidia/llama-3.1-nemotron-nano-8b-v1"],
  diagnostic_radiology: ["nvidia/llama-3.1-nemotron-nano-8b-v1", "meta/llama-3.3-70b-instruct", "nvidia/nvidia-nemotron-nano-9b-v2"],
  clinical_pathology: ["nvidia/nvidia-nemotron-nano-9b-v2", "meta/llama-3.3-70b-instruct", "meta/llama-3.1-8b-instruct"],
  pharmacology_safety: ["google/gemma-3-12b-it", "meta/llama-3.3-70b-instruct", "nvidia/llama-3.1-nemotron-nano-8b-v1"],
  psychiatry: ["nvidia/llama-3.1-nemotron-nano-8b-v1", "meta/llama-3.3-70b-instruct", "qwen/qwen3-next-80b-a3b-instruct"],
};

export function allocateModelsToSpecialties(selectedSpecialtyIds: string[]): string[] {
  const allocated: string[] = [];
  const usedModels = new Set<string>();

  for (const specId of selectedSpecialtyIds) {
    const preferences = SPECIALTY_MODEL_PREFERENCE[specId] || [];
    let assignedModel = preferences.find(m => !usedModels.has(m));
    
    if (!assignedModel) {
      const directModel = Object.keys(MODEL_SPECIALTY_MAP).find(
        m => MODEL_SPECIALTY_MAP[m] === specId && !usedModels.has(m)
      );
      if (directModel) {
        assignedModel = directModel;
      }
    }
    
    if (!assignedModel) {
      assignedModel = NVIDIA_SWARM_MODELS.find(m => !usedModels.has(m));
    }
    
    if (!assignedModel) {
      assignedModel = "meta/llama-3.3-70b-instruct";
    }
    
    allocated.push(assignedModel);
    usedModels.add(assignedModel);
  }
  
  return allocated;
}
