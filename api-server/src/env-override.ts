// ─── .env force-override loader ──────────────────────────────────────────────
// Node's `--env-file` flag will NOT override an env var that is already set
// in the parent process (even to an empty string). Some host environments
// (notably Claude Code) pre-set ANTHROPIC_API_KEY="" in every subshell, which
// silently wins over the value in .env. Load the file ourselves and force
// the values in so .env always has the final word.
//
// IMPORTANT: this file must be imported BEFORE any module that reads
// process.env at import time (e.g. the Anthropic client in analyze.ts).
// In ESM, static imports are hoisted — so the caller must use a dynamic
// `await import("./app")` AFTER importing this file, otherwise the app
// module graph evaluates before this override runs.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

try {
  const here    = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(here, "..", ".env");
  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let   val = trimmed.slice(eq + 1).trim();
      // Strip matching surrounding quotes if present
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      // Force-override, even if the parent process already set it (possibly empty)
      process.env[key] = val;
    }
  }
} catch (err) {
  console.warn("[env-override] .env force-override failed:", (err as Error).message);
}
