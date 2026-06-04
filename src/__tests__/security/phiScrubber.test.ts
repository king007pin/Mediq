import { describe, expect, it } from "vitest";
import { scrubPhi, scrubPhiDeep } from "../../lib/phi-scrubber";

describe("scrubPhi — regex redaction", () => {
  it("redacts titled names", () => {
    expect(scrubPhi("Mr. John Doe presented with chest pain")).toBe("[NAME] presented with chest pain");
    expect(scrubPhi("Dr Jane Smith reviewed the case")).toBe("[NAME] reviewed the case");
    expect(scrubPhi("Mrs. Smith")).toBe("[NAME]");
  });

  it("redacts 'patient <Name>' patterns", () => {
    expect(scrubPhi("patient John Doe, 42yo")).toMatch(/patient \[NAME\]/);
    expect(scrubPhi("Patient: Jane")).toMatch(/Patient \[NAME\]/);
  });

  it("redacts US and Indian phone numbers", () => {
    expect(scrubPhi("call 555-123-4567")).toBe("call [PHONE]");
    expect(scrubPhi("(415) 867-5309")).toBe("[PHONE]");
    expect(scrubPhi("+1 415 867 5309")).toBe("[PHONE]");
    expect(scrubPhi("4158675309")).toBe("[PHONE]");
    expect(scrubPhi("patient mobile +91 98765 43210")).toBe("patient mobile [PHONE]");
    expect(scrubPhi("dial 919876543210 or 09876543210")).toBe("dial [PHONE] or [PHONE]");
  });

  it("redacts Indian national IDs (Aadhaar & ABHA)", () => {
    expect(scrubPhi("Aadhaar: 1234-5678-9012")).toBe("Aadhaar: [AADHAAR]");
    expect(scrubPhi("ABHA ID is 12-3456-7890-1234")).toBe("ABHA ID is [ABHA]");
  });

  it("redacts email addresses", () => {
    expect(scrubPhi("contact john.doe@example.com today")).toBe("contact [EMAIL] today");
  });

  it("redacts SSN", () => {
    expect(scrubPhi("ssn 123-45-6789")).toBe("ssn [SSN]");
  });

  it("redacts MRN", () => {
    expect(scrubPhi("MRN 12345678 admitted")).toBe("[MRN] admitted");
    expect(scrubPhi("Medical Record #87654321")).toBe("[MRN]");
  });

  it("redacts calendar dates", () => {
    expect(scrubPhi("DOB 12/31/1990")).toBe("DOB [DATE]");
    expect(scrubPhi("visit on 2024-03-15 was uneventful")).toBe("visit on [DATE] was uneventful");
    expect(scrubPhi("January 5, 1990 birth date")).toBe("[DATE] birth date");
  });

  it("preserves clinical content like ages, labs, vitals", () => {
    const text = "42yo M with WBC 12.5, BP 140/90, troponin 0.04";
    expect(scrubPhi(text)).toBe(text);
  });

  it("handles null/undefined safely", () => {
    expect(scrubPhi(null)).toBe("");
    expect(scrubPhi(undefined)).toBe("");
    expect(scrubPhi("")).toBe("");
  });
});

describe("scrubPhiDeep — recursive object scrubber", () => {
  it("scrubs strings inside nested objects", () => {
    const input = {
      patient: "Mr. John Doe",
      vitals: { bp: "140/90", note: "called 555-123-4567" },
      tags: ["seen by Dr. Smith", "WBC 12"],
    };
    const out = scrubPhiDeep(input) as typeof input;
    expect(out.patient).toBe("[NAME]");
    expect(out.vitals.note).toBe("called [PHONE]");
    expect(out.tags[0]).toBe("seen by [NAME]");
    expect(out.tags[1]).toBe("WBC 12");
  });

  it("preserves non-string primitives", () => {
    expect(scrubPhiDeep(42)).toBe(42);
    expect(scrubPhiDeep(true)).toBe(true);
    expect(scrubPhiDeep(null)).toBe(null);
  });

  it("breaks reference cycles", () => {
    const a: Record<string, unknown> = { name: "Mr. Smith" };
    a.self = a;
    const out = scrubPhiDeep(a) as Record<string, unknown>;
    expect(out.name).toBe("[NAME]");
    expect(out.self).toBe("[Circular]");
  });

  it("scrubs Error message and stack", () => {
    const e = new Error("Patient: Jane Doe failed validation");
    const out = scrubPhiDeep(e) as Error;
    expect(out.message).toMatch(/Patient \[NAME\] failed validation/);
  });
});
