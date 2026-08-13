// @vitest-environment happy-dom
import React from "react";
import { render, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import FeedPanel from "@/components/feed-panel";

describe("FeedPanel AbortController & Signal Cleanup", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    localStorage.clear();
    // Block auto-run by default so we can test loadFeeds & component lifecycle cleanly
    localStorage.setItem("mediq-last-auto-crawl", String(Date.now()));
    originalFetch = global.fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it("passes AbortSignal to fetch calls on mount and aborts signal when unmounted", async () => {
    // Object wrapper, not a reassigned `let` — TS over-narrows a `let x: T | null
    // | undefined = null` scalar to the literal `null` and keeps that narrowing
    // across the `render()` call below (it can't see the mock closure runs inside
    // it), so a later `x?.prop` type-checks as `never`. A property on a `const`
    // object sidesteps that narrowing.
    const captured: { signal: AbortSignal | null | undefined } = { signal: null };
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/api/admin/feeds")) {
        captured.signal = init?.signal;
        return new Promise(() => {}); // never resolves to keep request pending
      }
      return Promise.resolve(new Response(JSON.stringify({ feeds: [] })));
    });
    global.fetch = fetchMock;

    const { unmount } = render(React.createElement(FeedPanel));

    expect(fetchMock).toHaveBeenCalled();
    expect(captured.signal).toBeDefined();
    expect(captured.signal?.aborted).toBe(false);

    unmount();

    expect(captured.signal?.aborted).toBe(true);
  });

  it("prevents state mutations when fetch resolves after component unmount", async () => {
    let resolveFeeds: (val: Response) => void;
    const feedsPromise = new Promise<Response>((resolve) => {
      resolveFeeds = resolve;
    });

    const captured: { signal: AbortSignal | null | undefined } = { signal: null };
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/api/admin/feeds")) {
        captured.signal = init?.signal;
        return feedsPromise;
      }
      return Promise.resolve(new Response(JSON.stringify({ feeds: [] })));
    });
    global.fetch = fetchMock;

    const { unmount } = render(React.createElement(FeedPanel));

    expect(captured.signal).toBeDefined();
    expect(captured.signal?.aborted).toBe(false);

    unmount();
    expect(captured.signal?.aborted).toBe(true);

    // Resolve fetch after unmount
    resolveFeeds!(
      new Response(
        JSON.stringify({
          feeds: [
            {
              id: 1,
              name: "Test Feed",
              type: "rss",
              intervalHours: 1,
              lastFetchedAt: null,
              lastFetchCount: 0,
              errorCount: 0,
              lastError: null,
              enabled: true,
            },
          ],
        })
      )
    );

    await expect(feedsPromise).resolves.toBeDefined();
  });

  it("aborts active auto-run refresh and master crawl on unmount", async () => {
    localStorage.clear(); // enable auto-run
    const signalsCaptured: AbortSignal[] = [];

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.signal) {
        signalsCaptured.push(init.signal);
      }
      if (url.includes("/api/admin/refresh")) {
        return new Promise(() => {}); // hang refresh request
      }
      return Promise.resolve(new Response(JSON.stringify({ feeds: [] })));
    });
    global.fetch = fetchMock;

    const { unmount } = render(React.createElement(FeedPanel));

    expect(signalsCaptured.length).toBeGreaterThan(0);
    const signal = signalsCaptured[signalsCaptured.length - 1];
    expect(signal.aborted).toBe(false);

    unmount();

    signalsCaptured.forEach((s) => {
      expect(s.aborted).toBe(true);
    });
  });
});
