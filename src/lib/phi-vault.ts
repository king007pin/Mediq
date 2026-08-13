import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;

function getKEK(): Buffer {
  const raw = process.env.APP_PHI_KEK ?? "";
  if (!raw) {
    throw new Error("APP_PHI_KEK env var not set");
  }

  // APP_PHI_KEK must not equal APP_SECRET_KEY to prevent key collapse
  if (process.env.APP_SECRET_KEY && raw === process.env.APP_SECRET_KEY) {
    throw new Error("APP_PHI_KEK must not equal APP_SECRET_KEY.");
  }

  const buf = Buffer.from(raw, "base64");
  if (buf.length !== KEY_BYTES) {
    throw new Error(`APP_PHI_KEK must decode to exactly ${KEY_BYTES} bytes`);
  }
  return buf;
}

// Retired KEKs, tried in order after the current key fails — lets ciphertext
// written under a rotated-out key stay readable during a rotation grace
// period. A malformed entry is skipped (warned), not fatal: a bad retired
// key must never block startup the way a bad primary key does.
function getRetiredKEKs(): Buffer[] {
  const raw = process.env.APP_PHI_KEK_PREVIOUS ?? "";
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const buf = Buffer.from(entry, "base64");
      if (buf.length !== KEY_BYTES) {
        console.warn(`APP_PHI_KEK_PREVIOUS entry ignored: does not decode to ${KEY_BYTES} bytes`);
        return [];
      }
      return [buf];
    });
}

// Thrown when the DEK-unwrap step fails against the current KEK and every
// retired KEK — the expected, recoverable shape of "this ciphertext was
// written under a key we no longer have configured." Callers (e.g. the
// encryptedText Drizzle customType) can catch this specifically to degrade
// gracefully instead of crashing on genuine corruption/tampering, which
// still throws a plain Error.
export class PhiKeyMismatchError extends Error {
  constructor() {
    super("PHI ciphertext does not match the current or any retired APP_PHI_KEK");
    this.name = "PhiKeyMismatchError";
  }
}

const b64 = (b: Buffer) => b.toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url");

export function encryptPhi(plaintext: string): string {
  if (plaintext === null || plaintext === undefined) {
    return "";
  }

  const kek = getKEK();
  const dek = randomBytes(KEY_BYTES);

  // 1. Wrap (encrypt) the DEK under the KEK using AES-256-GCM
  const dekIv = randomBytes(IV_BYTES);
  const dekC = createCipheriv("aes-256-gcm", kek, dekIv);
  const dekWrapped = Buffer.concat([dekC.update(dek), dekC.final()]);
  const dekTag = dekC.getAuthTag();

  // 2. Encrypt the plaintext under the DEK using AES-256-GCM
  const pIv = randomBytes(IV_BYTES);
  const pC = createCipheriv("aes-256-gcm", dek, pIv);
  const pCt = Buffer.concat([
    pC.update(plaintext, "utf8"),
    pC.final(),
  ]);
  const pTag = pC.getAuthTag();

  // 3. Serialise into the dot-separated base64url envelope
  return [
    VERSION,
    b64(dekWrapped),
    b64(dekIv),
    b64(dekTag),
    b64(pIv),
    b64(pTag),
    b64(pCt),
  ].join(".");
}

function unwrapDek(kek: Buffer, di: string, dt: string, dw: string): Buffer {
  const dekD = createDecipheriv("aes-256-gcm", kek, unb64(di));
  dekD.setAuthTag(unb64(dt));
  return Buffer.concat([dekD.update(unb64(dw)), dekD.final()]);
}

export function decryptPhi(envelope: string): string {
  if (!envelope) {
    return "";
  }

  const parts = envelope.split(".");
  const [v, dw, di, dt, pi, pt, pc] = parts;

  if (v !== VERSION) {
    throw new Error(`Unknown PHI envelope version: ${v}`);
  }

  if (parts.length !== 7) {
    throw new Error("Invalid PHI envelope structure");
  }

  // 1. Unwrap the DEK, trying the current KEK then each retired KEK in turn.
  // Only a GCM auth-tag failure (wrong key) triggers a retry — any other
  // error is unexpected and rethrown immediately.
  const candidateKeys = [getKEK(), ...getRetiredKEKs()];
  let dek: Buffer | null = null;
  for (const kek of candidateKeys) {
    try {
      dek = unwrapDek(kek, di, dt, dw);
      break;
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (!msg.includes("Unsupported state or unable to authenticate data")) throw err;
    }
  }
  if (!dek) {
    throw new PhiKeyMismatchError();
  }

  // 2. Decrypt the payload using the unwrapped DEK. A failure here is real
  // corruption/tampering (the DEK just verified), not a key-rotation case —
  // it must still fail loud.
  const pD = createDecipheriv("aes-256-gcm", dek, unb64(pi));
  pD.setAuthTag(unb64(pt));
  return Buffer.concat([pD.update(unb64(pc)), pD.final()]).toString("utf8");
}

export function isEncrypted(v: string | null | undefined): boolean {
  return typeof v === "string" && v.startsWith(VERSION + ".");
}
