import { runModelHealthSweep } from "@/lib/model-health";
import { requireCron } from "@/lib/auth-guard";
import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const auth = await requireCron(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const result = await runModelHealthSweep();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    logger.error("model health sweep failed", err);
    return NextResponse.json(
      { ok: false, error: "sweep failed" },
      { status: 500 },
    );
  }
}
