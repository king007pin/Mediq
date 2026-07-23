import Link from "next/link";
import ThemeToggle from "@/components/theme-toggle";
import LogoutButton from "@/components/logout-button";
import AdminDashboard from "@/components/admin-dashboard";

export const dynamic = "force-dynamic";

export default function AdminDashboardPage() {
  return (
    <main
      className="min-h-screen"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      <div className="mx-auto max-w-6xl px-4 py-6 space-y-8 sm:px-6 sm:py-10">
        
        {/* Header navigation bar */}
        <div className="flex w-full items-center justify-between gap-4">
          <Link
            href="/"
            className="rounded-full border px-4 py-2 text-xs font-semibold hover:opacity-80 transition-opacity active:scale-[0.98]"
            style={{
              borderColor: "var(--card-border)",
              color: "var(--text)",
              backgroundColor: "var(--card)",
            }}
          >
            ← Back to Dashboard
          </Link>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <LogoutButton />
          </div>
        </div>

        {/* Dashboard Title Hero */}
        <header className="space-y-2">
          <div
            className="inline-flex items-center gap-2 rounded-full border px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.32em]"
            style={{
              borderColor: "var(--accent)",
              color: "var(--accent)",
              backgroundColor: "color-mix(in srgb, var(--accent) 8%, transparent)",
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: "var(--accent)", boxShadow: "0 0 6px var(--accent)" }}
            />
            Clinical Mission Control
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Admin Dashboard</h1>
          <p className="text-sm max-w-2xl" style={{ color: "var(--muted)" }}>
            Central administration command center. Configure medical swarm API keys, monitor diagnostic complexity routing, audit knowledge feed crawlers, and manage user accounts.
          </p>
        </header>

        {/* Interactive Dashboard Content */}
        <AdminDashboard />

      </div>
    </main>
  );
}
