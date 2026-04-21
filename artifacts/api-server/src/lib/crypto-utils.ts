import crypto from "crypto";

function getKey(): Buffer | null {
  const hex = process.env.ENCRYPTION_KEY ?? "";
  if (!hex) return null;
  const key = Buffer.from(hex, "hex");
  return key.length === 32 ? key : null;
}

export function encryptToken(text: string): string {
  const key = getKey();
  if (!key) {
    throw new Error(
      "ENCRYPTION_KEY is not configured or is invalid. " +
      "Set ENCRYPTION_KEY to a 64-character hex string (32 bytes) before storing broker credentials.",
    );
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

/**
 * Decrypts a token previously encrypted with `encryptToken`.
 *
 * Returns the plaintext on success. Returns `null` if the input is a valid
 * AES-GCM envelope but decryption fails (wrong/rotated ENCRYPTION_KEY or
 * tampered ciphertext). Returns the input unchanged only when the input is
 * plainly not an encrypted envelope (too short to be a valid GCM blob).
 *
 * Note: the server requires a valid ENCRYPTION_KEY at startup (see index.ts),
 * so the `!key` branch below is only reachable in isolated unit-test contexts
 * or if the env var is removed at runtime after boot.
 *
 * This distinction matters: if we return the still-encrypted base64 blob as
 * a "token", downstream Dhan calls fail with 401 and the user sees misleading
 * errors. Returning null lets callers surface a "credentials unreadable,
 * please reconnect broker" message instead.
 */
export function decryptToken(data: string): string | null {
  const key = getKey();
  if (!key) return data;
  const buf = Buffer.from(data, "base64");
  // Minimum envelope: 12B IV + 16B tag + at least 1B ciphertext = 29B
  // If shorter, it's not an encrypted token — treat as legacy plaintext.
  if (buf.length < 29) return data;
  try {
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted).toString("utf8") + decipher.final("utf8");
  } catch {
    // Compatibility fallback: a legacy plaintext JWT (stored before the key was
    // enabled) happens to decode as ≥29 bytes of base64 and will land here.
    // Dhan access tokens are JWTs and always begin with the literal "eyJ"
    // header. If we see that, the string is already plaintext — return as-is.
    if (data.startsWith("eyJ")) return data;
    return null;
  }
}
