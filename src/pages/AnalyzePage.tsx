import { useState, useRef, useCallback } from "react";
import { C, F } from "../design";
import VideoPlayer, { type MarkedPosition, type VideoPlayerHandle } from "../components/VideoPlayer";
import type {
  SessionMemory,
  FeelProfile,
  AnalysisResult,
  CoachingPoint,
  CheckinResponse,
  SelectedFrame,
} from "../App";
import { computeCareerSummary, formatAnalyticsForPrompt, type Round } from "../lib/analytics";

// ─── Loading state ────────────────────────────────────────────────────────────
// Time-based progress messages so the user sees real forward motion during
// the up-to-3-minute analysis window. Each entry fires when elapsed time
// crosses its `startMs` threshold — prevents users from thinking the page
// froze and refreshing (which kills the request).

interface LoadingStage {
  startMs: number;
  message: string;
}

const LOADING_STAGES: LoadingStage[] = [
  { startMs:     0, message: "Extracting swing frames..." },
  { startMs: 15000, message: "Identifying swing positions..." },
  { startMs: 30000, message: "Analyzing your technique..." },
  { startMs: 60000, message: "Writing your coaching session..." },
  { startMs: 90000, message: "Almost done — finalizing recommendations..." },
];

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  feelProfile: FeelProfile | null;
  sessionHistory: SessionMemory[];
  checkinResponses: CheckinResponse[];
  roundHistory: Round[];
  onCheckinSaved: (r: CheckinResponse) => void;
  onSessionSaved: (s: SessionMemory) => void;
  onSwitchTab: (t: "round" | "analyze" | "sessions" | "drills" | "analytics") => void;
}

// ─── Frame lookup helper (CHANGE 2) ───────────────────────────────────────────

/** Look up a frame by exact frameIndex; if missing or out of range, return the
 * closest available frame by timestamp. Guarantees a real image rather than a
 * placeholder so coaching points always render against something visual. */
function resolveFrame(
  frameImages: AnalysisResult["frameImages"],
  frameIndex: number,
  timestamp?: number,
): AnalysisResult["frameImages"][number] | null {
  if (!frameImages || frameImages.length === 0) return null;
  if (frameIndex >= 0 && frameIndex < frameImages.length) {
    return frameImages[frameIndex];
  }
  // Fallback: closest frame by timestamp if provided, else clamp to range.
  if (typeof timestamp === "number") {
    let best = frameImages[0];
    let bestDelta = Math.abs((best.timestamp ?? 0) - timestamp);
    for (const f of frameImages) {
      const delta = Math.abs((f.timestamp ?? 0) - timestamp);
      if (delta < bestDelta) { best = f; bestDelta = delta; }
    }
    return best;
  }
  const clamped = Math.max(0, Math.min(frameImages.length - 1, frameIndex));
  return frameImages[clamped] ?? null;
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function Card({
  children,
  style = {},
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{
      border: "1px solid #E8E4DC", borderRadius: 12, padding: 16,
      background: "#fff", ...style,
    }}>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, color: C.muted, textTransform: "uppercase" as const,
      letterSpacing: "0.1em", marginBottom: 8,
    }}>
      {children}
    </div>
  );
}

// ─── Strength card (compact — no image) ──────────────────────────────────────

function StrengthCard({ point }: { point: CoachingPoint }) {
  return (
    <div style={{
      display: "flex", gap: 10, alignItems: "flex-start",
      border: `1px solid #B7D9BE`, borderRadius: 10, padding: "11px 14px",
      background: C.lightGreen, marginBottom: 8,
    }}>
      <span style={{ color: C.accentGreen, fontSize: 16, flexShrink: 0, marginTop: 1 }}>✓</span>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.accentGreen, marginBottom: 2 }}>
          {point.positionLabel}
        </div>
        <div style={{ fontSize: 13, color: C.secondary, lineHeight: 1.6 }}>
          {point.observation}
        </div>
      </div>
    </div>
  );
}

// ─── Fix / observation card ───────────────────────────────────────────────────

function FixCard({
  point,
  frameImages,
  cardRef,
  onSeek,
}: {
  point: CoachingPoint;
  frameImages: AnalysisResult["frameImages"];
  cardRef?: (el: HTMLDivElement | null) => void;
  /** Called when the user taps the frame image or position label —
   * tells the page-level video player to seek to this card's moment. */
  onSeek?: (timestamp: number) => void;
}) {
  const isExtra = point.status === "extra-observation";
  const accent  = isExtra ? "#5C5445" : C.warning;
  const badge   = isExtra ? "Key Observation" : "Priority Fix";

  const frame = resolveFrame(frameImages, point.frameIndex, point.timestamp);
  const ytQuery = point.youtubeSearch?.query
    ? encodeURIComponent(point.youtubeSearch.query)
    : null;
  const seekHere = () => {
    if (onSeek && typeof point.timestamp === "number") onSeek(point.timestamp);
  };

  return (
    <Card
      style={{ marginBottom: 14, borderTop: `3px solid ${accent}` }}
    >
      {/* Ref anchor */}
      <div ref={cardRef} />

      {/* 1. Priority badge + position label + timestamp */}
      <div style={{
        display: "flex", justifyContent: "space-between",
        alignItems: "flex-start", marginBottom: 10,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 700, color: accent,
          textTransform: "uppercase" as const, letterSpacing: "0.08em",
        }}>
          {badge}
        </div>
        <div
          style={{
            fontSize: 11, color: C.muted, textAlign: "right" as const,
            cursor: onSeek ? "pointer" : "default",
            textDecoration: onSeek ? "underline dotted" : "none",
          }}
          onClick={seekHere}
          title={onSeek ? "Tap to jump video to this moment" : undefined}
        >
          {point.positionLabel}
          {point.timestamp != null ? ` · ${point.timestamp.toFixed(1)}s` : ""}
        </div>
      </div>

      {/* 2. Fix title */}
      {point.title && (
        <div style={{
          fontFamily: F.serif, fontSize: 17, color: C.deepGreen,
          marginBottom: 8, lineHeight: 1.3,
        }}>
          {point.title}
        </div>
      )}

      {/* 3. Frame — tap to seek video to this exact timestamp */}
      {frame && (
        <div
          style={{
            lineHeight: 0, borderRadius: 8, overflow: "hidden",
            marginBottom: 14, cursor: onSeek ? "pointer" : "default",
          }}
          onClick={seekHere}
          title={onSeek ? "Tap to jump video to this frame" : undefined}
        >
          <img
            src={`data:image/jpeg;base64,${frame.base64}`}
            alt={`${point.positionLabel} — frame at ${point.timestamp?.toFixed(2)}s`}
            style={{ width: "100%", display: "block" }}
          />
        </div>
      )}

      {/* 4. Description */}
      {point.description && (
        <div style={{ fontSize: 14, color: C.secondary, lineHeight: 1.7, marginBottom: 14 }}>
          {point.description}
        </div>
      )}

      {/* Pro reference */}
      {point.proRef?.player && (
        <div style={{
          background: C.lightGreen, borderRadius: 10,
          padding: "12px 14px", marginBottom: 12,
          borderLeft: `3px solid ${C.accentGreen}`,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.deepGreen, marginBottom: 3 }}>
            {point.proRef.player}
          </div>
          <div style={{ fontSize: 13, color: C.secondary, lineHeight: 1.55 }}>
            {point.proRef.comparison}
          </div>
        </div>
      )}

      {/* 5. Feeling cue */}
      {point.feelingCue && (
        <div style={{
          background: C.deepGreen, borderRadius: 10,
          padding: "14px 16px", marginBottom: 12,
        }}>
          <div style={{
            fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.5)",
            textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: 6,
          }}>
            Feeling cue
          </div>
          <div style={{
            fontSize: 14, color: "rgba(255,255,255,0.9)", lineHeight: 1.65,
            fontStyle: "italic", fontFamily: F.serif,
            marginBottom: point.feelingCueCredit ? 10 : 0,
          }}>
            "{point.feelingCue}"
          </div>
          {point.feelingCueCredit && (
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>
              {point.feelingCueCredit}
            </div>
          )}
        </div>
      )}

      {/* Practice drill */}
      {point.practiceDrill && (
        <div style={{
          background: C.lightGreen, borderRadius: 10,
          padding: "14px 16px", border: "1px solid #B7D9BE",
          marginBottom: ytQuery ? 10 : 0,
        }}>
          <div style={{
            fontSize: 10, fontWeight: 600, color: C.accentGreen,
            textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: 8,
          }}>
            Practice drill
          </div>
          <div style={{ fontFamily: F.serif, fontSize: 15, color: C.deepGreen, marginBottom: 2 }}>
            {point.practiceDrill.name}
            <span style={{
              fontFamily: F.sans, fontSize: 12, fontWeight: 500,
              color: C.muted, marginLeft: 8,
            }}>
              {point.practiceDrill.reps}
            </span>
          </div>
          <div style={{ fontSize: 13, color: C.secondary, lineHeight: 1.6 }}>
            {point.practiceDrill.description}
          </div>
        </div>
      )}

      {/* 6. YouTube drill */}
      {ytQuery && (
        <a
          href={`https://www.youtube.com/results?search_query=${ytQuery}`}
          target="_blank" rel="noopener noreferrer"
          style={{
            display: "flex", alignItems: "center", gap: 10,
            textDecoration: "none",
            border: `1px solid ${C.border}`, borderRadius: 8,
            padding: "11px 14px",
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 2 }}>
              Recommended drill
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.deepGreen }}>
              {point.youtubeSearch?.query}
            </div>
            {point.youtubeSearch?.channel && (
              <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>
                {point.youtubeSearch.channel}
              </div>
            )}
          </div>
          <div style={{
            flexShrink: 0, fontSize: 12, fontWeight: 600, color: C.accentGreen,
            border: `1px solid ${C.accentGreen}`, padding: "5px 10px", borderRadius: 6,
          }}>
            Watch on YouTube
          </div>
        </a>
      )}
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AnalyzePage({
  feelProfile,
  sessionHistory,
  checkinResponses,
  roundHistory,
  onCheckinSaved,
  onSessionSaved,
}: Props) {
  const [file,        setFile]        = useState<File | null>(null);
  const [videoUrl,    setVideoUrl]    = useState<string | null>(null);
  const [previewType, setPreviewType] = useState<"video" | "image">("video");
  const [notes,       setNotes]       = useState("");
  const [loading,     setLoading]     = useState(false);
  const [loadStep,    setLoadStep]    = useState(0);
  const [result,      setResult]      = useState<AnalysisResult | null>(null);
  const [error,       setError]       = useState("");
  const [dragging,    setDragging]    = useState(false);
  const [checkinDone, setCheckinDone] = useState(false);
  const fileRef     = useRef<HTMLInputElement>(null);
  // Refs keyed by coaching point index (in sorted order) for scroll-to
  const cardRefs    = useRef<Map<number, HTMLDivElement>>(new Map());
  // Imperative handle on the video player so coaching cards can seek the video
  const playerRef   = useRef<VideoPlayerHandle>(null);
  const seekVideo = useCallback((t: number) => {
    playerRef.current?.seekTo(t);
  }, []);

  const handleFile = useCallback(
    (f: File) => {
      setError(""); setResult(null); setFile(f);
      const isVid =
        f.type.startsWith("video/") ||
        /\.(mp4|mov|m4v|avi|mkv|webm|3gp)$/i.test(f.name);
      setPreviewType(isVid ? "video" : "image");
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setVideoUrl(URL.createObjectURL(f));
    },
    [videoUrl],
  );

  const removeFile = () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setFile(null); setVideoUrl(null); setResult(null); setError("");
  };

  const runAnalysis = async () => {
    if (!file) return;
    setError(""); setLoading(true); setLoadStep(0);

    // Time-based progress ticker — re-evaluates which stage we're in every
    // second and sets loadStep to that stage's index. Each tick also counts
    // as a heartbeat so the user can see the analysis is still running.
    const startedAt = Date.now();
    const iv = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      let idx = 0;
      for (let i = 0; i < LOADING_STAGES.length; i++) {
        if (elapsed >= LOADING_STAGES[i].startMs) idx = i;
      }
      setLoadStep(idx);
    }, 1000);

    try {
      const form = new FormData();
      form.append("swing", file);
      form.append("swingType", "Full swing");
      form.append("notes", notes || "none");

      // Strip the heavy `analysis` field (which carries base64 frameImages)
      // and cap to the most-recent 5 sessions before posting. The backend
      // only references date/swingType/headline/faults/improvements/weeklyFocus
      // for context — uploading 5 sessions × ~200 KB of base64 frames was
      // tripping multer's 1 MB field-size cap with "field value too long."
      const slimSessionHistory = sessionHistory.slice(0, 5).map((s) => ({
        id: s.id,
        date: s.date,
        swingType: s.swingType,
        headline: s.headline,
        faultsIdentified: s.faultsIdentified,
        improvementsNoted: s.improvementsNoted,
        weeklyFocus: s.weeklyFocus,
      }));
      form.append("sessionHistory", JSON.stringify(slimSessionHistory));
      form.append("checkinHistory", JSON.stringify(checkinResponses.slice(0, 30)));
      if (feelProfile) form.append("feelProfile", JSON.stringify(feelProfile));

      // Analytics context — computed from round history so the AI can weight
      // coaching advice toward the player's weakest Strokes Gained area.
      if (roundHistory && roundHistory.length > 0) {
        const summary = computeCareerSummary(roundHistory);
        const block = formatAnalyticsForPrompt(summary, roundHistory);
        if (block) form.append("analyticsSummary", block);
      }

      // 3-minute timeout — split-call analysis (label + coach) + frame extraction
      // can reach ~2 min on longer iPhone clips, so 180s leaves a safety margin.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 180000);

      let res: Response;
      try {
        res = await fetch("/api/analyze", {
          method: "POST",
          body: form,
          signal: controller.signal,
        });
      } catch (fetchErr: unknown) {
        clearTimeout(timeoutId);
        clearInterval(iv);
        const fe = fetchErr as { name?: string; message?: string };
        if (fe?.name === "AbortError") {
          throw new Error("Analysis timed out — the video took longer than 3 minutes. Try a shorter clip.");
        }
        throw new Error(`API connection failed: ${fe?.message || "could not reach the analysis server"}`);
      }
      clearTimeout(timeoutId);

      // Read as text first so we can surface the actual server message even
      // if it isn't JSON (e.g. an HTML error page from an upstream proxy).
      const bodyText = await res.text();
      let data: { success?: boolean; error?: string; analysis?: AnalysisResult };
      try {
        data = bodyText ? JSON.parse(bodyText) : {};
      } catch {
        clearInterval(iv);
        // Strip HTML tags and trim so the user sees the human-readable bit.
        const stripped = bodyText
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const preview = stripped.slice(0, 240) || "(empty body)";
        throw new Error(
          `Analysis failed (HTTP ${res.status}) — ${preview}${stripped.length > 240 ? "…" : ""}`,
        );
      }
      clearInterval(iv);
      if (!res.ok || !data.success) {
        const serverMsg = data.error || `Analysis failed (HTTP ${res.status})`;
        // Map common backend phrases to clearer user messages
        if (/too large|payload/i.test(serverMsg))      throw new Error("Video too large — please upload a smaller file (under 200 MB).");
        if (/timed out|timeout/i.test(serverMsg))      throw new Error("Analysis timed out — try a shorter clip.");
        if (/authentication|API key|api_key/i.test(serverMsg)) throw new Error("API connection failed — the server is missing its API key.");
        throw new Error(serverMsg);
      }

      const a: AnalysisResult = data.analysis as AnalysisResult;
      setResult(a);

      // ── Save to session history (unchanged) ──
      onSessionSaved({
        id:               `${Date.now()}`,
        date:             new Date().toLocaleDateString("en-US", {
                            month: "short", day: "numeric", year: "numeric",
                          }),
        swingType:        "Full swing",
        headline:         a.headline || "",
        faultsIdentified: a.sessionSummary?.faultsIdentified || [],
        improvementsNoted:a.sessionSummary?.improvementsNoted || [],
        weeklyFocus:      a.weeklyFocus || "",
        analysis:         a,
      });
    } catch (e: unknown) {
      clearInterval(iv);
      setError((e as Error).message || "Analysis failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { removeFile(); setNotes(""); setLoadStep(0); };

  // ── Scroll coaching card into view when thumbnail is tapped ──
  const handleFrameClick = useCallback((pointIndex: number) => {
    const el = cardRefs.current.get(pointIndex);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.style.animation = "highlightFade 1.2s ease";
      setTimeout(() => { if (el) el.style.animation = ""; }, 1300);
    }
  }, []);

  // ── UPLOAD VIEW ───────────────────────────────────────────────────────────

  if (!result && !loading) {
    const primaryBtn: React.CSSProperties = {
      width: "100%", padding: "13px 0", background: C.deepGreen, color: "#fff",
      border: "none", borderRadius: 8, fontSize: 15, fontWeight: 600,
    };

    // ── Check-in card (CHANGE 4A) ──
    // Shown only when at least one previous session exists AND we don't
    // already have a check-in recorded for the most recent session's focus
    // dated today. Normalizes focus via lowercase+punctuation-strip so small
    // wording drift from Claude doesn't cause the card to reappear after
    // answering.
    const normFocus = (s: string) =>
      s.trim().toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ");
    const lastSession = sessionHistory[0];
    const lastFocus   = lastSession?.weeklyFocus?.trim() || "";
    const lastFocusKey = normFocus(lastFocus);
    const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const alreadyAnsweredThisFocus =
      checkinDone ||
      (lastFocusKey && checkinResponses.some(
        (r) => normFocus(r.focus) === lastFocusKey && r.date === today,
      ));
    const showCheckin = sessionHistory.length >= 1 && lastFocus && !alreadyAnsweredThisFocus;

    const recordCheckin = (response: "improving" | "struggling" | "not_yet") => {
      onCheckinSaved({
        date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        focus: lastFocus,
        response,
      });
      setCheckinDone(true);
    };

    const checkinBtn = (bg: string, color: string): React.CSSProperties => ({
      flex: 1, padding: "10px 8px", borderRadius: 8,
      border: `1px solid ${color}`, background: bg, color,
      fontSize: 13, fontWeight: 600, lineHeight: 1.3, cursor: "pointer",
    });

    return (
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "24px 16px" }}>
        <div style={{ fontFamily: F.serif, fontSize: 24, color: C.deepGreen, marginBottom: 4 }}>
          Analyze your swing
        </div>
        <div style={{ fontSize: 14, color: C.muted, marginBottom: 20 }}>
          Upload a video and get tour-level coaching in seconds
        </div>

        {showCheckin && (
          <div style={{
            border: "1px solid #E8E4DC", borderRadius: 12, padding: 16,
            background: "#fff", marginBottom: 16,
          }}>
            <div style={{
              fontSize: 10, color: C.muted, textTransform: "uppercase",
              letterSpacing: "0.1em", marginBottom: 8,
            }}>
              Since last session
            </div>
            <div style={{ fontFamily: F.serif, fontSize: 16, color: C.deepGreen, lineHeight: 1.4, marginBottom: 4 }}>
              Last week's focus: <span style={{ fontStyle: "italic" }}>{lastFocus}</span>
            </div>
            <div style={{ fontSize: 13, color: C.secondary, lineHeight: 1.6, marginBottom: 14 }}>
              How has it been going? Your answer shapes today's coaching.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => recordCheckin("improving")}
                style={checkinBtn(C.lightGreen, C.accentGreen)}
              >
                Yes — feeling better
              </button>
              <button
                onClick={() => recordCheckin("struggling")}
                style={checkinBtn("#FEF3E2", C.warning)}
              >
                Yes — still struggling
              </button>
              <button
                onClick={() => recordCheckin("not_yet")}
                style={checkinBtn(C.card, C.secondary)}
              >
                Not yet
              </button>
            </div>
          </div>
        )}

        {feelProfile && (
          <div style={{
            background: C.lightGreen, border: "1px solid #B7D9BE",
            borderRadius: 10, padding: "10px 14px", marginBottom: 16,
          }}>
            <div style={{ fontSize: 13, color: C.accentGreen, lineHeight: 1.6 }}>
              Feel profile active — AI will look for{" "}
              <strong>{feelProfile.shotShape || "shot shape"}</strong> tendencies and{" "}
              <strong>{feelProfile.contact || "contact"}</strong> patterns.
            </div>
          </div>
        )}

        {!videoUrl ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault(); setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
            onClick={() => fileRef.current?.click()}
            style={{
              border: `1.5px dashed ${dragging ? C.accentGreen : C.borderDark}`,
              borderRadius: 12, padding: "44px 24px", textAlign: "center" as const,
              cursor: "pointer",
              background: dragging ? C.lightGreen : C.card,
              transition: "all 0.2s", marginBottom: 12,
            }}
          >
            <input
              ref={fileRef} type="file" style={{ display: "none" }}
              accept="video/*,image/*,.mov,.mp4,.m4v,.avi,.mkv,.webm,.heic,.heif,.jpg,.jpeg,.png"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
            />
            <div style={{ fontFamily: F.serif, fontSize: 18, color: C.deepGreen, marginBottom: 8 }}>
              Upload your swing video
            </div>
            <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.7, marginBottom: 20 }}>
              iPhone MOV, MP4, any format<br />
              <span style={{ fontSize: 12 }}>
                Pre-shot routine is automatically detected and excluded
              </span>
            </div>
            <div style={{
              display: "inline-block", background: C.deepGreen, color: "#fff",
              padding: "11px 28px", borderRadius: 8, fontSize: 14, fontWeight: 600,
            }}>
              Choose file
            </div>
          </div>
        ) : (
          <Card style={{ marginBottom: 12 }}>
            {previewType === "video" ? (
              <video
                src={videoUrl} controls
                style={{ width: "100%", borderRadius: 8, display: "block", maxHeight: 300, background: "#000" }}
              />
            ) : (
              <img
                src={videoUrl} alt="Swing"
                style={{ width: "100%", borderRadius: 8, display: "block", maxHeight: 300, objectFit: "contain" }}
              />
            )}
            <div style={{
              display: "flex", justifyContent: "space-between",
              alignItems: "center", marginTop: 10,
            }}>
              <span style={{ fontSize: 13, color: C.secondary }}>
                {file?.name} · {((file?.size ?? 0) / 1024 / 1024).toFixed(1)} MB
              </span>
              <button
                onClick={removeFile}
                style={{ border: "none", background: "none", color: C.warning, fontSize: 13, fontWeight: 600 }}
              >
                Remove
              </button>
            </div>
          </Card>
        )}

        <Card style={{ marginBottom: 16 }}>
          <SectionLabel>Context (optional)</SectionLabel>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="e.g. 7-iron, feels over the top, tends to slice..."
            style={{
              width: "100%", border: `1px solid ${C.borderDark}`, borderRadius: 8,
              padding: "10px 12px", fontSize: 14, color: C.body, background: C.card,
              resize: "none" as const, lineHeight: 1.5,
            }}
          />
        </Card>

        {error && (
          <div style={{
            border: "1px solid #F5C98A", borderRadius: 10, padding: "12px 14px",
            color: C.warning, fontSize: 14, marginBottom: 16, background: "#FEF3E2",
          }}>
            {error}
          </div>
        )}

        <button
          onClick={runAnalysis}
          disabled={!file}
          style={{ ...primaryBtn, opacity: file ? 1 : 0.4 }}
        >
          {file ? "Analyze my swing" : "Upload a swing first"}
        </button>
      </div>
    );
  }

  // ── LOADING VIEW ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "80px 20px", textAlign: "center" as const }}>
        <div style={{
          width: 40, height: 40, border: `2px solid ${C.border}`,
          borderTop: `2px solid ${C.accentGreen}`, borderRadius: "50%",
          animation: "spin 1s linear infinite", margin: "0 auto 28px",
        }} />
        <div style={{ fontFamily: F.serif, fontSize: 22, color: C.deepGreen, marginBottom: 10 }}>
          Your coach is reviewing your swing
        </div>
        <div style={{ fontSize: 15, color: C.accentGreen, marginBottom: 28 }}>
          {LOADING_STAGES[loadStep]?.message ?? LOADING_STAGES[0].message}
        </div>
        <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
          {LOADING_STAGES.map((_, i) => (
            <div
              key={i}
              style={{
                width: 6, height: 6, borderRadius: "50%",
                background: i <= loadStep ? C.accentGreen : C.borderDark,
                transition: "background 0.3s",
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (!result) return null;

  // ── RESULTS VIEW ──────────────────────────────────────────────────────────

  const frameImages   = result.frameImages ?? [];
  const coachingPoints: CoachingPoint[] = result.coachingPoints ?? [];

  // Sort all coaching points by priority (lower = more urgent)
  const sortedPoints = [...coachingPoints].sort(
    (a, b) => (a.coachingPriority ?? 99) - (b.coachingPriority ?? 99),
  );

  const strengths = sortedPoints.filter((p) => p.status === "strength");
  const fixes     = sortedPoints.filter((p) => p.status !== "strength");

  // Build selectedFrames for VideoPlayer thumbnail strip (ordered by timestamp)
  const selectedFrames: SelectedFrame[] = [...coachingPoints]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((cp) => {
      const img = resolveFrame(frameImages, cp.frameIndex, cp.timestamp);
      const short = cp.positionLabel.split(" ")[0] || cp.positionLabel;
      return {
        base64:     img?.base64 ?? "",
        timestamp:  cp.timestamp,
        shortLabel: short,
        fullLabel:  cp.positionLabel,
        status:     cp.status,
        pointIndex: coachingPoints.indexOf(cp),
      };
    });

  // MarkedPositions for timeline dots (all coaching points)
  const markedPositions: MarkedPosition[] = coachingPoints.map((cp) => ({
    position:  cp.positionLabel.split(" ")[0] || cp.positionLabel,
    label:     cp.positionLabel,
    timestamp: cp.timestamp,
    status:    cp.status,
    coachNote: cp.observation,
  }));

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 0 24px" }}>
      {/* Header */}
      <div style={{ padding: "20px 16px 16px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontFamily: F.serif, fontSize: 22, color: C.deepGreen, marginBottom: 4 }}>
          {result.headline}
        </div>
        <div style={{ fontSize: 13, color: C.muted }}>
          {result.isVideoAnalysis
            ? `${result.videoFramesAnalyzed} frames analyzed · swing ${result.swingStart?.toFixed(1) ?? ""}s–${result.swingEnd?.toFixed(1) ?? ""}s · ${coachingPoints.length} coaching points`
            : "Image analyzed"}
        </div>
      </div>

      <div style={{ padding: "16px" }}>

        {/* Opening */}
        <Card style={{ marginBottom: 20, background: C.lightGreen, border: "1px solid #B7D9BE" }}>
          <div style={{ fontSize: 15, color: C.deepGreen, lineHeight: 1.75 }}>
            {result.openingMessage}
          </div>
        </Card>

        {/* Video player with frame strip and timeline dots */}
        {videoUrl && result.isVideoAnalysis && (
          <div style={{ marginBottom: 24 }}>
            <SectionLabel>Your swing</SectionLabel>
            <Card style={{ padding: 12 }}>
              <VideoPlayer
                ref={playerRef}
                videoUrl={videoUrl}
                duration={result.videoDuration ?? 3}
                frameTimestamps={result.frameTimestamps ?? []}
                positions={markedPositions}
                selectedFrames={selectedFrames}
                onFrameClick={handleFrameClick}
              />
            </Card>
          </div>
        )}

        {/* What's working */}
        {result.whatsWorking?.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <SectionLabel>What is working</SectionLabel>
            <Card>
              {result.whatsWorking.map((s, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex", gap: 10, alignItems: "flex-start",
                    paddingBottom: i < result.whatsWorking.length - 1 ? 12 : 0,
                    borderBottom: i < result.whatsWorking.length - 1 ? `1px solid ${C.border}` : "none",
                    marginBottom: i < result.whatsWorking.length - 1 ? 12 : 0,
                  }}
                >
                  <span style={{ color: C.accentGreen, fontSize: 14, flexShrink: 0, marginTop: 2 }}>+</span>
                  <div style={{ fontSize: 15, color: C.secondary, lineHeight: 1.6 }}>{s}</div>
                </div>
              ))}
            </Card>
          </div>
        )}

        {/* Strengths — compact cards, no image */}
        {strengths.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <SectionLabel>Strengths ({strengths.length})</SectionLabel>
            {strengths.map((p, i) => (
              <div
                key={i}
                ref={(el) => {
                  const idx = coachingPoints.indexOf(p);
                  if (el) cardRefs.current.set(idx, el);
                }}
              >
                <StrengthCard point={p} />
              </div>
            ))}
          </div>
        )}

        {/* Fix cards — ordered by coachingPriority, with annotated frames */}
        {fixes.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <SectionLabel>
              Coaching fixes — priority order ({fixes.length})
            </SectionLabel>
            {fixes.map((p, i) => {
              const globalIdx = coachingPoints.indexOf(p);
              return (
                <FixCard
                  key={i}
                  point={p}
                  frameImages={frameImages}
                  cardRef={(el) => {
                    if (el) cardRefs.current.set(globalIdx, el);
                  }}
                  onSeek={seekVideo}
                />
              );
            })}
          </div>
        )}

        {/* Weekly focus */}
        {result.weeklyFocus && (
          <div style={{
            background: C.deepGreen, borderRadius: 12, padding: 20, marginBottom: 16,
          }}>
            <div style={{
              fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.5)",
              textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: 10,
            }}>
              This week's focus
            </div>
            <div style={{ fontFamily: F.serif, fontSize: 17, color: "#fff", lineHeight: 1.65 }}>
              {result.weeklyFocus}
            </div>
          </div>
        )}

        {/* Closing */}
        {result.closingMessage && (
          <Card style={{ marginBottom: 20, borderLeft: `3px solid ${C.accentGreen}` }}>
            <div style={{
              fontSize: 15, color: C.secondary, lineHeight: 1.75, fontStyle: "italic",
            }}>
              {result.closingMessage}
            </div>
          </Card>
        )}

        <button
          onClick={reset}
          style={{
            width: "100%", padding: "13px 0",
            border: `1px solid ${C.border}`, borderRadius: 8,
            background: C.card, color: C.secondary, fontSize: 15, fontWeight: 600,
          }}
        >
          Analyze another swing
        </button>
      </div>
    </div>
  );
}
