import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    process.env.FRONTEND_URL || '*',
  ],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Global JSON error handler for /api/*. Without this, multer errors (file
// filter rejections, "unexpected field" on wrong form-field name, size
// limit) and any unhandled throw fall through to Express's default handler
// which returns an HTML error page — that breaks the frontend's
// `await res.json()` with "server returned an invalid response."
app.use("/api", (err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const e = err as {
    status?: number; statusCode?: number; code?: string; message?: string;
  };
  const status =
    typeof e?.status === "number"     ? e.status
    : typeof e?.statusCode === "number" ? e.statusCode
    : e?.code === "LIMIT_FILE_SIZE"   ? 413
    : e?.code === "LIMIT_FIELD_VALUE" ? 413
    : 500;

  const message =
    e?.code === "LIMIT_FILE_SIZE"         ? "Video too large — please upload a smaller file (under 200 MB)."
    : e?.code === "LIMIT_FIELD_VALUE"     ? "A form field is too large — try clearing some session history and try again."
    : e?.code === "LIMIT_UNEXPECTED_FILE" ? "Unexpected form field — expected a field named 'swing'."
    : e?.message                          ? e.message
    : "Internal server error";

  // Log server-side so we can still see the real stack trace.
  req.log?.error({ err }, "API error (returned to client as JSON)");

  // Only send if we haven't already started responding.
  if (!res.headersSent) {
    res.status(status).json({ error: message });
  }
});

// Serve the built React frontend (Railway: process.cwd() is the project root)
const frontendDist = path.join(process.cwd(), "dist");
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  // SPA fallback — send index.html for any non-API GET (and HEAD, which
  // health checkers and link prefetchers use). Express 5's path-to-regexp
  // v6 no longer accepts bare "*" as a route pattern, so we use a
  // middleware with an explicit /api guard instead.
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(frontendDist, "index.html"));
  });
  logger.info({ frontendDist }, "Serving frontend static files");
} else {
  logger.warn({ frontendDist }, "Frontend dist not found — run 'npm run build' first");
}

export default app;
