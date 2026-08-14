import { createHash } from "crypto";
import { or, eq } from "drizzle-orm";
import { dbCorpus } from "@/db";
import { embeddings, sources } from "@/db/schema";
import { chunkText, embedBatch } from "./rag";

export type IngestKind = "pdf" | "youtube" | "website" | "text" | "rss";

export function sanitizeTextForPostgres(text: string): string {
  return text.replace(/\u0000/g, "");
}

function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

export async function persistSource({
  kind,
  rawText: rawTextInput,
  url,
  title,
  description,
}: {
  kind: IngestKind;
  rawText: string;
  url?: string;
  title?: string | null;
  description?: string | null;
}): Promise<{ sourceId: number; chunkCount: number; duplicate?: boolean }> {
  const rawText = sanitizeTextForPostgres(rawTextInput);

  const urlHash = url ? sha256(url) : undefined;
  const contentHash = sha256(rawText);

  const conditions = [eq(sources.contentHash, contentHash)];
  if (urlHash) conditions.push(eq(sources.urlHash, urlHash));

  const [existing] = await dbCorpus
    .select({ id: sources.id })
    .from(sources)
    .where(or(...conditions))
    .limit(1);
  if (existing) return { sourceId: existing.id, chunkCount: 0, duplicate: true };

  const chunks = chunkText(rawText);
  if (!chunks.length) throw new Error("No content to persist");

  const vectors = await embedBatch(chunks, "passage");

  const source = await dbCorpus.transaction(async (tx) => {
    const [created] = await tx
      .insert(sources)
      .values({
        title: title ?? deriveTitle(kind, url, rawText),
        type: kind === "rss" ? "website" : kind,
        url,
        description,
        urlHash,
        contentHash,
      })
      .returning();

    const BATCH_SIZE = 50;
    const allEmbeddings = chunks.map((chunk, idx) => ({
      sourceId: created.id,
      chunk,
      position: idx,
      embedding: vectors[idx],
    }));

    for (let i = 0; i < allEmbeddings.length; i += BATCH_SIZE) {
      const batch = allEmbeddings.slice(i, i + BATCH_SIZE);
      await tx.insert(embeddings).values(batch);
    }

    return created;
  });

  return { sourceId: source.id, chunkCount: chunks.length };
}

export function deriveTitle(kind: string, url?: string | null, fallback?: string): string {
  if (url) {
    try {
      return `${kind.toUpperCase()} · ${new URL(url).hostname}`;
    } catch {
      return `${kind.toUpperCase()} · ${url.slice(0, 60)}`;
    }
  }
  return `${kind.toUpperCase()} · ${fallback?.slice(0, 40) ?? "Untitled"}`;
}
