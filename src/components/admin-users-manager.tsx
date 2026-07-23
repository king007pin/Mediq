"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type UserRow = {
  id: string;
  email: string;
  role: "admin" | "clinician" | "viewer";
  active: boolean;
  createdAt: string;
};

type CreatedUser = {
  id: string;
  email: string;
  role: "clinician" | "viewer";
  initialPassword: string;
};

export default function AdminUsersManager() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"clinician" | "viewer">("clinician");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdUser, setCreatedUser] = useState<CreatedUser | null>(null);
  const [copied, setCopied] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        setDenied(true);
        return;
      }
      if (!res.ok) {
        setListError(`Failed to load users (HTTP ${res.status})`);
        return;
      }
      const data = (await res.json()) as { users: UserRow[] };
      setRows(data.users ?? []);
    } catch (err) {
      setListError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setCreatedUser(null);
    setCopied(false);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitError(
          (data as { error?: string }).error ?? `Failed (HTTP ${res.status})`,
        );
        return;
      }
      setCreatedUser(data as CreatedUser);
      setEmail("");
      void loadUsers();
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!createdUser) return;
    try {
      await navigator.clipboard.writeText(createdUser.initialPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  if (denied) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center space-y-6">
        <div
          className="rounded-2xl border p-8 space-y-4"
          style={{ backgroundColor: "var(--card)", borderColor: "var(--card-border)" }}
        >
          <h1 className="text-xl font-semibold mb-2">Admin access required</h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            You must be signed in as an administrator to manage users.
          </p>
          <div className="pt-2 flex justify-center gap-4">
            <Link
              href="/login"
              className="rounded-full border px-4 py-2 text-xs font-semibold hover:opacity-80 transition-opacity"
              style={{
                borderColor: "var(--card-border)",
                color: "var(--text)",
                backgroundColor: "var(--card)",
              }}
            >
              Go to Sign In
            </Link>
            <Link
              href="/"
              className="rounded-full border px-4 py-2 text-xs font-semibold hover:opacity-80 transition-opacity"
              style={{
                borderColor: "var(--card-border)",
                color: "var(--text)",
                backgroundColor: "var(--card)",
              }}
            >
              Go to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <section
        className="rounded-2xl border p-5 space-y-4"
        style={{
          backgroundColor: "var(--card)",
          borderColor: "var(--card-border)",
        }}
      >
        <h2 className="text-base font-semibold">Create user</h2>
        <form
          onSubmit={handleSubmit}
          className="grid gap-3 sm:grid-cols-[1fr,180px,auto] sm:items-end"
        >
          <label className="flex flex-col gap-1 text-left">
            <span
              className="text-[11px] uppercase tracking-wide"
              style={{ color: "var(--muted)" }}
            >
              Email
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="rounded-xl border px-3 py-2 text-sm"
              style={{
                backgroundColor: "var(--bg)",
                borderColor: "var(--card-border)",
                color: "var(--text)",
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-left">
            <span
              className="text-[11px] uppercase tracking-wide"
              style={{ color: "var(--muted)" }}
            >
              Role
            </span>
            <select
              value={role}
              onChange={(e) =>
                setRole(e.target.value as "clinician" | "viewer")
              }
              className="rounded-xl border px-3 py-2 text-sm"
              style={{
                backgroundColor: "var(--bg)",
                borderColor: "var(--card-border)",
                color: "var(--text)",
              }}
            >
              <option value="clinician">clinician</option>
              <option value="viewer">viewer</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-2xl px-4 py-2 text-sm font-semibold shadow transition disabled:opacity-50"
            style={{
              backgroundColor: "var(--accent)",
              color: "var(--bg)",
            }}
          >
            {submitting ? "Creating..." : "Create user"}
          </button>
        </form>

        {submitError && (
          <p className="text-sm" style={{ color: "#f87171" }}>
            {submitError}
          </p>
        )}

        {createdUser && (
          <div
            className="rounded-2xl border p-4 space-y-2"
            style={{
              borderColor: "#f59e0b",
              backgroundColor:
                "color-mix(in srgb, #f59e0b 12%, var(--card))",
            }}
          >
            <p
              className="text-[11px] font-bold uppercase tracking-wide"
              style={{ color: "#f59e0b" }}
            >
              Copy this password now — it will not be shown again.
            </p>
            <p className="text-sm" style={{ color: "var(--text)" }}>
              Account created for <strong>{createdUser.email}</strong> (
              {createdUser.role}).
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code
                className="rounded-xl border px-3 py-2 text-sm break-all"
                style={{
                  backgroundColor: "var(--bg)",
                  borderColor: "var(--card-border)",
                  color: "var(--text)",
                }}
              >
                {createdUser.initialPassword}
              </code>
              <button
                type="button"
                onClick={handleCopy}
                className="rounded-2xl px-3 py-2 text-sm font-semibold shadow transition"
                style={{
                  backgroundColor: "var(--accent)",
                  color: "var(--bg)",
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}
      </section>

      <section
        className="rounded-2xl border p-5 space-y-3"
        style={{
          backgroundColor: "var(--card)",
          borderColor: "var(--card-border)",
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Existing users</h2>
          <button
            type="button"
            onClick={() => void loadUsers()}
            className="rounded-2xl px-3 py-1.5 text-xs transition"
            style={{
              borderColor: "var(--card-border)",
              color: "var(--muted)",
              borderWidth: 1,
              borderStyle: "solid",
            }}
          >
            Refresh
          </button>
        </div>

        {loading && (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Loading...
          </p>
        )}
        {listError && (
          <p className="text-sm" style={{ color: "#f87171" }}>
            {listError}
          </p>
        )}

        {!loading && !listError && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="text-left text-[11px] uppercase tracking-wide"
                  style={{ color: "var(--muted)" }}
                >
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2 pr-3">Role</th>
                  <th className="py-2 pr-3">Active</th>
                  <th className="py-2 pr-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="py-3 text-center"
                      style={{ color: "var(--muted)" }}
                    >
                      No users yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((u) => (
                    <tr
                      key={u.id}
                      className="border-t"
                      style={{ borderColor: "var(--card-border)" }}
                    >
                      <td className="py-2 pr-3 break-all">{u.email}</td>
                      <td className="py-2 pr-3">{u.role}</td>
                      <td className="py-2 pr-3">
                        {u.active ? "yes" : "no"}
                      </td>
                      <td
                        className="py-2 pr-3"
                        style={{ color: "var(--muted)" }}
                      >
                        {new Date(u.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
