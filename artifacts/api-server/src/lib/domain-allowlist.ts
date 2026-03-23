import { db } from "@workspace/db";
import { settings } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function getDomainAllowlist(): Promise<string[]> {
  try {
    const [row] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "domainAllowlist"));

    if (!row) return [];
    const parsed = JSON.parse(row.valueJson);
    if (Array.isArray(parsed)) {
      return parsed.filter((d): d is string => typeof d === "string");
    }
    return [];
  } catch {
    return [];
  }
}

export function extractOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.origin;
  } catch {
    return null;
  }
}

export function isOriginAllowed(origin: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  const originLower = origin.toLowerCase();
  return allowlist.some((allowed) => {
    const allowedLower = allowed.toLowerCase().replace(/\/$/, "");
    return originLower === allowedLower || originLower.startsWith(allowedLower);
  });
}

export async function checkEndpointAllowed(
  endpoint: string | undefined | null,
  transportType: string
): Promise<{ allowed: boolean; reason?: string }> {
  if (transportType !== "streamable-http" || !endpoint) {
    return { allowed: true };
  }

  const origin = extractOrigin(endpoint);
  if (!origin) {
    return { allowed: false, reason: `Invalid endpoint URL: ${endpoint}` };
  }

  const allowlist = await getDomainAllowlist();
  if (allowlist.length === 0) {
    return { allowed: true };
  }

  if (!isOriginAllowed(origin, allowlist)) {
    return {
      allowed: false,
      reason: `Origin "${origin}" is not in the domain allowlist. Allowed: ${allowlist.join(", ")}`,
    };
  }

  return { allowed: true };
}
