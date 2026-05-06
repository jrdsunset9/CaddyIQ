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
app.use(cors());
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
    res.status(status).json({ error