/**
 * Best-effort PHI redaction for log output and cross-session memory.
 *
 * This is a regex-based scrubber, not a clinical NER. It is intended to
 * cut the obvious identifiers (names with titles, phone numbers, email,
 * SSN, MRN-like sequences, dates of birth) before strings are written to
 * application logs or re-injected into another patient's LLM context.
 * Anything subtler — free-text addresses, geographic identifiers,
 * relationship descriptions — still requires a real de-identification
 * pipeline. Document this in audit notes so it isn't mistaken for full
 * Safe Harbor compliance.
 */

type ScrubRule = { pattern: RegExp; replacement: string };

const RULES: ScrubRule[] = [
  // Titled names: "Mr. John Doe", "Mrs Smith", "Dr. Jane Q. Public".
  { pattern: /\b(Mr\.?|Mrs\.?|Ms\.?|Miss|Mx\.?|Dr\.?|Prof\.?)\s+[A-Z][a-z]+(?:\s+(?:[A-Z]\.?\s*)?[A-Z][a-z]+)?\b/g, replacement: "[NAME]" },
  // "patient John", "patient: Jane Doe"
  { pattern: /\b([Pp]atient|[Cc]lient|[Ss]ubject)[\s:]+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g, replacement: "$1 [NAME]" },
  // US and Indian phone numbers.
  { pattern: /(?:\+?91[\s.-]?|0)?[6-9]\d{4}[\s.-]?\d{5}\b/g, replacement: "[PHONE]" },
  { pattern: /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g, replacement: "[PHONE]" },
  // Email addresses.
  { pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: "[EMAIL]" },
  // US SSN.
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: "[SSN]" },
  // Indian national IDs.
  { pattern: /\b\d{2}[\s.-]?\d{4}[\s.-]?\d{4}[\s.-]?\d{4}\b/g, replacement: "[ABHA]" },
  { pattern: /\b\d{4}[\s.-]?\d{4}[\s.-]?\d{4}\b/g, replacement: "[AADHAAR]" },
  // MRN-like: "MRN 12345678", "MR # 1234567", "Medical Record #87654321".
  { pattern: /\b(MRN|MR\s*#?|Med(?:ical)?\s+Record)\s*[#:]?\s*\d{4,}\b/gi, replacement: "[MRN]" },
  // Calendar dates: 12/31/1990, 1990-12-31, "Jan 5, 1990".
  { pattern: /\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/g, replacement: "[DATE]" },
  { pattern: /\b\d{4}-\d{2}-\d{2}\b/g, replacement: "[DATE]" },
  { pattern: /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b/gi, replacement: "[DATE]" },
];

export function scrubPhi(text: string | null | undefined): string {
  if (!text) return "";
  let out = text;
  for (const { pattern, replacement } of RULES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * W65 helper — scrub regex-detectable PHI and clamp to a preview length so a
 * decrypted PHI column never leaves the server as a full plaintext blob. Used
 * by the admin insights endpoint to display short, redacted previews of past
 * queries and gap topics. Kept here (rather than in session-learning.ts) so
 * unit tests do not transitively load the database client.
 */
export const PHI_PREVIEW_LEN = 140;
export function scrubPhiPreview(text: string | null | undefined): string {
  const cleaned = scrubPhi(text);
  return cleaned.length > PHI_PREVIEW_LEN ? cleaned.slice(0, PHI_PREVIEW_LEN) + "…" : cleaned;
}

/**
 * Recursive scrubber for objects passed to loggers. Strings are
 * replaced; primitives, dates, errors, etc. are preserved. Cycles are
 * broken by a WeakSet visited tracker.
 */
export function scrubPhiDeep(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value == null) return value;
  if (typeof value === "string") return scrubPhi(value);
  if (typeof value !== "object") return value;
  if (seen.has(value as object)) return "[Circular]";
  seen.add(value as object);

  if (value instanceof Error) {
    return Object.assign(new Error(scrubPhi(value.message)), { stack: value.stack ? scrubPhi(value.stack) : undefined });
  }
  if (Array.isArray(value)) {
    return value.map((v) => scrubPhiDeep(v, seen));
  }
  if (value instanceof Date) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = scrubPhiDeep(v, seen);
  }
  return out;
}
