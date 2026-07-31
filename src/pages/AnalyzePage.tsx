import { useState, useRef, useCallback, useEffect } from "react";
import { C, F } from "../design";
import VideoPlayer, { type VideoPlayerHandle } from "../components/VideoPlayer";
import type {
  SessionMemory,
  FeelProfile,
  AnalysisResult,
  CoachingPoint,
  CheckinResponse,
} from "../App";
import { computeCareerSummary, formatAnalyticsForPrompt, type Round } from "../lib/analytics";
import { buildCheckpoints, type Checkpoint, type Severity } from "../lib/swingPhases";

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

// ─── Frame lookup helper ───────────────────────────────────────────────────

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

function severityColor(s: Severity): string {
  return s === "red" ? C.danger : s === "yellow" ? C.warning : C.accentGreen;
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

// ─── Checkpoint bar — persistent, below video ─────────────────────────────────
// Always shows all 6 phases. Tapping a dot seeks the video (if that phase has
// a mapped moment) and opens the breakdown panel scrolled to that section.
// Swipe-up (or tap the affordance row) opens the panel at the top.

function CheckpointBar({
  checkpoints,
  onTapDot,
  onOpenPanel,
}: {
  checkpoints: Checkpoint[];
  onTapDot: (i: number) => void;
  onOpenPanel: () => void;
}) {
  const dragStartY = useRef<number | null>(null);

  return (
    <div
      onPointerDown={(e) => { dragStartY.current = e.clientY; }}
      onPointerMove={(e) => {
        if (dragStartY.current === null) return;
        if (dragStartY.current - e.clientY > 28) {
          onOpenPanel();
          dragStartY.current = null;
        }
      }}
      onPointerUp={() => { dragStartY.current = null; }}
      onPointerCancel={() => { dragStartY.current = null; }}
      style={{
        border: `1px solid ${C.border}`, borderRadius: 12, background: C.card,
        padding: "12px 6px 0", marginTop: 14, touchAction: "pan-y",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        {checkpoints.map((cp, i) => (
          <button
            key={cp.phase}
            onClick={() => onTapDot(i)}
            style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
              gap: 5, border: "none", background: "transparent", cursor: "pointer",
              padding: "2px 0 10px",
            }}
          >
            <span style={{
              width: 10, height: 10, borderRadius: "50%",
              background: severityColor(cp.severity),
            }} />
            <span style={{ fontSize: 10, color: C.muted, textAlign: "center" as const, lineHeight: 1.2 }}>
              {cp.phase}
            </span>
          </button>
        ))}
      </div>
      <div
        onClick={onOpenPanel}
        style={{
          textAlign: "center" as const, fontSize: 11, color: C.muted,
          padding: "7px 0", cursor: "pointer", borderTop: `1px solid ${C.border}`,
        }}
      >
        ︿ Swipe up for full breakdown
      </div>
    </div>
  );
}

// ─── Breakdown section — one per checkpoint, inside the swipe-up panel ────────

function BreakdownSection({
  checkpoint,
  frameImages,
  onSeek,
}: {
  checkpoint: Checkpoint;
  frameImages: AnalysisResult["frameImages"];
  onSeek: (t: number) => void;
}) {
  const sevColor = severityColor(checkpoint.severity);

  return (
    <div style={{ padding: "18px 0", borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: sevColor, flexShrink: 0 }} />
        <div style={{ fontFamily: F.serif, fontSize: 17, color: C.deepGreen }}>{checkpoint.phase}</div>
      </div>

      {checkpoint.points.length === 0 ? (
        <div style={{ fontSize: 14, color: C.secondary, lineHeight: 1.7 }}>
          Nothing to flag here — solid position.
        </div>
      ) : (
        checkpoint.points.map((p: CoachingPoint, i: number) => {
          const frame = resolveFrame(frameImages, p.frameIndex, p.timestamp);
          const ytQuery = p.youtubeSearch?.query ? encodeURIComponent(p.youtubeSearch.query) : null;
          const bodyText = p.status === "strength" ? p.observation : (p.description || p.observation);
          const isLast = i === checkpoint.points.length - 1;

          return (
            <div key={i} style={{ marginBottom: isLast ? 0 : 16 }}>
              {p.title && (
                <div style={{
                  fontSize: 14, fontWeight: 700, marginBottom: 4,
                  color: p.status === "strength" ? C.accentGreen : C.deepGreen,
                }}>
                  {p.title}
                </div>
              )}

              {bodyText && (
                <div style={{
                  fontSize: 15, color: C.secondary, lineHeight: 1.7,
                  marginBottom: (frame || p.feelingCue || p.practiceDrill || ytQuery) ? 10 : 0,
                }}>
                  {bodyText}
                </div>
              )}

              {frame && (
                <div
                  onClick={() => onSeek(p.timestamp)}
                  title="Tap to jump video to this frame"
                  style={{
                    lineHeight: 0, borderRadius: 8, overflow: "hidden",
                    marginBottom: 10, cursor: "pointer", maxWidth: 240,
                  }}
                >
                  <img
                    src={`data:image/jpeg;base64,${frame.base64}`}
                    alt={`${checkpoint.phase} — ${p.timestamp?.toFixed(2)}s`}
                    style={{ width: "100%", display: "block" }}
                  />
                </div>
              )}

              {p.feelingCue && (
                <div style={{
                  fontSize: 14, color: C.deepGreen, fontStyle: "italic" as const,
                  fontFamily: F.serif, lineHeight: 1.6, marginBottom: 6,
                  borderLeft: `2px solid ${C.accentGreen}`, paddingLeft: 10,
                }}>
                  "{p.feelingCue}"
                  {p.feelingCueCredit && (
                    <div style={{
                      fontSize: 11, color: C.muted, fontStyle: "normal" as const,
                      fontFamily: F.sans, marginTop: 3,
                    }}>
                      {p.feelingCueCredit}
                    </div>
                  )}
                </div>
              )}

              {p.practiceDrill && (
                <div style={{
                  fontSize: 13, color: C.secondary, lineHeight: 1.6,
                  marginBottom: ytQuery ? 6 : 0,
                }}>
                  <span style={{ fontWeight: 700, color: C.deepGreen }}>{p.practiceDrill.name}</span>
                  {p.practiceDrill.reps ? ` — ${p.practiceDrill.reps}` : ""}
                  {p.practiceDrill.description ? `: ${p.practiceDrill.description}` : ""}
                </div>
              )}

              {ytQuery && (
                <a
                  href={`https://www.youtube.com/results?search_query=${ytQuery}`}
                  target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 13, fontWeight: 600, color: C.accentGreen, textDecoration: "none" }}
                >
                  Watch on YouTube →
                </a>
              )}
            </div>
          );
        })
      )}
    </div>
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

  // Swipe-up breakdown panel state
  const [panelOpen,     setPanelOpen]     = useState(false);
  const [panelScrollTo, setPanelScrollTo] = useState<number | null>(null);
  const sectionRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Imperative handle on the video player so the checkpoint bar can seek the video
  const playerRef   = useRef<VideoPlayerHandle>(null);
  const seekVideo = useCallback((t: number) => {
    playerRef.current?.seekTo(t);
  }, []);

  useEffect(() => {
    if (panelOpen && panelScrollTo !== null) {
      const el = sectionRefs.current.get(panelScrollTo);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      setPanelScrollTo(null);
    }
  }, [panelOpen, panelScrollTo]);

  const openPanel = useCallback((scrollToIdx: number | null) => {
    setPanelOpen(true);
    setPanelScrollTo(scrollToIdx);
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
      setPanelOpen(false);

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

  const reset = () => { removeFile(); setNotes(""); setLoadStep(0); setPanelOpen(false); };

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
  // Video-first: header is a single compact block, the video is the primary
  // element on the page, a persistent checkpoint bar sits directly below it,
  // and the full narrative breakdown lives in a swipe-up panel so it never
  // competes with the video for attention until the user asks for it.

  const frameImages   = result.frameImages ?? [];
  const coachingPoints: CoachingPoint[] = result.coachingPoints ?? [];
  const checkpoints = buildCheckpoints(coachingPoints);

  const handleCheckpointTap = (i: number) => {
    const cp = checkpoints[i];
    if (cp.timestamp !== null) seekVideo(cp.timestamp);
    openPanel(i);
  };

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 0 32px" }}>
      {/* Header — compact, no separate boxed cards competing with the video below */}
      <div style={{ padding: "20px 16px 4px" }}>
        <div style={{ fontFamily: F.serif, fontSize: 22, color: C.deepGreen, marginBottom: 4 }}>
          {result.headline}
        </div>
        {result.openingMessage && (
          <div style={{ fontSize: 14, color: C.secondary, lineHeight: 1.6, marginBottom: 6 }}>
            {result.openingMessage}
          </div>
        )}
        {result.isVideoAnalysis && (
          <div style={{ fontSize: 12, color: C.muted }}>
            Swing {result.swingStart?.toFixed(1) ?? ""}s–{result.swingEnd?.toFixed(1) ?? ""}s
          </div>
        )}
      </div>

      <div style={{ padding: "10px 16px 0" }}>
        {videoUrl && result.isVideoAnalysis && (
          <VideoPlayer
            ref={playerRef}
            videoUrl={videoUrl}
            duration={result.videoDuration ?? 3}
          />
        )}

        <CheckpointBar
          checkpoints={checkpoints}
          onTapDot={handleCheckpointTap}
          onOpenPanel={() => openPanel(null)}
        />

        {/* Weekly focus + closing — one compact card, kept minimal */}
        {(result.weeklyFocus || result.closingMessage) && (
          <div style={{ background: C.deepGreen, borderRadius: 12, padding: 18, marginTop: 20 }}>
            {result.weeklyFocus && (
              <>
                <div style={{
                  fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.5)",
                  textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: 8,
                }}>
                  This week's focus
                </div>
                <div style={{
                  fontFamily: F.serif, fontSize: 16, color: "#fff", lineHeight: 1.6,
                  marginBottom: result.closingMessage ? 10 : 0,
                }}>
                  {result.weeklyFocus}
                </div>
              </>
            )}
            {result.closingMessage && (
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", lineHeight: 1.6, fontStyle: "italic" as const }}>
                {result.closingMessage}
              </div>
            )}
          </div>
        )}

        <button
          onClick={reset}
          style={{
            width: "100%", padding: "13px 0", marginTop: 16,
            border: `1px solid ${C.border}`, borderRadius: 8,
            background: C.card, color: C.secondary, fontSize: 15, fontWeight: 600,
          }}
        >
          Analyze another swing
        </button>
      </div>

      {/* ── Swipe-up breakdown panel ── */}
      {panelOpen && (
        <div
          onClick={() => setPanelOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(15,36,23,0.35)", zIndex: 1100 }}
        />
      )}
      <div style={{
        position: "fixed", left: 0, right: 0, bottom: 0,
        maxWidth: 680, margin: "0 auto",
        height: "84vh", background: C.bg,
        borderTopLeftRadius: 20, borderTopRightRadius: 20,
        boxShadow: "0 -10px 30px rgba(0,0,0,0.2)",
        transform: panelOpen ? "translateY(0)" : "translateY(100%)",
        transition: "transform 0.28s ease",
        zIndex: 1200, display: "flex", flexDirection: "column" as const,
      }}>
        <div
          onClick={() => setPanelOpen(false)}
          style={{ padding: "10px 0 8px", display: "flex", justifyContent: "center", cursor: "pointer" }}
        >
          <div style={{ width: 40, height: 4, borderRadius: 2, background: C.borderDark }} />
        </div>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "0 20px 14px", borderBottom: `1px solid ${C.border}`,
        }}>
          <div style={{ fontFamily: F.serif, fontSize: 18, color: C.deepGreen }}>Full breakdown</div>
          <button
            onClick={() => setPanelOpen(false)}
            style={{ border: "none", background: "none", fontSize: 22, color: C.muted, cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto" as const, padding: "4px 20px 32px" }}>
          {checkpoints.map((cp, i) => (
            <div key={cp.phase} ref={(el) => { if (el) sectionRefs.current.set(i, el); }}>
              <BreakdownSection checkpoint={cp} frameImages={frameImages} onSeek={seekVideo} />
            </div>
          ))}

          {/* Feeling layer — always last, connects tempo/contact feel to
              faults already covered above in causal language. Optional. */}
          {result.feelingLayer?.narrative && (
            <div style={{ padding: "18px 0" }}>
              <div style={{ fontFamily: F.serif, fontSize: 15, color: C.deepGreen, marginBottom: 8 }}>
                How it feels
              </div>
              <div style={{ fontSize: 15, color: C.secondary, lineHeight: 1.75, fontStyle: "italic" as const }}>
                {result.feelingLayer.narrative}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
