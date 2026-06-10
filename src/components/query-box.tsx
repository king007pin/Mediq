"use client";

import React, { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ThinkingDots } from "./query-box/AgentDebateBubble";
import { DebateGrid } from "./query-box/DebateGrid";
import { ConsensusReport } from "./query-box/ConsensusReport";
import { EvidenceSources } from "./query-box/EvidenceSources";

export type AgentReply = { model: string; message: string; reasoning: string; round?: 1 | 2 };
export type Match = {
  sourceId: number;
  sourceTitle?: string | null;
  sourceType?: string | null;
  sourceUrl?: string | null;
  position?: number | null;
  chunk: string;
  score: number;
};
export type DDIFlag = { drug: string; warning: string; severity: "BLACK_BOX" | "SERIOUS" | "MODERATE" };
export type LabCritical = { name: string; value: number | string; unit: string };
export type ResponseShape = {
  answer: string;
  agents: AgentReply[];
  round1Agents: AgentReply[];
  matches: Match[];
  sessionId: number | null;
  hospitalDepartments?: string[];
  pgSubjects?: string[];
  ddiFlags?: DDIFlag[];
};
export type SavePayload = {
  title?: string;
  patientName?: string;
  patientAge?: number;
  patientDetails?: string;
  clinicianNotes?: string;
};
export type PatientInfo = { name: string; age: string; gender: string; phone: string; address: string };
export type ModelMeta = { id: string; label: string; role: string; description: string; tags: string[]; size: string };

export const MODELS: ModelMeta[] = [
  { id: "meta/llama-3.3-70b-instruct", label: "Llama 3.3 70B", role: "Internal Medicine",
    description: "Synthesis anchor. Bayesian probabilistic differentials, evidence-based workup, chronic disease context, internal medicine guidelines.",
    tags: ["free", "70B", "synthesis anchor", "generalist"], size: "70B" },
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", role: "Oncology",
    description: "120B open-weights. Red flag hunter. Complex staging, paraneoplastic syndromes, oncologic emergencies, worst-case analysis.",
    tags: ["free", "120B", "oncology", "red flags"], size: "120B" },
  { id: "meta/llama-4-maverick-17b-128e-instruct", label: "Llama 4 Maverick", role: "Emergency Medicine",
    description: "Llama 4 MoE. ABCDE life-threat triage, time-critical diagnoses, STAT vs urgent vs routine prioritisation.",
    tags: ["free", "MoE", "Llama 4", "acute care"], size: "17B×128E" },
  { id: "qwen/qwen3-next-80b-a3b-instruct", label: "Qwen3 80B MoE", role: "Neurology",
    description: "80B MoE stepwise reasoning. Devil's advocate. Rare and atypical diagnoses, complex neurological workups, CoT traces.",
    tags: ["free", "80B MoE", "reasoning", "rare disease"], size: "80B MoE" },
  { id: "mistralai/ministral-14b-instruct-2512", label: "Ministral 14B", role: "Infectious Disease",
    description: "14B fast. Pathogen-first reasoning. Antimicrobial stewardship, epidemiological risk, empiric regimen selection, culture interpretation.",
    tags: ["free", "14B", "fast", "antimicrobials"], size: "14B" },
  { id: "nvidia/nemotron-3-super-120b-a12b", label: "Nemotron Super 120B", role: "Endocrinology",
    description: "NVIDIA 120B. Metabolic unifier. Hormonal disorders, DKA, thyroid storm, adrenal crisis, systemic metabolic workup.",
    tags: ["free", "120B", "NVIDIA", "metabolic"], size: "120B" },
  { id: "nvidia/nemotron-nano-12b-v2-vl", label: "Nemotron Nano 12B", role: "General Practice",
    description: "12B fast, vision-capable. Occam's razor. Community prevalence priors, outpatient feasibility, pragmatic single-diagnosis focus.",
    tags: ["free", "12B", "fast", "primary care"], size: "12B" },
  { id: "mistralai/mixtral-8x22b-instruct-v0.1", label: "Mixtral 8x22B", role: "Rheumatology",
    description: "Sparse MoE step-by-step pathophysiology. Traces mechanism from root cause to every symptom. Autoimmune, connective tissue, vasculitis workup.",
    tags: ["free", "MoE", "8x22B", "pathophysiology"], size: "8x22B MoE" },
  { id: "nvidia/llama-3.3-nemotron-super-49b-v1", label: "Nemotron Super 49B", role: "Critical Care",
    description: "49B haemodynamic stability assessor. MAP, shock index, quick-SOFA. Tiered management: stabilise → escalate → disposition.",
    tags: ["free", "49B", "NVIDIA", "critical care"], size: "49B" },
  { id: "nvidia/llama-3.1-nemotron-70b-instruct", label: "Nemotron 70B", role: "Hematology",
    description: "70B NVIDIA Nemotron. Evidence-quality grader. Grades every claim RCT → cohort → consensus → case report. Anchors to NICE/AHA/WHO/ESMO guidelines.",
    tags: ["free", "70B", "NVIDIA", "evidence grading", "guidelines"], size: "70B" },
];

export const MODEL_COLORS = [
  { border: "#818cf8", bg: "rgba(129,140,248,0.08)", dot: "#818cf8", glow: "rgba(129,140,248,0.25)" },
  { border: "#34d399", bg: "rgba(52,211,153,0.08)",  dot: "#34d399", glow: "rgba(52,211,153,0.25)"  },
  { border: "#f472b6", bg: "rgba(244,114,182,0.08)", dot: "#f472b6", glow: "rgba(244,114,182,0.25)" },
  { border: "#fb923c", bg: "rgba(251,146,60,0.08)",  dot: "#fb923c", glow: "rgba(251,146,60,0.25)"  },
  { border: "#38bdf8", bg: "rgba(56,189,248,0.08)",  dot: "#38bdf8", glow: "rgba(56,189,248,0.25)"  },
  { border: "#a78bfa", bg: "rgba(167,139,250,0.08)", dot: "#a78bfa", glow: "rgba(167,139,250,0.25)" },
  { border: "#fbbf24", bg: "rgba(251,191,36,0.08)",  dot: "#fbbf24", glow: "rgba(251,191,36,0.25)"  },
  { border: "#f87171", bg: "rgba(248,113,113,0.08)", dot: "#f87171", glow: "rgba(248,113,113,0.25)" },
  { border: "#2dd4bf", bg: "rgba(45,212,191,0.08)",  dot: "#2dd4bf", glow: "rgba(45,212,191,0.25)"  },
  { border: "#e879f9", bg: "rgba(232,121,249,0.08)", dot: "#e879f9", glow: "rgba(232,121,249,0.25)" },
];



// ── PDF generation ──────────────────────────────────────────────────────────

function generateClinicalPDF(reportText: string, query: string, jsPDFClass: any, logoDataUrl: string | null): Blob {
  const doc = new jsPDFClass({ orientation: "portrait", unit: "mm", format: "a4" });

  const PW = 210, PH = 297;
  const ML = 18, MR = 192;
  const CW = MR - ML;

  const TEAL: [number, number, number] = [13, 148, 136];
  const NAVY: [number, number, number] = [26, 52, 96];
  const DARK: [number, number, number] = [30, 41, 59];
  const MUTED: [number, number, number] = [100, 116, 139];
  const LIGHT: [number, number, number] = [200, 214, 229];
  const WHITE: [number, number, number] = [255, 255, 255];
  const DISC: [number, number, number] = [176, 190, 197];
  const TEAL_BG: [number, number, number] = [237, 248, 247];
  const HEADER_BG: [number, number, number] = [245, 249, 250];

  const tc = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const fc = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2]);
  const dc = (c: [number, number, number]) => doc.setDrawColor(c[0], c[1], c[2]);

  let page = 1;
  let y = 57;

  function drawLetterhead() {
    fc(HEADER_BG); doc.rect(0, 0, PW, 46, "F");
    if (logoDataUrl) doc.addImage(logoDataUrl, "PNG", 14, 8, 22, 22);
    doc.setFont("times", "bold"); doc.setFontSize(22); tc(NAVY);
    doc.text("MEDIQ", 40, 21);
    doc.setFont("times", "normal"); doc.setFontSize(8.5); tc(TEAL);
    doc.text("CLINICAL INTELLIGENCE", 40, 27);
    const now = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
    doc.setFont("times", "normal"); doc.setFontSize(7.5); tc(MUTED);
    doc.text(now, MR, 18, { align: "right" });
    doc.text("AI-Assisted Assessment", MR, 24, { align: "right" });
    doc.text("For Licensed Clinicians Only", MR, 30, { align: "right" });
    dc(TEAL); doc.setLineWidth(0.7); doc.line(ML, 35, MR, 35);
    doc.setFont("times", "bold"); doc.setFontSize(13); tc(NAVY);
    doc.text("CLINICAL ASSESSMENT REPORT", PW / 2, 42, { align: "center" });
    if (query.trim()) {
      doc.setFont("times", "italic"); doc.setFontSize(8); tc(MUTED);
      const qLines = doc.splitTextToSize(`Query: ${query}`, CW) as string[];
      doc.text(qLines, PW / 2, 48, { align: "center" });
      // separator and content start track actual query height (each line ≈4mm at 8pt)
      const qEndY = 48 + (qLines.length - 1) * 4;
      dc(LIGHT); doc.setLineWidth(0.25); doc.line(ML, qEndY + 4, MR, qEndY + 4);
      y = qEndY + 9;
    } else {
      dc(LIGHT); doc.setLineWidth(0.25); doc.line(ML, 52, MR, 52);
      y = 57;
    }
  }

  function drawFooter() {
    dc(LIGHT); doc.setLineWidth(0.25); doc.line(ML, PH - 22, MR, PH - 22);
    const disc = "DISCLAIMER: This document is generated by MEDIQ Artificial Intelligence and is intended solely as a clinical decision-support tool for use by licensed medical professionals. It does not constitute a final diagnosis, treatment recommendation, or professional medical advice. All AI-generated findings must be independently verified through physical examination, validated diagnostic investigations, and the attending clinician's professional judgment. Direct use of this output for patient management without clinical corroboration may be hazardous. Not intended for direct patient communication. © MEDIQ Clinical Intelligence.";
    doc.setFont("times", "italic"); doc.setFontSize(6); tc(DISC);
    const dlines = doc.splitTextToSize(disc, CW) as string[];
    doc.text(dlines, ML, PH - 19);
    doc.setFont("times", "normal"); doc.setFontSize(7); tc(MUTED);
    doc.text(`Page ${page}`, PW / 2, PH - 7, { align: "center" });
  }

  function newPage() {
    drawFooter(); doc.addPage(); page++;
    fc(HEADER_BG); doc.rect(0, 0, PW, 15, "F");
    doc.setFont("times", "bold"); doc.setFontSize(9); tc(NAVY);
    doc.text("MEDIQ", ML, 9);
    doc.setFont("times", "normal"); doc.setFontSize(8); tc(TEAL);
    doc.text("Clinical Assessment Report (continued)", ML + 13, 9);
    dc(TEAL); doc.setLineWidth(0.4); doc.line(ML, 13, MR, 13);
    y = 21;
  }

  const checkY = (n: number) => { if (y + n > PH - 25) newPage(); };

  const isAllCapsHeader = (l: string) => {
    let clean = l.trim();
    if (clean.startsWith("#")) {
      clean = clean.replace(/^#+\s*/, "").trim();
    }
    if (clean.startsWith("•") || clean.startsWith("–") || clean.startsWith("-")) {
      clean = clean.slice(1).trim();
    }
    const textWithoutNumber = clean.replace(/^(\d+[\.\s]+|◆\s*)/, "").trim();
    return /^[A-Z\d\s&\/\-–—:().,]+$/.test(textWithoutNumber) && textWithoutNumber.length >= 3 && clean.length <= 80;
  };
  const isDash = (l: string) => /^[-─═]+$/.test(l.trim()) && l.trim().length >= 3;
  const isTableLine = (l: string) => l.trim().startsWith("|");
  const isNumList = (l: string) => /^\d+\.\s{1,3}/.test(l.trim());
  const isBull = (l: string) => /^[-•]\s{1,3}/.test(l.trim());
  const isSepRow = (l: string) => /^\|[-|\s]+\|$/.test(l.trim());

  drawLetterhead();

  const lines = reportText.split("\n");
  let i = 0;

  // Table layout constants
  const CELL_FS = 10;
  const CELL_LINE_H = 5.0;   // mm per line at 10pt
  const CELL_TPAD = 2.8;     // row-top → first baseline
  const CELL_BPAD = 2.2;     // last baseline → row-bottom
  const CELL_HPad = 2.5;     // horizontal cell padding
  const MIN_ROW_H = 8;

  function calcRowH(wrapped: string[][]): number {
    const maxLines = Math.max(...wrapped.map(w => w.length), 1);
    return Math.max(CELL_TPAD + maxLines * CELL_LINE_H + CELL_BPAD, MIN_ROW_H);
  }

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; y += 1.2; continue; }

    if (line.trim().startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;

      if (codeLines.length > 0) {
        const blockH = codeLines.length * 4.5 + 6;
        checkY(blockH);
        fc(TEAL_BG);
        dc([13, 148, 136]);
        doc.setLineWidth(0.2);
        doc.rect(ML, y, CW, blockH, "FD");
        doc.setFont("courier", "normal");
        doc.setFontSize(8.5);
        tc(DARK);
        codeLines.forEach((cl, idx) => {
          doc.text(cl, ML + 4, y + 4.5 + idx * 4.5);
        });
        y += blockH + 3;
      }
      continue;
    }

    if (isTableLine(line)) {
      const tbl: string[] = [];
      while (i < lines.length && (isTableLine(lines[i]) || isSepRow(lines[i]))) { tbl.push(lines[i]); i++; }
      const parseRow = (l: string) => l.split("|").slice(1, -1).map(c => c.trim());
      const si = tbl.findIndex(isSepRow);
      const hdrs = (si > 0 ? tbl.slice(0, si) : [tbl[0]]).flatMap(parseRow);
      const drows = (si >= 0 ? tbl.slice(si + 1) : tbl.slice(1)).filter(l => !isSepRow(l)).map(parseRow).filter(r => r.some(c => c));
      if (!hdrs.length) continue;

      const nCols = hdrs.length;
      const colW = CW / nCols;

      // Pre-wrap all rows so we can measure height before drawing
      doc.setFont("times", "bold"); doc.setFontSize(CELL_FS);
      const hdrWrapped = hdrs.map(h => doc.splitTextToSize(h, colW - CELL_HPad * 2) as string[]);
      const hdrH = calcRowH(hdrWrapped);

      doc.setFont("times", "normal"); doc.setFontSize(CELL_FS);
      const dataWrapped = drows.map(row =>
        row.map(cell => doc.splitTextToSize(cell || "", colW - CELL_HPad * 2) as string[])
      );
      const dataHs = dataWrapped.map(rw => calcRowH(rw));

      const totalH = hdrH + dataHs.reduce((s, h) => s + h, 0);
      y += 2;

      const drawTableHeader = (): number => {
        fc(TEAL); doc.rect(ML, y, CW, hdrH, "F");
        doc.setFont("times", "bold"); doc.setFontSize(CELL_FS); tc(WHITE);
        hdrWrapped.forEach((wlines, ci) => {
          wlines.forEach((wl, li) => {
            doc.text(wl, ML + ci * colW + CELL_HPad, y + CELL_TPAD + li * CELL_LINE_H);
          });
        });
        for (let ci = 1; ci < nCols; ci++) {
          dc(WHITE); doc.setLineWidth(0.2);
          doc.line(ML + ci * colW, y, ML + ci * colW, y + hdrH);
        }
        return hdrH;
      };

      // Keep table together if it fits on a single A4 page (max content height is 251mm).
      if (totalH <= 251) {
        if (y + totalH > PH - 25) {
          newPage();
        }
      } else {
        // Fallback: keep header + first data row together on the same page
        const firstRowH = dataHs[0] ?? 0;
        if (y + hdrH + firstRowH > PH - 25) newPage();
      }

      let segTopY = y;
      y += drawTableHeader();

      // Data rows
      dataWrapped.forEach((rowWrapped, ri) => {
        const rH = dataHs[ri];
        if (y + rH > PH - 25) {
          // Close current segment's outer border on the page being left
          dc(TEAL); doc.setLineWidth(0.4);
          doc.rect(ML, segTopY, CW, y - segTopY, "S");
          newPage();
          segTopY = y;
          y += drawTableHeader();
        }
        if (ri % 2 === 0) { fc(TEAL_BG); doc.rect(ML, y, CW, rH, "F"); }
        doc.setFont("times", "normal"); doc.setFontSize(CELL_FS);
        rowWrapped.forEach((wlines, ci) => {
          tc(ci === 0 ? DARK : MUTED);
          wlines.forEach((wl, li) => {
            doc.text(wl, ML + ci * colW + CELL_HPad, y + CELL_TPAD + li * CELL_LINE_H);
          });
        });
        // Row bottom border + column dividers
        dc(LIGHT); doc.setLineWidth(0.15);
        doc.line(ML, y + rH, MR, y + rH);
        for (let ci = 1; ci < nCols; ci++) {
          doc.line(ML + ci * colW, y, ML + ci * colW, y + rH);
        }
        y += rH;
      });

      // Close final segment's outer border
      dc(TEAL); doc.setLineWidth(0.4);
      doc.rect(ML, segTopY, CW, y - segTopY, "S");
      void totalH; // suppress unused warning
      y += 3;
      continue;
    }

    if (isDash(line)) { i++; continue; }

    if (isAllCapsHeader(line)) {
      checkY(35); y += 3;
      doc.setFont("times", "bold"); doc.setFontSize(15); tc(TEAL);
      let clean = line.trim();
      if (clean.startsWith("#")) {
        clean = clean.replace(/^#+\s*/, "").trim();
      }
      if (clean.startsWith("•") || clean.startsWith("–") || clean.startsWith("-")) {
        clean = clean.slice(1).trim();
      }
      doc.text(clean, ML, y);
      const tw = doc.getTextWidth(clean);
      dc(TEAL); doc.setLineWidth(0.4); doc.line(ML, y + 1.1, ML + tw, y + 1.1);
      y += 6; i++;
      continue;
    }

    if (isNumList(line)) {
      const wrapped = doc.splitTextToSize(line.trim(), CW - 5) as string[];
      checkY(wrapped.length * 5.2 + 1);
      doc.setFont("times", "normal"); doc.setFontSize(11.5); tc(DARK);
      wrapped.forEach((wl, wi) => { doc.text(wl, ML + (wi > 0 ? 6 : 3), y); y += 5.2; });
      i++; continue;
    }

    if (isBull(line)) {
      const content = line.trim().replace(/^[-•]\s{1,3}/, "");
      const wrapped = doc.splitTextToSize(content, CW - 9) as string[];
      checkY(wrapped.length * 5.2 + 1);
      doc.setFont("times", "normal"); doc.setFontSize(11.5);
      tc(TEAL); doc.text("–", ML + 2, y);
      tc(MUTED);
      wrapped.forEach((wl, wi) => { if (wi > 0) checkY(5.2); doc.text(wl, ML + 7, y); y += 5.2; });
      i++; continue;
    }

    const wrapped = doc.splitTextToSize(line, CW) as string[];
    checkY(wrapped.length * 5.2 + 1);
    doc.setFont("times", "normal"); doc.setFontSize(11.5); tc(DARK);
    wrapped.forEach(wl => { doc.text(wl, ML, y); y += 5.2; });
    i++;
  }

  drawFooter();
  return doc.output("blob") as Blob;
}

// ── Shared sub-components ────────────────────────────────────────────────────

function ModelCard({ meta, selected, onClick }: { meta: ModelMeta; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full rounded-xl border p-3 text-left transition"
      style={{
        borderColor: selected ? "var(--accent)" : "var(--card-border)",
        backgroundColor: selected ? "color-mix(in srgb, var(--accent) 8%, var(--card))" : "var(--card)",
        boxShadow: selected ? "0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent)" : undefined,
      }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
            style={{ backgroundColor: selected ? "var(--accent)" : "var(--pill)", color: selected ? "#0f172a" : "var(--text)" }}>
            {meta.size}
          </span>
          <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>{meta.label}</span>
        </div>
        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase"
          style={{ backgroundColor: "var(--pill)", color: "var(--accent)" }}>{meta.role}</span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>{meta.description}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {meta.tags.map((t) => (
          <span key={t} className="rounded-full px-2 py-0.5 text-[10px]"
            style={{ backgroundColor: "var(--pill)", color: "var(--muted)" }}>{t}</span>
        ))}
      </div>
    </button>
  );
}



// ── Main component ───────────────────────────────────────────────────────────

export default function QueryBox() {
  const [question, setQuestion] = useState("");
  const [model, setModel] = useState<string>("meta/llama-3.3-70b-instruct");
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [swarmSize, setSwarmSize] = useState(3);
  const [swarmMode, setSwarmMode] = useState<"research" | "debate">("debate");
  const [result, setResult] = useState<ResponseShape | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saveCase, setSaveCase] = useState(false);
  const [caseFields, setCaseFields] = useState<SavePayload>({});

  const [liveRound1, setLiveRound1] = useState<AgentReply[]>([]);
  const [liveRound2, setLiveRound2] = useState<AgentReply[]>([]);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const [routingPhase, setRoutingPhase] = useState(false);
  const [debatePhase, setDebatePhase] = useState(false);
  const [synthesisPhase, setSynthesisPhase] = useState(false);

  const [feedbackSessionId, setFeedbackSessionId] = useState<number | null>(null);
  const [feedbackGiven, setFeedbackGiven] = useState(false);
  const [feedbackSending, setFeedbackSending] = useState(false);

  const [showPatientInfo, setShowPatientInfo] = useState(false);
  const [patientInfo, setPatientInfo] = useState<PatientInfo>({ name: "", age: "", gender: "", phone: "", address: "" });
  const [labFiles, setLabFiles] = useState<File[]>([]);
  const [labText, setLabText] = useState<string>("");
  const [labCriticals, setLabCriticals] = useState<LabCritical[]>([]);
  const [labUploading, setLabUploading] = useState(false);
  const [labError, setLabError] = useState<string | null>(null);
  const [expandedFileIdx, setExpandedFileIdx] = useState<number | null>(null);
  const [synthesisStream, setSynthesisStream] = useState("");

  const [mode, setMode] = useState<"nvidia" | "multi">("nvidia");
  const [hasProviders, setHasProviders] = useState(false);
  const [multiResult, setMultiResult] = useState<{
    synthesis: string;
    agents: Array<{ role: string; model: string; providerId: string; content: string }>;
    swarmSize: number;
  } | null>(null);

  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [sharingPdf, setSharingPdf] = useState(false);
  const [jsPdfClass, setJsPdfClass] = useState<any>(null);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);

  useEffect(() => {
    import("jspdf")
      .then((m) => {
        setJsPdfClass(() => m.default);
      })
      .catch((err) => console.error("Failed to load jsPDF:", err));

    // Preload logo image and convert to Base64
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          setLogoDataUrl(canvas.toDataURL("image/png"));
        }
      } catch (err) {
        console.error("Failed to convert image to Data URL:", err);
      }
    };
    img.onerror = () => {
      console.error("Failed to load logo image");
    };
    img.src = "/brain-icon.png";
  }, []);

  const abortRef = useRef<AbortController | null>(null);
  const [extractionCache, setExtractionCache] = useState<Map<string, { text: string; criticals: LabCritical[] }>>(new Map());

  function stop() {
    abortRef.current?.abort();
    setStopped(true);
  }

  useEffect(() => {
    fetch("/api/provider-key/status")
      .then((r) => r.json())
      .then((d: { providers?: unknown[] }) => { if ((d.providers?.length ?? 0) > 0) setHasProviders(true); })
      .catch(() => {});
  }, []);

  const selectedMeta = MODELS.find((m) => m.id === model) ?? MODELS[0];

  function formatPatientContext(info: PatientInfo): string {
    const parts: string[] = [];
    if (info.name) parts.push(`Name: ${info.name}`);
    if (info.age) parts.push(`Age: ${info.age}`);
    if (info.gender) parts.push(`Gender: ${info.gender}`);
    if (info.phone) parts.push(`Phone: ${info.phone}`);
    if (info.address) parts.push(`Address: ${info.address}`);
    return parts.join(" | ");
  }

  const getCacheKey = (file: File) => `${file.name}-${file.size}-${file.lastModified}`;

  async function compressImageForOcr(file: File): Promise<File> {
    if (!file.type.startsWith("image/") || file.type === "image/gif") {
      return file;
    }
    return new Promise<File>((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new window.Image();
        img.onload = () => {
          const MAX_DIM = 2000;
          let width = img.width;
          let height = img.height;
          if (width > MAX_DIM || height > MAX_DIM) {
            if (width > height) {
              height = Math.round((height * MAX_DIM) / width);
              width = MAX_DIM;
            } else {
              width = Math.round((width * MAX_DIM) / height);
              height = MAX_DIM;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(file);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                resolve(file);
                return;
              }
              const extension = file.name.split(".").pop();
              const hasValidExtension = extension && ["jpg", "jpeg", "png", "webp", "tiff", "bmp"].includes(extension.toLowerCase());
              const newName = hasValidExtension 
                ? file.name.replace(/\.[^/.]+$/, "") + ".jpg"
                : file.name + ".jpg";
              const compressedFile = new File([blob], newName, {
                type: "image/jpeg",
                lastModified: Date.now(),
              });
              resolve(compressedFile);
            },
            "image/jpeg",
            0.85
          );
        };
        img.onerror = () => resolve(file);
        img.src = e.target?.result as string;
      };
      reader.onerror = () => resolve(file);
      reader.readAsDataURL(file);
    });
  }

  async function runLabExtraction(files: File[]) {
    if (files.length === 0) {
      setLabFiles([]);
      setLabText("");
      setLabCriticals([]);
      setLabError(null);
      return;
    }

    setLabError(null);
    setLabUploading(true);

    let processedFiles: File[];
    try {
      processedFiles = await Promise.all(files.map((f) => compressImageForOcr(f)));
    } catch (err) {
      console.error("Client-side image compression failed, using original files:", err);
      processedFiles = files;
    }

    setLabFiles(processedFiles); // Instantly display the files in the UI list before extraction begins!

    // Identify which files need to be processed
    const newFiles = processedFiles.filter((file) => !extractionCache.has(getCacheKey(file)));
    let activeCache = extractionCache;

    if (newFiles.length > 0) {
      try {
        const newExtractions = await Promise.all(
          newFiles.map(async (file) => {
            const fd = new FormData();
            fd.append("files", file);
            const res = await fetch("/api/lab-extract", { method: "POST", body: fd });
            const data = await res.json() as {
              text?: string;
              panel?: { structuredText: string; criticals: LabCritical[] };
              error?: string;
            };
            if (!res.ok || data.error) {
              throw new Error(data.error ?? `Extraction failed for ${file.name}`);
            }
            return {
              file,
              text: data.panel?.structuredText ?? data.text ?? "",
              criticals: data.panel?.criticals ?? [],
            };
          })
        );

        // Store results in client-side cache
        const nextCache = new Map(extractionCache);
        newExtractions.forEach(({ file, text, criticals }) => {
          nextCache.set(getCacheKey(file), { text, criticals });
        });
        setExtractionCache(nextCache);
        activeCache = nextCache;
      } catch (err) {
        setLabError((err as Error).message ?? "Upload failed — check file format.");
        setLabUploading(false);
        // Revert UI to show only the files that were successfully cached/extracted
        const validFiles = processedFiles.filter((f) => extractionCache.has(getCacheKey(f)));
        setLabFiles(validFiles);
        return;
      }
    }

    // Combine extraction results from cache for all current files
    const combinedTexts: string[] = [];
    const combinedCriticals: LabCritical[] = [];

    processedFiles.forEach((file) => {
      const cached = activeCache.get(getCacheKey(file));
      if (cached) {
        combinedTexts.push(cached.text);
        combinedCriticals.push(...cached.criticals);
      }
    });

    setLabFiles(processedFiles);
    setLabText(combinedTexts.join("\n\n"));
    setLabCriticals(combinedCriticals);
    setLabUploading(false);
  }

  async function handleLabFile(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(e.target.files ?? []);
    if (selectedFiles.length === 0) return;
    const combinedFiles = [...labFiles, ...selectedFiles];
    await runLabExtraction(combinedFiles);
  }

  async function removeLabFile(idxToRemove: number) {
    const updatedFiles = labFiles.filter((_, i) => i !== idxToRemove);
    await runLabExtraction(updatedFiles);
  }

  function handlePrint() {
    if (!result || !jsPdfClass) return;
    setGeneratingPdf(true);
    try {
      const blob = generateClinicalPDF(result.answer, question, jsPdfClass, logoDataUrl);
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank");
      if (win) {
        win.focus();
      } else {
        const a = document.createElement("a");
        a.href = url; a.download = "mediq-clinical-report.pdf";
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
      }
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) {
      console.error("PDF generation failed:", err);
    } finally {
      setGeneratingPdf(false);
    }
  }

  async function handleShare() {
    if (!result || !jsPdfClass) return;
    setSharingPdf(true);
    try {
      const blob = generateClinicalPDF(result.answer, question, jsPdfClass, logoDataUrl);
      const file = new File([blob], "mediq-clinical-report.pdf", { type: "application/pdf" });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: "MEDIQ Clinical Assessment Report", text: "Clinical Assessment Report — MEDIQ AI", files: [file] });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = "mediq-clinical-report.pdf";
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") console.error("Share failed:", err);
    } finally {
      setSharingPdf(false);
    }
  }

  const [stopped, setStopped] = useState(false);

  async function runSwarm() {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStopped(false);
    setLoading(true);
    setResult(null);
    setMultiResult(null);

    // ── Multi-provider path ──────────────────────────────────────────────────
    if (mode === "multi") {
      setLiveStatus("Running multi-provider clinical swarm…");
      setRoutingPhase(true);
      try {
        const ctx = [formatPatientContext(patientInfo), labText].filter(Boolean).join("\n\n");
        const res = await fetch("/api/clinical-swarm/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: question, context: ctx || undefined }),
          signal: ctrl.signal,
        });
        const data = (await res.json()) as { synthesis?: string; agents?: Array<{ role: string; model: string; providerId: string; content: string }>; swarmSize?: number; error?: string };
        if (data.error) { setStatus(data.error); }
        else {
          setMultiResult({ synthesis: data.synthesis ?? "", agents: data.agents ?? [], swarmSize: data.swarmSize ?? 0 });
          if (saveCase) {
            await fetch("/api/cases", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: caseFields.title || question.slice(0, 80), question, answer: data.synthesis ?? "" }),
            });
            setStatus("Saved as case profile");
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") setStatus((err as Error).message);
        else { setStopped(true); setStatus(null); }
      }
      finally { setLoading(false); setLiveStatus(null); setRoutingPhase(false); abortRef.current = null; }
      return;
    }
    // ── NVIDIA swarm path ────────────────────────────────────────────────────

    setLiveRound1([]);
    setLiveRound2([]);
    setLiveStatus(null);
    setRoutingPhase(true);
    setDebatePhase(false);
    setSynthesisPhase(false);
    setSynthesisStream("");
    setStatus(null);
    setFeedbackGiven(false);
    setFeedbackSessionId(null);

    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question, model, mode: swarmMode,
          patientContext: formatPatientContext(patientInfo) || undefined,
          labText: labText || undefined,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Query failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const r1: AgentReply[] = [];
      const r2: AgentReply[] = [];
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          try {
            const payload = JSON.parse(part.slice(6)) as Record<string, unknown>;

            if (payload.type === "status") {
              setLiveStatus(payload.message as string);
              setRoutingPhase(true);
            } else if (payload.type === "swarm_config") {
              setSwarmSize(payload.swarmSize as number);
            } else if (payload.type === "agent") {
              const agent: AgentReply = {
                model: payload.model as string,
                message: payload.message as string,
                reasoning: payload.reasoning as string,
                round: (payload.round as 1 | 2) ?? 1,
              };
              setRoutingPhase(false);
              if (agent.round === 2) {
                setDebatePhase(false);
                r2.push(agent);
                setLiveRound2([...r2]);
              } else {
                r1.push(agent);
                setLiveRound1([...r1]);
              }
            } else if (payload.type === "debate_start") {
              setDebatePhase(true);
              setLiveStatus(payload.message as string ?? "Agents reviewing each other's reasoning…");
            } else if (payload.type === "synthesis_start") {
              setSynthesisPhase(true);
              setDebatePhase(false);
              setLiveStatus(payload.message as string ?? "Synthesizing final report…");
            } else if (payload.type === "synthesis_token") {
              setSynthesisStream((prev) => prev + (payload.token as string));
            } else if (payload.type === "done") {
              const p = payload as {
                answer: string; agents: AgentReply[];
                round1Agents: AgentReply[]; matches: Match[]; sessionId: number | null;
                hospitalDepartments?: string[];
                pgSubjects?: string[];
                ddiFlags?: DDIFlag[];
              };
              setResult({
                answer: p.answer, agents: p.agents,
                round1Agents: p.round1Agents ?? [], matches: p.matches, sessionId: p.sessionId ?? null,
                hospitalDepartments: p.hospitalDepartments ?? [],
                pgSubjects: p.pgSubjects ?? [],
                ddiFlags: p.ddiFlags ?? [],
              });
              setFeedbackSessionId(p.sessionId ?? null);
              if (saveCase) {
                await fetch("/api/cases", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    title: caseFields.title || question.slice(0, 80), question,
                    answer: p.answer,
                    patientName: caseFields.patientName ?? undefined,
                    patientAge: caseFields.patientAge ?? undefined,
                    patientDetails: caseFields.patientDetails ?? undefined,
                    clinicianNotes: caseFields.clinicianNotes ?? undefined,
                  }),
                });
                setStatus("Saved as case profile");
              }
            } else if (payload.type === "error") {
              throw new Error(payload.message as string);
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setStatus((err as Error).message);
      else { setStopped(true); setStatus(null); }
    } finally {
      setLoading(false);
      setLiveStatus(null);
      setRoutingPhase(false);
      setDebatePhase(false);
      setSynthesisPhase(false);
      abortRef.current = null;
    }
  }

  async function ask(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await runSwarm();
  }

  async function submitFeedback(rating: number, helpful: boolean, issueType?: string) {
    if (!feedbackSessionId || feedbackGiven) return;
    setFeedbackSending(true);
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: feedbackSessionId, rating, helpful, issueType }),
      });
      setFeedbackGiven(true);
    } finally { setFeedbackSending(false); }
  }

  const topCitation = useMemo(() => result?.matches?.[0], [result]);
  const hasDebate = (result?.round1Agents?.length ?? 0) > 0 && (result?.agents?.some((a) => a.round === 2) ?? false);
  const totalLive = liveRound1.length + liveRound2.length;
  const totalExpected = swarmSize * (swarmMode === "debate" && swarmSize > 1 ? 2 : 1);

  // Phase label
  const phaseLabel = synthesisPhase
    ? "Synthesizing report"
    : debatePhase
    ? "Peer debate"
    : routingPhase
    ? "Routing"
    : liveRound2.length > 0
    ? "Round 2 — refining"
    : "Round 1 — analysing";

  const phaseColor = synthesisPhase ? "#4ade80" : debatePhase ? "#f472b6" : "var(--accent)";

  return (
    <div className="space-y-4">
      {/* ── Form ── */}
      <form onSubmit={ask} className="space-y-3">
        <label className="block text-sm" style={{ color: "var(--text)" }}>
          Question
          <textarea value={question} onChange={(e) => setQuestion(e.target.value)} required={!labText && labFiles.length === 0} rows={4}
            className="mt-1 w-full rounded-xl border px-4 py-3 text-base focus:outline-none resize-none leading-relaxed"
            style={{ borderColor: "var(--card-border)", backgroundColor: "var(--bg)", color: "var(--text)" }}
            placeholder="Describe the clinical scenario or upload medical reports / images below..." />
        </label>

        {/* ── Patient Details ── */}
        <div className="rounded-xl border" style={{ borderColor: "var(--card-border)" }}>
          <button type="button" onClick={() => setShowPatientInfo((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-sm"
            style={{ color: "var(--text)" }}>
            <span className="font-medium">Patient details <span className="text-xs font-normal" style={{ color: "var(--muted)" }}>(optional — improves dosing & contraindication accuracy)</span></span>
            <span style={{ color: "var(--accent)" }}>{showPatientInfo ? "▲" : "▼"}</span>
          </button>
          {showPatientInfo && (
            <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2">
              {(["name", "age", "phone"] as const).map((field) => (
                <label key={field} className="text-sm" style={{ color: "var(--text)" }}>
                  {field === "name" ? "Full name" : field === "age" ? "Age" : "Phone"}
                  <input
                    type={field === "age" ? "number" : "text"}
                    min={field === "age" ? 0 : undefined}
                    max={field === "age" ? 140 : undefined}
                    placeholder={field === "age" ? "e.g. 45" : field === "phone" ? "e.g. +91 98765 43210" : "e.g. Ravi Kumar"}
                    value={patientInfo[field]}
                    onChange={(e) => setPatientInfo((p) => ({ ...p, [field]: e.target.value }))}
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:outline-none"
                    style={{ borderColor: "var(--card-border)", backgroundColor: "var(--bg)", color: "var(--text)" }} />
                </label>
              ))}
              <label className="text-sm" style={{ color: "var(--text)" }}>
                Gender
                <select value={patientInfo.gender}
                  onChange={(e) => setPatientInfo((p) => ({ ...p, gender: e.target.value }))}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: "var(--card-border)", backgroundColor: "var(--bg)", color: "var(--text)" }}>
                  <option value="">Prefer not to say</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </label>
              <label className="text-sm sm:col-span-2" style={{ color: "var(--text)" }}>
                Address
                <input placeholder="e.g. Mumbai, Maharashtra" value={patientInfo.address}
                  onChange={(e) => setPatientInfo((p) => ({ ...p, address: e.target.value }))}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: "var(--card-border)", backgroundColor: "var(--bg)", color: "var(--text)" }} />
              </label>
            </div>
          )}
        </div>

        {/* ── Lab Report Upload ── */}
        <div className="rounded-xl border px-4 py-3 space-y-2.5" style={{ borderColor: "var(--card-border)" }}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium" style={{ color: "var(--text)" }}>
              Clinical reports / Images <span className="text-xs font-normal" style={{ color: "var(--muted)" }}>(optional — PDF, Image, .txt)</span>
            </span>
            {labFiles.length > 0 && (
              <button type="button" onClick={() => { setLabFiles([]); setLabText(""); setLabCriticals([]); setLabError(null); }}
                className="text-xs px-2 py-0.5 rounded-full hover:brightness-110 active:scale-95 transition"
                style={{ backgroundColor: "rgba(239,68,68,0.15)", color: "#f87171" }}>
                Remove All ({labFiles.length})
              </button>
            )}
          </div>

          {labFiles.length > 0 && (
            <div className="rounded-xl border px-3 py-2.5 text-xs space-y-2"
              style={{ borderColor: "var(--card-border)", backgroundColor: "var(--card)" }}>
              <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
                {labFiles.map((file, idx) => {
                  const hasText = !!extractionCache.get(getCacheKey(file))?.text;
                  const isExpanded = expandedFileIdx === idx;
                  return (
                    <div key={idx} className="border-b pb-2 last:border-0 last:pb-0 py-1.5" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 truncate pr-2 cursor-pointer" onClick={() => setExpandedFileIdx(isExpanded ? null : idx)}>
                          <span style={{ color: "var(--accent)" }}>
                            {file.type.startsWith("image/") ? "🖼️" : file.type === "application/pdf" ? "📕" : "📄"}
                          </span>
                          <span className="font-medium truncate hover:underline" style={{ color: "var(--text)" }}>{file.name}</span>
                          {hasText && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 font-bold uppercase tracking-wider scale-90">
                              Analyzed
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px]" style={{ color: "var(--muted)" }}>({(file.size / 1024).toFixed(1)} KB)</span>
                          {hasText && (
                            <button type="button" onClick={() => setExpandedFileIdx(isExpanded ? null : idx)}
                              className="text-[10px] px-1.5 py-0.5 rounded hover:bg-zinc-800 transition"
                              style={{ color: "var(--accent)" }}>
                              {isExpanded ? "Hide" : "Review Findings"}
                            </button>
                          )}
                          <button type="button" onClick={() => void removeLabFile(idx)}
                            className="text-[11px] px-1 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors active:scale-95"
                            style={{ color: "var(--muted)" }}
                            title="Remove file">
                            ✕
                          </button>
                        </div>
                      </div>
                      {isExpanded && hasText && (
                        <div className="mt-2 rounded-lg p-3 text-xs leading-relaxed overflow-x-auto border font-sans whitespace-pre-wrap"
                          style={{ backgroundColor: "var(--bg)", borderColor: "var(--card-border)", color: "var(--text)" }}>
                          <div className="text-[10px] uppercase font-bold tracking-wider mb-1.5" style={{ color: "var(--accent)" }}>
                            AI Visual / Document Extraction Findings
                          </div>
                          {extractionCache.get(getCacheKey(file))?.text}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between border-t pt-1.5 text-[11px]" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                {labUploading ? (
                  (() => {
                    const isImg = (f: File) => f.type.startsWith("image/") || /\.(jpg|jpeg|png|webp|heic|heif|bmp|tiff|gif)$/i.test(f.name);
                    const imageCount = labFiles.filter(isImg).length;
                    const textCount = labFiles.filter(f => !isImg(f)).length;
                    let statusText = "Processing files…";
                    if (imageCount > 0 && textCount === 0) {
                      statusText = imageCount === 1 ? "Analysing your scan…" : "Analysing your scans…";
                    } else if (imageCount > 0 && textCount > 0) {
                      statusText = imageCount === 1 
                        ? "Analysing your scan and extracting the text…" 
                        : "Analysing your scans and extracting the text…";
                    } else if (imageCount === 0 && textCount > 0) {
                      statusText = "Extracting the text…";
                    }
                    return (
                      <span className="text-xs sm:text-sm font-medium" style={{ color: "var(--muted)" }}>
                        {statusText}
                      </span>
                    );
                  })()
                ) : (
                  <>
                    {labText && <span style={{ color: "#4ade80" }}>✓ {labText.length.toLocaleString()} total chars extracted</span>}
                    <button type="button" onClick={() => { setLabFiles([]); setLabText(""); setLabCriticals([]); setLabError(null); setExpandedFileIdx(null); }}
                      className="text-[10px] hover:underline" style={{ color: "#f87171" }}>
                      Clear
                    </button>
                  </>
                )}
              </div>
              {labUploading && (
                <div className="space-y-1.5 pt-1.5">
                  <div className="relative h-2 w-full overflow-hidden rounded-full bg-zinc-950/60 border border-zinc-800/60 shadow-[inner_0_1px_2px_rgba(0,0,0,0.4)]">
                    <div className="absolute inset-y-0 rounded-full"
                      style={{
                        width: "40%",
                        background: "linear-gradient(90deg, #818cf8, #f472b6)",
                        boxShadow: "0 0 10px rgba(129,140,248,0.5), inset 0 1px 1px rgba(255,255,255,0.15)",
                        animation: "pulse-progress 1.8s ease-in-out infinite"
                      }} />
                  </div>
                  <style>{`
                    @keyframes pulse-progress {
                      0% { width: 10%; left: -10%; }
                      50% { width: 40%; left: 30%; }
                      100% { width: 10%; left: 100%; }
                    }
                  `}</style>
                </div>
              )}
              {labError && <p style={{ color: "#f87171" }}>{labError}</p>}
              {labText && !labUploading && (
                <p className="mt-1 leading-relaxed line-clamp-2" style={{ color: "var(--muted)" }}>
                  {labText.slice(0, 180)}…
                </p>
              )}
            </div>
          )}

          <label className="flex cursor-pointer items-center justify-center gap-2.5 rounded-xl border border-dashed px-4 py-3 transition hover:border-indigo-400 hover:bg-indigo-500/5"
            style={{ borderColor: "var(--card-border)", backgroundColor: "var(--bg)" }}>
            <span className="text-xs font-semibold" style={{ color: "var(--accent)" }}>
              {labFiles.length > 0 ? "➕ Add more files" : "📤 Upload files / images"}
            </span>
            <span className="text-[11px]" style={{ color: "var(--muted)" }}>
              {labFiles.length > 0 ? "Select more medical reports, images, or docs to append" : "Upload PDFs, Images (PNG, JPG, HEIC, TIFF, BMP), Word Docs (.docx, .doc), DICOMs (.dcm), ZIPs (.zip), or Text reports…"}
            </span>
            <input type="file" multiple accept=".pdf,.txt,.csv,.png,.jpg,.jpeg,.webp,.heic,.heif,.tiff,.bmp,.doc,.docx,.md,.zip,.dcm" className="hidden" onChange={handleLabFile} />
          </label>
        </div>

        {/* Item 4: Critical lab value banner */}
        {labCriticals.length > 0 && (
          <div className="rounded-xl border px-4 py-3 space-y-2"
            style={{ borderColor: "rgba(239,68,68,0.5)", background: "rgba(239,68,68,0.08)" }}>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "#f87171" }}>
                CRITICAL LAB VALUES DETECTED
              </span>
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{ backgroundColor: "rgba(239,68,68,0.2)", color: "#f87171" }}>
                {labCriticals.length} value{labCriticals.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {labCriticals.map((c, i) => (
                <span key={i} className="rounded-lg px-2 py-1 text-xs font-semibold"
                  style={{ backgroundColor: "rgba(239,68,68,0.15)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.3)" }}>
                  {c.name.toUpperCase()} = {c.value} {c.unit}
                </span>
              ))}
            </div>
            <p className="text-[11px]" style={{ color: "#fca5a5" }}>
              These values have been highlighted for the clinical swarm. Verify urgently.
            </p>
          </div>
        )}

        {hasProviders && (
          <div className="flex items-center gap-2 rounded-xl border px-3 py-2"
            style={{ borderColor: "var(--card-border)", backgroundColor: "var(--card)" }}>
            <span className="text-xs shrink-0" style={{ color: "var(--muted)" }}>Swarm source:</span>
            {(["nvidia", "multi"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)}
                className="rounded-full px-3 py-1.5 text-xs font-semibold transition"
                style={{
                  backgroundColor: mode === m ? "var(--accent)" : "var(--pill)",
                  color: mode === m ? "#0f172a" : "var(--muted)",
                }}>
                {m === "nvidia" ? "NVIDIA NIM (free)" : "My Providers"}
              </button>
            ))}
            {mode === "nvidia" && (
              <span className="text-[10px] ml-1" style={{ color: "var(--accent)" }}>
                ✨ Auto: your provider key will be used if configured
              </span>
            )}
            {mode === "multi" && (
              <span className="text-[10px] ml-1" style={{ color: "var(--muted)" }}>
                Uses your configured provider keys + active swarm config
              </span>
            )}
          </div>
        )}

        <p className="text-xs text-amber-400">For clinician use only. Always verify with current guidelines.</p>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm" style={{ color: "var(--text)" }}>Primary agent</span>
            <button type="button" onClick={() => setShowModelPicker((v) => !v)}
              className="rounded-full px-3 py-1 text-xs font-medium transition"
              style={{ backgroundColor: "var(--pill)", color: "var(--accent)", border: "1px solid var(--pill-border)" }}>
              {showModelPicker ? "Hide models" : "Change model"}
            </button>
          </div>
          <div className="rounded-xl border px-3 py-2.5"
            style={{ borderColor: "var(--accent)", backgroundColor: "color-mix(in srgb, var(--accent) 8%, var(--card))" }}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>{selectedMeta.label}</span>
              <span className="text-xs" style={{ color: "var(--accent)" }}>{selectedMeta.role}</span>
            </div>
            <p className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>{selectedMeta.description.slice(0, 90)}...</p>
          </div>
          {showModelPicker && (
            <div className="mt-2 space-y-2">
              <p className="text-xs uppercase tracking-wider" style={{ color: "var(--muted)" }}>All free NVIDIA NIM agents</p>
              {MODELS.map((m) => (
                <ModelCard key={m.id} meta={m} selected={model === m.id}
                  onClick={() => { setModel(m.id); setShowModelPicker(false); }} />
              ))}
            </div>
          )}
        </div>



        <div className="flex flex-col items-center gap-1.5">
          <div className="inline-flex rounded-full border p-1"
            style={{ borderColor: "var(--card-border)", backgroundColor: "var(--card)" }}>
            {([
              { id: "research", label: "Research", hint: "faster" },
              { id: "debate", label: "Research + Debate", hint: "deeper · default" },
            ] as const).map((m) => (
              <button key={m.id} type="button" onClick={() => setSwarmMode(m.id)}
                aria-pressed={swarmMode === m.id}
                className="rounded-full px-4 py-1.5 text-xs font-semibold transition"
                style={{
                  backgroundColor: swarmMode === m.id ? "var(--accent)" : "transparent",
                  color: swarmMode === m.id ? "#0f172a" : "var(--muted)",
                }}>
                {m.label}
                <span className="ml-1 font-normal opacity-70">({m.hint})</span>
              </button>
            ))}
          </div>
          <p className="text-[10px]" style={{ color: "var(--muted)" }}>
            {swarmMode === "research"
              ? "Round 1 analysis → synthesis. Skips peer debate for a faster report."
              : "Round 1 → peer debate → synthesis. Deeper, multi-agent cross-review."}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-4">
          <button type="submit" disabled={loading}
            className="rounded-2xl px-6 py-3 text-sm font-semibold shadow-lg transition disabled:opacity-60"
            style={{ background: "linear-gradient(90deg, #818cf8, #f472b6)", color: "#0f172a", boxShadow: "0 10px 30px rgba(99,102,241,0.25)" }}>
            {loading ? (swarmMode === "debate" ? "Debating…" : "Researching…") : "Ask the swarm"}
          </button>
          {(loading || stopped) && (
            <button type="button"
              onClick={loading ? stop : () => void runSwarm()}
              className="rounded-2xl px-6 py-3 text-sm font-semibold transition"
              style={loading
                ? { backgroundColor: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.35)" }
                : { backgroundColor: "rgba(129,140,248,0.12)", color: "#818cf8", border: "1px solid rgba(129,140,248,0.35)" }
              }>
              {loading ? "Stop" : "Resume"}
            </button>
          )}
          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text)" }}>
            <input type="checkbox" checked={saveCase} onChange={(e) => setSaveCase(e.target.checked)} />
            Save as case profile
          </label>
        </div>
      </form>

      {status && <p className="text-sm" style={{ color: "var(--accent)" }}>{status}</p>}

      {saveCase && (
        <div className="space-y-3 rounded-2xl border p-4" style={{ borderColor: "var(--card-border)", backgroundColor: "var(--card)" }}>
          <p className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>Case metadata (optional)</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["title", "patientName"] as const).map((key) => (
              <label key={key} className="text-sm" style={{ color: "var(--text)" }}>
                {key === "title" ? "Case title" : "Patient name"}
                <input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: "var(--card-border)", backgroundColor: "var(--bg)", color: "var(--text)" }}
                  value={(caseFields[key] as string) ?? ""}
                  onChange={(e) => setCaseFields((p) => ({ ...p, [key]: e.target.value }))} />
              </label>
            ))}
            <label className="text-sm" style={{ color: "var(--text)" }}>
              Patient age
              <input type="number" min={0} max={140} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: "var(--card-border)", backgroundColor: "var(--bg)", color: "var(--text)" }}
                value={caseFields.patientAge ?? ""}
                onChange={(e) => setCaseFields((p) => ({ ...p, patientAge: e.target.value ? Number(e.target.value) : undefined }))} />
            </label>
            <label className="text-sm" style={{ color: "var(--text)" }}>
              Patient details
              <input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: "var(--card-border)", backgroundColor: "var(--bg)", color: "var(--text)" }}
                value={caseFields.patientDetails ?? ""}
                onChange={(e) => setCaseFields((p) => ({ ...p, patientDetails: e.target.value }))} />
            </label>
          </div>
          <label className="text-sm" style={{ color: "var(--text)" }}>
            Clinician notes
            <textarea rows={3} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: "var(--card-border)", backgroundColor: "var(--bg)", color: "var(--text)" }}
              value={caseFields.clinicianNotes ?? ""}
              onChange={(e) => setCaseFields((p) => ({ ...p, clinicianNotes: e.target.value }))} />
          </label>
        </div>
      )}

      {/* ── LIVE SWARM PANEL ── */}
      {loading && (
        <div className="rounded-2xl border p-4 space-y-4"
          style={{ borderColor: "var(--card-border)", backgroundColor: "var(--card)" }}>

          {/* Citation legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg px-3 py-1.5 text-left text-[10px]"
            style={{ backgroundColor: "var(--pill)", borderColor: "var(--card-border)", border: "1px solid var(--card-border)" }}>
            <span className="font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Citations:</span>
            <span style={{ color: "var(--muted)" }}><span style={{ color: "var(--accent)" }}>[S1], [S2]…</span> = evidence snippet from your knowledge base (PDF / URL / notes)</span>
            <span style={{ color: "var(--muted)" }}><span style={{ color: "var(--accent)" }}>[PC1], [PC2]…</span> = prior case from session history</span>
            <span style={{ color: "var(--muted)" }}><span style={{ color: "var(--accent)" }}>[S#]</span> number = order of relevance to your query</span>
          </div>

          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full animate-pulse" style={{ backgroundColor: phaseColor }} />
              <span className="text-xs font-semibold" style={{ color: phaseColor }}>{phaseLabel}</span>
            </div>
            <span className="text-[11px]" style={{ color: "var(--muted)" }}>
              {synthesisPhase ? "Generating report…" : `${totalLive} / ${totalExpected} responses`}
            </span>
          </div>

          {/* Swarm progress bar */}
          <div className="space-y-1.5">
            <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-zinc-950/70 border border-zinc-800/60 shadow-[inner_0_1px_3px_rgba(0,0,0,0.5)]">
              <div className="absolute inset-y-0 rounded-full transition-all duration-500 ease-out"
                style={{
                  width: `${synthesisPhase ? 95 : Math.max(10, Math.min(90, (totalLive / (totalExpected || 1)) * 100))}%`,
                  background: "linear-gradient(90deg, #818cf8, #3b82f6, #ec4899)",
                  boxShadow: "0 0 14px rgba(129,140,248,0.7), inset 0 1px 1px rgba(255,255,255,0.2)",
                }} />
            </div>
            <div className="flex justify-between text-[10px]" style={{ color: "var(--muted)" }}>
              <span>Swarm Analysis Progress</span>
              <span>{synthesisPhase ? "95%" : `${Math.round((totalLive / (totalExpected || 1)) * 100)}%`}</span>
            </div>
          </div>

          {/* Status text */}
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {liveStatus ?? "Initialising swarm…"}
            {(routingPhase || debatePhase || synthesisPhase) && <ThinkingDots />}
          </p>

          {/* Model nodes */}
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: swarmSize }, (_, idx) => {
              const r2 = liveRound2[idx]; const r1 = liveRound1[idx];
              const done = liveRound2.length > 0 ? !!r2 : !!r1;
              const meta = (r2 ?? r1) ? MODELS.find((m) => m.id === (r2 ?? r1)!.model) : null;
              const color = MODEL_COLORS[idx % MODEL_COLORS.length];
              return (
                <div key={idx} className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all duration-500"
                  style={{
                    borderColor: done ? color.border : "var(--card-border)",
                    backgroundColor: done ? color.bg : "transparent",
                    color: done ? color.dot : "var(--muted)",
                    opacity: done ? 1 : 0.45,
                    boxShadow: done ? `0 0 8px ${color.glow}` : undefined,
                  }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: done ? color.dot : "var(--muted)" }} />
                  {meta?.label ?? `Agent ${idx + 1}`}
                  {done && " ✓"}
                </div>
              );
            })}
          </div>

          {/* Round 1 */}
          {liveRound1.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold mb-2"
                style={{ color: liveRound2.length > 0 || debatePhase || synthesisPhase ? "var(--muted)" : "var(--accent)" }}>
                Round 1 — Independent Analysis
              </p>
              <DebateGrid
                agents={liveRound1}
                swarmSize={swarmSize}
                phase="r1"
                isLive
                liveRound2Length={liveRound2.length}
                debatePhase={debatePhase}
                synthesisPhase={synthesisPhase}
              />
            </div>
          )}

          {/* Debate transition */}
          {swarmMode === "debate" && (debatePhase || liveRound2.length > 0 || synthesisPhase) && swarmSize > 1 && (
            <div className="rounded-xl border px-4 py-3"
              style={{ borderColor: "rgba(244,114,182,0.35)", background: "linear-gradient(135deg,rgba(244,114,182,0.06),rgba(129,140,248,0.06))" }}>
              <div className="flex items-center gap-3 mb-1">
                <div className="flex-1 h-px" style={{ backgroundColor: "rgba(244,114,182,0.3)" }} />
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#f472b6" }}>Peer Debate</span>
                <div className="flex-1 h-px" style={{ backgroundColor: "rgba(129,140,248,0.3)" }} />
              </div>
              <p className="text-[11px] text-center" style={{ color: "var(--muted)" }}>
                {debatePhase ? <>Agents reviewing each other<ThinkingDots /></>
                  : "Agents incorporated peer feedback — responses refined"}
              </p>
            </div>
          )}

          {/* Round 2 */}
          {liveRound2.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold mb-2" style={{ color: "#f472b6" }}>
                Round 2 — Peer-Reviewed Refinement
              </p>
              <DebateGrid
                agents={liveRound2}
                swarmSize={swarmSize}
                phase="r2"
                isLive
              />
            </div>
          )}

          {/* Synthesis transition — Item 2: stream tokens live */}
          {synthesisPhase && (
            <div className="rounded-xl border px-4 py-3 space-y-2"
              style={{ borderColor: "rgba(74,222,128,0.35)", background: "linear-gradient(135deg,rgba(74,222,128,0.06),rgba(6,182,212,0.06))" }}>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px" style={{ backgroundColor: "rgba(74,222,128,0.3)" }} />
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#4ade80" }}>Synthesizing Report</span>
                <div className="flex-1 h-px" style={{ backgroundColor: "rgba(6,182,212,0.3)" }} />
              </div>
              {synthesisStream ? (
                <p className="text-xs leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto" style={{ color: "var(--muted)" }}>
                  {synthesisStream}
                  <span className="inline-block w-0.5 h-3 ml-0.5 align-middle animate-pulse" style={{ backgroundColor: "#4ade80" }} />
                </p>
              ) : (
                <p className="text-[11px] text-center" style={{ color: "var(--muted)" }}>
                  Primary model generating structured clinical report from full debate<ThinkingDots />
                </p>
              )}
            </div>
          )}

          {/* Progress */}
          <div className="h-1 w-full rounded-full overflow-hidden" style={{ backgroundColor: "var(--pill)" }}>
            <div className="h-full rounded-full transition-all duration-700"
              style={{
                width: synthesisPhase ? "90%" : `${(totalLive / (totalExpected || 1)) * 80}%`,
                background: "linear-gradient(90deg, #818cf8, #f472b6, #4ade80)",
              }} />
          </div>
        </div>
      )}

      {/* ── MULTI-PROVIDER RESULT ── */}
      {multiResult && !loading && (() => {
        const ROLE_COLORS: Record<string, string> = {
          "Case Summarizer": "#38bdf8", "Differential Diagnosis": "#818cf8",
          "Red Flag / Safety": "#f87171", "Evidence Reasoner": "#4ade80",
          "Specialist Clinician": "#fbbf24", "Skeptical Debate": "#f472b6",
          "Final Synthesis": "#a78bfa",
        };
        const PROV_COLORS: Record<string, string> = {
          openrouter: "#f97316", nvidia: "#76b900", openai: "#10a37f", anthropic: "#d97706",
          gemini: "#4285f4", mistral: "#ff6d00", groq: "#f472b6", together: "#818cf8",
          fireworks: "#f43f5e", cerebras: "#a855f7", deepseek: "#06b6d4", custom: "#94a3b8",
        };
        return (
          <div className="space-y-4 rounded-2xl border p-4"
            style={{ borderColor: "var(--card-border)", backgroundColor: "var(--card)" }}>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px" style={{ backgroundColor: "var(--card-border)" }} />
              <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color: "#a78bfa" }}>
                Multi-Provider Clinical Synthesis — {multiResult.swarmSize} agents
              </span>
              <div className="flex-1 h-px" style={{ backgroundColor: "var(--card-border)" }} />
            </div>
            <ConsensusReport text={multiResult.synthesis} isMultiProvider />
            {multiResult.agents.length > 0 && (
              <details>
                <summary className="cursor-pointer text-xs uppercase tracking-wide list-none flex items-center gap-2"
                  style={{ color: "var(--muted)" }}>
                  <span>Individual agent assessments ({multiResult.agents.length}) ▼</span>
                </summary>
                <div className="mt-2 space-y-1.5">
                  {multiResult.agents.map((agent, i) => {
                    const color = ROLE_COLORS[agent.role] ?? "#94a3b8";
                    const pColor = PROV_COLORS[agent.providerId] ?? "#94a3b8";
                    return (
                      <details key={i} className="rounded-xl border overflow-hidden" style={{ borderColor: `${color}33` }}>
                        <summary className="flex cursor-pointer items-center justify-between px-3 py-2 list-none"
                          style={{ backgroundColor: `${color}08` }}>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold" style={{ color }}>{agent.role}</span>
                            <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase"
                              style={{ backgroundColor: `${pColor}20`, color: pColor }}>{agent.providerId}</span>
                            <span className="text-[10px] font-mono truncate max-w-[160px]" style={{ color: "var(--muted)" }}>{agent.model}</span>
                          </div>
                          <span className="text-[10px] shrink-0" style={{ color: "var(--muted)" }}>▼</span>
                        </summary>
                        <div className="px-3 py-2 text-xs whitespace-pre-wrap border-t"
                          style={{ borderColor: `${color}22`, color: "var(--muted)" }}>{agent.content}</div>
                      </details>
                    );
                  })}
                </div>
              </details>
            )}
          </div>
        );
      })()}

      {/* ── FINAL RESULT ── */}
      {result && !loading && (
        <div className="space-y-5 rounded-2xl border p-4"
          style={{ borderColor: "var(--card-border)", backgroundColor: "var(--card)" }}>

          {/* Round 1 collapsible */}
          {hasDebate && (
            <details className="group">
              <summary className="flex cursor-pointer items-center justify-between list-none">
                <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: "var(--muted)" }}>
                  Round 1 — Initial Analysis ({result.round1Agents.length} agents)
                </p>
                <span className="text-[10px]" style={{ color: "var(--muted)" }}>
                  <span className="group-open:hidden">Show ▼</span>
                  <span className="hidden group-open:inline">Hide ▲</span>
                </span>
              </summary>
              <DebateGrid agents={result.round1Agents} phase="r1" compact />
            </details>
          )}

          {/* Debate divider */}
          {hasDebate && (
            <div className="rounded-xl border px-4 py-2.5"
              style={{ borderColor: "rgba(244,114,182,0.3)", background: "linear-gradient(135deg,rgba(244,114,182,0.05),rgba(129,140,248,0.05))" }}>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px" style={{ backgroundColor: "rgba(244,114,182,0.25)" }} />
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#f472b6" }}>Peer Debate Complete</span>
                <div className="flex-1 h-px" style={{ backgroundColor: "rgba(129,140,248,0.25)" }} />
              </div>
              <p className="mt-1 text-[11px] text-center" style={{ color: "var(--muted)" }}>
                Each agent reviewed peers&rsquo; reasoning and refined its assessment
              </p>
            </div>
          )}

          {/* Citation legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg px-3 py-1.5 text-left text-[10px]"
            style={{ backgroundColor: "var(--pill)", border: "1px solid var(--card-border)" }}>
            <span className="font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Citations:</span>
            <span style={{ color: "var(--muted)" }}><span style={{ color: "var(--accent)" }}>[S1], [S2]…</span> = knowledge base snippet (PDF / URL / notes), ranked by relevance</span>
            <span style={{ color: "var(--muted)" }}><span style={{ color: "var(--accent)" }}>[PC1], [PC2]…</span> = prior case from session history</span>
          </div>

          {/* Agent comparison grid */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] uppercase tracking-widest font-bold"
                style={{ color: hasDebate ? "#f472b6" : "var(--muted)" }}>
                {hasDebate ? "Round 2 — Peer-Reviewed Analysis" : "Agent Analysis"}
              </p>
              <span className="text-[10px] rounded-full px-2 py-0.5"
                style={{ backgroundColor: "var(--pill)", color: "var(--muted)" }}>
                {result.agents.length} model{result.agents.length !== 1 ? "s" : ""}
              </span>
            </div>
            <DebateGrid agents={result.agents} phase="r2" />
          </div>

          {/* Synthesis divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px" style={{ backgroundColor: "var(--card-border)" }} />
            <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color: "#4ade80" }}>
              Synthesized Report
            </span>
            <div className="flex-1 h-px" style={{ backgroundColor: "var(--card-border)" }} />
          </div>

          {/* Report panel */}
          <ConsensusReport
            text={result.answer}
            agentsCount={result.agents.length}
            hasDebate={hasDebate}
            generatingPdf={generatingPdf || !jsPdfClass}
            sharingPdf={sharingPdf || !jsPdfClass}
            handlePrint={handlePrint}
            handleShare={handleShare}
            hospitalDepartments={result.hospitalDepartments}
            pgSubjects={result.pgSubjects}
          />

          {/* Item 6: DDI banners */}
          {(result.ddiFlags?.length ?? 0) > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: "#fbbf24" }}>
                Drug Interaction Alerts ({result.ddiFlags!.length})
              </p>
              {result.ddiFlags!.map((flag, i) => {
                const isBlackBox = flag.severity === "BLACK_BOX";
                const color = isBlackBox ? "#f87171" : flag.severity === "SERIOUS" ? "#fb923c" : "#fbbf24";
                const bg = isBlackBox ? "rgba(239,68,68,0.08)" : flag.severity === "SERIOUS" ? "rgba(251,146,60,0.08)" : "rgba(251,191,36,0.08)";
                const border = isBlackBox ? "rgba(239,68,68,0.4)" : flag.severity === "SERIOUS" ? "rgba(251,146,60,0.4)" : "rgba(251,191,36,0.4)";
                return (
                  <div key={i} className="rounded-xl border px-3 py-2.5"
                    style={{ borderColor: border, backgroundColor: bg }}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold" style={{ color }}>{flag.drug.toUpperCase()}</span>
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                        style={{ backgroundColor: bg, color, border: `1px solid ${border}` }}>
                        {isBlackBox ? "BLACK BOX" : flag.severity}
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>{flag.warning}</p>
                  </div>
                );
              })}
            </div>
          )}

          {/* Feedback */}
          {feedbackSessionId && !feedbackGiven && (
            <div className="rounded-xl border px-4 py-3 flex flex-wrap items-center gap-3"
              style={{ borderColor: "var(--card-border)", backgroundColor: "var(--card)" }}>
              <span className="text-xs" style={{ color: "var(--muted)" }}>Was this helpful?</span>
              {[
                { label: "Yes", rating: 5, helpful: true, color: "#4ade80", bg: "rgba(74,222,128,0.15)" },
                { label: "Needs work", rating: 2, helpful: false, issue: "incomplete", color: "#f87171", bg: "rgba(239,68,68,0.15)" },
                { label: "Wrong diagnosis", rating: 1, helpful: false, issue: "wrong_diagnosis", color: "#f87171", bg: "rgba(239,68,68,0.15)", border: "rgba(239,68,68,0.3)" },
              ].map(({ label, rating, helpful, issue, color, bg, border }) => (
                <button key={label} disabled={feedbackSending}
                  onClick={() => void submitFeedback(rating, helpful, issue)}
                  className="rounded-xl px-3 py-1.5 text-sm font-medium transition disabled:opacity-50"
                  style={{ backgroundColor: bg, color, border: border ? `1px solid ${border}` : undefined }}>
                  {label}
                </button>
              ))}
            </div>
          )}
          {feedbackGiven && (
            <p className="text-xs text-center" style={{ color: "var(--muted)" }}>
              Feedback recorded — system will learn from this session.
            </p>
          )}

          {/* Citations */}
          <EvidenceSources matches={result.matches} />
        </div>
      )}
    </div>
  );
}
