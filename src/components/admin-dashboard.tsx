"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ProviderKeyManager from "@/components/provider-key-manager";
import ManagerPanel from "@/components/manager-panel";
import InsightsPanel from "@/components/insights-panel";

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

type TabId = "providers" | "swarm" | "insights" | "users";

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<TabId>("providers");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // User management tab specific states
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"clinician" | "viewer">("clinician");
  const [submittingUser, setSubmittingUser] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdUser, setCreatedUser] = useState<CreatedUser | null>(null);
  const [copied, setCopied] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        setDenied(true);
        return;
      }
      if (!res.ok) {
        setError(`Failed to fetch admin dashboard configuration (HTTP ${res.status})`);
        return;
      }
      const data = (await res.json()) as { users: UserRow[] };
      setUsers(data.users ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void loadData();
  }, [loadData]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleInviteSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setCreatedUser(null);
    setCopied(false);
    setSubmittingUser(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitError(
          (data as { error?: string }).error ?? `Failed to create user (HTTP ${res.status})`,
        );
        return;
      }
      setCreatedUser(data as CreatedUser);
      setInviteEmail("");
      void loadData();
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmittingUser(false);
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
          className="rounded-2xl border p-8 space-y-4 shadow-xl"
          style={{ backgroundColor: "var(--card)", borderColor: "var(--card-border)" }}
        >
          <h1 className="text-xl font-semibold mb-2">Admin access required</h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            You must be signed in as an administrator to access the Mission Control dashboard.
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

  // Count metrics
  const adminCount = users.filter((u) => u.role === "admin").length;
  const clinicianCount = users.filter((u) => u.role === "clinician").length;
  const viewerCount = users.filter((u) => u.role === "viewer").length;
  const totalCount = users.length;

  return (
    <>
      {/* Quick System Metrics strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Accounts", value: totalCount, icon: "👥", color: "var(--accent)" },
          { label: "Clinicians", value: clinicianCount, icon: "🩺", color: "var(--success)" },
          { label: "Viewers", value: viewerCount, icon: "📖", color: "var(--muted)" },
          { label: "Administrators", value: adminCount, icon: "⚙️", color: "var(--accent-2)" },
        ].map((m) => (
          <div
            key={m.label}
            className="rounded-2xl border p-4 flex items-center justify-between transition-all"
            style={{
              backgroundColor: "var(--card)",
              borderColor: "var(--card-border)",
            }}
          >
            <div className="space-y-1">
              <span className="text-xs uppercase tracking-wider font-semibold" style={{ color: "var(--muted)" }}>
                {m.label}
              </span>
              <p className="text-2xl font-black">{loading ? "..." : m.value}</p>
            </div>
            <span className="text-3xl" aria-hidden style={{ color: m.color }}>
              {m.icon}
            </span>
          </div>
        ))}
      </section>

      {/* Console Tab Navigation */}
      <div className="border-b" style={{ borderColor: "var(--card-border)" }}>
        <nav className="flex flex-wrap -mb-px gap-2" aria-label="Tabs">
          {[
            { id: "providers", label: "🔑 Swarm Keys", desc: "API Keys & Provider Slots" },
            { id: "swarm", label: "📊 Swarm Operations", desc: "Complexity & Live Routing" },
            { id: "insights", label: "🧠 Learning Insights", desc: "Knowledge Gaps & Remediation" },
            { id: "users", label: "👥 Clinician Invites", desc: "Create & Manage Accounts" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as TabId)}
              className={`py-3 px-4 text-sm font-semibold border-b-2 transition-all rounded-t-xl ${
                activeTab === tab.id
                  ? "border-indigo-500 font-bold"
                  : "border-transparent opacity-75 hover:opacity-100"
              }`}
              style={{
                borderBottomColor: activeTab === tab.id ? "var(--accent)" : "transparent",
                color: activeTab === tab.id ? "var(--accent)" : "var(--text)",
              }}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Contents */}
      <div className="space-y-6">
        
        {/* Tab 1: Provider Keys */}
        {activeTab === "providers" && (
          <div
            className="rounded-3xl border p-5 shadow-sm sm:p-6 space-y-6"
            style={{ backgroundColor: "var(--card)", borderColor: "var(--card-border)" }}
          >
            <div className="space-y-1">
              <h2 className="text-lg font-bold">Multi-Provider Swarm Setup</h2>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                Configure your API keys for all 12 model providers to enable dynamic, automated selection and real-time swarm health checks.
              </p>
            </div>
            <ProviderKeyManager />
          </div>
        )}

        {/* Tab 2: Swarm Operations & Monitoring */}
        {activeTab === "swarm" && (
          <div
            className="rounded-3xl border p-5 shadow-sm sm:p-6 space-y-6"
            style={{ backgroundColor: "var(--card)", borderColor: "var(--card-border)" }}
          >
            <div className="space-y-1">
              <h2 className="text-lg font-bold">Swarm Operations Monitor</h2>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                Real-time query metrics, complexity-based agent routing, automated emergency detection, and escalation logs.
              </p>
            </div>
            <ManagerPanel />
          </div>
        )}

        {/* Tab 3: Continuous Learning & Insights */}
        {activeTab === "insights" && (
          <div
            className="rounded-3xl border p-5 shadow-sm sm:p-6 space-y-6"
            style={{ backgroundColor: "var(--card)", borderColor: "var(--card-border)" }}
          >
            <div className="space-y-1">
              <h2 className="text-lg font-bold">Clinical Learning & Remediation</h2>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                Identify clinical session knowledge gaps, manage auto-remediation triggers, and execute real-time PubMed RAG ingestion.
              </p>
            </div>
            <InsightsPanel />
          </div>
        )}

        {/* Tab 4: User Accounts & Invites */}
        {activeTab === "users" && (
          <div className="grid gap-6 lg:grid-cols-[1fr,2fr]">
            
            {/* Invite Form */}
            <div
              className="rounded-3xl border p-5 shadow-sm space-y-4"
              style={{ backgroundColor: "var(--card)", borderColor: "var(--card-border)" }}
            >
              <h3 className="text-base font-bold">Invite Clinician / Viewer</h3>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                Instantly register a new secure clinician account. Copy the generated password before leaving this tab.
              </p>

              <form onSubmit={handleInviteSubmit} className="space-y-4">
                <label className="flex flex-col gap-1 text-left">
                  <span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: "var(--muted)" }}>
                    Email Address
                  </span>
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="doctor@hospital.gov.in"
                    className="rounded-xl border px-3 py-2 text-sm bg-transparent"
                    style={{
                      borderColor: "var(--card-border)",
                      color: "var(--text)",
                    }}
                  />
                </label>

                <label className="flex flex-col gap-1 text-left">
                  <span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: "var(--muted)" }}>
                    Designated Role
                  </span>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as "clinician" | "viewer")}
                    className="rounded-xl border px-3 py-2 text-sm bg-transparent"
                    style={{
                      borderColor: "var(--card-border)",
                      color: "var(--text)",
                      backgroundColor: "var(--card)",
                    }}
                  >
                    <option value="clinician">Clinician (Full Read/Write)</option>
                    <option value="viewer">Viewer (Read-only)</option>
                  </select>
                </label>

                <button
                  type="submit"
                  disabled={submittingUser}
                  className="w-full rounded-2xl py-2 text-sm font-semibold shadow transition-all active:scale-[0.98] disabled:opacity-50"
                  style={{
                    backgroundColor: "var(--accent)",
                    color: "var(--bg)",
                  }}
                >
                  {submittingUser ? "Creating..." : "👥 Generate Invitation"}
                </button>
              </form>

              {submitError && (
                <p className="text-xs font-semibold text-red-500 bg-red-500/10 p-3 rounded-xl border border-red-500/20">
                  ⚠️ {submitError}
                </p>
              )}

              {createdUser && (
                <div
                  className="rounded-2xl border p-4 space-y-3 shadow-md"
                  style={{
                    borderColor: "var(--accent-2)",
                    backgroundColor: "color-mix(in srgb, var(--accent-2) 8%, var(--card))",
                  }}
                >
                  <p className="text-[10px] font-black uppercase tracking-wider" style={{ color: "var(--accent-2)" }}>
                    📋 COPY TEMPORARY PASSWORD NOW:
                  </p>
                  <p className="text-xs" style={{ color: "var(--text)" }}>
                    Account created for <strong>{createdUser.email}</strong>.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <code
                      className="rounded-xl border px-3 py-1.5 text-xs break-all flex-1 select-all"
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
                      className="rounded-xl px-3 py-1.5 text-xs font-bold shadow transition-all active:scale-[0.98]"
                      style={{
                        backgroundColor: "var(--accent-2)",
                        color: "var(--bg)",
                      }}
                    >
                      {copied ? "✓ Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Users list table */}
            <div
              className="rounded-3xl border p-5 shadow-sm space-y-4"
              style={{ backgroundColor: "var(--card)", borderColor: "var(--card-border)" }}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold">Registered Users</h3>
                <button
                  type="button"
                  onClick={() => void loadData()}
                  className="rounded-xl border px-3 py-1 text-xs font-semibold hover:bg-neutral-500/5 dark:hover:bg-neutral-500/10 transition-all active:scale-[0.98]"
                  style={{ borderColor: "var(--card-border)", color: "var(--muted)", backgroundColor: "var(--card)" }}
                >
                  🔄 Refresh
                </button>
              </div>

              {loading && (
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  Loading user directory...
                </p>
              )}

              {error && (
                <p className="text-xs text-red-500 bg-red-500/10 p-3 rounded-xl border border-red-500/20">
                  ⚠️ {error}
                </p>
              )}

              {!loading && !error && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="uppercase tracking-wider opacity-70 border-b" style={{ borderColor: "var(--card-border)" }}>
                        <th className="py-2.5 pr-2">Email Address</th>
                        <th className="py-2.5 px-2">Role</th>
                        <th className="py-2.5 px-2">Active</th>
                        <th className="py-2.5 pl-2 text-right">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-4 text-center opacity-70">
                            No registered users.
                          </td>
                        </tr>
                      ) : (
                        users.map((u) => (
                          <tr
                            key={u.id}
                            className="border-b last:border-0 hover:bg-neutral-500/5 transition-all"
                            style={{ borderColor: "var(--card-border)" }}
                          >
                            <td className="py-3 pr-2 font-semibold break-all">{u.email}</td>
                            <td className="py-3 px-2">
                              <span
                                className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                                style={{
                                  backgroundColor:
                                    u.role === "admin"
                                      ? "rgba(244,114,182,0.15)"
                                      : u.role === "clinician"
                                      ? "rgba(34,197,94,0.15)"
                                      : "rgba(148,163,184,0.15)",
                                  color:
                                    u.role === "admin"
                                      ? "var(--accent-2)"
                                      : u.role === "clinician"
                                      ? "var(--success)"
                                      : "var(--muted)",
                                }}
                              >
                                {u.role}
                              </span>
                            </td>
                            <td className="py-3 px-2">
                              <span
                                className={`font-semibold ${u.active ? "text-green-500" : "text-red-500"}`}
                              >
                                {u.active ? "Yes" : "No"}
                              </span>
                            </td>
                            <td className="py-3 pl-2 text-right opacity-80">
                              {new Date(u.createdAt).toLocaleDateString()}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

          </div>
        )}

      </div>
    </>
  );
}
