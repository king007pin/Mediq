import { describe, expect, it, vi, beforeEach } from "vitest";
import { extractTextFromImage } from "../../lib/nvidia";

const OCR_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";

function ocrOk(text: string) {
  return {
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: text,
          },
        },
      ],
    }),
  } as Response;
}

describe("extractTextFromImage — Llama 3.2 11B Vision (Multimodal)", () => {
  beforeEach(() => {
    vi.stubEnv("NVIDIA_API_KEY", "mock-nvidia-key");
    vi.restoreAllMocks();
  });

  it("posts an inline base64 image to the Vision chat completions endpoint and returns text", async () => {
    const mockImageBuffer = Buffer.from("fake-image-data-bytes");
    const mimeType = "image/png";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      ocrOk("Hemoglobin 14.2 g/dL\nCreatinine 0.9 mg/dL")
    );

    const result = await extractTextFromImage(mockImageBuffer, mimeType);

    expect(result).toBe("Hemoglobin 14.2 g/dL\nCreatinine 0.9 mg/dL");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [callUrl, callInit] = fetchSpy.mock.calls[0];
    expect(callUrl).toBe(OCR_ENDPOINT);

    const body = JSON.parse(callInit?.body as string);
    expect(body.model).toBe("meta/llama-3.2-11b-vision-instruct");
    expect(body.messages[0].content[0].type).toBe("text");
    expect(body.messages[0].content[1].type).toBe("image_url");
    expect(body.messages[0].content[1].image_url.url).toContain("data:image/png;base64,");
    expect(body.messages[0].content[1].image_url.url).toContain(mockImageBuffer.toString("base64"));
  });

  it("retries transient failures with key rotation", async () => {
    const mockImageBuffer = Buffer.from("fake-image-data-bytes");

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => "Rate limit exceeded" } as Response)
      .mockResolvedValueOnce(ocrOk("Sepsis noted on summary"));

    const result = await extractTextFromImage(mockImageBuffer, "image/jpeg");

    expect(result).toBe("Sepsis noted on summary");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toBe(OCR_ENDPOINT);
    expect(fetchSpy.mock.calls[1][0]).toBe(OCR_ENDPOINT);
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string).model).toBe("meta/llama-3.2-11b-vision-instruct");
  });

  it("throws when OCR fails persistently", async () => {
    const mockImageBuffer = Buffer.from("fake-image-data-bytes");

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal server error",
    } as Response);

    await expect(extractTextFromImage(mockImageBuffer, "image/png")).rejects.toThrow(/OCR.*failed/);
  });
});
