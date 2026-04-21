import { Router, type IRouter } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import os from "os";
import { randomUUID } from "crypto";
import { execSync } from "child_process";
import ffmpeg from "fluent-ffmpeg";
import Anthropic from "@anthropic-ai/sdk";

function findFfmpeg(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const cmd = process.platform === "win32" ? "where ffmpeg" : "which ffmpeg";
    const result = execSync(cmd).toString().trim().split("\n")[0].trim();
    if (result) return result;
  } catch {}
  const fallbacks = [
    "C:\\ffmpeg\\bin\\ffmpeg.exe",
    "C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe",
    "/usr/local/bin/ffmpeg",
    "/usr/bin/ffmpeg",
  ];
  for (const p of fallbacks) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("FFmpeg not found. Set FFMPEG_PATH environment variable.");
}

const FFMPEG_PATH = path.normalize(findFfmpeg());
ffmpeg.setFfmpegPath(FFMPEG_PATH);
console.log("FFmpeg path resolved:", FFMPEG_PATH);
console.log("FFmpeg binary:", FFMPEG_PATH);
console.log("FFmpeg exists:", fs.existsSync(FFMPEG_PATH));
if (!fs.existsSync(FFMPEG_PATH)) {
  throw new Error(`FFmpeg binary not found at "${FFMPEG_PATH}". Set FFMPEG_PATH or install ffmpeg.`);
}

const router: IRouter = Router();

// Startup diagnostics — confirm API key is loaded WITHOUT revealing its value
console.log(`[analyze] API key loaded: ${Boolean(process.env.ANTHROPIC_API_KEY)}`);
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("[analyze] WARNING: ANTHROPIC_API_KEY is not set — /api/analyze will fail with 'API connection failed'.");
}

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed =
      /video\/(mp4|quicktime|x-m4v|avi|x-matroska|webm|3gpp)|image\/(jpeg|png|heic|heif|webp)/i;
    if (
      allowed.test(file.mimetype) ||
      /\.(mp4|mov|m4v|avi|mkv|webm|3gp|jpg|jpeg|png|heic|heif)$/i.test(
        file.originalname,
      )
    ) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported file type"));
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

/** Extract frames evenly across the video using the fps= filter (Fix #1).
 *  This replaces the old `select='eq(t\,X)+...'` approach that was producing
 *  exit code 4294967274 (EINVAL) on iPhone HEVC/H.265 MOV files. The fps filter
 *  is computed so that `count` frames span the full duration.
 *
 *  Pass 1 target: up to 30 frames. Per the fix spec, if duration is short we
 *  fall back to `fps=3 -vframes 30` literally; otherwise we spread `count`
 *  frames evenly with `fps=count/duration`.
 *
 *  On failure, retries once with `thumbnail=30 -vframes 10` (Fix #4) — ffmpeg's
 *  built-in thumbnail filter works on virtually any decodable format.
 */
async function extractEvenFrames(
  videoPath: string,
  count: number,
  duration: number,
): Promise<{ files: string[]; frameDir: string; timestamps: number[] }> {
  const frameDir = path.normalize(path.join(os.tmpdir(), randomUUID()));
  fs.mkdirSync(frameDir, { recursive: true });

  const inputPath     = path.normalize(videoPath);
  const outputPattern = path.normalize(path.join(frameDir, "frame_%03d.jpg"));

  // Verbatim verified config — do NOT add -vsync vfr, -ss on input, or select=eq(t\,…)
  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .inputOptions([])
      .outputOptions([
        "-vf", "fps=2.34,scale=1024:-2",
        "-q:v", "5",
        "-vframes", "10",
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
      "FFmpeg extracted zero frames with both the primary and thumbnail filters.",
    );
  }

  // Derive synthetic timestamps evenly distributed across the duration —
  // the fps filter produces frames at regular intervals, so this accurately
  // reflects where each frame sits in the original video.
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
          "-vf", "scale=1024:-2",
          "-vframes", "1",
          "-q:v", "5",
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

function fileToBase64(p: string): string {
  return fs.readFileSync(p).toString("base64");
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

type ContentBlock = Anthropic.Messages.ContentBlockParam;

// ─── PASS 1 — Swing detection ─────────────────────────────────────────────────

async function detectSwingBounds(
  anthropic: Anthropic,
  frames: Array<{ base64: string; timestamp: number }>,
  videoDuration: number,
): Promise<{ swingStart: number; swingEnd: number }> {
  const content: ContentBlock[] = [];

  content.push({
    type: "text",
    text: `You are analyzing a golf swing video. These ${frames.length} frames are evenly spaced across the full video (frame 0 to frame ${frames.length - 1}). Your job is to find the actual golf swing and ignore everything else — pre-shot routine, waggle, practice moves, looking at target, walking into address.

The real swing starts when the club makes a COMMITTED move away from the ball (not a waggle — an actual takeaway). The swing ends when the golfer reaches a balanced finish position.

If multiple swings appear, use the LAST complete swing only.

Return ONLY a JSON object: { "swing_start_frame": <0-${frames.length - 1}>, "swing_end_frame": <0-${frames.length - 1}> }`,
  });

  frames.forEach(({ base64, timestamp }, i) => {
    content.push({ type: "text", text: `Frame ${i} (${timestamp.toFixed(3)}s):` });
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: base64 },
    });
  });

  const res = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 256,
    messages: [{ role: "user", content }],
  });

  const raw = res.content.find((b) => b.type === "text")?.text ?? "";
  try {
    const m = raw.match(/\{[\s\S]*?\}/);
    if (m) {
      const parsed = JSON.parse(m[0]) as {
        swing_start_frame?: number;
        swing_end_frame?: number;
      };
      const si = Math.max(0, Math.min(frames.length - 1, parsed.swing_start_frame ?? 0));
      const ei = Math.max(0, Math.min(frames.length - 1, parsed.swing_end_frame ?? frames.length - 1));
      const swingStart = frames[si]?.timestamp ?? 0;
      const swingEnd   = frames[ei]?.timestamp ?? videoDuration;
      if (swingEnd > swingStart + 0.3) return { swingStart, swingEnd };
    }
  } catch {}

  return { swingStart: 0, swingEnd: videoDuration };
}

// ─── Route ───────────────────────────────────────────────────────────────────

router.post("/analyze", upload.single("swing"), async (req, res) => {
  const uploadedPath = req.file?.path;
  let detectFrameDir: string | null = null;
  let swingFrameDir:  string | null = null;

  console.log("[analyze] POST /api/analyze received. req.file:", req.file
    ? { field: req.file.fieldname, name: req.file.originalname, mime: req.file.mimetype, size: req.file.size }
    : "(none)");

  try {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded — expected a form field named 'swing'." });
      return;
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(500).json({ error: "API connection failed: ANTHROPIC_API_KEY is not configured on the server." });
      return;
    }

    const { swingType, notes, sessionHistory, feelProfile } =
      req.body as Record<string, string>;

    let previousSessions: SessionMemory[] = [];
    if (sessionHistory) {
      try { previousSessions = JSON.parse(sessionHistory); } catch {}
    }

    let playerFeelProfile: FeelProfileData | null = null;
    if (feelProfile) {
      try { playerFeelProfile = JSON.parse(feelProfile); } catch {}
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

      // ── PASS 1: 30 frames evenly across video — find the real swing ──
      const detectResult = await extractEvenFrames(uploadedPath!, 30, videoDuration);
      detectFrameDir = detectResult.frameDir;

      const detectFrames = detectResult.files.map((f, i) => ({
        base64:    fileToBase64(f),
        timestamp: detectResult.timestamps[i] ?? 0,
      }));

      req.log.info({ count: detectFrames.length }, "Pass 1: swing detection");

      const bounds = await detectSwingBounds(anthropic, detectFrames, videoDuration);
      swingStart = bounds.swingStart;
      swingEnd   = bounds.swingEnd;

      req.log.info({ swingStart, swingEnd }, "Swing bounds detected");

      // ── PASS 2: one frame every 0.1s across the detected swing ──
      const swingTimestamps: number[] = [];
      for (
        let t = swingStart;
        t <= swingEnd + 0.001;
        t = parseFloat((t + 0.1).toFixed(3))
      ) {
        swingTimestamps.push(parseFloat(Math.min(t, swingEnd).toFixed(3)));
      }
      // Cap at 60 frames for safety / API cost
      const cappedTs = swingTimestamps.slice(0, 60);

      const swingResult = await extractAtTimestamps(uploadedPath!, cappedTs);
      swingFrameDir = swingResult.frameDir;

      // swingResult.timestamps only contains the timestamps that successfully
      // extracted — stay aligned with that instead of the originally-requested list.
      swingFrames = swingResult.files.map((f, i) => ({
        base64:    fileToBase64(f),
        timestamp: swingResult.timestamps[i] ?? 0,
        index:     i,
      }));

      req.log.info(
        { frames: swingFrames.length, swingStart, swingEnd },
        "Pass 2: swing frames extracted",
      );
    } else {
      // Single image
      swingFrames = [{
        base64:    fileToBase64(uploadedPath!),
        timestamp: 0,
        index:     0,
      }];
    }

    // ── PASS 3: Full Claude analysis ──────────────────────────────────────────

    const feelProfileText = playerFeelProfile
      ? `\n\nPLAYER FEEL PROFILE FROM RECENT ROUNDS:
  Shot shape tendency: ${playerFeelProfile.shotShape || "not specified"}
  Contact feel: ${playerFeelProfile.contact || "not specified"}
  Self-reported swing feels: ${playerFeelProfile.customFeels || "none"}
  Last updated: ${playerFeelProfile.lastUpdated || "unknown"}
Reference these naturally — e.g. "You mentioned feeling stuck on the downswing — looking at your frame I can see exactly why..." If these patterns are NOT visible in the video, celebrate that as improvement.`
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

    const MAX_FRAMES = 8;
    if (swingFrames.length > MAX_FRAMES) {
      swingFrames = swingFrames.slice(0, MAX_FRAMES);
    }

    const totalKB = swingFrames.reduce((s, f) => s + f.base64.length * 0.75, 0) / 1024;
    console.log("Payload:", totalKB.toFixed(0), "KB across", swingFrames.length, "frames");

    const frameMap = swingFrames
      .map((f) => `Frame ${f.index} (${f.timestamp.toFixed(3)}s)`)
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
- Player notes: ${notes || "none"}
- Frames available: ${swingFrames.length} (one every 0.1s across swing)
${feelProfileText}${sessionHistoryText}

EXACT FRAME INDEX → TIMESTAMP MAP (use these exact values — do not invent timestamps):
${frameMap}

═══════════════════════════════════════════
ANALYSIS INSTRUCTIONS
═══════════════════════════════════════════

1. View ALL ${swingFrames.length} frames to understand the full swing motion before identifying positions.

2. Identify between 8 and 14 coaching points total — DO NOT lock yourself to exactly 10. Choose the number that honestly represents what you see.

3. For EACH coaching point, pick the SINGLE best frame that most clearly shows that position or fault. Use its EXACT frameIndex and timestamp from the map above.

4. Also look for faults that occur BETWEEN standard positions (grip problems at address, early extension mid-backswing, casting in transition, etc.) — flag these as "extra-observation" points.

5. A frameIndex must be the ACTUAL index of the frame you are analyzing. Never estimate or interpolate.

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
- Each fix must include a specific YouTube search query and recommended channel

COPYRIGHT: All feeling cues must be original CaddyIQ language. Never reproduce a coach's known phrases verbatim.

═══════════════════════════════════════════
ANNOTATION INSTRUCTIONS
═══════════════════════════════════════════

For each coaching point, describe ONE annotation (max two shapes):
- Use relative descriptive language: "from the lead shoulder to the trail hip", "circle around the lead elbow", "curved arrow from inside the swing plane to impact"
- Use spatial positions: "upper left", "center frame", "lower right"
- Colors: "green" for correct position/strength, "amber" for fault, "white" for neutral reference line
- Keep annotations minimal and clear — one shape that highlights the key point

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
      },
      "annotation": {
        "type": "<line | circle | arc | arrow | path>",
        "description": "<natural language of what this annotation highlights>",
        "bodyPart": "<e.g. lead arm, club shaft, hip line, swing path>",
        "color": "<green | amber | white>",
        "geometry": {
          "startDescription": "<e.g. 'from upper left where club head is' | 'at the lead shoulder'>",
          "endDescription": "<e.g. 'to lower right at ball position' | 'to the trail hip'>",
          "shape": "<e.g. 'straight line along shoulder plane' | 'circle around lead elbow' | 'curved arrow showing inside-out path'>"
        }
      }
    }
  ],
  "weeklyFocus": "<ONE sentence. ONE thing only.>",
  "closingMessage": "<1-2 sentences of genuine encouragement>",
  "sessionSummary": {
    "faultsIdentified": ["<fault 1>", "<fault 2>"],
    "improvementsNoted": ["<improvement visible from previous session, or empty array>"]
  }
}

CRITICAL RULES:
• coachingPoints: 8–14 entries total
• Every frameIndex must be a real index from the map (0–${swingFrames.length - 1})
• Every timestamp must be the exact value from the map
• Strengths: omit title, description, proRef, feelingCue, feelingCueCredit, practiceDrill, youtubeSearch
• Fixes (focus-area + extra-observation): populate ALL fields including youtubeSearch
• Do not include null values — just omit the field for strengths`,
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
      text: "Analyze all frames and return your complete coaching JSON. 8–14 coaching points, exact frameIndex and timestamp values, coachingPriority follows the fundamentals order, all feeling cues are original CaddyIQ voice with credit lines, every fix has youtubeSearch.",
    });

    req.log.info({ frames: swingFrames.length }, "Pass 3: sending to Claude");

    let claudeRes: Anthropic.Messages.Message;
    try {
      claudeRes = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        messages: [{ role: "user", content: messageContent }],
      });
    } catch (apiErr: unknown) {
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
    const cleaned = rawText.replace(/```json\n?|```\n?/g, "").trim();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
      else throw new Error("Could not parse AI response as JSON");
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
      annotation?: unknown;
    };

    const coachingPoints = (parsed.coachingPoints as CP[] | undefined) ?? [];
    const fixes = coachingPoints
      .filter((p) => p.status !== "strength")
      .sort((a, b) => (a.coachingPriority ?? 99) - (b.coachingPriority ?? 99))
      .map((p, i) => ({
        priority:        i === 0 ? 1 : i === 1 ? 2 : 3,
        title:           p.title || p.positionLabel || `Fix ${i + 1}`,
        position:        p.positionLabel || "",
        positionCode:    (p.positionLabel || "").split(" ")[0],
        frameIndex:      p.frameIndex ?? 0,
        timestamp:       p.timestamp ?? 0,
        description:     p.description || p.observation || "",
        proRef:          p.proRef,
        feelingCue:      p.feelingCue,
        feelingCueCredit:p.feelingCueCredit,
        practiceDrill:   p.practiceDrill,
        youtubeSearch:   p.youtubeSearch,
      }));

    parsed.fixes               = fixes;
    parsed.videoFramesAnalyzed = swingFrames.length;
    parsed.isVideoAnalysis     = isVideo;
    parsed.videoDuration       = videoDuration;
    parsed.frameTimestamps     = swingFrames.map((f) => f.timestamp);
    parsed.swingStart          = swingStart;
    parsed.swingEnd            = swingEnd;

    // Return ALL extracted frames as base64 so frontend can look up any frame by index
    parsed.frameImages = swingFrames.map((f) => ({
      base64:    f.base64,
      timestamp: f.timestamp,
      code:      `F${f.index}`,
      position:  `Frame ${f.index}`,
    }));

    res.json({ success: true, analysis: parsed });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Analysis failed";
    req.log.error({ err }, "Analysis error");
    res.status(500).json({ error: message });
  } finally {
    if (uploadedPath)    cleanup(uploadedPath);
    if (detectFrameDir)  cleanup(detectFrameDir);
    if (swingFrameDir)   cleanup(swingFrameDir);
  }
});

export default router;
