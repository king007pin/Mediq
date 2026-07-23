import { db } from "@/db";
import { providerCredentials } from "@/db/schema";
import { decrypt } from "@/lib/secretVault";
import { PROVIDERS, callProvider, resolveProvider } from "@/lib/providerRegistry";
import { requireRole } from "@/lib/auth-guard";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ providerId: z.string().min(1) });

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ["admin"]);
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const { providerId } = parsed.data;

  const [cred] = await db
    .select()
    .from(providerCredentials)
    .where(eq(providerCredentials.providerId, providerId));

  if (!cred) return NextResponse.json({ error: "Provider not configured" }, { status: 404 });

  const provider = PROVIDERS[providerId];
  if (!provider) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });

  const effectiveProvider = resolveProvider(provider, cred.customBaseUrl);

  let apiKey: string;
  try {
    apiKey = decrypt(cred.encryptedData);
  } catch {
    return NextResponse.json({ error: "Key decryption failed" }, { status: 500 });
  }

  const model = provider.defaultModels[0];
  if (!model) return NextResponse.json({ error: "No default model" }, { status: 400 });

  const start = Date.now();
  try {
    const reply = await callProvider(
      effectiveProvider,
      apiKey,
      model,
      [{ role: "user", content: "Reply with exactly: ok" }],
      15_000,
    );
    return NextResponse.json({ ok: true, latencyMs: Date.now() - start, model, snippet: reply.slice(0, 80) });
  } catch (err) {
    const e = err as Error & { status?: number };
    return NextResponse.json({ ok: false, latencyMs: Date.now() - start, error: e.message, status: e.status }, { status: e.status ?? 502 });
  }
}
