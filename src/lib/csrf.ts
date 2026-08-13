/**
 * W36 — CSRF defence for state-changing requests.
 * W68 — Double-submit token fallback for clients behind corporate proxies
 * that strip `Origin` / `Referer` / `Sec-Fetch-Site`.
 *
 * Validation order:
 *   1. `Sec-Fetch-Site` (modern browsers, "same-origin" required).
 *   2. `Origin` header — must equal request origin.
 *   3. `Referer` host — must equal request host.
 *   4. `x-csrf-token` header == `csrf-token` cookie (double-submit fallback).
 *
 * Fail-closed when none of the above clears.
 *
 * The token cookie is set by `/api/csrf` and rotated on login. The cookie is
 * intentionally NOT `HttpOnly` because client JS must read it to echo into
 * the request header — that is the whole point of the double-submit pattern.
 * Confidentiality of the token does not matter for CSRF; what matters is that
 * a cross-site attacker cannot read the cookie value to construct a matching
 * header (SameSite=Lax blocks the cross-site cookie disclosure).
 */
import type { NextRequest } from "next/server";

export const CSRF_COOKIE = "mediq-csrf";
export const CSRF_HEADER = "x-csrf-token";
export const CSRF_TOKEN_BYTES = 32;

export type CsrfVerdict = { ok: true } | { ok: false; reason: string };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Paths exempt from CSRF (login bootstrap, cron with bearer, health, csrf mint).
const CSRF_EXEMPT_EXACT = new Set<string>([
  "/api/auth",
  "/api/health",
  "/api/csrf",
]);
const CSRF_EXEMPT_PREFIX = ["/api/cron"];

function isExempt(pathname: string): boolean {
  if (CSRF_EXEMPT_EXACT.has(pathname)) return true;
  return CSRF_EXEMPT_PREFIX.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

// Constant-time comparison — Web Crypto has no timingSafeEqual equivalent, so
// this loops over every byte regardless of an early mismatch (no short-circuit
// return) to avoid leaking length-of-match via timing.
function safeEqualString(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) {
    diff |= ab[i] ^ bb[i];
  }
  return diff === 0;
}

function readCsrfCookie(req: NextRequest): string | null {
  const v = req.cookies.get(CSRF_COOKIE)?.value || req.cookies.get(`__Host-${CSRF_COOKIE}`)?.value;
  return v && v.length > 0 ? v : null;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function mintCsrfToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CSRF_TOKEN_BYTES));
  return toBase64Url(bytes);
}

export function checkCsrf(req: NextRequest): CsrfVerdict {
  const method = req.method.toUpperCase();
  if (SAFE_METHODS.has(method)) return { ok: true };

  const { pathname } = req.nextUrl;
  if (isExempt(pathname)) return { ok: true };

  const expectedOrigin = req.nextUrl.origin;
  const expectedHost = req.nextUrl.host;

  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite) {
    // Only `same-origin` clears here. We reach this branch solely for mutating
    // methods (safe methods returned above). `none` is sent on direct
    // address-bar navigation, but a state-changing request should never
    // legitimately originate that way — and `none` has been used as a
    // CSRF-bypass vector — so we reject it (and `cross-site`) for mutations.
    // A genuine no-browser-signal client still has the double-submit fallback.
    if (secFetchSite === "same-origin") {
      return { ok: true };
    }
    return { ok: false, reason: `sec-fetch-site=${secFetchSite}` };
  }

  const origin = req.headers.get("origin");
  if (origin) {
    if (origin === expectedOrigin) return { ok: true };
    return { ok: false, reason: "origin-mismatch" };
  }

  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const refUrl = new URL(referer);
      if (refUrl.host === expectedHost) return { ok: true };
      return { ok: false, reason: "referer-host-mismatch" };
    } catch {
      return { ok: false, reason: "referer-invalid" };
    }
  }

  // W68 — double-submit fallback. Corp proxies that strip `Origin` /
  // `Referer` / `Sec-Fetch-Site` cannot strip a cookie + header that the
  // client deliberately attaches. Both must be present AND equal.
  const cookie = readCsrfCookie(req);
  const header = req.headers.get(CSRF_HEADER);
  if (cookie && header && safeEqualString(cookie, header)) {
    return { ok: true };
  }

  return { ok: false, reason: "no-origin-header" };
}
