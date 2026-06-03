"use client";

import React, { useState, useMemo } from "react";
import { type AgentReply, type ModelMeta } from "../query-box";

const MODEL_STRATEGY_LABELS: Record<string, string> = {
  "meta/llama-3.3-70b-instruct":                 "Bayesian differential",
  "openai/gpt-oss-120b":                          "Worst-case · red flag hunter",
  "meta/llama-4-maverick-17b-128e-instruct":      "Time-critical life-threat triage",
  "qwen/qwen3-next-80b-a3b-instruct":             "Devil's advocate · rare diagnosis hunter",
  "mistralai/ministral-14b-instruct-2512":        "Pathogen-first infectious reasoning",
  "nvidia/nemotron-3-super-120b-a12b":            "Metabolic · systemic unifier",
  "nvidia/nemotron-nano-12b-v2-vl":              "Occam's razor · parsimony first",
};

type ModelColor = {
  border: string;
  bg: string;
  dot: string;
  glow: string;
};

// Thinking dots animation for pending states
export function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-0.5 ml-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-1.5 w-1.5 rounded-full animate-bounce"
          style={{
            backgroundColor: "var(--muted)",
            animationDelay: `${i * 180}ms`,
            animationDuration: "900ms",
          }}
        />
      ))}
    </span>
  );
}

// Skeleton loading lines
export function SkeletonLines({ count = 5 }: { count?: number }) {
  const widths = [85, 70, 92, 60, 78];
  return (
    <div className="space-y-2 pt-1">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="h-2 rounded animate-pulse"
          style={{
            width: `${widths[i % widths.length]}%`,
            backgroundColor: "var(--pill)",
            animationDelay: `${i * 100}ms`,
          }}
        />
      ))}
    </div>
  );
}

// Helper to extract structured sections from agent message
function parseAgentSections(text: string): Array<{ heading: string; body: string }> {
  const sectionPattern = /^(\d+\.\s+[A-Z][A-Z\s&\/\-()]+)$/m;
  const lines = text.split("\n");
  const sections: Array<{ heading: string; body: string }> = [];
  let current: { heading: string; lines: string[] } | null = null;

  for (const line of lines) {
    if (sectionPattern.test(line.trim())) {
      if (current) sections.push({ heading: current.heading, body: current.lines.join("\n").trim() });
      current = { heading: line.trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push({ heading: current.heading, body: current.lines.join("\n").trim() });
  return sections.filter((s) => s.body.length > 10);
}

interface AgentDebateBubbleProps {
  agent?: AgentReply;
  meta?: ModelMeta | null;
  color: ModelColor;
  idx: number;
  phase: "r1" | "r2";
  pending?: boolean;
  compact?: boolean;
}

export function AgentDebateBubble({
  agent,
  meta,
  color,
  idx,
  phase,
  pending,
  compact,
}: AgentDebateBubbleProps) {
  const [expanded, setExpanded] = useState(false);
  const [prevCompact, setPrevCompact] = useState(compact);

  // Store information from previous renders to adjust state when compact changes
  if (compact !== prevCompact) {
    setPrevCompact(compact);
    if (compact) setExpanded(false);
  }

  const label = meta?.label ?? agent?.model ?? `Agent ${idx + 1}`;
  const role = meta?.role ?? "";

  const parsedRole = useMemo(() => {
    if (!agent || !agent.reasoning) return "";
    const parts = agent.reasoning.split(" · ");
    if (parts[0] === "Ruflo" || parts[0] === "local") {
      return parts[1] || "";
    }
    if (parts[0].startsWith("fallback")) {
      return "Clinical Specialist";
    }
    return parts[0];
  }, [agent]);

  const displayRole = role || parsedRole || label;

  const strategy = useMemo(() => {
    if (!agent) return "";
    if (MODEL_STRATEGY_LABELS[agent.model]) {
      return MODEL_STRATEGY_LABELS[agent.model];
    }
    const parts = agent.reasoning.split(" · ");
    let strategyPart = "";
    if (parts[0] === "Ruflo" || parts[0] === "local") {
      strategyPart = parts[2] || "";
    } else {
      strategyPart = parts[1] || "";
    }
    return strategyPart;
  }, [agent]);

  const sections = agent ? parseAgentSections(agent.message) : [];
  const hasSections = sections.length >= 2;

  return (
    <div
      className="rounded-xl border flex flex-col transition-all duration-700"
      style={{
        borderColor: agent ? color.border : "var(--card-border)",
        backgroundColor: agent ? color.bg : "var(--card)",
        opacity: agent ? 1 : pending ? 0.45 : 1,
        boxShadow: agent && !pending ? `0 0 12px ${color.glow}` : undefined,
      }}
    >
      {/* Header */}
      <div
        className="flex items-start justify-between px-3 py-2.5 border-b gap-2"
        style={{ borderColor: agent ? color.border : "var(--card-border)" }}
      >
        <div className="flex items-start gap-2 min-w-0">
          <span
            className="mt-0.5 h-2 w-2 rounded-full shrink-0"
            style={{
              backgroundColor: agent ? color.dot : "var(--muted)",
              boxShadow: agent ? `0 0 6px ${color.dot}` : undefined,
            }}
          />
          <div className="min-w-0">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold" style={{ color: "var(--text)" }}>
                  {displayRole}
                </span>
                {agent && (
                  <span
                    className="text-[9px] rounded-full px-1.5 py-0.2"
                    style={{
                      backgroundColor: "var(--card)",
                      color: color.dot,
                      border: `1px solid ${color.border}`,
                    }}
                  >
                    {phase === "r2" ? "refined" : "initial"}
                  </span>
                )}
              </div>
              {displayRole !== label && (
                <span className="text-[10px] font-normal leading-tight" style={{ color: "var(--muted)" }}>
                  {label}
                </span>
              )}
            </div>
            {strategy && strategy !== displayRole && (
              <p className="mt-0.5 text-[10px]" style={{ color: "var(--muted)" }}>
                Lens: {strategy}
              </p>
            )}
          </div>
        </div>
        {agent ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 rounded-full px-2 py-0.5 text-[10px] transition mt-0.5"
            style={{ backgroundColor: "var(--pill)", color: "var(--muted)" }}
          >
            {expanded ? "Collapse ▲" : "Expand ▼"}
          </button>
        ) : (
          <span className="text-[10px] shrink-0" style={{ color: "var(--muted)" }}>
            reasoning<ThinkingDots />
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2.5 flex-1">
        {agent ? (
          expanded ? (
            hasSections ? (
              <div className="space-y-3">
                {sections.map((sec, i) => (
                  <div key={i}>
                    <p
                      className="text-[10px] font-bold uppercase tracking-wider mb-1"
                      style={{ color: color.dot }}
                    >
                      {sec.heading}
                    </p>
                    <p
                      className="text-xs leading-relaxed whitespace-pre-wrap"
                      style={{ color: "var(--muted)" }}
                    >
                      {sec.body}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p
                className="text-xs leading-relaxed whitespace-pre-wrap"
                style={{ color: "var(--muted)" }}
              >
                {agent.message}
              </p>
            )
          ) : (
            <div className="space-y-1">
              {hasSections ? (
                sections.slice(0, 2).map((sec, i) => (
                  <div key={i}>
                    <p
                      className="text-[10px] font-bold uppercase tracking-wider"
                      style={{ color: color.dot }}
                    >
                      {sec.heading}
                    </p>
                    <p
                      className="text-xs leading-relaxed line-clamp-3"
                      style={{ color: "var(--muted)" }}
                    >
                      {sec.body}
                    </p>
                  </div>
                ))
              ) : (
                <p
                  className="text-xs leading-relaxed line-clamp-4"
                  style={{ color: "var(--muted)" }}
                >
                  {agent.message}
                </p>
              )}
              {(hasSections ? sections.length > 2 : agent.message.length > 300) && (
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="text-[10px] mt-1"
                  style={{ color: color.dot }}
                >
                  + Show full assessment ({hasSections ? `${sections.length - 2} more sections` : "more"})
                </button>
              )}
            </div>
          )
        ) : (
          <SkeletonLines />
        )}
      </div>

      {agent && (
        <div
          className="px-3 py-1.5 border-t flex items-center gap-1"
          style={{ borderColor: color.border }}
        >
          {agent.reasoning.startsWith("fallback") ? (
            <span
              className="text-[10px] truncate"
              style={{ color: "var(--warning, #f59e0b)" }}
            >
              ⚠ API timeout — partial result shown
            </span>
          ) : (
            <>
              <span className="text-[10px]" style={{ color: color.dot }}>
                via
              </span>
              <span className="text-[10px] truncate" style={{ color: "var(--muted)" }}>
                {agent.reasoning}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
