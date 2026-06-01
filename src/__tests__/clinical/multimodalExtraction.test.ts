import { describe, expect, it, vi, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { POST as extractPOST } from "@/app/api/lab-extract/route";

const originalFetch = global.fetch;

afterAll(() => {
  global.fetch = originalFetch;
});

// Mock dependencies to run in isolation
vi.mock("@/lib/auth-guard", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    userId: "user-123",
    sessionId: "session-123",
    role: "clinician",
  }),
}));

vi.mock("@/lib/rag", () => ({
  textFromPdfBuffer: vi.fn().mockResolvedValue("Mocked PDF extracted text"),
}));

vi.mock("@/lib/nvidia", () => ({
  ocrImages: vi.fn().mockImplementation(async (images) => {
    return images.map((img: any) => `Extracted text from ${img.mimeType} image`);
  }),
}));

vi.mock("heic-convert", () => {
  return {
    default: vi.fn().mockResolvedValue(Buffer.from("converted-jpeg-bytes")),
  };
});

vi.mock("mammoth", () => {
  return {
    extractRawText: vi.fn().mockResolvedValue({ value: "Extracted text from docx file via Mammoth" }),
  };
});

describe("Multimodal Extraction Pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })) as any;
  });

  it("handles standard PNG images and routes to OCR", async () => {
    const file = new File([Buffer.from("png-bytes")], "report.png", { type: "image/png" });
    const formData = new FormData();
    formData.append("file", file);

    const req = new NextRequest("http://localhost/api/lab-extract", {
      method: "POST",
      body: formData,
    });

    const res = await extractPOST(req);
    expect(res.status).toBe(200);

    const data = await res.json() as any;
    expect(data.text).toContain("Extracted text from image/png image");
  });

  it("handles TIFF images and routes to OCR", async () => {
    const file = new File([Buffer.from("tiff-bytes")], "scan.tiff", { type: "image/tiff" });
    const formData = new FormData();
    formData.append("file", file);

    const req = new NextRequest("http://localhost/api/lab-extract", {
      method: "POST",
      body: formData,
    });

    const res = await extractPOST(req);
    expect(res.status).toBe(200);

    const data = await res.json() as any;
    expect(data.text).toContain("Extracted text from image/tiff image");
  });

  it("handles BMP images and routes to OCR", async () => {
    const file = new File([Buffer.from("bmp-bytes")], "graph.bmp", { type: "image/bmp" });
    const formData = new FormData();
    formData.append("file", file);

    const req = new NextRequest("http://localhost/api/lab-extract", {
      method: "POST",
      body: formData,
    });

    const res = await extractPOST(req);
    expect(res.status).toBe(200);

    const data = await res.json() as any;
    expect(data.text).toContain("Extracted text from image/bmp image");
  });

  it("handles HEIC files by converting them to JPEG first", async () => {
    // HEIC magic bytes signature: buffer[4..8] is "ftyp", brand buffer[8..12] is "heic"
    const heicBytes = Buffer.alloc(20);
    heicBytes.write("ftyp", 4, "ascii");
    heicBytes.write("heic", 8, "ascii");

    const file = new File([heicBytes], "iphone_scan.heic", { type: "image/heic" });
    const formData = new FormData();
    formData.append("file", file);

    const req = new NextRequest("http://localhost/api/lab-extract", {
      method: "POST",
      body: formData,
    });

    const res = await extractPOST(req);
    expect(res.status).toBe(200);

    const data = await res.json() as any;
    // It should convert HEIC to image/jpeg, so OCR receives image/jpeg
    expect(data.text).toContain("Extracted text from image/jpeg image");
  });

  it("extracts text from Word documents (.docx)", async () => {
    // DOCX signature: starts with PK zip magic bytes (50 4B 03 04)
    const docxBytes = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0]);
    const file = new File([docxBytes], "lab_report.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    
    const formData = new FormData();
    formData.append("file", file);

    const req = new NextRequest("http://localhost/api/lab-extract", {
      method: "POST",
      body: formData,
    });

    const res = await extractPOST(req);
    expect(res.status).toBe(200);

    const data = await res.json() as any;
    expect(data.text).toContain("Extracted text from docx file via Mammoth");
  });

  it("extracts text from legacy Word documents (.doc)", async () => {
    // Legacy .doc file uses custom extraction logic. Let's write printable characters
    const docBytes = Buffer.from("Clinical Report: Patient John Doe - Blood Sugar normal");
    const file = new File([docBytes], "old_report.doc", { type: "application/msword" });

    const formData = new FormData();
    formData.append("file", file);

    const req = new NextRequest("http://localhost/api/lab-extract", {
      method: "POST",
      body: formData,
    });

    const res = await extractPOST(req);
    expect(res.status).toBe(200);

    const data = await res.json() as any;
    expect(data.text).toContain("Clinical Report: Patient [NAME] - Blood Sugar normal");
  });

  it("uses magic bytes detection when filename has no extension and MIME is missing/generic", async () => {
    // PNG file but filename has no extension and generic octet-stream MIME type
    const pngBytes = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]);
    const file = new File([pngBytes], "Screenshot 2026-06-01 at 11.19.16 PM", { type: "application/octet-stream" });

    const formData = new FormData();
    formData.append("file", file);

    const req = new NextRequest("http://localhost/api/lab-extract", {
      method: "POST",
      body: formData,
    });

    const res = await extractPOST(req);
    expect(res.status).toBe(200);

    const data = await res.json() as any;
    // Magic bytes should detect image/png, and route to OCR
    expect(data.text).toContain("Extracted text from image/png image");
  });
});
