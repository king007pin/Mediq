export interface DicomMetadata {
  patientName?: string;
  patientId?: string;
  patientAge?: string;
  patientSex?: string;
  modality?: string;
  studyDate?: string;
  studyDescription?: string;
  institutionName?: string;
  manufacturer?: string;
}

/**
 * Extracts patient and study metadata from a binary DICOM file (.dcm) buffer.
 * Walks explicit and implicit VR tags sequentially, terminating before pixel data.
 */
export function parseDicomHeader(buffer: Buffer): DicomMetadata {
  if (buffer.length < 132) {
    throw new Error("DICOM file too small (must be at least 132 bytes)");
  }

  // Verify DICM signature at offset 128
  if (
    buffer[128] !== 0x44 || // 'D'
    buffer[129] !== 0x49 || // 'I'
    buffer[130] !== 0x43 || // 'C'
    buffer[131] !== 0x4D    // 'M'
  ) {
    throw new Error("Invalid DICOM file: missing 'DICM' signature at offset 128");
  }

  const meta: DicomMetadata = {};
  let offset = 132;
  let iterations = 0;
  const maxIterations = 5000; // safety ceiling to prevent infinite loops

  // Helpers to read Little-Endian numbers
  const readUint16 = (o: number) => buffer[o] | (buffer[o + 1] << 8);
  const readUint32 = (o: number) =>
    buffer[o] | (buffer[o + 1] << 8) | (buffer[o + 2] << 16) | (buffer[o + 3] << 24);

  while (offset < buffer.length - 8 && iterations++ < maxIterations) {
    const group = readUint16(offset);
    const element = readUint16(offset + 2);
    offset += 4;

    // Detect VR structure (Explicit VR uses printable uppercase ASCII characters at bytes 4 & 5)
    const vrChar1 = buffer[offset];
    const vrChar2 = buffer[offset + 1];
    const isExplicit = vrChar1 >= 65 && vrChar1 <= 90 && vrChar2 >= 65 && vrChar2 <= 90;

    let length = 0;
    let vr = "";

    if (isExplicit) {
      vr = String.fromCharCode(vrChar1, vrChar2);
      offset += 2;

      if (["OB", "OW", "OF", "SQ", "UT", "UN"].includes(vr)) {
        // Skip 2 reserved bytes, then read 32-bit length
        offset += 2;
        length = readUint32(offset);
        offset += 4;
      } else {
        // Read 16-bit length
        length = readUint16(offset);
        offset += 2;
      }
    } else {
      // Implicit VR (Always uses 32-bit length)
      length = readUint32(offset);
      offset += 4;
    }

    // Skip undefined length items/sequences or stop early
    if (length === 0xFFFFFFFF) {
      length = 0;
    }

    if (offset + length > buffer.length) {
      break; // safety bounding
    }

    // Stop early if we reach heavy pixel data (Group 7FE0)
    if (group === 0x7FE0) {
      break;
    }

    const tag = `${group.toString(16).padStart(4, "0").toUpperCase()},${element.toString(16).padStart(4, "0").toUpperCase()}`;
    const rawVal = buffer.toString("utf-8", offset, offset + length).trim().replace(/\0/g, "");

    if (length > 0 && rawVal) {
      switch (tag) {
        case "0010,0010":
          meta.patientName = rawVal.replace(/\^/g, " "); // DICOM carrot separator replacement
          break;
        case "0010,0020":
          meta.patientId = rawVal;
          break;
        case "0010,1010":
          meta.patientAge = rawVal;
          break;
        case "0010,0040":
          meta.patientSex = rawVal;
          break;
        case "0008,0060":
          meta.modality = rawVal;
          break;
        case "0008,0020":
          meta.studyDate = rawVal;
          break;
        case "0008,1030":
          meta.studyDescription = rawVal;
          break;
        case "0008,0080":
          meta.institutionName = rawVal;
          break;
        case "0008,0070":
          meta.manufacturer = rawVal;
          break;
      }
    }

    offset += length;
  }

  return meta;
}
