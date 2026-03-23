import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Derive the allowed origin from the Replit dev domain env var (always present in Replit)
// In production deployments the origin will be the .replit.app domain.
function buildAllowedOrigins(): string[] {
  const origins: string[] = ["http://localhost", "http://127.0.0.1"];
  const devDomain = process.env["REPLIT_DEV_DOMAIN"];
  if (devDomain) {
    origins.push(`https://${devDomain}`);
  }
  const appsDomain = process.env["REPLIT_DEPLOYMENT_URL"];
  if (appsDomain) {
    origins.push(appsDomain);
  }
  return origins;
}

const allowedOrigins = buildAllowedOrigins();

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
      // Allow same-origin (no origin header) and localhost in any port
      if (!origin || allowedOrigins.some((o) => origin.startsWith(o))) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
