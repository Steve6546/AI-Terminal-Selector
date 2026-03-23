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

export function extractHostname(url: string): { origin: string; hostname: string } | null {
  try {
    const parsed = new URL(url);
    return { origin: parsed.origin, hostname: parsed.hostname.toLowerCase() };
  } catch {
    return null;
  }
}

/**
 * Checks whether an origin is allowed by the allowlist.
 * Matching rules:
 *   - If the allowlist is empty, all origins are allowed.
 *   - An allowlist entry is matched if:
 *     - The entry and the request origin are exactly equal (scheme + host + port), OR
 *     - The entry has a wildcard prefix (*.example.com) and the request hostname
 *       ends with ".example.com" (dot-boundary enforced).
 *
 * IMPORTANT: raw startsWith on origins is NOT used to prevent bypass via
 * crafted hostnames such as evil.allowed.example.com.evil.com.
 */
export function isOriginAllowed(requestOrigin: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;

  const requestParsed = (() => {
    try {
      return new URL(requestOrigin);
    } catch {
      return null;
    }
  })();

  if (!requestParsed) return false;

  const reqHostname = requestParsed.hostname.toLowerCase();
  const reqScheme = requestParsed.protocol;
  const reqPort = requestParsed.port;

  for (const entry of allowlist) {
    const normalized = entry.trim().toLowerCase();

    if (normalized.startsWith("*.")) {
      const suffix = normalized.slice(1);
      if (
        reqHostname === suffix.slice(1) ||
        reqHostname.endsWith(suffix)
      ) {
        return true;
      }
      continue;
    }

    let entryParsed: URL;
    try {
      entryParsed = new URL(normalized);
    } catch {
      try {
        entryParsed = new URL(`https://${normalized}`);
      } catch {
        continue;
      }
    }

    const entryScheme = entryParsed.protocol;
    const entryHostname = entryParsed.hostname.toLowerCase();
    const entryPort = entryParsed.port;

    if (
      reqScheme === entryScheme &&
      reqHostname === entryHostname &&
      reqPort === entryPort
    ) {
      return true;
    }
  }

  return false;
}

export async function checkEndpointAllowed(
  endpoint: string | undefined | null,
  transportType: string
): Promise<{ allowed: boolean; reason?: string }> {
  if (transportType !== "streamable-http" || !endpoint) {
    return { allowed: true };
  }

  const parsed = extractHostname(endpoint);
  if (!parsed) {
    return { allowed: false, reason: `Invalid endpoint URL: ${endpoint}` };
  }

  const allowlist = await getDomainAllowlist();
  if (allowlist.length === 0) {
    return { allowed: true };
  }

  if (!isOriginAllowed(parsed.origin, allowlist)) {
    return {
      allowed: false,
      reason: `Origin "${parsed.origin}" is not in the domain allowlist. Allowed: ${allowlist.join(", ")}`,
    };
  }

  return { allowed: true };
}
