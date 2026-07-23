import Link from "next/link";
import ThemeToggle from "@/components/theme-toggle";
import AdminUsersManager from "@/components/admin-users-manager";

export const dynamic = "force-dynamic";

export default function AdminUsersPage() {
  return (
    <main
      className="min-h-screen"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      <div className="mx-auto max-w-5xl px-4 py-6 space-y-6 sm:px-6 sm:py-10">
        <div className="flex w-full items-center justify-between gap-4">
          <Link
            href="/"
            className="rounded-full border px-4 py-2 text-xs font-semibold hover:opacity-80 transition-opacity"
            style={{
              borderColor: "var(--card-border)",
              color: "var(--text)",
              backgroundColor: "var(--card)",
            }}
          >
            ← Back to Dashboard
          </Link>
          <ThemeToggle />
        </div>
        <header className="space-y-1">
          <p
            className="text-[11px] uppercase tracking-[0.28em]"
            style={{ color: "var(--accent)" }}
          >
            Admin
          </p>
          <h1 className="text-2xl font-semibold">User invitations</h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Create clinician or viewer accounts. The generated password is shown
            once — copy it before navigating away.
          </p>
        </header>

        <AdminUsersManager />
      </div>
    </main>
  );
}
