"use client";

import React from "react";

function ReportTable({ lines }: { lines: string[] }) {
  const parseRow = (line: string) =>
    line.split("|").slice(1, -1).map((c) => c.trim());

  const isSeparator = (line: string) => /^\|[-|\s]+\|$/.test(line.trim());
  const nonSep = lines.filter((l) => !isSeparator(l));
  const sepIdx = lines.findIndex(isSeparator);

  const headerLines = sepIdx > 0 ? lines.slice(0, sepIdx) : [lines[0]];
  const dataLines = sepIdx >= 0 ? lines.slice(sepIdx + 1).filter((l) => !isSeparator(l)) : lines.slice(1);

  const headers = headerLines.flatMap(parseRow);
  const dataRows = dataLines.map(parseRow).filter((r) => r.some((c) => c));

  if (!nonSep.length) return null;

  return (
    <div className="overflow-x-auto rounded-xl border my-3" style={{ borderColor: "var(--card-border)" }}>
      <table className="w-full border-collapse">
        <thead>
          <tr style={{ backgroundColor: "rgba(13,148,136,0.08)" }}>
            {headers.map((h, i) => (
              <th key={i} className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider"
                style={{ color: "var(--accent)", borderBottom: "1px solid var(--card-border)" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataRows.map((row, ri) => (
            <tr key={ri} style={{ borderBottom: "1px solid var(--card-border)" }}>
              {row.map((cell, ci) => (
                <td key={ci} className="px-4 py-2.5 text-[13px] leading-relaxed"
                  style={{ color: ci === 0 ? "var(--text)" : "var(--muted)" }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ReportView({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  const isAllCapsHeader = (l: string) =>
    /^[A-Z][A-Z\s\d&\/\-–—:()]+$/.test(l.trim()) && l.trim().length >= 4 && l.trim().length <= 60;
  const isDashLine = (l: string) => /^[-─═]+$/.test(l.trim()) && l.trim().length >= 8;
  const isTableLine = (l: string) => l.trim().startsWith("|");
  const isNumbered = (l: string) => /^\d+\.\s{1,3}/.test(l.trim());
  const isBullet = (l: string) => /^[-•]\s{1,3}/.test(l.trim());

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") { i++; continue; }

    // Collect pipe table block
    if (isTableLine(line)) {
      const tableLines: string[] = [];
      while (i < lines.length && (isTableLine(lines[i]) || /^\|[-|\s]+\|$/.test(lines[i].trim()))) {
        tableLines.push(lines[i]);
        i++;
      }
      elements.push(<ReportTable key={key++} lines={tableLines} />);
      continue;
    }

    // Dash separator → skip (visual handled by header spacing)
    if (isDashLine(line)) { i++; continue; }

    // ALL CAPS section header
    if (isAllCapsHeader(line)) {
      elements.push(
        <div key={key++} className="mt-7 mb-3">
          <div className="flex items-center gap-3">
            <span className="text-base leading-none" style={{ color: "var(--accent)" }}>◆</span>
            <p className="text-[15px] font-bold uppercase tracking-wide" style={{ color: "var(--accent)" }}>
              {line.trim()}
            </p>
          </div>
          <div className="h-px mt-2" style={{ backgroundColor: "rgba(13,148,136,0.25)" }} />
        </div>
      );
      i++;
      continue;
    }

    // Numbered list
    if (isNumbered(line)) {
      elements.push(
        <p key={key++} className="text-[13px] leading-6 pl-5 my-1" style={{ color: "var(--text)" }}>
          {line.trim()}
        </p>
      );
      i++;
      continue;
    }

    // Bullet list
    if (isBullet(line)) {
      elements.push(
        <p key={key++} className="text-[13px] leading-6 pl-5 my-1 flex gap-3" style={{ color: "var(--muted)" }}>
          <span className="mt-0.5 shrink-0 text-sm" style={{ color: "var(--accent)" }}>–</span>
          <span>{line.trim().replace(/^[-•]\s{1,3}/, "")}</span>
        </p>
      );
      i++;
      continue;
    }

    // Regular line
    elements.push(
      <p key={key++} className="text-[13px] leading-6 my-1" style={{ color: "var(--text)" }}>
        {line}
      </p>
    );
    i++;
  }

  return <div className="space-y-1 text-left leading-relaxed">{elements}</div>;
}

interface ConsensusReportProps {
  text: string;
  agentsCount?: number;
  hasDebate?: boolean;
  generatingPdf?: boolean;
  sharingPdf?: boolean;
  handlePrint?: () => void;
  handleShare?: () => void;
  hospitalDepartments?: string[];
  pgSubjects?: string[];
  isMultiProvider?: boolean;
}

export function ConsensusReport({
  text,
  agentsCount = 0,
  hasDebate = false,
  generatingPdf = false,
  sharingPdf = false,
  handlePrint,
  handleShare,
  hospitalDepartments = [],
  pgSubjects = [],
  isMultiProvider = false,
}: ConsensusReportProps) {
  if (isMultiProvider) {
    return (
      <div className="rounded-xl border p-4"
        style={{ borderColor: "rgba(167,139,250,0.3)", background: "linear-gradient(135deg,rgba(167,139,250,0.04),var(--card))" }}>
        <ReportView text={text} />
      </div>
    );
  }

  return (
    <div className="rounded-xl border overflow-hidden"
      style={{
        borderColor: "rgba(74,222,128,0.3)",
        boxShadow: "0 0 24px rgba(74,222,128,0.08)",
      }}>
      {/* Accent top bar */}
      <div className="h-1 w-full" style={{ background: "linear-gradient(90deg, #4ade80, #0d9488, #4ade80)" }} />
      <div className="p-5 pb-4"
        style={{
          background: "linear-gradient(180deg, rgba(74,222,128,0.06), var(--card))",
          borderBottom: "1px solid rgba(74,222,128,0.15)",
        }}>
        {/* Report header */}
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <span className="inline-block h-3 w-3 rounded-full"
            style={{ backgroundColor: "#4ade80", boxShadow: "0 0 8px #4ade80" }} />
          <span className="text-sm font-bold uppercase tracking-wider" style={{ color: "#4ade80" }}>
            Clinical Assessment Report
          </span>
          <span className="text-[11px] rounded-full px-2.5 py-1 font-medium"
            style={{ backgroundColor: "var(--pill)", color: "var(--muted)" }}>
            {agentsCount} agent{agentsCount !== 1 ? "s" : ""} · {hasDebate ? "2 rounds + synthesis" : "1 round + synthesis"}
          </span>
          {(handlePrint || handleShare) && (
            <div className="ml-auto flex items-center gap-2">
              {handlePrint && (
                <button type="button" onClick={() => void handlePrint()} disabled={generatingPdf}
                  className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50"
                  style={{ backgroundColor: "rgba(13,148,136,0.12)", color: "#0d9488", border: "1px solid rgba(13,148,136,0.3)" }}>
                  {generatingPdf ? <span className="animate-pulse">Generating…</span> : <span>Print PDF</span>}
                </button>
              )}
              {handleShare && (
                <button type="button" onClick={() => void handleShare()} disabled={sharingPdf}
                  className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50"
                  style={{ backgroundColor: "rgba(26,52,96,0.12)", color: "#1a3460", border: "1px solid rgba(26,52,96,0.3)" }}>
                  {sharingPdf ? <span className="animate-pulse">Preparing…</span> : <span>Share PDF</span>}
                </button>
              )}
            </div>
          )}
        </div>
        {/* Safety disclaimer notice */}
        <div className="flex items-start gap-2 rounded-lg px-3 py-2"
          style={{ backgroundColor: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)" }}>
          <span className="text-amber-400 mt-0.5 shrink-0">⚠</span>
          <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
            <span className="font-semibold text-amber-400/80">AI-assisted assessment.</span> For review by a licensed clinician only. Not a final diagnosis — does not replace professional medical judgment.
          </p>
        </div>
      </div>
      {/* Report body */}
      <div className="px-5 py-4">
        <ReportView text={text} />
      </div>
      {/* Meta footer */}
      {(hospitalDepartments.length > 0 || pgSubjects.length > 0) && (
        <div className="px-5 pb-4">
          <div className="mt-0 pt-4 border-t flex flex-col gap-3 text-left"
            style={{ borderColor: "rgba(74,222,128,0.15)" }}>
            {hospitalDepartments.length > 0 && (
              <div className="flex items-center flex-wrap gap-2">
                <span className="text-[11px] uppercase tracking-wider font-bold" style={{ color: "var(--muted)" }}>Hospital Departments</span>
                {hospitalDepartments.map((dept, i) => (
                  <span key={i} className="text-[11px] rounded-full px-2.5 py-1 font-semibold"
                    style={{ backgroundColor: "rgba(59,130,246,0.12)", color: "#60a5fa", border: "1px solid rgba(59,130,246,0.25)" }}>
                    {dept}
                  </span>
                ))}
              </div>
            )}
            {pgSubjects.length > 0 && (
              <div className="flex items-center flex-wrap gap-2">
                <span className="text-[11px] uppercase tracking-wider font-bold" style={{ color: "var(--muted)" }}>MBBS PG Subjects</span>
                {pgSubjects.map((subj, i) => (
                  <span key={i} className="text-[11px] rounded-full px-2.5 py-1 font-semibold"
                    style={{ backgroundColor: "rgba(168,85,247,0.12)", color: "#c084fc", border: "1px solid rgba(168,85,247,0.25)" }}>
                    {subj}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {/* Citation key */}
      <div className="px-5 pb-5">
        <div className="mt-0 rounded-lg border px-4 py-3 flex flex-wrap gap-x-4 gap-y-2 text-left"
          style={{ borderColor: "var(--card-border)", backgroundColor: "var(--pill)" }}>
          <span className="text-[11px] uppercase tracking-wider font-bold" style={{ color: "var(--muted)" }}>Citation Key</span>
          <span className="text-[12px]" style={{ color: "var(--muted)" }}>
            <span style={{ color: "var(--accent)" }}>[S1], [S2]…</span> = Evidence snippet from ingested knowledge base (PDF / URL / notes)
          </span>
          <span className="text-[12px]" style={{ color: "var(--muted)" }}>
            <span style={{ color: "var(--accent)" }}>[PC1], [PC2]…</span> = Prior case from session history used as contextual reference
          </span>
        </div>
      </div>
    </div>
  );
}
