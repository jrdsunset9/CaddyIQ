import { Router, type IRouter } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import os from "os";
import { randomUUID } from "crypto";
import ffmpeg from "fluent-ffmpeg";
import Anthropic from "@anthropic-ai/sdk";

// Use system ffmpeg (installed via winget) or fall back to @ffmpeg-installer
const FFMPEG_PATH = process.env.FFMPEG_PATH
  || "C:\\Users\\jrdsu\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe";
ffmpeg.setFfmpegPath(FFMPEG_PATH);

const router: IRouter = Router();

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /video\/(mp4|quicktime|x-m4v|avi|x-matroska|webm|3gpp)|image\/(jpeg|png|heic|heif|webp)/i;
    if (
      allowed.test(file.mimetype) ||
      /\.(mp4|mov|m4v|avi|mkv|webm|3gp|jpg|jpeg|png|heic|heif)$/i.test(file.originalname)
    ) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported file type"));
    }
  },
});

function extractFramesAtTimestamps(
  videoPath: string,
  timestamps: number[],
): Promise<{ files: string[]; frameDir: string }> {
  return new Promise((resolve, reject) => {
    const frameDir = path.join(os.tmpdir(), randomUUID());
    fs.mkdirSync(frameDir, { recursive: true });

    const selectFilter = timestamps.map(t => `eq(t\\,${t.toFixed(3)})`).join("+");

    ffmpeg(videoPath)
      .outputOptions([
        `-vf`, `select='${selectFilter}',scale=1024:-2`,
        `-vsync`, `vfr`,
        `-q:v`, `3`,
        `-frames:v`, `${timestamps.length}`,
      ])
      .output(path.join(frameDir, "frame_%03d.jpg"))
      .on("end", () => {
        const files = fs.readdirSync(frameDir)
          .filter(f => f.endsWith(".jpg"))
          .sort()
          .map(f => path.join(frameDir, f));
        resolve({ files, frameDir });
      })
      .on("error", (e) => reject(new Error("FFmpeg frame extraction failed: " + e.message)))
      .run();
  });
}

function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) { reject(new Error("Could not read video metadata: " + err.message)); return; }
      resolve((metadata.format.duration as number) || 3);
    });
  });
}

function fileToBase64(filePath: string): string {
  return fs.readFileSync(filePath).toString("base64");
}

function cleanup(...paths: string[]) {
  paths.forEach(p => {
    try {
      if (fs.statSync(p).isDirectory()) fs.rmSync(p, { recursive: true, force: true });
      else fs.unlinkSync(p);
    } catch {}
  });
}

const P_LABELS = [
  { code: "P1",  label: "Address / Setup" },
  { code: "P2",  label: "Takeaway" },
  { code: "P3",  label: "Halfway back" },
  { code: "P4",  label: "Three-quarter back" },
  { code: "P5",  label: "Top of backswing" },
  { code: "P6",  label: "Early downswing / transition" },
  { code: "P7",  label: "Late downswing" },
  { code: "P8",  label: "Impact" },
  { code: "P9",  label: "Early follow-through" },
  { code: "P10", label: "Full finish" },
];

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

async function detectSwingBounds(
  anthropic: Anthropic,
  frames: Array<{ base64: string; timestamp: number }>,
  videoDuration: number,
): Promise<{ swingStart: number; swingEnd: number }> {
  const content: ContentBlock[] = [];

  content.push({
    type: "text",
    text: `You are analyzing a golf video to find the actual swing. The video is ${videoDuration.toFixed(2)} seconds long.

Below are ${frames.length} frames extracted evenly across the video. Each frame has its exact timestamp from the video.

Your job: identify the exact start and end of the ACTUAL golf swing (not pre-shot routine, not waggle).

Rules:
- swing_start_time: timestamp when the club begins its committed takeaway from address (not a waggle or practice movement)
- swing_end_time: timestamp when the golfer reaches a balanced finish position (P10)
- If you see multiple swings (e.g., practice swing then real swing), use ONLY the LAST complete swing
- If there is no clear pre-shot routine and the swing starts immediately, swing_start_time should be close to 0
- If the video is only the swing with no pre/post routine, use the full duration

Return ONLY this JSON (no other text):
{"swing_start_time": <number>, "swing_end_time": <number>}`,
  });

  frames.forEach(({ base64, timestamp }) => {
    content.push({ type: "text", text: `Frame at ${timestamp.toFixed(3)}s:` });
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

  const raw = res.content.find(b => b.type === "text")?.text || "";
  try {
    const m = raw.match(/\{[\s\S]*?\}/);
    if (m) {
      const parsed = JSON.parse(m[0]) as { swing_start_time?: number; swing_end_time?: number };
      const start = Math.max(0, parsed.swing_start_time ?? 0);
      const end = Math.min(videoDuration, parsed.swing_end_time ?? videoDuration);
      if (end > start + 0.3) {
        return { swingStart: start, swingEnd: end };
      }
    }
  } catch {}

  return { swingStart: 0, swingEnd: videoDuration };
}

router.post("/analyze", upload.single("swing"), async (req, res) => {
  const uploadedPath = req.file?.path;
  let detectFrameDir: string | null = null;
  let swingFrameDir: string | null = null;

  try {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const { swingType, notes, sessionHistory, feelProfile } = req.body as Record<string, string>;

    let previousSessions: SessionMemory[] = [];
    if (sessionHistory) {
      try { previousSessions = JSON.parse(sessionHistory); } catch {}
    }

    let playerFeelProfile: FeelProfileData | null = null;
    if (feelProfile) {
      try { playerFeelProfile = JSON.parse(feelProfile); } catch {}
    }

    const anthropic = new Anthropic({
      apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || "placeholder",
      baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
    });

    const isVideo =
      req.file.mimetype.startsWith("video/") ||
      /\.(mp4|mov|m4v|avi|mkv|webm|3gp)$/i.test(req.file.originalname);

    interface FrameContent {
      base64: string;
      position: string;
      code: string;
      timestamp: number;
    }

    let imageContents: FrameContent[] = [];
    let videoDuration = 0;
    let videoTimestamps: number[] = [];
    let swingStart = 0;
    let swingEnd = 0;

    if (isVideo) {
      videoDuration = await getVideoDuration(uploadedPath!);

      // ── Pass 1: extract 20 evenly-spaced frames for swing detection ──
      const detectCount = 20;
      const detectInterval = videoDuration / (detectCount + 1);
      const detectTimestamps = Array.from({ length: detectCount }, (_, i) =>
        parseFloat(Math.min(detectInterval * (i + 1), videoDuration - 0.05).toFixed(3))
      );

      const detectResult = await extractFramesAtTimestamps(uploadedPath!, detectTimestamps);
      detectFrameDir = detectResult.frameDir;

      const detectFrames = detectResult.files.map((f, i) => ({
        base64: fileToBase64(f),
        timestamp: detectTimestamps[i] ?? 0,
      }));

      req.log.info({ count: detectFrames.length }, "Running swing detection pass");

      const bounds = await detectSwingBounds(anthropic, detectFrames, videoDuration);
      swingStart = bounds.swingStart;
      swingEnd = bounds.swingEnd;

      req.log.info({ swingStart, swingEnd }, "Swing bounds detected");

      // ── Pass 2: extract exactly 10 frames between swing_start and swing_end ──
      const swingDuration = swingEnd - swingStart;
      const frameCount = 10;
      const frameInterval = swingDuration / (frameCount + 1);

      videoTimestamps = Array.from({ length: frameCount }, (_, i) =>
        parseFloat(Math.min(swingStart + frameInterval * (i + 1), swingEnd - 0.02).toFixed(3))
      );

      const swingResult = await extractFramesAtTimestamps(uploadedPath!, videoTimestamps);
      swingFrameDir = swingResult.frameDir;

      imageContents = swingResult.files.map((f, i) => ({
        base64: fileToBase64(f),
        position: P_LABELS[i]?.label || `Position ${i + 1}`,
        code: P_LABELS[i]?.code || `P${i + 1}`,
        timestamp: videoTimestamps[i] ?? 0,
      }));

      req.log.info({ frames: imageContents.length, swingStart, swingEnd }, "Swing frames extracted");
    } else {
      imageContents = [{ base64: fileToBase64(uploadedPath!), position: "Swing frame", code: "P1", timestamp: 0 }];
    }

    const messageContent: ContentBlock[] = [];

    const feelProfileText = playerFeelProfile
      ? `\n\nPLAYER FEEL PROFILE FROM RECENT ROUNDS:\n  Shot shape tendency: ${playerFeelProfile.shotShape || "not specified"}\n  Contact feel: ${playerFeelProfile.contact || "not specified"}\n  Self-reported swing feels: ${playerFeelProfile.customFeels || "none"}\n  Last updated: ${playerFeelProfile.lastUpdated || "unknown"}\nReference these naturally — e.g. "You mentioned feeling stuck on the downswing — looking at your P5 frame I can see exactly why..." If these patterns are NOT visible in the video, celebrate that as improvement.`
      : "";

    const sessionHistoryText = previousSessions.length > 0
      ? `\n\nPREVIOUS SESSIONS (reference naturally — celebrate improvements, acknowledge recurring patterns):\n${previousSessions.slice(0, 5).map((s, i) =>
          `Session ${i + 1} (${s.date}, ${s.swingType}):\n  Faults: ${s.faultsIdentified.join(", ") || "none"}\n  Improvements: ${s.improvementsNoted.join(", ") || "none"}\n  Focus was: ${s.weeklyFocus || "not recorded"}`
        ).join("\n")}`
      : "\n\nThis is the golfer's FIRST session — no history yet.";

    const frameContextLines = imageContents.map(
      (f, i) => `Frame ${i} (${f.code} — ${f.position}): extracted at exactly ${f.timestamp.toFixed(3)}s in the video`
    ).join("\n");

    messageContent.push({
      type: "text",
      text: `You are a world-class golf coach — warm, direct, deeply knowledgeable. You combine the eye of Butch Harmon, the biomechanical precision of Sean Foley, the player psychology of Claude Harmon III, and the technical depth of Pete Cowen.

SWING CONTEXT:
- Shot type: ${swingType || "full swing"}
- Full video duration: ${videoDuration.toFixed(2)}s
- Actual swing detected: ${swingStart.toFixed(2)}s to ${swingEnd.toFixed(2)}s (pre-shot routine excluded)
- Player notes: ${notes || "none"}
${feelProfileText}${sessionHistoryText}

EXACT FRAME EXTRACTION TIMESTAMPS — you MUST use these exact timestamp values for each position. Do not invent or estimate different timestamps:
${frameContextLines}

You have ${imageContents.length} frames covering P1 (Address) through P10 (Full finish).
Analyze ALL frames together to see the complete swing motion.

COACHING PHILOSOPHY:
- Lead with genuine encouragement — find what is actually working first
- Reference previous sessions naturally when they exist
- Name real PGA Tour players: Rory McIlroy, Scottie Scheffler, Jon Rahm, Dustin Johnson, Collin Morikawa, Viktor Hovland, Xander Schauffele, Brooks Koepka
- Generate ORIGINAL feeling cues in CaddyIQ's own voice — never quote a coach directly or reproduce known phrases
- After each feeling cue, credit the coach whose principles inspired it
- Format: "Concept inspired by [First Name Last Name]'s [specific teaching concept]"
- Give ONE focused weekly drill — not a list
- Each fix must include a specific YouTube search query and recommended channel

COPYRIGHT REQUIREMENT: All feeling cues must be written in original CaddyIQ language. Never reproduce a coach's known phrases verbatim. Always include the credit line attributing the conceptual inspiration.

Return ONLY a valid JSON object (start with { end with }):

{
  "headline": "<punchy 4-8 word title>",
  "openingMessage": "<2-3 warm encouraging sentences — reference previous sessions if they exist>",
  "whatsWorking": [
    "<specific strength with detail>",
    "<second specific strength>"
  ],
  "positionBreakdown": [
    {
      "position": "P1",
      "positionCode": "P1",
      "label": "Address / Setup",
      "timestamp": <use the EXACT timestamp from the frame map above — Frame 0 timestamp>,
      "frameIndex": 0,
      "observation": "<specific observation at this position>",
      "status": "<exactly one of: strength | improving | focus-area>",
      "coachNote": "<one-sentence actionable coaching note>"
    }
  ],
  "fixes": [
    {
      "priority": <1, 2, or 3>,
      "title": "<fault name>",
      "position": "<position code e.g. P4>",
      "positionCode": "<e.g. P4>",
      "frameIndex": <0-9, index of the most relevant frame>,
      "timestamp": <EXACT timestamp from the frame map where this fault is most visible>,
      "description": "<what the fault is, why it costs them, ball flight consequence — 2-3 sentences>",
      "proRef": {
        "player": "<real PGA Tour player>",
        "comparison": "<specific thing this player does well that addresses this fault>"
      },
      "feelingCue": "<original CaddyIQ-voice tactile cue — what the body physically feels>",
      "feelingCueCredit": "Concept inspired by <Coach Full Name>'s <specific teaching concept>",
      "practiceDrill": {
        "name": "<named drill>",
        "description": "<step by step how to do it>",
        "reps": "<specific reps and sets>"
      },
      "youtubeSearch": {
        "query": "<specific search query finding great instruction for this exact fault>",
        "channel": "<recommended channel — e.g. Me and My Golf, Rick Shiels, Danny Maude, Chris Ryan Golf, Rotary Swing, Performance Golf>"
      }
    }
  ],
  "weeklyFocus": "<ONE sentence. ONE thing only.>",
  "closingMessage": "<1-2 sentences of genuine encouragement>",
  "sessionSummary": {
    "faultsIdentified": ["<fault 1>", "<fault 2>"],
    "improvementsNoted": ["<improvement from previous sessions visible here, or empty array>"]
  }
}

CRITICAL: positionBreakdown must have exactly 10 entries (P1 through P10). Each entry's timestamp must be the EXACT value from the frame map above — Frame 0 timestamp for P1, Frame 1 timestamp for P2, etc.`,
    });

    imageContents.forEach(({ base64, position, code }, i) => {
      messageContent.push({ type: "text", text: `--- Frame ${i} (${code} — ${position}, ${imageContents[i].timestamp.toFixed(3)}s) ---` });
      messageContent.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: base64 },
      });
    });

    messageContent.push({ type: "text", text: "Analyze all frames and return your complete coaching JSON. Remember: use EXACT frame timestamps, positionBreakdown must have exactly 10 entries, all feeling cues must be original CaddyIQ voice with feelingCueCredit." });

    const claudeRes = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [{ role: "user", content: messageContent }],
    });

    const raw = claudeRes.content.find(b => b.type === "text")?.text || "";
    const cleaned = raw.replace(/```json\n?|```\n?/g, "").trim();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
      else throw new Error("Could not parse AI response as JSON");
    }

    parsed.videoFramesAnalyzed = imageContents.length;
    parsed.isVideoAnalysis = isVideo;
    parsed.videoDuration = videoDuration;
    parsed.frameTimestamps = videoTimestamps;
    parsed.swingStart = swingStart;
    parsed.swingEnd = swingEnd;

    parsed.frameImages = imageContents.map(f => ({
      base64: f.base64,
      timestamp: f.timestamp,
      code: f.code,
      position: f.position,
    }));

    res.json({ success: true, analysis: parsed });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Analysis failed";
    req.log.error({ err }, "Analysis error");
    res.status(500).json({ error: message });
  } finally {
    if (uploadedPath) cleanup(uploadedPath);
    if (detectFrameDir) cleanup(detectFrameDir);
    if (swingFrameDir) cleanup(swingFrameDir);
  }
});

export default router;
