import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/provider/test/route";
import { callProvider } from "@/lib/providerRegistry";

vi.mock("@/lib/auth-guard", () => ({
  requireRole: vi.fn().mockResolvedValue({ userId: "admin-user", role: "admin" }),
}));

vi.mock("@/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { providerId: "openai", encryptedData: "encrypted_key", customBaseUrl: null },
        ]),
      }),
    }),
  },
}));

vi.mock("@/lib/secretVault", () => ({
  decrypt: vi.fn().mockReturnValue("decrypted-api-key"),
}));

vi.mock("@/lib/providerRegistry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/providerRegistry")>();
  return {
    ...actual,
    callProvider: vi.fn(),
  };
});

describe("POST /api/provider/test - Status Codes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns HTTP 502 (or non-200) when provider test fails without explicit status", async () => {
    vi.mocked(callProvider).mockRejectedValue(new Error("Connection refused"));

    const req = new NextRequest("http://localhost/api/provider/test", {
      method: "POST",
      body: JSON.stringify({ providerId: "openai" }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(res.status).not.toBe(200);
    expect(data.ok).toBe(false);
    expect(data.error).toBe("Connection refused");
  });

  it("returns explicit error status code when e.status is present (e.g. 500 or 502)", async () => {
    const errorWithStatus = new Error("Upstream Timeout") as Error & { status?: number };
    errorWithStatus.status = 504;
    vi.mocked(callProvider).mockRejectedValue(errorWithStatus);

    const req = new NextRequest("http://localhost/api/provider/test", {
      method: "POST",
      body: JSON.stringify({ providerId: "openai" }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(504);
    expect(res.status).not.toBe(200);
    expect(data.ok).toBe(false);
    expect(data.error).toBe("Upstream Timeout");
  });
});
