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
 * Issues a one-time token bound to the caller's IP + origin.
 * Requires X-Requested-With header (CSRF protection) and is rate-limited (10/min per IP).
 */
router.get("/terminal/token", (req, res) => {
  // CSRF: reject simple cross-origin requests (cannot set custom headers cross-origin)
  if (!req.headers["x-requested-with"]) {
    res.status(403).json({ error: "Forbidden: missing required header" });
    return;
  }

  const ip = ((req.ip ?? req.socket?.remoteAddress ?? "unknown")).split(",")[0]?.trim() ?? "unknown";
  if (isRateLimited(ip)) {
    res.status(429).json({ error: "Too many requests — try again later" });
    return;
  }

  const origin = req.headers.origin ?? req.headers.host ?? "localhost";
  const token = issueTerminalToken(ip, origin);
  res.json({ token });
});

export default router;
