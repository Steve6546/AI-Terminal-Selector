import type { Response } from "express";

interface ZodLikeError {
  issues: unknown[];
}

function isZodError(err: unknown): err is ZodLikeError {
  return (
    err != null &&
    typeof err === "object" &&
    "issues" in err &&
    Array.isArray((err as ZodLikeError).issues) &&
    "name" in err &&
    (err as { name: string }).name === "ZodError"
  );
}

export function handleRouteError(res: Response, err: unknown, fallbackMessage: string): void {
  if (isZodError(err)) {
    res.status(400).json({ error: "Validation failed", issues: err.issues });
    return;
  }
  res.status(500).json({ error: fallbackMessage });
}
