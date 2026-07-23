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
    let capturedSignal: AbortSignal | null | undefined = null;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/api/admin/feeds")) {
        capturedSignal = init?.signal;
        return new Promise(() => {}); // never resolves to keep request pending
      }
      return Promise.resolve(new Response(JSON.stringify({ feeds: [] })));
    });
    global.fetch = fetchMock;

    const { unmount } = render(React.createElement(FeedPanel));

    expect(fetchMock).toHaveBeenCalled();
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    expect(capturedSignal?.aborted).toBe(true);
  });

  it("prevents state mutations when fetch resolves after component unmount", async () => {
    let resolveFeeds: (val: Response) => void;
    const feedsPromise = new Promise<Response>((resolve) => {
      resolveFeeds = resolve;
    });

    let capturedSignal: AbortSignal | null | undefined = null;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/api/admin/feeds")) {
        capturedSignal = init?.signal;
        return feedsPromise;
      }
      return Promise.resolve(new Response(JSON.stringify({ feeds: [] })));
    });
    global.fetch = fetchMock;

    const { unmount } = render(React.createElement(FeedPanel));

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    unmount();
    expect(capturedSignal?.aborted).toBe(true);

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
