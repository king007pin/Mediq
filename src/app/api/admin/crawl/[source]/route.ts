import { db } from "@/db";
import { sourceFeeds } from "@/db/schema";
import { persistSource } from "@/lib/ingest-pipeline";
import { CRAWLERS } from "@/lib/crawl-registry";
import { requireRole } from "@/lib/auth-guard";
import { rateLimit, RL_CRAWL } from "@/lib/rate-limit";
import { eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function getOrCreateCrawlFeed(crawlerName: string, crawlerUrl: string, crawlerIntervalHours: number) {
  const existing = await db
    .select()
    .from(sourceFeeds)
    .where(eq(sourceFeeds.name, crawlerName));
  if (existing[0]) return existing[0];

  const [created] = await db
    .insert(sourceFeeds)
    .values({
      name: crawlerName,
      type: "website",
      url: crawlerUrl,
      query: "0", // reused as offset tracker
      maxItems: 20,
      intervalHours: crawlerIntervalHours,
      enabled: true,
    })
    .returning();
  return created;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ source: string }> },
) {
  const auth = await requireRole(req, ["admin"]);
  if (auth instanceof NextResponse) return auth;
  const { source } = await params;
  const crawler = CRAWLERS[source];
  if (!crawler) {
    return NextResponse.json({ error: `Unknown crawler: ${source}` }, { status: 404 });
  }

  const feed = await db
    .select()
    .from(sourceFeeds)
    .where(eq(sourceFeeds.name, crawler.name));

  const offset = Number(feed[0]?.query ?? "0");
  return NextResponse.json(
    {
      exists: !!feed[0],
      offset,
      lastFetchedAt: feed[0]?.lastFetchedAt ?? null,
      lastFetchCount: feed[0]?.lastFetchCount ?? 0,
      errorCount: feed[0]?.errorCount ?? 0,
      lastError: feed[0]?.lastError ?? null,
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ source: string }> },
) {
  const auth = await requireRole(req, ["admin"]);
  if (auth instanceof NextResponse) return auth;
  const { source } = await params;
  const crawler = CRAWLERS[source];
  if (!crawler) {
    return NextResponse.json({ error: `Unknown crawler: ${source}` }, { status: 404 });
  }
  const rl = rateLimit(req, { ...RL_CRAWL, bucket: `crawl:${source}` });
  if (rl) {
    // Persist for status reload — frontend `lastError` red-text shows it after refresh.
    // No-op if the feed row was never created (first-ever rate-limited request).
    // Swallow + log on DB failure; the 429 response itself must always reach the client.
    try {
      await db
        .update(sourceFeeds)
        .set({ lastError: "Rate-limited — wait a few minutes before retrying." })
        .where(eq(sourceFeeds.name, crawler.name));
    } catch (err) {
      console.warn(`[crawl/${source}] failed to persist rate-limit lastError:`, (err as Error).message);
    }
    return rl;
  }

  const body = await req.json().catch(() => ({})) as {
    batchSize?: number;
    reset?: boolean;
  };
  const { batchSize = crawler.batchSize, reset = false } = body;

  const feed = await getOrCreateCrawlFeed(
    crawler.name,
    `https://placeholder/${crawler.id}`,
    crawler.intervalHours,
  );

  if (reset) {
    await db
      .update(sourceFeeds)
      .set({ query: "0", lastFetchCount: 0, errorCount: 0, lastError: null })
      .where(eq(sourceFeeds.id, feed.id));
    return NextResponse.json({ ok: true, message: "Reset to offset 0" });
  }

  // W20: tx-A — acquire row lock + read offset atomically. SKIP LOCKED
  // means a concurrent cron firing for the same feed bails immediately
  // instead of dup-ingesting from the same offset.
  const locked = await db.transaction(async (tx) => {
    const r = await tx.execute(sql`
      SELECT id, query, last_fetch_count, error_count
      FROM source_feeds
      WHERE id = ${feed.id}
      FOR UPDATE SKIP LOCKED
    `);
    const row = (r.rows ?? [])[0] as
      | { id: number; query: string | null; last_fetch_count: number | null; error_count: number | null }
      | undefined;
    if (!row) return null;
    return {
      offset: Number(row.query ?? "0"),
      lastFetchCount: row.last_fetch_count ?? 0,
      errorCount: row.error_count ?? 0,
    };
  });

  if (!locked) {
    return NextResponse.json(
      { ok: false, skipped: true, reason: "Another crawl is already running for this feed" },
      { status: 409 },
    );
  }

  const offset = locked.offset;

  // Fetch the full article URL list (OUTSIDE tx — do not hold lock across HTTP)
  let allUrls: string[];
  try {
    allUrls = await crawler.fetchUrls();
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch URL list for ${crawler.name}: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  if (!allUrls.length) {
    return NextResponse.json(
      { error: `No article URLs found for ${crawler.name}` },
      { status: 500 },
    );
  }

  const batch = allUrls.slice(offset, offset + batchSize);
  const done = offset + batchSize >= allUrls.length;

  let ingested = 0;
  let skipped = 0;
  let errors = 0;
  let lastErrMsg: string | null = null;

  for (const url of batch) {
    let article: Awaited<ReturnType<typeof crawler.fetchArticle>>;
    try {
      article = await crawler.fetchArticle(url);
    } catch (err) {
      errors++;
      lastErrMsg = (err as Error).message ?? String(err);
      console.error(`[crawl/${source}] fetchArticle failed for ${url}: ${lastErrMsg}`);
      continue;
    }
    if (!article || article.content.length < 100) {
      skipped++;
      continue;
    }
    try {
      await persistSource({
        kind: "website",
        rawText: article.content,
        url: article.url,
        title: article.title,
        description: article.description ?? crawler.description,
      });
      ingested++;
    } catch (err) {
      errors++;
      lastErrMsg = (err as Error).message ?? String(err);
      console.error(`[crawl/${source}] persistSource failed for ${url}: ${lastErrMsg}`);
    }
  }

  const nextOffset = done ? 0 : offset + batchSize;
  // tx-B: write-back offset/counters in a short tx. No lock needed —
  // tx-A already serialized us; updatedAt-style CAS is implicit via the
  // SKIP LOCKED gate above.
  await db.transaction(async (tx) => {
    await tx
      .update(sourceFeeds)
      .set({
        query: String(nextOffset),
        lastFetchedAt: new Date(),
        lastFetchCount: locked.lastFetchCount + ingested,
        errorCount: locked.errorCount + errors,
        lastError: errors > 0
          ? `${errors} article(s) failed in last batch — ${lastErrMsg ?? "unknown error"}`
          : null,
      })
      .where(eq(sourceFeeds.id, feed.id));
  });

  return NextResponse.json({
    ok: true,
    ingested,
    skipped,
    errors,
    offset,
    nextOffset,
    totalUrls: allUrls.length,
    done,
    progress: `${Math.min(offset + batchSize, allUrls.length)} / ${allUrls.length}`,
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ source: string }> },
) {
  const auth = await requireRole(req, ["admin"]);
  if (auth instanceof NextResponse) return auth;
  const { source } = await params;
  const crawler = CRAWLERS[source];
  if (!crawler) {
    return NextResponse.json({ error: `Unknown crawler: ${source}` }, { status: 404 });
  }

  await db
    .update(sourceFeeds)
    .set({ query: "0", lastFetchCount: 0 })
    .where(eq(sourceFeeds.name, crawler.name));

  return NextResponse.json({ ok: true, message: "Crawl progress reset" });
}
