import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";

declare global {
  namespace Express {
    interface Request {
      traceId: string;
    }
  }
}

export function traceIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const traceId = (req.headers["x-trace-id"] as string) || randomUUID();
  req.traceId = traceId;
  res.setHeader("X-Trace-Id", traceId);
  next();
}
