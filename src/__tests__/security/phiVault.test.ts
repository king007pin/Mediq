import { describe, expect, it, beforeEach } from "vitest";
import { encryptPhi, decryptPhi, isEncrypted, PhiKeyMismatchError } from "../../lib/phi-vault";

// 32-byte base64-encoded test keys — distinct from each other and from
// APP_SECRET_KEY below.
const KEY_A = "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=";
const KEY_B = "YmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmI=";
const KEY_C = "Y2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2M=";

describe("PHI Envelope Encryption Vault", () => {
  beforeEach(() => {
    // Reset standard testing KEK (32-byte base64-encoded key)
    process.env.APP_PHI_KEK = KEY_A;
    process.env.APP_SECRET_KEY = "another-secret-key-value-distinct-from-kek";
    delete process.env.APP_PHI_KEK_PREVIOUS;
  });

  it("performs correct roundtrip encryption/decryption for simple text", () => {
    const plain = "Jane Q. Doe";
    const encrypted = encryptPhi(plain);

    expect(isEncrypted(encrypted)).toBe(true);
    expect(encrypted.split(".")).toHaveLength(7);
    expect(encrypted.startsWith("v1.")).toBe(true);

    const decrypted = decryptPhi(encrypted);
    expect(decrypted).toBe(plain);
  });

  it("handles maximum length clinician notes without issues", () => {
    const plain = "x".repeat(4000);
    const encrypted = encryptPhi(plain);
    const decrypted = decryptPhi(encrypted);
    expect(decrypted).toBe(plain);
  });

  it("properly parses unicode and emojis", () => {
    const plain = "朱莉 🩺 Patient MRN#42-🌟";
    const encrypted = encryptPhi(plain);
    const decrypted = decryptPhi(encrypted);
    expect(decrypted).toBe(plain);
  });

  it("guarantees ciphertext uniqueness via random nonces and DEKs", () => {
    const plain = "identical-string";
    const enc1 = encryptPhi(plain);
    const enc2 = encryptPhi(plain);

    expect(enc1).not.toEqual(enc2);
    expect(decryptPhi(enc1)).toEqual(plain);
    expect(decryptPhi(enc2)).toEqual(plain);
  });

  it("throws error when ciphertext payload is tampered", () => {
    const plain = "confidential";
    const encrypted = encryptPhi(plain);
    const parts = encrypted.split(".");
    // Modify the last segment (ciphertext payload)
    parts[6] = parts[6].slice(0, -3) + "xyz";
    const tampered = parts.join(".");

    expect(() => decryptPhi(tampered)).toThrow();
  });

  it("throws error when auth tag is tampered", () => {
    const plain = "confidential";
    const encrypted = encryptPhi(plain);
    const parts = encrypted.split(".");
    // Modify segment 5 (payload GCM auth tag)
    parts[5] = parts[5].slice(0, -3) + "abc";
    const tampered = parts.join(".");

    expect(() => decryptPhi(tampered)).toThrow();
  });

  it("throws error when KEK is missing", () => {
    delete process.env.APP_PHI_KEK;
    expect(() => encryptPhi("test")).toThrow("APP_PHI_KEK env var not set");
  });

  it("refuses to initialize if KEK matches APP_SECRET_KEY", () => {
    process.env.APP_PHI_KEK = "same-value-for-both-secrets-key-aaaaa";
    process.env.APP_SECRET_KEY = "same-value-for-both-secrets-key-aaaaa";
    expect(() => encryptPhi("test")).toThrow(
      "APP_PHI_KEK must not equal APP_SECRET_KEY.",
    );
  });

  it("throws error when KEK has wrong length", () => {
    // 16-byte key instead of 32-byte key
    process.env.APP_PHI_KEK = "c2hvcnQta2V5LXZhbHVl";
    expect(() => encryptPhi("test")).toThrow("must decode to exactly 32 bytes");
  });

  it("decrypts with a retired key when the current key doesn't match (rotation)", () => {
    process.env.APP_PHI_KEK = KEY_A;
    const encrypted = encryptPhi("rotated secret");

    // Simulate rotation: A is now retired, B is current.
    process.env.APP_PHI_KEK = KEY_B;
    process.env.APP_PHI_KEK_PREVIOUS = KEY_A;

    expect(decryptPhi(encrypted)).toBe("rotated secret");
  });

  it("throws PhiKeyMismatchError when neither current nor retired keys match", () => {
    process.env.APP_PHI_KEK = KEY_A;
    const encrypted = encryptPhi("orphaned secret");

    process.env.APP_PHI_KEK = KEY_B;
    process.env.APP_PHI_KEK_PREVIOUS = KEY_C;

    expect(() => decryptPhi(encrypted)).toThrow(PhiKeyMismatchError);
  });

  it("still throws on tampered ciphertext even with a retired key configured", () => {
    process.env.APP_PHI_KEK = KEY_A;
    const encrypted = encryptPhi("confidential");
    const parts = encrypted.split(".");
    parts[6] = parts[6].slice(0, -3) + "xyz";
    const tampered = parts.join(".");

    process.env.APP_PHI_KEK_PREVIOUS = KEY_B;

    expect(() => decryptPhi(tampered)).toThrow();
    expect(() => decryptPhi(tampered)).not.toThrow(PhiKeyMismatchError);
  });

  it("accurately detects encrypted format via isEncrypted", () => {
    expect(isEncrypted("v1.wrapped.iv.tag.iv.tag.ct")).toBe(true);
    expect(isEncrypted("v2.wrapped.iv.tag.iv.tag.ct")).toBe(false);
    expect(isEncrypted("plain-text")).toBe(false);
    expect(isEncrypted(null)).toBe(false);
    expect(isEncrypted(undefined)).toBe(false);
  });
});
