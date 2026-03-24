import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { traceIdMiddleware } from "./lib/trace-middleware";

const app: Express = express();

// Derive the allowed origin from the Replit dev domain env var (always present in Replit)
// In production deployments the origin will be the .replit.app domain.
function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return true;

    const devDomain = process.env["REPLIT_DEV_DOMAIN"];
    if (devDomain && url.origin === new URL(`https://${devDomain}`).origin) return true;

    const appsDomain = process.env["REPLIT_DEPLOYMENT_URL"];
    if (appsDomain) {
      try {
        if (url.origin === new URL(appsDomain).origin) return true;
      } catch { /* invalid env var */ }
    }

    return false;
  } catch {
    return false;
  }
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (isAllowedOrigin(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    credentials: true,
  })
);

app.use(traceIdMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
