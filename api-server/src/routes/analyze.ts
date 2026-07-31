import { Router, type IRouter } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import os from "os";
import { randomUUID } from "crypto";
import { execSync } from "child_process";
import ffmpeg from "fluent-ffmpeg";
import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";

/** Locate the ffmpeg binary. Returns null instead of throwing so a missing
 * binary surfaces as a per-request 500 rather than crashing the whole API
 * server at startup. */
function findFfmpeg(): string | null {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const cmd = process.platform === "win32" ? "where ffmpeg" : "which ffmpeg";
    const result = execSync(cmd).toString().trim().split("\n")[0].trim();
    if (result) return result;
  } catch {}
  const fallbacks = [
    "/usr/bin/ffmpeg",
    "/run/current-system/sw/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "C:\\ffmpeg\\bin\\ffmpeg.exe",
    "C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe",
  ];
  for (const p of fallbacks) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const RESOLVED_FFMPEG = findFfmpeg();
const FFMPEG_PATH: string | null = RESOLVED_FFMPEG ? path.normalize(RESOLVED_FFMPEG) : null;
if (FFMPEG_PATH && fs.existsSync(FFMPEG_PATH)) {
  ffmpeg.setFfmpegPath(FFMPEG_PATH);
  console.log("FFmpeg path resolved:", FFMPEG_PATH);
} else {
  console.error(
    "[analyze] FFmpeg NOT found at startup —",
    "video uploads will fail per-request with a 500 until FFMPEG_PATH is set",
    "or ffmpeg is installed on PATH. Set FFMPEG_PATH env var to override.",
  );
}

const router: IRouter = Router();

// Startup diagnostics — confirm API key is loaded WITHOUT revealing its value
console.log(`[analyze] API key loaded: ${Boolean(process.env.ANTHROPIC_API_KEY)}`);
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("[analyze] WARNING: ANTHROPIC_API_KEY is not set — /api/analyze will fail with 'API connection failed'.");
}

const upload = multer({
  dest: os.tmpdir(),
  // 200 MB is comfortably above an iPhone 4K-60 swing clip (~50 MB) while
  // making it harder to fill the tmp partition with a single bad upload.
  // (Reduced from 500 MB.)
  // fieldSize: 2 MB — frontend strips base64 frameImages from sessionHistory
  // before posting, so real fields are <100 KB. 2 MB gives a ~20× safety
  // margin without exposing the prior 200 MB worst-case combined payload
  // (10 MB × 20 fields). Now ~24 MB worst-case combined.
  limits: { fileSize: 200 * 1024 * 1024, files: 1, fields: 12, fieldSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedMime =
      /video\/(mp4|quicktime|x-m4v|avi|x-matroska|webm|3gpp)|image\/(jpeg|png|heic|heif|webp)/i;
    const allowedExt =
      /\.(mp4|mov|m4v|avi|mkv|webm|3gp|jpg|jpeg|png|heic|heif)$/i;
    // Require BOTH a plausible MIME and a plausible extension. Browser-supplied
    // mimetypes can be spoofed, but combined with extension this rejects the
    // obvious "rename .exe to .mov" case. ffprobe still validates real format.
    if (allowedMime.test(file.mimetype) && allowedExt.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported file type — please upload a video (.mp4/.mov) or image (.jpg/.png/.heic)."));
    }
  },
});

// ─── FFmpeg helpers ───────────────────────────────────────────────────────────

/** Fix #3 — probe the file before any extraction. Returns duration, or throws
 * a user-readable error. iPhone HEVC containers occasionally trip ffprobe;
 * we surface the real reason rather than the later EINVAL. */
function probeVideo(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(path.normalize(videoPath), (err, meta) => {
      if (err) {
        reject(new Error(
          "Video format not supported — please try a different video file. " +
          `(ffprobe: ${err.message})`,
        ));
        return;
      }
      resolve((meta.format.duration as number) || 3);
    });
  });
}

// Kept for backward-compat with existing callers; now just delegates to probe.
function getVideoDuration(videoPath: string): Promise<number> {
  return probeVideo(videoPath);
}

/** List newly-created JPEGs in a frame dir, sorted. */
function listFrames(frameDir: string): string[] {
  if (!fs.existsSync(frameDir)) return [];
  return fs
    .readdirSync(frameDir)
    .filter((f) => f.endsWith(".jpg"))
    .sort()
    .map((f) => path.normalize(path.join(frameDir, f)))
    .filter((f) => {
      try { return fs.statSync(f).size > 0; } catch { return false; }
    });
}

/** Extract `count` frames evenly across the video using the fps= filter.
 *  The fps filter is computed as `count / duration` so frames span the whole
 *  video uniformly. Used for Pass 1 (swing detection) where we want a broad
 *  overview — typically 30 frames across the full clip so Claude can find
 *  the actual swing inside the pre-shot routine. */
async function extractEvenFrames(
  videoPath: string,
  count: number,
  duration: number,
): Promise<{ files: string[]; frameDir: string; timestamps: number[] }> {
  const frameDir = path.normalize(path.join(os.tmpdir(), randomUUID()));
  fs.mkdirSync(frameDir, { recursive: true });

  const inputPath     = path.normalize(videoPath);
  const outputPattern = path.normalize(path.join(frameDir, "frame_%03d.jpg"));

  // fps rate = count / duration, clamped so we always get at least ~1 fps
  // (ffmpeg rejects extremely small floats) and never over 30 fps.
  const safeDuration = Math.max(duration, 1);
  const fpsRate = Math.max(0.5, Math.min(30, count / safeDuration));

  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .inputOptions([])
      .outputOptions([
        "-vf", `fps=${fpsRate.toFixed(3)},scale=800:-2`,
        "-q:v", "8",
        "-vframes", String(count),
        "-map", "0:v:0",
      ])
      .output(outputPattern)
      .on("start", (cmd) => console.log("FFmpeg CMD:", cmd))
      .on("end", () => resolve())
      .on("error", (e: Error, stdout?: string | null, stderr?: string | null) => {
        console.log("FFmpeg stdout:", stdout);
        console.log("FFmpeg stderr:", stderr);
        reject(new Error("FFmpeg extraction failed: " + e.message));
      })
      .run();
  });

  const files = listFrames(frameDir);
  console.log("Frames extracted:", files.length, "files");

  if (files.length === 0) {
    throw new Error(
      "Video format not supported — please try a different video file. " +
      "FFmpeg extracted zero frames.",
    );
  }

  // Derive evenly-distributed timestamps across the duration.
  const timestamps = files.map((_, i) => {
    const span = Math.max(duration - 0.05, 0);
    return parseFloat(((i + 0.5) * (span / files.length)).toFixed(3));
  });

  return { files, frameDir, timestamps };
}

/** Extract frames at exact timestamps (Pass 2) — uses per-frame `-ss` seek so
 * each frame is an independent ffmpeg invocation. A single bad timestamp can't
 * kill the batch, and we avoid the filter-graph EINVAL entirely. */
async function extractAtTimestamps(
  videoPath: string,
  timestamps: number[],
): Promise<{ files: string[]; frameDir: string; timestamps: number[] }> {
  const frameDir = path.normalize(path.join(os.tmpdir(), randomUUID()));
  fs.mkdirSync(frameDir, { recursive: true });

  const inputPath = path.normalize(videoPath);

  const extractOne = (t: number, outputPath: string): Promise<void> =>
    new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .inputOptions(["-ss", t.toString()])
        .outputOptions([
          "-vf", "scale=800:-2",
          "-vframes", "1",
          "-q:v", "8",
          "-map", "0:v:0",
        ])
        .output(outputPath)
        .on("start", (cmd) => console.log("FFmpeg CMD:", cmd))
        .on("end", () => resolve())
        .on("error", (e: Error, stdout?: string | null, stderr?: string | null) => {
          console.log("FFmpeg stdout:", stdout);
          console.log("FFmpeg stderr:", stderr);
          reject(new Error(`FFmpeg frame@${t.toFixed(3)}s failed: ${e.message}`));
        })
        .run();
    });

  const kept: Array<{ file: string; timestamp: number }> = [];
  for (let i = 0; i < timestamps.length; i++) {
    const t    = timestamps[i];
    const file = path.normalize(path.join(frameDir, `frame_${String(i).padStart(3, "0")}.jpg`));
    try {
      await extractOne(t, file);
      if (fs.existsSync(file) && fs.statSync(file).size > 0) {
        kept.push({ file, timestamp: t });
      }
    } catch (err) {
      console.warn(`[analyze] skipping frame @ ${t.toFixed(3)}s:`, (err as Error).message);
    }
  }

  console.log(`[analyze] Pass 2 extracted ${kept.length}/${timestamps.length} swing frame(s)`);
  console.log("Frames extracted:", kept.length, "files");

  if (kept.length === 0) {
    throw new Error("FFmpeg could not extract any swing frames at the requested timestamps.");
  }

  return {
    files:      kept.map((r) => r.file),
    frameDir,
    timestamps: kept.map((r) => r.timestamp),
  };
}

/** Resize a JPEG frame to 800px wide (keeping aspect ratio) via sharp, then
 *  base64-encode it. Sharp is more efficient than raw readFileSync when we
 *  want to guarantee payload size — it also strips any extra EXIF/metadata. */
async function fileToBase64(p: string): Promise<string> {
  const buf = await sharp(p)
    .resize({ width: 800, withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return buf.toString("base64");
}

function cleanup(...paths: string[]) {
  for (const p of paths) {
    try {
      if (fs.statSync(p).isDirectory())
        fs.rmSync(p, { recursive: true, force: true });
      else fs.unlinkSync(p);
    } catch {}
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface SessionMemory {
  date: string;
  swingType: string;
  faultsIdentified: string[];
  improvementsNoted: string[];
  weeklyFocus: string;
}

interface FeelProfileData {
  shotShape?: string;
  contact?: string;
  customFeels?: string;
  lastUpdated?: string;
}

interface CheckinResponseData {
  date:     string;
  focus:    string;
  response: "improving" | "struggling" | "not_yet";
}

type ContentBlock = Anthropic.Messages.ContentBlockParam;

// ─── CALL 0 — Pre-shot detection (strict two-pass) ───────────────────────────
//
// Pass 1 sends a broad 30-frame sweep of the full video to Claude and asks it
// to identify where the actual swing starts and ends (excluding pre-shot
// waggles, practice swings, setup routines, etc.). We then use the returned
// window to extract the 6 frames we actually analyze for coaching.

interface SwingDetection {
  swing_start_frame: number;
  swing_end_frame:   number;
  confidence:        "high" | "medium" | "low";
  notes:             string;
}

async function detectSwingBounds(
  anthropic: Anthropic,
  frames: Array<{ base64: string; timestamp: number; index: number }>,
  signal?: AbortSignal,
): Promise<SwingDetection> {
  const content: ContentBlock[] = [];

  content.push({
    type: "text",
    text: `You are analyzing frames from a golf video. Your only job is to find the LAST complete golf swing in this video.

IGNORE everything before the final swing:
- Walking up to the ball
- Practice swings or waggles that return to address
- Looking at the target
- Settling into address stance
- Any motion that does not commit to a full backswing

The real swing starts at the LAST frame where the club is stationary at address immediately before the committed takeaway begins. A committed takeaway means the body has begun rotating and the club will not return to address.

The real swing ends at the frame showing a balanced finish position — weight on lead foot, club behind the head, chest facing target.

Look at every frame carefully. If you see the golfer waggle or make a practice motion and then re-settle, ignore everything before that final re-settlement.

Return ONLY this JSON with no other text:
{
  "swing_start_frame": <integer index 0 to N>,
  "swing_end_frame": <integer index 0 to N>,
  "confidence": "<'high' | 'medium' | 'low'>",
  "notes": "<one sentence: what you saw and where the real swing begins>"
}

If confidence is low, still pick the most likely window and explain why in notes.`,
  });

  frames.forEach(({ base64, timestamp, index }) => {
    content.push({ type: "text", text: `Frame ${index} (${timestamp.toFixed(3)}s):` });
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: base64 },
    });
  });

  const res = await anthropic.messages.create(
    {
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      messages: [{ role: "user", content }],
    },
    signal ? { signal } : undefined,
  );

  const raw = res.content.find((b) => b.type === "text")?.text ?? "";
  const cleaned = raw.replace(/```json\n?|```\n?/g, "").trim();

  const tryParse = (s: string): SwingDetection | null => {
    try {
      const j = JSON.parse(s) as Record<string, unknown>;
      if (typeof j.swing_start_frame === "number" && typeof j.swing_end_frame === "number") {
        // Parenthesize the OR — the previous expression returned the BOOLEAN
        // `true` on the happy path because `||` binds looser than `?:`.
        const conf: SwingDetection["confidence"] =
          (j.confidence === "high" || j.confidence === "low")
            ? j.confidence
            : "medium";
        return {
          swing_start_frame: Math.round(j.swing_start_frame),
          swing_end_frame:   Math.round(j.swing_end_frame),
          confidence:        conf,
          notes:             String(j.notes ?? ""),
        };
      }
    } catch {}
    return null;
  };

  const parsed = tryParse(cleaned) ?? (() => {
    const m = cleaned.match(/\{[\s\S]*\}/);
    return m ? tryParse(m[0]) : null;
  })();

  if (parsed) {
    // Clamp to the sent frame range and enforce a minimum 2-frame span so the
    // 6-frame extraction window in Pass 2 doesn't collapse to a single moment.
    const maxIdx = frames.length - 1;
    parsed.swing_start_frame = Math.max(0, Math.min(maxIdx, parsed.swing_start_frame));
    parsed.swing_end_frame   = Math.max(parsed.swing_start_frame, Math.min(maxIdx, parsed.swing_end_frame));
    if (parsed.swing_end_frame - parsed.swing_start_frame < 2) {
      // Expand the window symmetrically (clamped to bounds) so we still
      // capture meaningful motion even if Claude returned a tiny range.
      const center = (parsed.swing_start_frame + parsed.swing_end_frame) / 2;
      parsed.swing_start_frame = Math.max(0, Math.floor(center - 2));
      parsed.swing_end_frame   = Math.min(maxIdx, Math.ceil(center + 2));
    }
    return parsed;
  }

  // Fallback: use middle 60% of the clip if detection fails.
  const startIdx = Math.floor(frames.length * 0.2);
  const endIdx   = Math.floor(frames.length * 0.8);
  return {
    swing_start_frame: startIdx,
    swing_end_frame:   endIdx,
    confidence:        "low",
    notes:             "Detection failed — defaulted to middle 60% of clip.",
  };
}

// ─── CALL 1 — Frame labeling (fast, small) ────────────────────────────────────
//
// Claude labels each of the 6 frames with a P1–P10 swing position and flags
// whether the position is a `strength` or a `focus-area`. We then send only
// the 2–3 focus-area frames into the heavy coaching call — avoiding re-analysis
// of all 6 large images in the big prompt.

interface LabeledFrame {
  frameIndex: number;
  position:   string;
  timestamp:  number;
  status:     "strength" | "focus-area";
}

async function labelFrames(
  anthropic: Anthropic,
  frames: Array<{ base64: string; timestamp: number; index: number }>,
  signal?: AbortSignal,
): Promise<LabeledFrame[]> {
  const content: ContentBlock[] = [];

  // Explicit frame manifest at the TOP of the prompt — this is the only set
  // of valid frameIndex values. Prevents the model from inventing or
  // interpolating timestamps that don't correspond to a real extracted frame.
  const frameManifest = frames
    .map((f, i) => `Frame ${i}: extracted at exactly ${f.timestamp.toFixed(2)}s in the original video`)
    .join("\n");

  content.push({
    type: "text",
    text: `FRAME MANIFEST — these are the ONLY frames available. You must reference frameIndex values 0 through ${frames.length - 1} only.
Never reference a frame index outside this range.
Never estimate or interpolate timestamps.

${frameManifest}

For every coaching point you return, the frameIndex field must be the integer index from this manifest that best shows the fault or position you are describing. The user will see that exact frame image next to your advice. Choose the frame where the fault is most visible.

Label each frame with its swing position P1-P10. Return only JSON: [{frameIndex, position, timestamp, status: strength|focus-area}]`,
  });

  frames.forEach(({ base64, timestamp, index }) => {
    content.push({ type: "text", text: `Frame ${index} (${timestamp.toFixed(3)}s):` });
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: base64 },
    });
  });

  const res = await anthropic.messages.create(
    {
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      messages: [{ role: "user", content }],
    },
    signal ? { signal } : undefined,
  );

  const raw = res.content.find((b) => b.type === "text")?.text ?? "";

  // Try strict parse, then array-extract fallback.
  const tryParse = (s: string): LabeledFrame[] | null => {
    try {
      const j = JSON.parse(s);
      if (Array.isArray(j)) {
        return j.map((o: Record<string, unknown>) => ({
          frameIndex: Number(o.frameIndex ?? 0),
          position:   String(o.position ?? ""),
          timestamp:  Number(o.timestamp ?? 0),
          status:     (o.status === "focus-area" ? "focus-area" : "strength") as LabeledFrame["status"],
        }));
      }
    } catch {}
    return null;
  };

  const cleaned = raw.replace(/```json\n?|```\n?/g, "").trim();
  const parsed  = tryParse(cleaned) ?? (() => {
    const m = cleaned.match(/\[[\s\S]*\]/);
    return m ? tryParse(m[0]) : null;
  })();

  if (parsed && parsed.length > 0) return parsed;

  // Fallback: treat all frames as focus-area so the pipeline still produces output.
  return frames.map((f) => ({
    frameIndex: f.index,
    position:   `P${f.index + 1}`,
    timestamp:  f.timestamp,
    status:     "focus-area",
  }));
}

// ─── Route ───────────────────────────────────────────────────────────────────

router.post("/analyze", upload.single("swing"), async (req, res) => {
  // Extend both ends of the socket to 3 minutes — ffmpeg + two Claude calls
  // can occasionally push past the Node default of 0 (no limit) on some hosts,
  // and Express downstream timeouts would otherwise chop the response short.
  req.setTimeout(180000);
  res.setTimeout(180000);

  const uploadedPath = req.file?.path;
  let detectFrameDir: string | null = null;
  let swingFrameDir:  string | null = null;

  console.log("[analyze] POST /api/analyze received. req.file:", req.file
    ? { field: req.file.fieldname, name: req.file.originalname, mime: req.file.mimetype, size: req.file.size }
    : "(none)");

  // Cancellation plumbing: if the client disconnects (browser tab closed,
  // 180s frontend AbortController fires, mobile data drops), we abort the
  // in-flight Claude SDK calls instead of paying for a discarded request.
  // Each Anthropic call burns ~$0.05 — orphaned requests add up fast.
  const requestAbort = new AbortController();
  let clientDisconnected = false;
  const onClientClose = () => {
    if (!res.writableEnded) {
      clientDisconnected = true;
      console.warn("[analyze] Client disconnected — aborting in-flight Claude calls");
      requestAbort.abort();
    }
  };
  req.on("close", onClientClose);

  try {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded — expected a form field named 'swing'." });
      return;
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(500).json({ error: "API connection failed: ANTHROPIC_API_KEY is not configured on the server." });
      return;
    }

    if (!FFMPEG_PATH || !fs.existsSync(FFMPEG_PATH)) {
      res.status(500).json({
        error: "FFmpeg is not installed on the server. Install ffmpeg or set the FFMPEG_PATH environment variable, then restart the API.",
      });
      return;
    }

    const { swingType, notes, sessionHistory, feelProfile, checkinHistory, analyticsSummary } =
      req.body as Record<string, string>;

    let previousSessions: SessionMemory[] = [];
    if (sessionHistory) {
      try { previousSessions = JSON.parse(sessionHistory); } catch {}
    }

    let playerFeelProfile: FeelProfileData | null = null;
    if (feelProfile) {
      try { playerFeelProfile = JSON.parse(feelProfile); } catch {}
    }

    let playerCheckinHistory: CheckinResponseData[] = [];
    if (checkinHistory) {
      try { playerCheckinHistory = JSON.parse(checkinHistory); } catch {}
    }

    // 150s Anthropic SDK timeout leaves ~30s buffer before the 180s client/server
    // socket deadline fires, so the user sees a clean error rather than a blank abort.
    const anthropic = new Anthropic({
      apiKey:  process.env.ANTHROPIC_API_KEY,
      timeout: 150000,
    });

    const isVideo =
      req.file.mimetype.startsWith("video/") ||
      /\.(mp4|mov|m4v|avi|mkv|webm|3gp)$/i.test(req.file.originalname);

    interface FrameData {
      base64: string;
      timestamp: number;
      index: number;
    }

    let swingFrames: FrameData[] = [];
    let videoDuration = 0;
    let swingStart    = 0;
    let swingEnd      = 0;

    if (isVideo) {
      videoDuration = await getVideoDuration(uploadedPath!);

      // Cost-saver: very short clips (< 4 s) are almost certainly the swing
      // itself with little/no pre-shot routine — skip the detection pass and
      // use the whole clip. Saves ~15 image-equivalents (~$0.04) per analysis.
      const SKIP_DETECTION_BELOW_S = 4;
      let startT: number;
      let endT: number;

      if (videoDuration < SKIP_DETECTION_BELOW_S) {
        startT = 0;
        endT   = videoDuration;
        console.log(`Swing detected: skipped (clip < ${SKIP_DETECTION_BELOW_S}s, using full duration)`);
        console.log(`Frames: full clip 0..${videoDuration.toFixed(2)}s`);
        console.log(`Confidence: n/a`);
      } else {
        // ── PASS 1 (detection): 15 frames evenly across the full video ──
        // Reduced from 30 → 15: detection only needs to spot the takeaway and
        // finish, which is robust at 15 samples. Halves Pass 0 image cost.
        const DETECT_FRAME_COUNT = 15;
        const detectResult = await extractEvenFrames(uploadedPath!, DETECT_FRAME_COUNT, videoDuration);
        detectFrameDir = detectResult.frameDir;

        const detectionFrames = await Promise.all(
          detectResult.files.map(async (f, i) => ({
            base64:    await fileToBase64(f),
            timestamp: detectResult.timestamps[i] ?? 0,
            index:     i,
          })),
        );

        req.log.info({ count: detectionFrames.length }, "Pass 1: detection frames extracted");

        // ── CALL 0: Claude finds the actual swing window, ignoring pre-shot ──
        const detection = await detectSwingBounds(anthropic, detectionFrames, requestAbort.signal);

        // Span validation: if the model returned a tiny window (often the
        // result of mistaking part of the pre-shot for the whole swing),
        // expand symmetrically around the midpoint so we still capture
        // meaningful motion in Pass 2.
        const totalFrames = detectionFrames.length;
        const span = detection.swing_end_frame - detection.swing_start_frame;
        if (span < 4) {
          console.warn(
            "Swing window too narrow:", span,
            "frames. Expanding symmetrically.",
          );
          const mid = Math.round(
            (detection.swing_start_frame + detection.swing_end_frame) / 2,
          );
          detection.swing_start_frame = Math.max(0, mid - 5);
          detection.swing_end_frame   = Math.min(totalFrames - 1, mid + 5);
        }

        console.log(
          "Swing window:", detection.swing_start_frame, "to", detection.swing_end_frame,
          "| Confidence:", detection.confidence,
          "| Notes:", detection.notes,
        );

        req.log.info(
          {
            startFrame: detection.swing_start_frame,
            endFrame:   detection.swing_end_frame,
            confidence: detection.confidence,
            notes:      detection.notes,
          },
          "Call 0: swing window detected",
        );

        // Convert frame indices → timestamps on the original video.
        startT = detectionFrames[detection.swing_start_frame]?.timestamp ?? 0;
        endT   = detectionFrames[detection.swing_end_frame]?.timestamp   ?? videoDuration;
      }
      swingStart = startT;
      swingEnd   = endT;

      // ── PASS 2: extract 6 frames evenly inside the detected swing window ──
      const span = Math.max(endT - startT, 0.3);
      const swingTimestamps = Array.from({ length: 6 }, (_, i) =>
        parseFloat((startT + (i + 0.5) * (span / 6)).toFixed(3)),
      );

      const swingResult = await extractAtTimestamps(uploadedPath!, swingTimestamps);
      swingFrameDir = swingResult.frameDir;

      const labelingFrames = await Promise.all(
        swingResult.files.map(async (f, i) => ({
          base64:    await fileToBase64(f),
          timestamp: swingResult.timestamps[i] ?? 0,
          index:     i,
        })),
      );

      req.log.info({ count: labelingFrames.length }, "Pass 2: swing-window frames extracted");

      // ── CALL 1: Label each swing-window frame P1–P10, mark status ──
      const labeled = await labelFrames(anthropic, labelingFrames, requestAbort.signal);
      req.log.info({ labeled: labeled.length }, "Call 1: frames labeled");

      // Focus-area frames are the problem spots — cap at 3 to keep Call 2 small.
      const focusIndices = new Set(
        labeled.filter((l) => l.status === "focus-area").slice(0, 3).map((l) => l.frameIndex),
      );

      let selected = labelingFrames.filter((f) => focusIndices.has(f.index));
      if (selected.length === 0) {
        selected = [labelingFrames[1], labelingFrames[3], labelingFrames[5]].filter(Boolean) as typeof labelingFrames;
      }

      // Use the real extraction timestamp from the labelingFrames entry —
      // not the label's own timestamp field, which can be missing or wrong
      // if Claude returned duplicate or reordered frameIndices in Pass 1.
      swingFrames = selected.map((f, i) => ({
        base64:    f.base64,
        timestamp: f.timestamp,
        index:     i, // reindex 0..(n-1) so prompt frameMap stays aligned with sent images
      }));

      req.log.info(
        { frames: swingFrames.length, swingStart, swingEnd },
        "Call 2 input: focus-area frames",
      );
    } else {
      // Single image
      swingFrames = [{
        base64:    await fileToBase64(uploadedPath!),
        timestamp: 0,
        index:     0,
      }];
    }

    // ── PASS 3: Full Claude analysis ──────────────────────────────────────────

    // Cap user free-text fields before they go into the prompt so a long
    // textarea entry can't blow past Anthropic's per-block size limit and
    // surface as an opaque "field too long" error.
    const truncate = (s: string, max: number): string =>
      s.length <= max ? s : s.slice(0, max) + "…";
    const safeNotes = truncate((notes || "").trim(), 500);
    const safeCustomFeels = playerFeelProfile
      ? truncate((playerFeelProfile.customFeels || "").trim(), 500)
      : "";

    const feelProfileText = playerFeelProfile
      ? `\n\nPlayer feel profile from recent rounds:
  Shot shape tendency: ${truncate(playerFeelProfile.shotShape || "not specified", 120)}
  Contact quality: ${truncate(playerFeelProfile.contact || "not specified", 120)}
  Self-reported swing feels: ${safeCustomFeels || "none"}
  Last updated: ${playerFeelProfile.lastUpdated || "unknown"}

Reference these naturally in your analysis. If you can see the reported shot shape tendency in the video frames, confirm it. If you cannot see it, note that it may be a feel issue rather than a visible swing fault.`
      : "";

    const sessionHistoryText =
      previousSessions.length > 0
        ? `\n\nPREVIOUS SESSIONS (reference naturally — celebrate improvements, acknowledge recurring patterns):\n${previousSessions
            .slice(0, 5)
            .map(
              (s, i) =>
                `Session ${i + 1} (${s.date}, ${s.swingType}):\n  Faults: ${s.faultsIdentified.join(", ") || "none"}\n  Improvements: ${s.improvementsNoted.join(", ") || "none"}\n  Focus was: ${s.weeklyFocus || "not recorded"}`,
            )
            .join("\n")}`
        : "\n\nThis is the golfer's FIRST session — no history yet.";

    // ── Check-in progression (CHANGE 4B) ──
    // Tally the golfer's self-reported state for each previous weekly focus so
    // Claude can apply the 4-rule progression: de-prioritize items they report
    // improving on, archive items they've improved on twice, reframe items
    // they've struggled with 3+ times, and always introduce at least one new
    // focus each session.
    // Normalize focus strings (lowercase, strip punctuation, collapse spaces)
    // so Claude's per-session phrasing drift doesn't fragment the tally.
    // Keeps the most recent human-readable form for display in the prompt.
    const normFocusKey = (s: string) =>
      s.trim().toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ");
    const checkinTally = new Map<
      string,
      { display: string; improving: number; struggling: number; not_yet: number }
    >();
    // Cap to the 30 most-recent check-ins. Older signals are stale anyway,
    // and uncapped iteration was the largest unbounded prompt growth path.
    const recentCheckins = playerCheckinHistory.slice(0, 30);
    for (const r of recentCheckins) {
      const f = (r.focus || "").trim();
      if (!f) continue;
      const key = normFocusKey(f);
      if (!key) continue;
      if (r.response !== "improving" && r.response !== "struggling" && r.response !== "not_yet") continue;
      const cur = checkinTally.get(key) ?? { display: truncate(f, 120), improving: 0, struggling: 0, not_yet: 0 };
      cur[r.response] += 1;
      checkinTally.set(key, cur);
    }

    const checkinLines: string[] = [];
    for (const t of checkinTally.values()) {
      const parts: string[] = [];
      if (t.improving)  parts.push(`improving ×${t.improving}`);
      if (t.struggling) parts.push(`struggling ×${t.struggling}`);
      if (t.not_yet)    parts.push(`not yet ×${t.not_yet}`);
      checkinLines.push(`  - "${t.display}": ${parts.join(", ")}`);
    }

    // ── Analytics block ──
    // Pre-formatted career SG + basic stats from the frontend. Injected
    // verbatim so the prompt structure here stays clean.
    const analyticsText = (analyticsSummary && analyticsSummary.trim().length > 0)
      ? `\n\n${analyticsSummary.trim()}`
      : "";

    const checkinText =
      checkinLines.length > 0
        ? `\n\nPLAYER SELF-REPORTED PROGRESS (from before-analysis check-ins):
${checkinLines.join("\n")}

PROGRESSION RULES — apply these when choosing coaching points:
1. Any focus the golfer has reported IMPROVING on ONCE → de-prioritize it. Mention briefly ("your takeaway feels better — great") but do NOT make it a priority fix again unless it clearly re-appears in the video.
2. Any focus reported IMPROVING on TWO OR MORE times → treat it as ARCHIVED. Do not raise it as a fix this session. Celebrate the progress in the opening message only.
3. Any focus reported STRUGGLING on THREE OR MORE times → REFRAME the approach. Do not repeat the same feeling cue or drill. Try a different angle — a different body part, a different feel, a different pro reference, a different drill. Acknowledge explicitly that the previous cue did not click.
4. ALWAYS introduce at least ONE new focus area per session — never hand back only the same fixes the golfer has been working on.`
        : "";

    // Hard safety cap — the 2-call flow already limits focus-area to 3, but
    // belt-and-suspenders in case someone changes that selection logic later.
    const MAX_FRAMES = 3;
    if (swingFrames.length > MAX_FRAMES) {
      swingFrames = swingFrames.slice(0, MAX_FRAMES);
    }

    const totalKB = swingFrames.reduce((s, f) => s + f.base64.length * 0.75, 0) / 1024;
    console.log("Payload:", totalKB.toFixed(0), "KB across", swingFrames.length, "frames");

    // Coaching-pass frame manifest. The user will see the exact frame at
     // fix.frameIndex next to your advice — pick the one where the fault
     // is most visible.
    const frameMap = swingFrames
      .map((f) => `Frame ${f.index}: extracted at exactly ${f.timestamp.toFixed(2)}s in the original video`)
      .join("\n");

    const messageContent: ContentBlock[] = [];

    messageContent.push({
      type: "text",
      text: `You are a master golf instructor who understands swing sequencing. When prioritizing fixes, think like a teacher who knows that correcting setup and grip issues first makes backswing corrections easier, which makes downswing corrections easier, which makes impact improvements natural. A beginner should be able to follow your priority order and have each fix build logically on the previous one. Never give a golfer a downswing fix before addressing the setup issue that is causing the downswing problem.

You combine the eye of Butch Harmon, the biomechanical precision of Sean Foley, the player psychology of Claude Harmon III, and the technical depth of Pete Cowen.

SWING CONTEXT:
- Shot type: ${swingType || "full swing"}
- Full video duration: ${videoDuration.toFixed(2)}s
- Actual swing detected: ${swingStart.toFixed(2)}s → ${swingEnd.toFixed(2)}s (pre-shot routine excluded)
- Player notes: ${safeNotes || "none"}
- Frames available: ${swingFrames.length} (one every 0.1s across swing)
${feelProfileText}${sessionHistoryText}${checkinText}${analyticsText}

FRAME MANIFEST — these are the ONLY frames available. You must reference frameIndex values 0 through ${swingFrames.length - 1} only. Never reference a frame index outside this range. Never estimate or interpolate timestamps. The user will see the exact frame image at fix.frameIndex next to your advice — choose the frame where the fault is most visible.

${frameMap}

═══════════════════════════════════════════
ANALYSIS INSTRUCTIONS
═══════════════════════════════════════════

1. View ALL ${swingFrames.length} frames to understand the full swing motion before identifying positions.

2. Produce a focused coaching session of 4–7 coaching points total:
   - 2 strengths (status: "strength") — what is genuinely working
   - exactly 2 priority fixes (status: "focus-area") — the two most impactful changes only
   - 0–3 extra observations (status: "extra-observation") — minor things worth flagging without full coaching treatment

   Quality over quantity. The two priority fixes are the only items that need full coaching treatment (proRef + feelingCue always; practiceDrill/youtubeSearch per the MEDIA JUDGMENT rule below).

3. For EACH coaching point, pick the SINGLE best frame that most clearly shows that position or fault. Use its EXACT frameIndex and timestamp from the map above.

4. Look for faults that occur BETWEEN standard positions (grip problems at address, early extension mid-backswing, casting in transition, etc.) — flag these as "extra-observation" points.

5. EXACT FRAME MATCHING — NON-NEGOTIABLE: For every coaching point you make, you MUST reference the exact frameIndex from the map above. Do NOT interpolate, do NOT estimate, do NOT invent a frameIndex between two listed values. The frameIndex must be an integer from 0 to ${swingFrames.length - 1} that appears in the map. Same rule for timestamp — it must be the EXACT decimal listed in the map for that frameIndex.

═══════════════════════════════════════════
PRIORITY ORDER — assign coachingPriority integers
═══════════════════════════════════════════

Use LOWER numbers = fix this FIRST:

  1–3   → Setup, grip, and posture faults (fixing these makes EVERY downstream position easier)
  4–6   → Takeaway and early backswing faults
  7–9   → Top of backswing faults
  10–13 → Transition and downswing faults
  14–17 → Impact faults
  18–19 → Follow-through faults (often symptoms of earlier faults — note but deprioritize)
  20–30 → Strengths (celebrate, no priority needed)

Extra-observation faults that appear at address or grip get priority 1–3 even if they are structural rather than motion.

═══════════════════════════════════════════
COACHING PHILOSOPHY
═══════════════════════════════════════════

- Lead with genuine encouragement — find what is actually working first
- Reference previous sessions naturally when they exist
- Name real PGA Tour players: Rory McIlroy, Scottie Scheffler, Jon Rahm, Dustin Johnson, Collin Morikawa, Viktor Hovland, Xander Schauffele, Brooks Koepka
- Generate ORIGINAL feeling cues in CaddyIQ's own voice — never quote a coach directly or reproduce known phrases
- After each feeling cue, credit: "Concept inspired by [First Name Last Name]'s [specific teaching concept]"
- Give ONE focused weekly drill — not a list

VOICE — every "observation" and "description" string:
- Write like you're talking to the golfer, not filing a report. Narrative sentences, not clinical bullet fragments.
- Upbeat, concise, get to the point fast. No filler ("it's worth noting that", "one thing to consider is").
- Say what you see, why it matters, and stop. 1-3 sentences max — shorter is better when the fix is simple.

MEDIA JUDGMENT — for each priority fix (focus-area), decide case-by-case whether it needs attached media:
- Simple, posture-level, one-cue fixes (grip pressure, ball position, stance width, alignment) → feelingCue only. OMIT practiceDrill and youtubeSearch entirely — a one-line feel adjustment doesn't need a video and drill turning a small tweak into homework.
- Mechanically complex faults that need repetition to groove (swing plane, sequencing/transition, casting, early extension, path/face timing) → include practiceDrill and/or youtubeSearch, whichever actually helps. You don't need both every time.
- Use your judgment on which fixes are "simple" vs "complex" — don't attach media reflexively to every fix.

COPYRIGHT: All feeling cues must be original CaddyIQ language. Never reproduce a coach's known phrases verbatim.

═══════════════════════════════════════════
RETURN FORMAT — valid JSON only (start { end })
═══════════════════════════════════════════

{
  "headline": "<punchy 4-8 word title>",
  "openingMessage": "<2-3 warm encouraging sentences — reference previous sessions if they exist>",
  "whatsWorking": [
    "<specific strength with detail>",
    "<second specific strength>"
  ],
  "coachingPoints": [
    {
      "positionLabel": "<e.g. 'P1 — Address / Setup' | 'P4 — Top of backswing' | 'Grip fault — Address' | 'Early extension — P6'>",
      "frameIndex": <exact integer index from the map above — 0 to ${swingFrames.length - 1}>,
      "timestamp": <exact decimal timestamp from the map above>,
      "status": "<strength | focus-area | extra-observation>",
      "observation": "<what you specifically see in this exact frame — precise, visual>",
      "coachingPriority": <integer per priority table above>,
      "title": "<fault name — omit for strengths>",
      "description": "<2-3 sentences: what the fault is, why it costs them, ball flight consequence — omit for strengths>",
      "proRef": {
        "player": "<real PGA Tour player>",
        "comparison": "<what this player does that addresses this fault>"
      },
      "feelingCue": "<original CaddyIQ-voice tactile cue — what the body physically feels>",
      "feelingCueCredit": "Concept inspired by <Coach Full Name>'s <specific teaching concept>",
      "practiceDrill": {
        "name": "<named drill>",
        "description": "<step by step how to do it>",
        "reps": "<specific reps and sets>"
      },
      "youtubeSearch": {
        "query": "<specific search query for this exact fault>",
        "channel": "<recommended channel — Me and My Golf | Rick Shiels | Danny Maude | Chris Ryan Golf | Rotary Swing | Performance Golf>"
      }
    }
  ],
  "weeklyFocus": "<ONE sentence. ONE thing only.>",
  "closingMessage": "<1-2 sentences of genuine encouragement>",
  "feelingLayer": {
    "narrative": "<1-3 sentences, OMIT this whole object if you have nothing genuine to say here>"
  },
  "sessionSummary": {
    "faultsIdentified": ["<fault 1>", "<fault 2>"],
    "improvementsNoted": ["<improvement visible from previous session, or empty array>"]
  }
}

FEELING LAYER — comes LAST, after every coaching point above already exists:
- This is NOT a new fault. It connects tempo/contact-quality FEEL (thin/fat contact, rushed tempo, timing) to the mechanical faults you already wrote about above — causally, using their actual titles/descriptions as reference.
- Pattern: "<feel/contact symptom> is what's happening because of <mechanical fault you already named>" — e.g. "That quick tempo and early release ('casting') is what's causing the ball-then-ground contact instead of ball-then-turf." Don't just restate a fault in different words — draw the causal line from cause (mechanics above) to effect (the feel/contact outcome).
- Only include this section if the video or the player's feel profile actually shows a tempo/contact symptom connected to a fault you already flagged. If there's nothing genuine to connect, OMIT the "feelingLayer" key entirely — do not invent a connection.

CRITICAL RULES:
• coachingPoints: 4–7 entries total — exactly 2 strengths, exactly 2 priority fixes, 0–3 extra observations
• Every frameIndex must be a real index from the map (0–${swingFrames.length - 1})
• Every timestamp must be the exact value from the map
• Strengths: omit title, description, proRef, feelingCue, feelingCueCredit, practiceDrill, youtubeSearch
• Priority fixes (focus-area): feelingCue is always required. practiceDrill and youtubeSearch are OPTIONAL per the MEDIA JUDGMENT rule above — omit both for simple one-cue fixes, include what's useful for mechanically complex faults
• Extra observations: title + description only — no proRef/feelingCue/practiceDrill/youtubeSearch
• feelingLayer is OPTIONAL — omit entirely if there's no genuine causal connection to draw
• Do not include null values — just omit the field
• Be concise: descriptions under 100 words, feelingCues under 50 words, feelingLayer narrative under 60 words`,
    });

    swingFrames.forEach(({ base64, timestamp, index }) => {
      messageContent.push({
        type: "text",
        text: `--- Frame ${index} (${timestamp.toFixed(3)}s) ---`,
      });
      messageContent.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: base64 },
      });
    });

    messageContent.push({
      type: "text",
      text: "Return your complete coaching JSON now. Exactly 2 strengths, exactly 2 priority fixes (focus-area, with proRef+feelingCue always, practiceDrill/youtubeSearch only when the fault is mechanically complex enough to need them), and 0–3 extra observations (title + description only). Add feelingLayer only if there's a genuine causal connection to draw — omit it otherwise. Write every observation/description in a narrative, upbeat, concise voice — not clinical bullet fragments. Use exact frameIndex and timestamp values from the map. Keep descriptions under 100 words, feelingCues under 50 words, feelingLayer narrative under 60 words.",
    });

    req.log.info({ frames: swingFrames.length }, "Pass 3: sending to Claude");

    const messageContent_size = JSON.stringify(messageContent).length;
    console.log('Total payload size:', (messageContent_size / 1024).toFixed(1), 'KB');
    messageContent.forEach((item, i) => {
      if (item.type === 'text') {
        console.log('Text block', i, ':', item.text.length, 'chars');
      }
      if (item.type === 'image' && item.source.type === 'base64') {
        console.log('Image block', i, ':',
          (item.source.data.length / 1024).toFixed(1), 'KB base64');
      }
    });

    let claudeRes: Anthropic.Messages.Message;
    try {
      claudeRes = await anthropic.messages.create(
        {
          model: "claude-sonnet-4-6",
          // 8000 leaves headroom for 4–7 fully-populated coaching points plus
          // headline/opening/closing/sessionSummary. Previous 4000 was the
          // root cause of the "JSON truncated mid-stream" issue.
          max_tokens: 8000,
          messages: [{ role: "user", content: messageContent }],
        },
        { signal: requestAbort.signal },
      );
      // Surface the real stop reason so we can detect token-limit truncation
      // ("max_tokens") vs. a clean finish ("end_turn").
      console.log(
        "[analyze] Pass 3 stop_reason:", claudeRes.stop_reason,
        "input:", claudeRes.usage?.input_tokens,
        "output:", claudeRes.usage?.output_tokens,
      );
    } catch (apiErr: unknown) {
      // Client-disconnect aborts come back as DOMException("AbortError") or
      // similar. Don't log them as scary "API call failed" — bail quietly.
      if (clientDisconnected || (apiErr instanceof Error && apiErr.name === "AbortError")) {
        req.log.info("[analyze] Pass 3 aborted (client disconnect)");
        return;
      }
      const e = apiErr as {
        status?: number;
        message?: string;
        error?: { error?: { message?: string; type?: string } };
        response?: { data?: unknown };
      };
      console.error("[analyze] Claude API call failed:", {
        status: e?.status,
        message: e?.message,
        errorBody: e?.error,
        responseData: e?.response?.data,
      });
      req.log.error({ err: apiErr }, "Claude API call failed");
      const apiMsg = e?.error?.error?.message || e?.message || "Unknown Claude API error";
      if (e?.status === 401 || e?.status === 403) {
        throw new Error(`API connection failed: authentication error — ${apiMsg}`);
      }
      if (e?.status === 413 || /too large|payload/i.test(apiMsg)) {
        throw new Error(`Video too large: ${apiMsg}`);
      }
      if (e?.status === 429) {
        throw new Error(`API connection failed: rate limited — ${apiMsg}`);
      }
      throw new Error(`Claude API error: ${apiMsg}`);
    }

    const rawText = claudeRes.content.find((b) => b.type === "text")?.text ?? "";

    // Diagnostic logging — if Claude truncates mid-JSON we need to see exactly
    // where the response was cut off so we can tune max_tokens or the prompt.
    console.log("Claude response length:", rawText.length, "chars");
    console.log("First 200 chars:", rawText.slice(0, 200));
    console.log("Last 200 chars:", rawText.slice(-200));

    const cleaned = rawText.replace(/```json\n?|```\n?/g, "").trim();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      const parseErr = e as Error;
      // Try to salvage truncated JSON by finding the last complete object
      // before the cut and closing the enclosing structure.
      const lastBrace   = cleaned.lastIndexOf("},");
      const lastBracket = cleaned.lastIndexOf("]");
      if (lastBrace > 0 || lastBracket > 0) {
        try {
          const truncated = cleaned.substring(0, Math.max(lastBrace, lastBracket) + 1);
          const salvaged  = truncated + "]}";
          parsed = JSON.parse(salvaged);
          console.log("Warning: JSON was truncated, salvaged partial response");
        } catch {
          throw new Error("Claude response was cut off mid-JSON. Position: " + parseErr.message);
        }
      } else {
        throw new Error("Could not parse Claude response: " + parseErr.message);
      }
    }

    // ── Derive `fixes` array for backward-compat with session history display ──
    type CP = {
      positionLabel?: string;
      frameIndex?: number;
      timestamp?: number;
      status?: string;
      observation?: string;
      coachingPriority?: number;
      title?: string;
      description?: string;
      proRef?: { player: string; comparison: string };
      feelingCue?: string;
      feelingCueCredit?: string;
      practiceDrill?: { name: string; description: string; reps: string };
      youtubeSearch?: { query: string; channel: string };
      severity?: "green" | "yellow" | "red";
    };

    // Defensive: Claude's salvaged JSON has been observed to return
    // `coachingPoints` as `null` or an object on truncation edges. The cast
    // alone won't protect us — explicitly normalize to an array so the
    // downstream `for…of` and `.filter` can never throw "not iterable."
    const coachingPoints: CP[] = Array.isArray(parsed.coachingPoints)
      ? (parsed.coachingPoints as CP[])
      : [];

    // ── frameIndex validation ──
    // Every coaching point's frameIndex MUST point at a real extracted frame,
    // and its timestamp MUST come from that frame's actual extraction time
    // (not a Claude-invented number). Without this, the frontend renders
    // a coaching card whose image doesn't match the position being described.
    const N = swingFrames.length;
    if (N === 0) {
      // No frames to attribute coaching points to — extremely defensive,
      // would only happen if Pass 2 dropped every selected frame. Skip
      // the bounds-check loop entirely so we don't deref undefined.
      console.warn("[analyze] No swingFrames available for frameIndex stamping; skipping bounds check.");
    } else {
      for (const cp of coachingPoints) {
        if (
          cp.frameIndex === undefined ||
          cp.frameIndex === null ||
          !Number.isFinite(cp.frameIndex) ||
          cp.frameIndex < 0 ||
          cp.frameIndex >= N
        ) {
          console.warn(
            "Invalid frameIndex on coaching point:",
            cp.title || cp.positionLabel || "(untitled)",
            "value:", cp.frameIndex,
            "— defaulting to frame 0",
          );
          cp.frameIndex = 0;
        }
        // Stamp the real extraction timestamp so the frontend can seek the
        // video to the exact moment the AI is referencing. Optional-chain
        // belt-and-suspenders in case the bounds check ever drifts.
        cp.timestamp = swingFrames[cp.frameIndex]?.timestamp ?? 0;
      }
    }

    // ── severity derivation ──
    // Frontend checkpoint bar needs a 3-state color (green/yellow/red) per
    // coaching point for its dots. We already have `status`, which is a
    // reasonable proxy — derive severity from it here rather than asking
    // Claude for a redundant field (no extra model call, no extra tokens).
    for (const cp of coachingPoints) {
      cp.severity =
        cp.status === "strength"          ? "green"
        : cp.status === "extra-observation" ? "yellow"
        : "red"; // focus-area — the two priority fixes
    }

    const fixes = coachingPoints
      .filter((p) => p.status !== "strength")
      .sort((a, b) => (a.coachingPriority ?? 99) - (b.coachingPriority ?? 99))
      .map((p, i) => {
        // frameIndex was already validated above; safe to dereference.
        const idx = p.frameIndex ?? 0;
        const ts  = swingFrames[idx]?.timestamp ?? 0;
        return {
          // Preserve true ordering (1, 2, 3, 4...) — the previous ternary
          // capped every fix beyond the second at priority 3, breaking
          // SessionsPage display for analyses with 3+ fixes.
          priority:        i + 1,
          title:           p.title || p.positionLabel || `Fix ${i + 1}`,
          position:        p.positionLabel || "",
          positionCode:    (p.positionLabel || "").split(" ")[0],
          frameIndex:      idx,
          timestamp:       ts,
          frameTimestamp:  ts, // explicit per spec — frontend reads this for seek
          description:     p.description || p.observation || "",
          proRef:          p.proRef,
          feelingCue:      p.feelingCue,
          feelingCueCredit:p.feelingCueCredit,
          practiceDrill:   p.practiceDrill,
          youtubeSearch:   p.youtubeSearch,
          severity:        p.severity,
        };
      });

    parsed.fixes               = fixes;
    parsed.videoFramesAnalyzed = swingFrames.length;
    parsed.isVideoAnalysis     = isVideo;
    parsed.videoDuration       = videoDuration;
    parsed.frameTimestamps     = swingFrames.map((f) => f.timestamp);
    parsed.swingStart          = swingStart;
    parsed.swingEnd            = swingEnd;

    // Return ALL extracted frames as base64 so frontend can look up any frame
    // by index. `index` is the canonical 0..N-1 used by every coachingPoint
    // and fix.frameIndex returned above — frontend should index this array
    // directly rather than trusting any other ordering.
    parsed.frameImages = swingFrames.map((f) => ({
      base64:    f.base64,
      timestamp: f.timestamp,
      index:     f.index,
      code:      `F${f.index}`,
      position:  `Frame ${f.index}`,
    }));

    res.json({ success: true, analysis: parsed });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Analysis failed";
    req.log.error({ err }, "Analysis error");
    // If the socket was closed mid-response, res.json can throw — guard so
    // the finally cleanup still runs and we don't escape to Express's default
    // HTML error handler.
    if (!res.headersSent) {
      try { res.status(500).json({ error: message }); } catch {}
    }
  } finally {
    // Detach the close listener so we don't leak handlers across requests.
    req.removeListener("close", onClientClose);
    if (clientDisconnected) {
      req.log.info("[analyze] Request was aborted by client; cleaning up tmp files");
    }
    if (uploadedPath)    cleanup(uploadedPath);
    if (detectFrameDir)  cleanup(detectFrameDir);
    if (swingFrameDir)   cleanup(swingFrameDir);
  }
});

export default router;
