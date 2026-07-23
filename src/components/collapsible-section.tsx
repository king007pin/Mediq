"use client";

import { useState, useId } from "react";

export type SectionFeature = { label: string; sub?: string };

type Props = {
  title: string;
  eyebrow?: React.ReactNode;
  subtitle?: string;
  features?: SectionFeature[];
  preview?: React.ReactNode;
  header?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
};

export default function CollapsibleSection({
  title,
  eyebrow,
  subtitle,
  features,
  preview,
  header,
  children,
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <div
      className="w-full overflow-hidden rounded-3xl border shadow-lg"
      style={{ backgroundColor: "var(--card)", borderColor: "var(--card-border)" }}
    >
      <div
        className="flex w-full flex-col gap-4 px-3 sm:px-6 py-4 sm:py-5 text-left transition"
        style={{
          backgroundColor: open
            ? "color-mix(in srgb, var(--accent) 5%, var(--card))"
            : "var(--card)",
        }}
      >
        {/* Header row */}
        <div className="flex w-full flex-col items-center gap-3 text-center sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          {/* Left spacer to balance the collapse button on desktop */}
          <div className="hidden w-24 shrink-0 sm:block" />

          <div className="flex flex-1 flex-col items-center gap-1 text-center min-w-0 w-full">
            {eyebrow && (
              <span className="text-xs uppercase tracking-[0.28em] font-semibold break-words block w-full" style={{ color: "var(--accent)" }}>
                {eyebrow}
              </span>
            )}
            <h3 className="text-xl font-semibold" style={{ color: "var(--text)" }}>
              {title}
            </h3>
            {subtitle && (
              <p className="text-xs leading-relaxed max-w-lg" style={{ color: "var(--muted)" }}>
                {subtitle}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={contentId}
            className="w-24 shrink-0 text-center rounded-full border py-1 text-xs font-semibold select-none sm:self-start cursor-pointer hover:opacity-90 transition"
            style={{
              borderColor: "var(--accent)",
              color: "var(--accent)",
              backgroundColor: "color-mix(in srgb, var(--accent) 10%, transparent)",
            }}
          >
            {open ? "Collapse ▲" : "Expand ▼"}
          </button>
        </div>

        {/* Feature pills — always visible, 4-col symmetric grid */}
        {features && features.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full">
            {features.map((f, i) => (
              <div
                key={i}
                className="flex flex-col items-center justify-center rounded-xl border px-2 py-2 text-center gap-0.5"
                style={{
                  borderColor: "var(--card-border)",
                  backgroundColor: "color-mix(in srgb, var(--accent) 5%, var(--bg))",
                }}
              >
                {f.sub && (
                  <span className="text-sm font-bold leading-tight" style={{ color: "var(--accent)" }}>
                    {f.sub}
                  </span>
                )}
                <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                  {f.label}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Preview — always visible extra content below pills */}
        {preview && <div className="w-full">{preview}</div>}
      </div>

      {open && (
        <div id={contentId} className="px-3 sm:px-6 pb-4 sm:pb-6 pt-2 space-y-5">
          {header}
          {children}
        </div>
      )}
    </div>
  );
}

