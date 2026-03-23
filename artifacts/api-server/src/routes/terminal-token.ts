import { Router } from "express";
import { issueTerminalToken } from "../lib/terminal-server";

const router = Router();

/**
 * GET /api/terminal/token
 * Returns a one-time token that authorizes a single WebSocket terminal connection.
 * The token expires in 60 seconds.
 */
router.get("/terminal/token", (_req, res) => {
  const token = issueTerminalToken();
  res.json({ token });
});

export default router;
