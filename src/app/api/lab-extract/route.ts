import { textFromPdfBuffer } from "@/lib/rag";
import { parseLabText } from "@/lib/lab-parser";
import { requireAuth } from "@/lib/auth-guard";
import { scrubPhi } from "@/lib/phi-scrubber";
import { ocrImages, type OcrImage } from "@/lib/nvidia";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MAX_CHARS = 40_000;
const MAX_LAB_BYTES = 25 * 1024 * 1024;

type Prepared =
  | { idx: number; name: string; text: string }
  | { idx: number; name: string; image: OcrImage }
  | { idx: number; name: string; error: string; status: number };

function detectMimeType(buffer: Buffer, filename: string): string | null {
  if (buffer.length < 12) return null;

  // 1. PDF
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return "application/pdf";
  }

  // 2. PNG
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return "image/png";
  }

  // 3. JPEG
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return "image/jpeg";
  }

  // 4. GIF
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return "image/gif";
  }

  // 5. WEBP
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return "image/webp";
  }

  // 6. BMP
  if (buffer[0] === 0x42 && buffer[1] === 0x4D) {
    return "image/bmp";
  }

  // 7. TIFF
  if (
    (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2A && buffer[3] === 0x00) ||
    (buffer[0] === 0x4D && buffer[1] === 0x4D && buffer[2] === 0x00 && buffer[3] === 0x2A)
  ) {
    return "image/tiff";
  }

  // 8. HEIC / HEIF
  const ftyp = buffer.toString("ascii", 4, 8);
  if (ftyp === "ftyp") {
    const brand = buffer.toString("ascii", 8, 12);
    if (["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"].includes(brand)) {
      return "image/heic";
    }
  }

  // 9. DOCX (ZIP archive starting with PK)
  if (buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04) {
    if (filename.toLowerCase().endsWith(".docx")) {
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }
  }

  return null;
}

function extractTextFromDoc(buffer: Buffer): string {
  let result = "";
  let temp = "";
  for (let i = 0; i < buffer.length; i++) {
    const char = buffer[i];
    if ((char >= 32 && char <= 126) || char === 10 || char === 13 || char === 9) {
      temp += String.fromCharCode(char);
    } else {
      if (temp.length >= 4) {
        result += temp + " ";
      }
      temp = "";
    }
  }
  if (temp.length >= 4) {
    result += temp;
  }
  return result.replace(/\s+/g, " ").trim();
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const files = [
    ...(formData.getAll("file") as File[]),
    ...(formData.getAll("files") as File[])
  ].filter(Boolean);

  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  // ── Phase 1: read + classify every file. Images defer OCR to a batched pass. ──
  const prepared: Prepared[] = await Promise.all(
    files.map(async (file, idx): Promise<Prepared> => {
      // W14: cap upload size before buffering.
      if (file.size > MAX_LAB_BYTES) {
        return { idx, name: file.name, error: `File ${file.name} is too large (limit 25 MB)`, status: 413 };
      }

      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const lower = file.name.toLowerCase();

        // Detect mimeType via magic bytes with client-side fallback
        const detectedMime = detectMimeType(buffer, file.name) || file.type || "";

        // 1. PDF Documents
        if (detectedMime === "application/pdf" || lower.endsWith(".pdf")) {
          try {
            const text = (await textFromPdfBuffer(buffer)).slice(0, MAX_CHARS);
            return { idx, name: file.name, text };
          } catch (err) {
            const msg = (err as Error).message;
            // Scanned / image-only PDFs have no extractable text layer. OCR of
            // rasterized pages needs a heavy native renderer (deferred), so give
            // the user an actionable instruction instead of a silent empty result.
            if (/no text found/i.test(msg)) {
              return {
                idx,
                name: file.name,
                error: `"${file.name}" looks like a scanned/image-only PDF with no text layer. Please upload it as an image (PNG/JPEG) so OCR can read it.`,
                status: 422,
              };
            }
            return { idx, name: file.name, error: `PDF extraction failed on ${file.name}: ${msg}`, status: 422 };
          }
        }

        // 2. HEIC / HEIF Images (Convert on server side)
        const isHeic = detectedMime === "image/heic" || detectedMime === "image/heif" || lower.match(/\.(heic|heif)$/i);
        if (isHeic) {
          try {
            const heicConvert = await import("heic-convert");
            const convert = heicConvert.default || heicConvert;
            const convertedBuffer = await convert({
              buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
              format: "JPEG",
              quality: 0.85,
            });
            return {
              idx,
              name: file.name,
              image: { buffer: Buffer.from(convertedBuffer), mimeType: "image/jpeg" },
            };
          } catch (err) {
            return {
              idx,
              name: file.name,
              error: `HEIC image conversion failed on ${file.name}: ${(err as Error).message}`,
              status: 422,
            };
          }
        }

        // 3. Standard & Other Major Images (PNG, JPEG, WebP, GIF, TIFF, BMP)
        const isImage = detectedMime.startsWith("image/") || lower.match(/\.(png|jpe?g|webp|gif|tiff?|bmp)$/i);
        if (isImage) {
          let mimeType = detectedMime;
          if (mimeType.startsWith("image/heic") || mimeType.startsWith("image/heif")) {
            mimeType = "image/jpeg"; // safety fallback if HEIC didn't get parsed
          } else if (mimeType === "application/octet-stream" || !mimeType) {
            if (lower.endsWith(".png")) mimeType = "image/png";
            else if (lower.endsWith(".webp")) mimeType = "image/webp";
            else if (lower.endsWith(".gif")) mimeType = "image/gif";
            else if (lower.endsWith(".tiff") || lower.endsWith(".tif")) mimeType = "image/tiff";
            else if (lower.endsWith(".bmp")) mimeType = "image/bmp";
            else mimeType = "image/jpeg";
          }
          return { idx, name: file.name, image: { buffer, mimeType } };
        }

        // 4. Word Documents (.docx)
        const isDocx = detectedMime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || lower.endsWith(".docx");
        if (isDocx) {
          try {
            const mammoth = await import("mammoth");
            const result = await mammoth.extractRawText({ buffer });
            const text = result.value.slice(0, MAX_CHARS);
            return { idx, name: file.name, text };
          } catch (err) {
            return { idx, name: file.name, error: `Word Document extraction failed on ${file.name}: ${(err as Error).message}`, status: 422 };
          }
        }

        // 5. Legacy Word Documents (.doc)
        const isDoc = lower.endsWith(".doc");
        if (isDoc) {
          try {
            const text = extractTextFromDoc(buffer).slice(0, MAX_CHARS);
            return { idx, name: file.name, text };
          } catch (err) {
            return { idx, name: file.name, error: `Word Document (.doc) extraction failed on ${file.name}: ${(err as Error).message}`, status: 422 };
          }
        }

        // 6. Text Documents
        if (detectedMime.startsWith("text/") || lower.match(/\.(txt|csv|md)$/i)) {
          return { idx, name: file.name, text: buffer.toString("utf-8").slice(0, MAX_CHARS) };
        }

        return {
          idx,
          name: file.name,
          error: `Unsupported file type for ${file.name}. Upload PDF, Word (.docx, .doc), Image (PNG, JPEG, HEIC, TIFF, BMP, WebP), or text (.txt, .csv, .md) reports.`,
          status: 415,
        };
      } catch (err) {
        return { idx, name: file.name, error: `File reading failed on ${file.name}: ${(err as Error).message}`, status: 500 };
      }
    })
  );

  // ── Phase 2: batch-OCR every image in one parallel pass (pinned model). ──
  const imageItems = prepared.filter((p): p is Extract<Prepared, { image: OcrImage }> => "image" in p);
  if (imageItems.length > 0) {
    try {
      const texts = await ocrImages(imageItems.map((p) => p.image));
      imageItems.forEach((p, i) => {
        // Replace the image descriptor with its extracted text, in place.
        prepared[p.idx] = { idx: p.idx, name: p.name, text: (texts[i] ?? "").slice(0, MAX_CHARS) };
      });
    } catch (err) {
      return NextResponse.json(
        { error: `Image transcription failed: ${(err as Error).message}` },
        { status: 422 },
      );
    }
  }

  // ── Phase 3: surface the first error, otherwise assemble in upload order. ──
  const errorResult = prepared.find((p): p is Extract<Prepared, { error: string }> => "error" in p);
  if (errorResult) {
    return NextResponse.json({ error: errorResult.error }, { status: errorResult.status ?? 422 });
  }

  const combinedText = prepared
    .slice()
    .sort((a, b) => a.idx - b.idx)
    .map((p) => `--- FILE: ${p.name} ---\n${(p as { text: string }).text}`)
    .join("\n\n");

  // W84 — Lab reports almost always include patient name, MRN, DOB, ordering
  // physician, and clinic-letterhead identifiers around the structured lab
  // values. Returning the full extracted text gives the client a plaintext
  // PHI artifact that the user is likely to save locally, paste into chat,
  // or email — none of which respect the envelope encryption applied at the
  // DB layer. Scrub regex-detectable identifiers from the text echo before
  // serialising. Structured `panel` values are numeric ranges and analyte
  // names with no free-text PHI surface, so they pass through untouched.
  const panel = parseLabText(combinedText);
  const scrubbedText = scrubPhi(combinedText);

  return NextResponse.json({
    text: scrubbedText,
    chars: scrubbedText.length,
    panel,
    criticals: panel.criticals,
  });
}
