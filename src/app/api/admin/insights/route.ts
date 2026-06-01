import { db } from "@/db";
import { knowledgeGaps, querySessions } from "@/db/schema";
import { getLearningStats } from "@/lib/session-learning";
import { requireRole } from "@/lib/auth-guard";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, ["admin"]);
  if (auth instanceof NextResponse) return auth;
  const page = Number(req.nextUrl.searchParams.get("page")) || 1;
  const stats = await getLearningStats(page);
  return NextResponse.json(stats);
}

export async function DELETE(req: NextRequest) {
  const auth = await requireRole(req, ["admin"]);
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => ({})) as { type?: string; id?: unknown };
  if (body.type === "sessions") {
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    await db.delete(querySessions).where(eq(querySessions.id, id));
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "type required" }, { status: 400 });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireRole(req, ["admin"]);
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => ({})) as { action?: string; confirm?: unknown };
  if (body.action === "resolve-all-gaps") {
    if (body.confirm !== true) {
      return NextResponse.json({ error: "confirm:true required for mass-resolve" }, { status: 400 });
    }
    await db.update(knowledgeGaps).set({ resolved: true, resolvedAt: new Date() }).where(eq(knowledgeGaps.resolved, false));
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "action required" }, { status: 400 });
}
