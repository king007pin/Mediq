import { describe, it, expect } from "vitest";
import { auditSections, MANDATORY_SECTIONS } from "../../lib/section-completeness";

const completeAnswer = `
## • CLINICAL SUMMARY
text

## • DIFFERENTIAL DIAGNOSIS
text

## • MOST LIKELY DIAGNOSIS
text

## • DEBATE SUMMARY
text

## • IMMEDIATE NEXT STEPS
text

## • TREATMENT APPROACH
text

## • FIRST-LINE PHARMACOTHERAPY
text

## • SECOND-LINE / ALTERNATIVES
text

## • MONITORING PLAN
text

## • DRUG INTERACTIONS
text

## • DOSE ADJUSTMENTS
text

## • SAFETY NOTES
text

## • CAVEATS AND LIMITATIONS
text
`;

describe("auditSections", () => {
  it("reports allMandatoryPresent when every mandatory header exists", () => {
    const r = auditSections(completeAnswer);
    expect(r.allMandatoryPresent).toBe(true);
    expect(r.missingMandatory).toEqual([]);
  });

  it("flags missing CLINICAL SUMMARY section", () => {
    const r = auditSections(completeAnswer.replace("CLINICAL SUMMARY", "XXXX"));
    expect(r.allMandatoryPresent).toBe(false);
    expect(r.missingMandatory).toContain("CLINICAL SUMMARY");
  });

  it("flags missing MOST LIKELY DIAGNOSIS", () => {
    const r = auditSections(completeAnswer.replace("MOST LIKELY DIAGNOSIS", "XXX"));
    expect(r.allMandatoryPresent).toBe(false);
    expect(r.missingMandatory).toContain("MOST LIKELY DIAGNOSIS");
  });

  it("is case-insensitive for header match", () => {
    const r = auditSections(completeAnswer.toLowerCase());
    expect(r.allMandatoryPresent).toBe(true);
  });

  it("returns all-mandatory-missing for empty input", () => {
    const r = auditSections("");
    expect(r.allMandatoryPresent).toBe(false);
    expect(r.missingMandatory).toEqual([...MANDATORY_SECTIONS]);
  });

  it("tracks optional sections separately", () => {
    const noOpt = completeAnswer;
    const r = auditSections(noOpt);
    expect(r.missingOptional).toEqual([]);
    expect(r.allMandatoryPresent).toBe(true);
  });
});
