import { describe, it, expect } from "vitest";
import jsPDF from "jspdf";
import { sanitizePdfText } from "@/components/query-box";

describe("Clinical PDF Generation Engine", () => {
  it("sanitizes medical and math symbols without corruption", () => {
    const input = "Dose: 10 µg/kg, eGFR ≤ 30 mL/min, Temp: 37 °C, Arrow: →, Vertical: │, Down: ▼";
    const sanitized = sanitizePdfText(input);
    expect(sanitized).toContain("mcg");
    expect(sanitized).toContain("<=");
    expect(sanitized).toContain("deg C");
    expect(sanitized).toContain("->");
    expect(sanitized).toContain("|");
    expect(sanitized).toContain("v");
    expect(sanitized).not.toContain("µ");
    expect(sanitized).not.toContain("▼");
  });

  it("builds a multi-page PDF document without throwing", () => {
    const sampleReport = `
• CLINICAL SUMMARY
A 68-year-old female with type 2 diabetes and renal impairment presents with confusion, abdominal pain, and Kussmaul respirations.

• DIFFERENTIAL DIAGNOSIS
| Diagnosis | Likelihood | Evidence | Agent Consensus |
| Metformin-Associated Lactic Acidosis (MALA) | High | Negative ketones, anion gap acidosis | 6/7 agents |
| Hyperosmolar Hyperglycemic State (HHS) | Moderate | Hyperglycemia | 4/7 agents |

• MOST LIKELY DIAGNOSIS
The most likely diagnosis is **Metformin-Associated Lactic Acidosis (MALA)**.
> **Patient-Friendly Summary**: This is a serious build-up of lactic acid in the blood due to metformin.

* **Etiology & Underlying Causes**: Renal impairment causing metformin accumulation.
* **Precipitating Triggers & Risk Factors**: Low eGFR, dehydration.

\`\`\`
[Metformin Accumulation]
        |
        v
[Inhibited Hepatic Gluconeogenesis]
        |
        v
[Lactic Acidosis]
\`\`\`

• DEBATE SUMMARY
Points of agreement:
– Presentation is consistent with metabolic emergency.
– Metformin in renal impairment is a primary trigger.

• IMMEDIATE NEXT STEPS
1. **Discontinue metformin**: Immediately stop metformin. -- Rationale: Prevent further accumulation.
2. **STAT ABG and Lactate**: Measure arterial blood gas and lactate levels. -- Rationale: Assess acidosis severity.

• TREATMENT APPROACH
Hemodialysis for severe cases and IV fluid resuscitation.

• FIRST-LINE PHARMACOTHERAPY
| Drug (generic) | Class | Dose & Route | Frequency | Duration | Evidence | Contraindications |
| Regular Insulin | Antidiabetic | 0.1 U/kg/h IV | Continuous | Until glucose < 200 mg/dL | [S1] | Hypoglycemia |
| Sodium Bicarbonate | Alkalinizing | 1-2 mEq/kg IV | Single dose | Until pH > 7.1 | [S2] | Severe hypocalcemia |

• SECOND-LINE / ALTERNATIVES
| Drug (generic) | Indication | Evidence | When to switch |
| Hemodialysis | Severe MALA | [S1] | If lactate > 10 mmol/L |

• MONITORING PLAN
– **Lab or vital**: Monitor serum lactate, glucose, electrolytes, and arterial blood gas.
– **Act if threshold**: Adjust insulin infusion if glucose > 200 mg/dL.

• DRUG INTERACTIONS
– **Metformin + Radiocontrast**: High risk for acute renal failure.

• DOSE ADJUSTMENTS
– **Renal impairment**: Discontinue metformin when eGFR < 30 mL/min.

• SAFETY NOTES
– **Emergency Escalation**: Monitor for worsening acidosis or shock; prepare for ICU transfer.

• CAVEATS AND LIMITATIONS
– Diagnosis requires clinical and laboratory confirmation.
`;

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    doc.setFont("times", "normal");
    doc.setFontSize(11.5);
    const splitLines = doc.splitTextToSize(sanitizePdfText(sampleReport), 174) as string[];
    splitLines.forEach((l: string) => doc.text(l, 18, 20));
    const blob = doc.output("blob");
    expect(blob).toBeDefined();
    expect(blob.size).toBeGreaterThan(500);
  });
});
