import { runAdvisorPass } from "@/lib/model-health-advisor";
import { requireAuth } from "@/lib/auth-guard";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const advice = await runAdvisorPass();
  return NextResponse.json({ ok: true, advice });
}
