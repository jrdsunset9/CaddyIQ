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
// CORS — same-origin (frontend served from this Express) doesn't need this.
// It only matters when the frontend is on a different domain: Vite dev server,
// a Vercel preview, iOS simulator hitting a remote backend, etc.
//
// `origin: true` reflects the request Origin header (NOT `*`), which is the
// only value the browser accepts alongside `credentials: true`. When
// FRONTEND_URL is set, we switch to a strict allow-list for production safety.
const corsOrigin: cors.CorsOptions["origin"] = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL, "http://localhost:5173", "http://localhost:3000"]
  : true;
app.use(cors({ origin: corsOrigin, credentials: true }));
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

// Serve the built React frontend if a `dist/` is available.
//
// Deploy topologies we need to support without surgery:
//   - Railway / Replit with cwd = `api-server/` → dist at `../dist`
//   - Local `npm start` from project root      → dist at `./dist`
//   - Future iOS-only backend (no frontend)    → no dist, just API
//   - Frontend hosted separately on Vercel     → set FRONTEND_DIST=""
//
// FRONTEND_DIST env var is the explicit override; otherwise we probe
// candidates in order and require `index.html` to exist (so a stray empty
// `dist/` directory doesn't trick the SPA fallback into serving 404s).
function resolveFrontendDist(): string | null {
  const override = process.env.FRONTEND_DIST;
  if (override !== undefined) {
    if (override === "") return null; // explicit opt-out (API-only mode)
    const resolved = path.resolve(override);
    return fs.existsSync(path.join(resolved, "index.html")) ? resolved : null;
  }
  const candidates = [
    path.join(process.cwd(), "dist"),
    path.join(process.cwd(), "..", "dist"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "index.html"))) return c;
  }
  return null;
}

const frontendDist = resolveFrontendDist();
if (frontendDist) {
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
  logger.info(
    "Frontend dist not found — running in API-only mode. " +
    "Set FRONTEND_DIST or run 'npm run build' from the project root.",
  );
}

export default app;
