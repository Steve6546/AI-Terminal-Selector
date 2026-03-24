import { logger } from "./logger";

interface OperationContext {
  operation: string;
  traceId?: string;
  runId?: string | number;
  executionId?: number;
  conversationId?: number;
  toolName?: string;
  serverId?: number;
  status?: string;
  durationMs?: number;
  [key: string]: unknown;
}

export function logOperation(ctx: OperationContext): void {
  const { operation, ...fields } = ctx;
  logger.info(fields, operation);
}

export function logOperationError(ctx: OperationContext, err: unknown): void {
  const { operation, ...fields } = ctx;
  logger.error({ ...fields, err }, `${operation} failed`);
}

export function withTiming<T>(
  operation: string,
  ctx: Omit<OperationContext, "operation" | "durationMs" | "status">,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  return fn()
    .then((result) => {
      logOperation({ operation, ...ctx, status: "success", durationMs: Date.now() - start });
      return result;
    })
    .catch((err) => {
      logOperationError({ operation, ...ctx, status: "error", durationMs: Date.now() - start }, err);
      throw err;
    });
}
