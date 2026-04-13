import crypto from "crypto";

function getKey(): Buffer | null {
  const hex = process.env.ENCRYPTION_KEY ?? "";
  if (!hex) return null;
  const key = Buffer.from(hex, "hex");
  return key.length === 32 ? key : null;
}

export function encryptToken(text: string): string {
  const key = getKey();
  if (!key) return text;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptToken(data: string): string {
  const key = getKey();
  if (!key) return data;
  try {
    const buf = Buffer.from(data, "base64");
    if (buf.length < 28) return data;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted).toString("utf8") + decipher.final("utf8");
  } catch {
    return data;
  }
}
