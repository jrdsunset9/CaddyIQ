import fs from "fs";
try {
  for (const line of fs.readFileSync(
    new URL("../.env", import.meta.url), "utf8"
  ).split("\n")) {
    const m = line.replace(/^\uFEFF/, "").match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {}

// Force-override .env FIRST, before any module that reads process.env at
// import time. This side-effect import runs before any other import below.
import "./env-override";

// Everything else must be loaded AFTER the override runs. In ESM, static
// imports are hoisted and fully evaluated before the module body runs —
// so we dynamic-import `./app` (and anything that reads env at import time)
// from inside an async bootstrap function.
async function main() {
  const { default: app }   = await import("./app");
  const { logger }         = await import("./lib/logger");

  const rawPort = process.env["PORT"];

  if (!rawPort) {
    throw new Error(
      "PORT environment variable is required but was not provided.",
    );
  }

  const port = Number(rawPort);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}

main().catch((err) => {
  console.error("[index] fatal startup error:", err);
  process.exit(1);
});
