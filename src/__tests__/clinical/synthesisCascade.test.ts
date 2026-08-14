import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/nvidia", () => ({
  hasNvidiaKey: vi.fn(() => true),
  nvidiaChat: vi.fn(),
  nvidiaChatStream: vi.fn(),
}));

vi.mock("@/lib/swarm/ruflo-client", () => ({
  callRufloApi: vi.fn(async () => null),
}));

import { runSynthesisAgent } from "@/lib/swarm/agent-runner";
import { nvidiaChat, nvidiaChatStream } from "@/lib/nvidia";

const chatMock = nvidiaChat as unknown as Mock;
const streamMock = nvidiaChatStream as unknown as Mock;

describe("runSynthesisAgent multi-model fallback cascade", () => {
  beforeEach(() => {
    chatMock.mockReset();
    streamMock.mockReset();
  });

  it("succeeds on primary model when primary call works", async () => {
    chatMock.mockResolvedValueOnce("PRIMARY SYNTHESIS REPORT");

    const result = await runSynthesisAgent(
      "meta/llama-3.3-70b-instruct",
      "q",
      "ctx",
      [],
      [],
      [],
    );

    expect(result).toBe("PRIMARY SYNTHESIS REPORT");
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(chatMock.mock.calls[0][0]).toBe("meta/llama-3.3-70b-instruct");
  });

  it("cascades to meta/llama-3.1-70b-instruct when primary model fails", async () => {
    chatMock
      .mockRejectedValueOnce(new Error("Primary 70B unavailable"))
      .mockResolvedValueOnce("SECONDARY SYNTHESIS REPORT");

    const result = await runSynthesisAgent(
      "meta/llama-3.3-70b-instruct",
      "q",
      "ctx",
      [],
      [],
      [],
    );

    expect(result).toBe("SECONDARY SYNTHESIS REPORT");
    expect(chatMock).toHaveBeenCalledTimes(2);
    expect(chatMock.mock.calls[0][0]).toBe("meta/llama-3.3-70b-instruct");
    expect(chatMock.mock.calls[1][0]).toBe("meta/llama-3.1-70b-instruct");
  });

  it("cascades to nvidia/nemotron-3-super-120b-a12b when primary and secondary models fail", async () => {
    chatMock
      .mockRejectedValueOnce(new Error("Primary failed"))
      .mockRejectedValueOnce(new Error("Secondary failed"))
      .mockResolvedValueOnce("TERTIARY SYNTHESIS REPORT");

    const result = await runSynthesisAgent(
      "meta/llama-3.3-70b-instruct",
      "q",
      "ctx",
      [],
      [],
      [],
    );

    expect(result).toBe("TERTIARY SYNTHESIS REPORT");
    expect(chatMock).toHaveBeenCalledTimes(3);
    expect(chatMock.mock.calls[0][0]).toBe("meta/llama-3.3-70b-instruct");
    expect(chatMock.mock.calls[1][0]).toBe("meta/llama-3.1-70b-instruct");
    expect(chatMock.mock.calls[2][0]).toBe("nvidia/nemotron-3-super-120b-a12b");
  });

  it("falls back to buildLocalSynthesis when all NIM models fail", async () => {
    chatMock
      .mockRejectedValueOnce(new Error("Primary failed"))
      .mockRejectedValueOnce(new Error("Secondary failed"))
      .mockRejectedValueOnce(new Error("Tertiary failed"));

    const result = await runSynthesisAgent(
      "meta/llama-3.3-70b-instruct",
      "q",
      "ctx",
      [],
      [],
      [],
    );

    expect(result).toContain("CLINICAL SUMMARY");
    expect(chatMock).toHaveBeenCalledTimes(3);
  });
});
