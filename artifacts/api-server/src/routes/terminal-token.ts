import { Router } from "express";
import { issueTerminalToken } from "../lib/terminal-server";

const router = Router();

// Simple in-memory rate limiter: max 10 token requests per IP per minute
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  if (!record || record.resetAt < now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  record.count++;
  if (record.count > 10) return true;
  return false;
}

/**
 * GET /api/terminal/token
 * Returns a one-time token that authorizes a single WebSocket terminal connection.
 * Requires X-Requested-With header (CSRF protection) and is rate-limited.
 */
router.get("/terminal/token", (req, res) => {
  // CSRF protection: only allow XHR/fetch requests with this custom header
  // (simple requests cannot set custom headers cross-origin)
  if (!req.headers["x-requested-with"]) {
    res.status(403).json({ error: "Forbidden: missing required header" });
    return;
  }

  const ip = (req.ip ?? "unknown").split(",")[0]?.trim() ?? "unknown";
  if (isRateLimited(ip)) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }

  const token = issueTerminalToken();
  res.json({ token });
});

export default router;
