import { describe, expect, it, vi, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { POST as extractPOST } from "@/app/api/lab-extract/route";
import { parseDicomHeader } from "@/lib/dicom";
import { buildDebateSystemPrompt, buildSynthesisSystemPrompt } from "@/lib/swarm/agent-runner";

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
    extractRawText: vi.fn().mockResolvedValue({ value: "Extracted text from docx file" }),
  };
});

vi.mock("jszip", () => {
  const mockFile = vi.fn().mockImplementation((name) => {
    return {
      async: vi.fn().mockResolvedValue(Buffer.from(`Extracted data for ${name}`)),
    };
  });

  return {
    default: {
      loadAsync: vi.fn().mockResolvedValue({
        files: {
          "file1.txt": { dir: false, async: vi.fn().mockResolvedValue(Buffer.from("Text content from ZIP")) },
          "nested/file2.pdf": { dir: false, async: vi.fn().mockResolvedValue(Buffer.from([0x25, 0x50, 0x44, 0x46, 0, 0])) }, // PDF magic
          "__MACOSX/stray": { dir: false, async: vi.fn() }, // should be ignored
        },
      }),
    },
  };
});

describe("Swarm Ingestion Upgrade — ZIP & DICOM Pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })) as any;
  });

  it("extracts and processes ZIP file content in parallel", async () => {
    // ZIP magic bytes signature: starts with PK zip magic bytes (50 4B 03 04)
    const zipBytes = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0]);
    const file = new File([zipBytes], "scan_reports.zip", { type: "application/zip" });
    
    const formData = new FormData();
    formData.append("file", file);

    const req = new NextRequest("http://localhost/api/lab-extract", {
      method: "POST",
      body: formData,
    });

    const res = await extractPOST(req);
    expect(res.status).toBe(200);

    const data = await res.json() as any;
    // Magic bytes and ZIP extraction should yield file1.txt (Text) and file2.pdf (PDF)
    expect(data.text).toContain("--- FILE: file1.txt ---");
    expect(data.text).toContain("Text content from ZIP");
    expect(data.text).toContain("--- FILE: nested/file2.pdf ---");
    expect(data.text).toContain("Mocked PDF extracted text");
  });

  it("parses valid DICOM file metadata and extracts standard clinical tags", () => {
    // Construct a valid mock DICOM buffer
    const buffer = Buffer.alloc(300);
    // Write "DICM" signature at offset 128
    buffer.write("DICM", 128, "ascii");

    // Helper to write an Explicit VR Element (Little-Endian)
    // Tag: 0010,0010 (Patient Name)
    let offset = 132;
    buffer.writeUInt16LE(0x0010, offset); // Group
    buffer.writeUInt16LE(0x0010, offset + 2); // Element
    buffer.write("PN", offset + 4, "ascii"); // VR
    buffer.writeUInt16LE(8, offset + 6); // Length
    buffer.write("DOE^JOHN", offset + 8, "ascii"); // Value

    // Tag: 0008,0060 (Modality)
    offset = 148;
    buffer.writeUInt16LE(0x0008, offset); // Group
    buffer.writeUInt16LE(0x0060, offset + 2); // Element
    buffer.write("CS", offset + 4, "ascii"); // VR
    buffer.writeUInt16LE(2, offset + 6); // Length
    buffer.write("MR", offset + 8, "ascii"); // Value

    const meta = parseDicomHeader(buffer);
    expect(meta.patientName).toBe("DOE JOHN");
    expect(meta.modality).toBe("MR");
  });

  it("API extract route successfully identifies and parses uploaded .dcm files", async () => {
    // DICOM signature at offset 128 is "DICM"
    const dicomBytes = Buffer.alloc(200);
    dicomBytes.write("DICM", 128, "ascii");
    // Patient Name tag: 0010,0010
    dicomBytes.writeUInt16LE(0x0010, 132);
    dicomBytes.writeUInt16LE(0x0010, 134);
    dicomBytes.write("PN", 136, "ascii");
    dicomBytes.writeUInt16LE(12, 138);
    dicomBytes.write("PATIENT^TEST", 140, "ascii");

    const file = new File([dicomBytes], "brain_mri.dcm", { type: "application/dicom" });
    const formData = new FormData();
    formData.append("file", file);

    const req = new NextRequest("http://localhost/api/lab-extract", {
      method: "POST",
      body: formData,
    });

    const res = await extractPOST(req);
    expect(res.status).toBe(200);

    const data = await res.json() as any;
    expect(data.text).toContain("Patient [NAME]");
  });
});
describe("Swarm Specialization Upgrades — Debate & Synthesis Prompts", () => {
  it("debate system prompt contains Red Flag Urgency and Skeptic Safety Review overlays", () => {
    const specialty = {
      id: "cardiac_care",
      role: "Cardiologist",
      focus: "coronary diagnostics",
      keywords: [],
      foundations: [],
      rulesets: []
    } as any;
    const prompt = buildDebateSystemPrompt(specialty);

    expect(prompt).toContain("Red Flag Urgency Analyst");
    expect(prompt).toContain("Skeptic Safety Reviewer");
  });

  it("synthesis prompt strictly enforces the 13-section clinical document layout", () => {
    const prompt = buildSynthesisSystemPrompt(5);

    expect(prompt).toContain("MANDATORY 13-SECTION OUTPUT FORMAT");
    expect(prompt).toContain("## • CLINICAL SUMMARY");
    expect(prompt).toContain("## • DIFFERENTIAL DIAGNOSIS");
    expect(prompt).toContain("## • MOST LIKELY DIAGNOSIS");
    expect(prompt).toContain("## • DEBATE SUMMARY");
    expect(prompt).toContain("## • IMMEDIATE NEXT STEPS");
    expect(prompt).toContain("## • TREATMENT APPROACH");
    expect(prompt).toContain("## • FIRST-LINE PHARMACOTHERAPY");
    expect(prompt).toContain("## • SECOND-LINE / ALTERNATIVES");
    expect(prompt).toContain("## • MONITORING PLAN");
    expect(prompt).toContain("## • DRUG INTERACTIONS");
    expect(prompt).toContain("## • DOSE ADJUSTMENTS");
    expect(prompt).toContain("## • SAFETY NOTES");
    expect(prompt).toContain("## • CAVEATS AND LIMITATIONS");
  });
});
