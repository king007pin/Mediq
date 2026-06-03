// Q5: synthesis section completeness check.
//
// buildSynthesisSystemPrompt mandates a fixed set of report sections, but
// max_tokens truncation, model laziness, or stop-token glitches can drop one
// of them silently. Clinicians then read an answer that's missing — for
// example — REFERENCES or RED FLAGS, with no signal that something was lost.
//
// This helper scans the synthesis output for the mandatory section headers
// (case-insensitive substring match against either the bare header or the
// header-followed-by-rule pattern). Returns the list of missing headers so
// callers can warn, regen, or surface to the UI.
//
// Kept in its own zero-dep module so it's unit-testable without the swarm/db
// chain.

export const MANDATORY_SECTIONS = [
  "CLINICAL SUMMARY",
  "DIFFERENTIAL DIAGNOSIS",
  "MOST LIKELY DIAGNOSIS",
  "DEBATE SUMMARY",
  "IMMEDIATE NEXT STEPS",
  "TREATMENT APPROACH",
  "FIRST-LINE PHARMACOTHERAPY",
  "SECOND-LINE / ALTERNATIVES",
  "MONITORING PLAN",
  "DRUG INTERACTIONS",
  "DOSE ADJUSTMENTS",
  "SAFETY NOTES",
  "CAVEATS AND LIMITATIONS",
] as const;

// Sections that are conditional in the synthesis prompt but worth tracking
// when present so we can detect drift if they vanish unexpectedly.
export const TRACKED_OPTIONAL_SECTIONS = [] as const;

export type SectionAuditResult = {
  missingMandatory: string[];
  missingOptional: string[];
  allMandatoryPresent: boolean;
};

function answerContains(answer: string, header: string): boolean {
  const upper = answer.toUpperCase();
  return upper.includes(header.toUpperCase());
}

export function auditSections(answer: string): SectionAuditResult {
  if (typeof answer !== "string" || answer.length === 0) {
    return {
      missingMandatory: [...MANDATORY_SECTIONS],
      missingOptional: [...TRACKED_OPTIONAL_SECTIONS],
      allMandatoryPresent: false,
    };
  }
  const missingMandatory = MANDATORY_SECTIONS.filter((s) => !answerContains(answer, s));
  const missingOptional = TRACKED_OPTIONAL_SECTIONS.filter((s) => !answerContains(answer, s));
  return {
    missingMandatory,
    missingOptional,
    allMandatoryPresent: missingMandatory.length === 0,
  };
}
