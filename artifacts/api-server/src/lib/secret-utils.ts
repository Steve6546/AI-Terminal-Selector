const PREFIX = "b64:";

export function maskSecret(secret: string | null | undefined): string | null {
  if (!secret) return null;
  return PREFIX + Buffer.from(secret, "utf-8").toString("base64");
}

export function unmaskSecret(masked: string | null | undefined): string | null {
  if (!masked) return null;
  if (!masked.startsWith(PREFIX)) return masked;
  return Buffer.from(masked.slice(PREFIX.length), "base64").toString("utf-8");
}
