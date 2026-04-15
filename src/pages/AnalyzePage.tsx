import { useState, useRef, useCallback, useEffect } from "react";
import { C, F, STATUS } from "../design";
import VideoPlayer, { MarkedPosition } from "../components/VideoPlayer";
import type { SessionMemory, FeelProfile, AnalysisResult, FrameImage } from "../App";

const LOADING_MESSAGES = [
  "Uploading your swing...",
  "Running pre-shot detection (20 frames)...",
  "Isolating actual swing bounds...",
  "Extracting 10 positions P1 to P10...",
  "Cross-referencing tour biomechanics...",
  "Building your coaching plan...",
];

interface Props {
  feelProfile: FeelProfile | null;
  sessionHistory: SessionMemory[];
  onSessionSaved: (s: SessionMemory) => void;
  onSwitchTab: (t: "round" | "analyze" | "sessions" | "drills") => void;
}

function Card({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ border: "1px solid #E8E4DC", borderRadius: 12, padding: 16, background: "#fff", ...style }}>{children}</div>;
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: 8 }}>{children}</div>;
}

function FrameCard({ frame, status }: { frame: FrameImage; status: "strength" | "improving" | "focus-area" }) {
  const cfg = STATUS[status];
  return (
    <div style={{ borderRadius: 10, overflow: "hidden", background: "#111", position: "relative", marginBottom: 14 }}>
      <img src={`data:image/jpeg;base64,${frame.base64}`} alt={frame.code}
        style={{ width: "100%", display: "block", maxHeight: 200, objectFit: "cover" }} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0,
        background: "rgba(15,36,23,0.75)", padding: "6px 10px",
        display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>
          {frame.code} — {frame.position}
        </span>
        <span style={{ fontSize: 10, fontWeight: 700, color: cfg.color,
          background: cfg.bg, border: `1px solid ${cfg.border}`,
          padding: "2px 8px", borderRadius: 100 }}>
          {cfg.label}
        </span>
      </div>
    </div>
  );
}

function FixCard({
  fix,
  frameImages,
}: {
  fix: AnalysisResult["fixes"][0];
  frameImages: FrameImage[];
}) {
  const ytQuery = fix.youtubeSearch?.query ? encodeURIComponent(fix.youtubeSearch.query) : null;
  const priority = fix.priority ?? 1;
  const accent = priority === 1 ? C.warning : priority === 2 ? C.accentGreen : C.secondary;
  const labels = ["Priority fix", "Secondary fix", "Bonus tip"];

  const frameIdx = fix.frameIndex ?? null;
  const frame = frameIdx !== null && frameImages[frameIdx] ? frameImages[frameIdx] : null;
  const status = (fix as { status?: "strength" | "improving" | "focus-area" }).status ?? "focus-area";

  return (
    <Card style={{ marginBottom: 12, borderTop: `3px solid ${accent}` }}>
      {/* 1. Priority badge + position label */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start",
        marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: accent, textTransform: "uppercase",
          letterSpacing: "0.08em" }}>
          {labels[priority - 1] ?? labels[2]}
        </div>
        <div style={{ fontSize: 11, color: C.muted, textAlign: "right" }}>
          {fix.position || fix.positionCode}{fix.timestamp != null ? ` · ${fix.timestamp.toFixed(1)}s` : ""}
        </div>
      </div>

      {/* 2. Fix title */}
      <div style={{ fontFamily: F.serif, fontSize: 17, color: C.deepGreen, marginBottom: 8, lineHeight: 1.3 }}>
        {fix.title}
      </div>

      {/* 3. Description */}
      <div style={{ fontSize: 14, color: C.secondary, lineHeight: 1.7, marginBottom: 14 }}>
        {fix.description}
      </div>

      {/* 4. Actual extracted frame */}
      {frame && (
        <FrameCard frame={frame} status={status} />
      )}

      {/* Pro reference */}
      {fix.proRef?.player && (
        <div style={{ background: C.lightGreen, borderRadius: 10, padding: "12px 14px",
          marginBottom: 12, borderLeft: `3px solid ${C.accentGreen}` }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.deepGreen, marginBottom: 3 }}>
            {fix.proRef.player}
          </div>
          <div style={{ fontSize: 13, color: C.secondary, lineHeight: 1.55 }}>
            {fix.proRef.comparison}
          </div>
        </div>
      )}

      {/* 5. Feeling cue */}
      {fix.feelingCue && (
        <div style={{ background: C.deepGreen, borderRadius: 10, padding: "14px 16px", marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.5)",
            textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
            Feeling cue
          </div>
          <div style={{ fontSize: 14, color: "rgba(255,255,255,0.9)", lineHeight: 1.65,
            fontStyle: "italic", fontFamily: F.serif, marginBottom: fix.feelingCueCredit ? 10 : 0 }}>
            "{fix.feelingCue}"
          </div>
          {fix.feelingCueCredit && (
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>
              {fix.feelingCueCredit}
            </div>
          )}
        </div>
      )}

      {/* Practice drill */}
      {fix.practiceDrill && (
        <div style={{ background: C.lightGreen, borderRadius: 10, padding: "14px 16px",
          border: `1px solid #B7D9BE`, marginBottom: ytQuery ? 10 : 0 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: C.accentGreen,
            textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
            Practice drill
          </div>
          <div style={{ fontFamily: F.serif, fontSize: 15, color: C.deepGreen, marginBottom: 2 }}>
            {fix.practiceDrill.name}
            <span style={{ fontFamily: F.sans, fontSize: 12, fontWeight: 500, color: C.muted, marginLeft: 8 }}>
              {fix.practiceDrill.reps}
            </span>
          </div>
          <div style={{ fontSize: 13, color: C.secondary, lineHeight: 1.6 }}>
            {fix.practiceDrill.description}
          </div>
        </div>
      )}

      {/* 6. YouTube drill */}
      {ytQuery && (
        <a href={`https://www.youtube.com/results?search_query=${ytQuery}`}
          target="_blank" rel="noopener noreferrer"
          style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none",
            border: `1px solid ${C.border}`, borderRadius: 8, padding: "11px 14px",
            marginTop: fix.practiceDrill ? 10 : 0 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 2 }}>Recommended drill</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.deepGreen }}>
              {fix.youtubeSearch?.query}
            </div>
            {fix.youtubeSearch?.channel && (
              <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>{fix.youtubeSearch.channel}</div>
            )}
          </div>
          <div style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, color: C.accentGreen,
            border: `1px solid ${C.accentGreen}`, padding: "5px 10px", borderRadius: 6 }}>
            Watch on YouTube
          </div>
        </a>
      )}
    </Card>
  );
}

export default function AnalyzePage({ feelProfile, sessionHistory, onSessionSaved, onSwitchTab }: Props) {
  const [file, setFile]             = useState<File | null>(null);
  const [videoUrl, setVideoUrl]     = useState<string | null>(null);
  const [previewType, setPreviewType] = useState<"video" | "image">("video");
  const [notes, setNotes]           = useState("");
  const [loading, setLoading]       = useState(false);
  const [loadStep, setLoadStep]     = useState(0);
  const [result, setResult]         = useState<AnalysisResult | null>(null);
  const [error, setError]           = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging]     = useState(false);
  const fixCardRefs = useRef<(HTMLDivElement | null)[]>([]);

  const handleFile = useCallback((f: File) => {
    setError(""); setResult(null); setFile(f);
    const isVid = f.type.startsWith("video/") || /\.(mp4|mov|m4v|avi|mkv|webm|3gp)$/i.test(f.name);
    setPreviewType(isVid ? "video" : "image");
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(URL.createObjectURL(f));
  }, [videoUrl]);

  const removeFile = () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setFile(null); setVideoUrl(null); setResult(null); setError("");
  };

  const runAnalysis = async () => {
    if (!file) return;
    setError(""); setLoading(true); setLoadStep(0);
    const iv = setInterval(() => setLoadStep(s => Math.min(s + 1, LOADING_MESSAGES.length - 1)), 3000);
    try {
      const form = new FormData();
      form.append("swing", file);
      form.append("swingType", "Full swing");
      form.append("notes", notes || "none");
      form.append("sessionHistory", JSON.stringify(sessionHistory));
      if (feelProfile) form.append("feelProfile", JSON.stringify(feelProfile));

      const res = await fetch("/api/analyze", { method: "POST", body: form });
      const data = await res.json();
      clearInterval(iv);
      if (!res.ok || !data.success) throw new Error(data.error || "Analysis failed");

      const a: AnalysisResult = data.analysis;
      setResult(a);

      onSessionSaved({
        id: `${Date.now()}`,
        date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        swingType: "Full swing",
        headline: a.headline || "",
        faultsIdentified: a.sessionSummary?.faultsIdentified || [],
        improvementsNoted: a.sessionSummary?.improvementsNoted || [],
        weeklyFocus: a.weeklyFocus || "",
        analysis: a,
      });
    } catch (e: unknown) {
      clearInterval(iv);
      setError((e as Error).message || "Analysis failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { removeFile(); setNotes(""); setLoadStep(0); };

  const primaryBtn: React.CSSProperties = {
    width: "100%", padding: "13px 0", background: C.deepGreen, color: "#fff",
    border: "none", borderRadius: 8, fontSize: 15, fontWeight: 600,
  };

  const markedPositions: MarkedPosition[] = (result?.positionBreakdown ?? []).map(p => ({
    position: p.position,
    label: p.label,
    timestamp: p.timestamp,
    status: p.status,
    coachNote: p.coachNote,
  }));

  const handlePositionClick = useCallback((idx: number) => {
    const el = fixCardRefs.current[idx];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.style.animation = "highlightFade 1.2s ease";
      setTimeout(() => { if (el) el.style.animation = ""; }, 1300);
    }
  }, []);

  // ── Upload view ──
  if (!result && !loading) {
    return (
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "24px 16px" }}>
        <div style={{ fontFamily: F.serif, fontSize: 24, color: C.deepGreen, marginBottom: 4 }}>
          Analyze your swing
        </div>
        <div style={{ fontSize: 14, color: C.muted, marginBottom: 20 }}>
          Upload a video and get tour-level coaching in seconds
        </div>

        {feelProfile && (
          <div style={{ background: C.lightGreen, border: `1px solid #B7D9BE`, borderRadius: 10,
            padding: "10px 14px", marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: C.accentGreen, lineHeight: 1.6 }}>
              Feel profile active — AI will look for{" "}
              <strong>{feelProfile.shotShape || "shot shape"}</strong> tendencies and{" "}
              <strong>{feelProfile.contact || "contact"}</strong> patterns.
            </div>
          </div>
        )}

        {!videoUrl ? (
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
            onClick={() => fileRef.current?.click()}
            style={{ border: `1.5px dashed ${dragging ? C.accentGreen : C.borderDark}`, borderRadius: 12,
              padding: "44px 24px", textAlign: "center", cursor: "pointer",
              background: dragging ? C.lightGreen : C.card, transition: "all 0.2s", marginBottom: 12 }}>
            <input ref={fileRef} type="file" style={{ display: "none" }}
              accept="video/*,image/*,.mov,.mp4,.m4v,.avi,.mkv,.webm,.heic,.heif,.jpg,.jpeg,.png"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
            <div style={{ fontFamily: F.serif, fontSize: 18, color: C.deepGreen, marginBottom: 8 }}>
              Upload your swing video
            </div>
            <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.7, marginBottom: 20 }}>
              iPhone MOV, MP4, any format<br />
              <span style={{ fontSize: 12 }}>Pre-shot routine is automatically detected and excluded</span>
            </div>
            <div style={{ display: "inline-block", background: C.deepGreen, color: "#fff",
              padding: "11px 28px", borderRadius: 8, fontSize: 14, fontWeight: 600 }}>
              Choose file
            </div>
          </div>
        ) : (
          <Card style={{ marginBottom: 12 }}>
            {previewType === "video"
              ? <video src={videoUrl} controls style={{ width: "100%", borderRadius: 8, display: "block", maxHeight: 300, background: "#000" }} />
              : <img src={videoUrl} alt="Swing" style={{ width: "100%", borderRadius: 8, display: "block", maxHeight: 300, objectFit: "contain" }} />}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
              <span style={{ fontSize: 13, color: C.secondary }}>{file?.name} · {((file?.size ?? 0) / 1024 / 1024).toFixed(1)} MB</span>
              <button onClick={removeFile} style={{ border: "none", background: "none", color: C.warning, fontSize: 13, fontWeight: 600 }}>Remove</button>
            </div>
          </Card>
        )}

        <Card style={{ marginBottom: 16 }}>
          <Label>Context (optional)</Label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
            placeholder="e.g. 7-iron, feels over the top, tends to slice..."
            style={{ width: "100%", border: `1px solid ${C.borderDark}`, borderRadius: 8,
              padding: "10px 12px", fontSize: 14, color: C.body, background: C.card,
              resize: "none", lineHeight: 1.5 }} />
        </Card>

        {error && (
          <div style={{ border: `1px solid #F5C98A`, borderRadius: 10, padding: "12px 14px",
            color: C.warning, fontSize: 14, marginBottom: 16, background: "#FEF3E2" }}>
            {error}
          </div>
        )}

        <button onClick={runAnalysis} disabled={!file} style={{ ...primaryBtn, opacity: file ? 1 : 0.4 }}>
          {file ? "Analyze my swing" : "Upload a swing first"}
        </button>
      </div>
    );
  }

  // ── Loading ──
  if (loading) {
    return (
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "80px 20px", textAlign: "center" }}>
        <div style={{ width: 40, height: 40, border: `2px solid ${C.border}`,
          borderTop: `2px solid ${C.accentGreen}`, borderRadius: "50%",
          animation: "spin 1s linear infinite", margin: "0 auto 28px" }} />
        <div style={{ fontFamily: F.serif, fontSize: 22, color: C.deepGreen, marginBottom: 10 }}>
          Your coach is reviewing your swing
        </div>
        <div style={{ fontSize: 15, color: C.accentGreen, marginBottom: 28 }}>
          {LOADING_MESSAGES[loadStep]}
        </div>
        <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
          {LOADING_MESSAGES.map((_, i) => (
            <div key={i} style={{ width: 6, height: 6, borderRadius: "50%",
              background: i <= loadStep ? C.accentGreen : C.borderDark, transition: "background 0.3s" }} />
          ))}
        </div>
      </div>
    );
  }

  if (!result) return null;

  const frameImages = result.frameImages ?? [];

  // ── Results ──
  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 0 24px" }}>
      <div style={{ padding: "20px 16px 16px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontFamily: F.serif, fontSize: 22, color: C.deepGreen, marginBottom: 4 }}>
          {result.headline}
        </div>
        <div style={{ fontSize: 13, color: C.muted }}>
          {result.isVideoAnalysis
            ? `${result.videoFramesAnalyzed} positions analyzed · swing ${result.swingStart?.toFixed(1) ?? ""}s–${result.swingEnd?.toFixed(1) ?? ""}s`
            : "Image analyzed"}
        </div>
      </div>

      <div style={{ padding: "16px" }}>
        {/* Opening */}
        <Card style={{ marginBottom: 20, background: C.lightGreen, border: `1px solid #B7D9BE` }}>
          <div style={{ fontSize: 15, color: C.deepGreen, lineHeight: 1.75 }}>
            {result.openingMessage}
          </div>
        </Card>

        {/* Video player */}
        {videoUrl && result.isVideoAnalysis && (
          <div style={{ marginBottom: 24 }}>
            <Label>Your swing</Label>
            <Card style={{ padding: 12 }}>
              <VideoPlayer
                videoUrl={videoUrl}
                duration={result.videoDuration ?? 3}
                frameTimestamps={result.frameTimestamps ?? []}
                positions={markedPositions}
                frameImages={frameImages}
                onPositionClick={handlePositionClick}
              />
            </Card>
          </div>
        )}

        {/* What's working */}
        {result.whatsWorking?.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <Label>What is working</Label>
            <Card>
              {result.whatsWorking.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start",
                  paddingBottom: i < result.whatsWorking.length - 1 ? 12 : 0,
                  borderBottom: i < result.whatsWorking.length - 1 ? `1px solid ${C.border}` : "none",
                  marginBottom: i < result.whatsWorking.length - 1 ? 12 : 0 }}>
                  <span style={{ color: C.accentGreen, fontSize: 14, flexShrink: 0, marginTop: 2 }}>+</span>
                  <div style={{ fontSize: 15, color: C.secondary, lineHeight: 1.6 }}>{s}</div>
                </div>
              ))}
            </Card>
          </div>
        )}

        {/* Position breakdown */}
        {result.positionBreakdown?.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <Label>Position by position</Label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {result.positionBreakdown.map((p, i) => {
                const cfg = STATUS[p.status] ?? STATUS["focus-area"];
                const frame = frameImages[p.frameIndex ?? i];
                return (
                  <Card key={i} style={{ padding: "12px 14px" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                      {frame && (
                        <img src={`data:image/jpeg;base64,${frame.base64}`} alt={p.position}
                          style={{ width: 56, height: 40, objectFit: "cover", borderRadius: 6,
                            border: `2px solid ${cfg.color}44`, flexShrink: 0 }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                          <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700,
                            textTransform: "uppercase", letterSpacing: "0.06em",
                            color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}`,
                            padding: "2px 8px", borderRadius: 100 }}>
                            {cfg.label}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: C.deepGreen }}>
                            {p.position} — {p.label}
                          </span>
                        </div>
                        <div style={{ fontSize: 13, color: C.secondary, lineHeight: 1.6 }}>{p.observation}</div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Fixes */}
        {result.fixes?.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <Label>Coaching fixes</Label>
            {result.fixes.slice(0, 3).map((fix, i) => (
              <div key={i} ref={el => { fixCardRefs.current[i] = el; }}>
                <FixCard fix={fix} frameImages={frameImages} />
              </div>
            ))}
          </div>
        )}

        {/* Weekly focus */}
        {result.weeklyFocus && (
          <div style={{ background: C.deepGreen, borderRadius: 12, padding: 20, marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.5)",
              textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>
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
            <div style={{ fontSize: 15, color: C.secondary, lineHeight: 1.75, fontStyle: "italic" }}>
              {result.closingMessage}
            </div>
          </Card>
        )}

        <button onClick={reset}
          style={{ width: "100%", padding: "13px 0", border: `1px solid ${C.border}`, borderRadius: 8,
            background: C.card, color: C.secondary, fontSize: 15, fontWeight: 600 }}>
          Analyze another swing
        </button>
      </div>
    </div>
  );
}
