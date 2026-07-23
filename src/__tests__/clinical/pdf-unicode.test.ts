import { describe, expect, it } from "vitest";
import { sanitizePdfText } from "../../components/query-box";

describe("sanitizePdfText", () => {
  it("sanitizes medical temperature units °C and °F to deg C and deg F", () => {
    expect(sanitizePdfText("Fever of 38.5°C")).toBe("Fever of 38.5deg C");
    expect(sanitizePdfText("Store at 70°F")).toBe("Store at 70deg F");
    expect(sanitizePdfText("Angle 45°")).toBe("Angle 45deg");
  });

  it("sanitizes microgram dosage units µg and μg to ug", () => {
    expect(sanitizePdfText("Administer 50µg IV")).toBe("Administer 50ug IV");
    expect(sanitizePdfText("Dose: 100μg/dL")).toBe("Dose: 100ug/dL");
  });

  it("sanitizes inequality signs ≥ and ≤ to >= and <=", () => {
    expect(sanitizePdfText("eGFR ≥ 60 mL/min")).toBe("eGFR >= 60 mL/min");
    expect(sanitizePdfText("SpO2 ≤ 92%")).toBe("SpO2 <= 92%");
  });

  it("sanitizes arrows →, ←, ↔ to ->, <-, <->", () => {
    expect(sanitizePdfText("Symptoms → Diagnosis")).toBe("Symptoms -> Diagnosis");
    expect(sanitizePdfText("Inflow ← Outflow")).toBe("Inflow <- Outflow");
    expect(sanitizePdfText("Reversible ↔ Irreversible")).toBe("Reversible <-> Irreversible");
  });

  it("sanitizes plus-minus sign ± to +/-", () => {
    expect(sanitizePdfText("Margin ± 2mm")).toBe("Margin +/- 2mm");
  });

  it("sanitizes Greek letters α, β, γ, Δ to alpha, beta, gamma, Delta", () => {
    expect(sanitizePdfText("α-blocker and β-agonist")).toBe("alpha-blocker and beta-agonist");
    expect(sanitizePdfText("TNF-α and IFN-γ")).toBe("TNF-alpha and IFN-gamma");
    expect(sanitizePdfText("ΔP = 10 mmHg")).toBe("DeltaP = 10 mmHg");
  });

  it("removes remaining unhandled non-ASCII characters", () => {
    expect(sanitizePdfText("Patient 🩺 status 😀: Stable 🔥")).toBe("Patient  status : Stable ");
  });

  it("handles empty or invalid inputs gracefully", () => {
    expect(sanitizePdfText("")).toBe("");
    expect(sanitizePdfText(null as any)).toBe("");
    expect(sanitizePdfText(undefined as any)).toBe("");
  });
});
