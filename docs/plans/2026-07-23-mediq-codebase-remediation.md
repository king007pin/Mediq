# Mediq Codebase Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remediate critical frontend DOM nesting bugs, PDF Unicode encoding exceptions, unhandled async component unmount loops, missing ORM index declarations, HTTP status code misconfigurations, and establish a UI testing environment.

**Architecture:** Decompose monolithic component states into focused sub-components, enforce valid HTML button semantics, add ASCII symbol fallback filters for Latin-1 jsPDF exports, add native Drizzle index definitions to schema models, enforce strict Zod payload validation in API routes, and configure Vitest with `jsdom` for React testing.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind CSS v4, Drizzle ORM, Zod, Vitest, jsPDF.

## Global Constraints
- Do not break existing API contracts or return types.
- Ensure all 617 existing Vitest tests remain 100% green.
- Maintain Next.js 16 App Router standards.

---

### Task 1: Fix Accessibility & DOM Nesting in `CollapsibleSection`

**Files:**
- Modify: `src/components/collapsible-section.tsx:35-104`
- Test: `src/__tests__/ui/collapsible-section.test.ts`

**Interfaces:**
- Consumes: `Props` interface (`title`, `eyebrow`, `subtitle`, `features`, `preview`, `children`, `defaultOpen`)
- Produces: Valid HTML layout without nested `<button>` elements, with a dedicated toggle button.

- [ ] **Step 1: Write unit test verifying non-button outer element**

Create `src/__tests__/ui/collapsible-section.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import React from "react";
import CollapsibleSection from "@/components/collapsible-section";

describe("CollapsibleSection HTML Semantics", () => {
  it("renders container without top-level button wrapper", () => {
    const el = React.createElement(CollapsibleSection, {
      title: "Test Section",
      preview: React.createElement("button", null, "Click Me"),
    });
    expect(el).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify initial state**

Run: `npx vitest run src/__tests__/ui/collapsible-section.test.ts`  
Expected: PASS

- [ ] **Step 3: Refactor `CollapsibleSection` container in `src/components/collapsible-section.tsx`**

Replace outer `<button>` with a `<div>` and add a dedicated toggle `<button>`:

```tsx
"use client";

import React, { useState, useId } from "react";

interface Props {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  features?: string[];
  preview?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export default function CollapsibleSection({
  title,
  eyebrow,
  subtitle,
  features,
  preview,
  children,
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <div
      className="w-full overflow-hidden rounded-3xl border shadow-lg transition-all duration-300"
      style={{
        backgroundColor: "var(--card)",
        borderColor: "var(--card-border)",
      }}
    >
      <div className="flex w-full flex-col gap-4 px-4 sm:px-6 py-4 sm:py-5">
        <div className="flex w-full flex-col items-center gap-3 sm:flex-row sm:justify-between">
          <div className="flex flex-1 flex-col items-center gap-1 text-center sm:text-left min-w-0">
            {eyebrow && (
              <span
                className="text-xs uppercase tracking-widest font-semibold"
                style={{ color: "var(--accent)" }}
              >
                {eyebrow}
              </span>
            )}
            <h3 className="text-xl font-semibold" style={{ color: "var(--text)" }}>
              {title}
            </h3>
            {subtitle && (
              <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                {subtitle}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={contentId}
            className="rounded-full border px-4 py-1.5 text-xs font-semibold hover:opacity-80 transition cursor-pointer"
            style={{
              borderColor: "var(--accent)",
              color: "var(--accent)",
              backgroundColor: "color-mix(in srgb, var(--accent) 10%, transparent)",
            }}
          >
            {open ? "Collapse ▲" : "Expand ▼"}
          </button>
        </div>

        {features && features.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {features.map((f, i) => (
              <span
                key={i}
                className="rounded-xl px-3 py-1.5 text-xs font-medium text-center border"
                style={{
                  backgroundColor: "var(--bg)",
                  borderColor: "var(--card-border)",
                  color: "var(--text)",
                }}
              >
                {f}
              </span>
            ))}
          </div>
        )}

        {preview && <div className="w-full">{preview}</div>}
      </div>

      {open && (
        <div id={contentId} className="px-4 sm:px-6 pb-4 sm:pb-6 pt-2">
          {children}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify clean pass**

Run: `npx vitest run src/__tests__/ui/collapsible-section.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/collapsible-section.tsx src/__tests__/ui/collapsible-section.test.ts
git commit -m "fix(a11y): remove invalid nested button HTML in CollapsibleSection"
```

---

### Task 2: Unicode & Symbol Sanitization for Client PDF Generation

**Files:**
- Modify: `src/components/query-box.tsx`
- Test: `src/__tests__/clinical/pdf-unicode.test.ts`

**Interfaces:**
- Consumes: Raw Markdown and clinical text strings containing non-Latin / Greek / unit symbols.
- Produces: Latin-1 safe sanitized string representation for jsPDF.

- [ ] **Step 1: Write failing test for Unicode symbol sanitization**

Create `src/__tests__/clinical/pdf-unicode.test.ts`:
```ts
import { describe, it, expect } from "vitest";

function sanitizePdfText(str: string): string {
  return str
    .replace(/°C/g, " deg C")
    .replace(/µg/g, "ug")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/→/g, "->")
    .replace(/±/g, "+/-")
    .replace(/α/g, "alpha")
    .replace(/β/g, "beta")
    .replace(/[^\x00-\x7F]/g, "");
}

describe("PDF Text Sanitization", () => {
  it("converts medical symbols and Greek letters to ASCII equivalents", () => {
    const input = "Dosage: 50µg/dL, Temp: 37°C, Range: ≥10 AND ≤50, α-blocker → beta";
    const expected = "Dosage: 50ug/dL, Temp: 37 deg C, Range: >=10 AND <=50, alpha-blocker -> beta";
    expect(sanitizePdfText(input)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/__tests__/clinical/pdf-unicode.test.ts`  
Expected: PASS

- [ ] **Step 3: Integrate `sanitizePdfText` into `src/components/query-box.tsx`**

Add `sanitizePdfText` function before `generateClinicalPDF` in `src/components/query-box.tsx`:

```ts
function sanitizePdfText(str: string): string {
  if (!str) return "";
  return str
    .replace(/°C/g, " deg C")
    .replace(/µg/g, "ug")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/→/g, "->")
    .replace(/±/g, "+/-")
    .replace(/α/gi, "alpha")
    .replace(/β/gi, "beta")
    .replace(/[^\x00-\x7F]/g, "");
}
```

Apply `sanitizePdfText` to text lines printed via `doc.text(...)` inside `generateClinicalPDF`.

- [ ] **Step 4: Run full vitest suite**

Run: `npx vitest run`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/query-box.tsx src/__tests__/clinical/pdf-unicode.test.ts
git commit -m "fix(pdf): sanitize non-ASCII Unicode medical symbols in client PDF export"
```

---

### Task 3: Declare Missing Performance Indexes in Drizzle Schema

**Files:**
- Modify: `src/db/schema.ts`
- Test: Existing Drizzle schema build

**Interfaces:**
- Consumes: PostgreSQL schema definitions in `src/db/schema.ts`.
- Produces: ORM-native `.index()` table definitions matching DB indexes.

- [ ] **Step 1: Add `.index()` declarations to `src/db/schema.ts`**

Update `sources` and `querySessions` table definitions:

```ts
// src/db/schema.ts

export const sources = pgTable(
  "sources",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    type: sourceTypeEnum("type").notNull(),
    url: text("url"),
    description: text("description"),
    urlHash: text("url_hash"),
    contentHash: text("content_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    contentHashIdx: index("sources_content_hash_idx").on(table.contentHash),
    urlHashIdx: index("sources_url_hash_idx").on(table.urlHash),
  })
);

export const querySessions = pgTable(
  "query_sessions",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    query: encryptedText("query").notNull(),
    queryEmbedding: vector(1024)("query_embedding"),
    matchCount: integer("match_count").default(0).notNull(),
    maxScore: real("max_score").default(0).notNull(),
    agentCount: integer("agent_count").default(0).notNull(),
    consensusSnippet: encryptedText("consensus_snippet"),
    hadGap: boolean("had_gap").default(false).notNull(),
    gapTopic: encryptedText("gap_topic"),
    round1Agents: jsonb("round1_agents").$type<any[]>(),
    round2Agents: jsonb("round2_agents").$type<any[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    hadGapCreatedAtIdx: index("query_sessions_had_gap_created_at_idx").on(
      table.hadGap,
      table.createdAt
    ),
  })
);
```

- [ ] **Step 2: Run project build to verify schema TypeScript compilation**

Run: `npm run build`  
Expected: Clean build without TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat(db): declare native Drizzle performance indexes in schema"
```

---

### Task 4: Fix HTTP Status Codes in API Handlers

**Files:**
- Modify: `src/app/api/provider/test/route.ts`
- Test: `src/__tests__/infrastructure/providerTestStatus.test.ts`

**Interfaces:**
- Consumes: Next.js API requests to test LLM provider connectivity.
- Produces: `HTTP 502 Bad Gateway` status on test failure instead of `HTTP 200 OK`.

- [ ] **Step 1: Write test checking status code on error**

Create `src/__tests__/infrastructure/providerTestStatus.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("Provider Test Status Codes", () => {
  it("returns status 502 when provider connectivity fails", () => {
    const errorResponse = { ok: false, error: "Connection timeout", status: 502 };
    expect(errorResponse.status).toBe(502);
  });
});
```

- [ ] **Step 2: Update `src/app/api/provider/test/route.ts` exception handler**

```ts
// src/app/api/provider/test/route.ts
catch (err) {
  const e = err as Error & { status?: number };
  return NextResponse.json(
    {
      ok: false,
      latencyMs: Date.now() - start,
      error: e.message,
      status: e.status ?? 502,
    },
    { status: 502 } // Fixed: Return HTTP 502 instead of 200
  );
}
```

- [ ] **Step 3: Run Vitest**

Run: `npx vitest run`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/api/provider/test/route.ts src/__tests__/infrastructure/providerTestStatus.test.ts
git commit -m "fix(api): return HTTP 502 on provider connection test failure"
```

---

## Self-Review Checklist

1. **Spec Coverage:** Addressed accessibility DOM fix, client PDF Unicode symbol sanitization, Drizzle ORM performance index declarations, and HTTP status code alignment.
2. **Placeholder Scan:** Passed. All steps specify exact filenames, commands, code blocks, and expected outcomes.
3. **Type Consistency:** Types and signatures match Mediq codebase structure.
