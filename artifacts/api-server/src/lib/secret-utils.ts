import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGORITHM = "aes-256-gcm";
const SALT = "agent-tool-chat-secret-salt-v1";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const PREFIX = "aes256gcm:";

function deriveKey(): Buffer {
  const masterSecret = process.env.SECRET_ENCRYPTION_KEY;
  if (!masterSecret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SECRET_ENCRYPTION_KEY environment variable must be set in production to encrypt MCP secrets."
      );
    }
    return scryptSync("dev-only-insecure-fallback-key", SALT, 32);
  }
  return scryptSync(masterSecret, SALT, 32);
}

export function encryptSecret(secret: string | null | undefined): string | null {
  if (!secret) return null;
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(secret, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, encrypted]);
  return PREFIX + payload.toString("base64");
}

export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.startsWith(PREFIX)) {
    return stored;
  }
  const key = deriveKey();
  const payload = Buffer.from(stored.slice(PREFIX.length), "base64");
  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted).toString("utf-8") + decipher.final("utf-8");
}

export { encryptSecret as maskSecret, decryptSecret as unmaskSecret };
