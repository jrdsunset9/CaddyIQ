import { useState } from "react";
import { C, F, STATUS } from "../design";
import type { SessionMemory, AnalysisResult, FrameImage } from "../App";

interface Props {
  history: SessionMemory[];
  onSwitchTab: (t: "round" | "analyze" | "sessions" | "drills") => void;
}

function Label({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase" as const,
      letterSpacing: "0.1em", marginBottom: 8 }}>{text}</div>
  );
}

function FrameStrip({ frames }: { frames: FrameImage[] }) {
  const [active, setActive] = useState<number | null>(null);
  if (!frames.length) return null;
  return (
    <div style={{ marginBottom: 20 }}>
      <Label text="Swing positions" />
      <div style={{ overflowX: "auto", paddingBottom: 4 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {frames.map((f, i) => (
            <div key={i} onClick={() => setActive(active === i ? null : i)}
              style={{ flexShrink: 0, cursor: "pointer", borderRadius: 8, overflow: "hidden",
                border: active === i ? `2px solid ${C.accentGreen}` : `2px solid ${C.border}`,
                transition: "border-color 0.2s" }}>
              <img src={`data:image/jpeg;base64,${f.base64}`} alt={f.code}
                style={{ width: 72, height: 50, objectFit: "cover", display: "block" }} />
              <div style={{ background: active === i ? C.lightGreen : C.bg,
                padding: "3px 4px", textAlign: "center",
                borderTop: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: active === i ? C.accentGreen : C.muted }}>
                  {f.code}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {active !== null && frames[active] && (
        <div style={{ marginTop: 10, borderRadius: 10, overflow: "hidden", background: "#111" }}>
          <img src={`data:image/jpeg;base64,${frames[active].base64}`}
            alt={frames[active].code}
            style={{ width: "100%", display: "block", maxHeight: 260, objectFit: "contain" }} />
          <div style={{ background: "rgba(15,36,23,0.85)", padding: "8px 12px" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>
              {frames[active].code} — {frames[active].position}
            </span>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", marginLeft: 8 }}>
              {frames[active].timestamp.toFixed(2)}s
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function FixCard({ fix, frameImages }: { fix: AnalysisResult["fixes"][0]; frameImages: FrameImage[] }) {
  const ytQuery = fix.youtubeSearch?.query ? encodeURIComponent(fix.youtubeSearch.query) : null;
  const priority = fix.priority ?? 1;
  const accent = priority === 1 ? C.warning : priority === 2 ? C.accentGreen : C.secondary;
  const labels = ["Priority fix", "Secondary fix", "Bonus tip"];
  const frameIdx = fix.frameIndex ?? null;
  const frame = frameIdx !== null && frameImages[frameIdx] ? frameImages[frameIdx] : null;

  return (
    <div style={{ border: "1px solid #E8E4DC", borderTop: `3px solid ${accent}`,
      borderRadius: 12, padding: 16, marginBottom: 10, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: accent, textTransform: "uppercase",
          letterSpacing: "0.08em" }}>
          {labels[priority - 1] ?? labels[2]}
        </div>
        <div style={{ fontSize: 11, color: C.muted }}>
          {fix.position || fix.positionCode}{fix.timestamp != null ? ` · ${fix.timestamp.toFixed(1)}s` : ""}
        </div>
      </div>

      <div style={{ fontFamily: F.serif, fontSize: 16, color: C.deepGreen, marginBottom: 6, lineHeight: 1.3 }}>
        {fix.title}
      </div>
      <div style={{ fontSize: 13, color: C.secondary, lineHeight: 1.7, marginBottom: frame || fix.feelingCue ? 12 : 0 }}>
        {fix.description}
      </div>

      {frame && (
        <div style={{ borderRadius: 8, overflow: "hidden", background: "#111", marginBottom: 12 }}>
          <img src={`data:image/jpeg;base64,${frame.base64}`} alt={frame.code}
            style={{ width: "100%", display: "block", maxHeight: 180, objectFit: "cover" }} />
          <div style={{ background: "rgba(15,36,23,0.75)", padding: "5px 10px" }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#fff" }}>
              {frame.code} — {frame.position}
            </span>
          </div>
        </div>
      )}

      {fix.feelingCue && (
        <div style={{ background: C.deepGreen, borderRadius: 8, padding: "12px 14px", marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", textTransform: "uppercase",
            letterSpacing: "0.1em", marginBottom: 6 }}>Feeling cue</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.9)", fontStyle: "italic",
            fontFamily: F.serif, lineHeight: 1.6, marginBottom: fix.feelingCueCredit ? 8 : 0 }}>
            "{fix.feelingCue}"
          </div>
          {fix.feelingCueCredit && (
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
              {fix.feelingCueCredit}
            </div>
          )}
        </div>
      )}

      {fix.practiceDrill && (
        <div style={{ background: C.lightGreen, borderRadius: 8, padding: "12px 14px",
          border: `1px solid #B7D9BE`, marginTop: 8 }}>
          <div style={{ fontFamily: F.serif, fontSize: 14, color: C.deepGreen, marginBottom: 3 }}>
            {fix.practiceDrill.name}
            <span style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, marginLeft: 8 }}>
              {fix.practiceDrill.reps}
            </span>
          </div>
          <div style={{ fontSize: 13, color: C.secondary, lineHeight: 1.6 }}>
            {fix.practiceDrill.description}
          </div>
        </div>
      )}

      {ytQuery && (
        <a href={`https://www.youtube.com/results?search_query=${ytQuery}`}
          target="_blank" rel="noopener noreferrer"
          style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none",
            border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", marginTop: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 1 }}>Recommended drill</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.deepGreen }}>{fix.youtubeSearch?.query}</div>
            {fix.youtubeSearch?.channel && (
              <div style={{ fontSize: 12, color: C.muted }}>{fix.youtubeSearch.channel}</div>
            )}
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.accentGreen,
            border: `1px solid ${C.accentGreen}`, padding: "4px 8px", borderRadius: 6 }}>
            Watch
          </div>
        </a>
      )}
    </div>
  );
}

function SessionDetail({ session, onBack, onAnalyze }: {
  session: SessionMemory;
  onBack: () => void;
  onAnalyze: () => void;
}) {
  const a = session.analysis;
  if (!a) {
    return (
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "24px 16px" }}>
        <button onClick={onBack} style={{ border: "none", background: "none",
          color: C.secondary, fontSize: 14, padding: "0 0 20px", display: "flex", alignItems: "center", gap: 4 }}>
          Back to sessions
        </button>
        <div style={{ fontFamily: F.serif, fontSize: 20, color: C.deepGreen }}>{session.headline}</div>
        <div style={{ fontSize: 14, color: C.muted, marginBottom: 20 }}>{session.date} — {session.swingType}</div>
        <div style={{ fontSize: 14, color: C.secondary }}>Full analysis not available for this session.</div>
      </div>
    );
  }

  const frameImages = a.frameImages ?? [];

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 0 24px" }}>
      <div style={{ padding: "16px 16px 0" }}>
        <button onClick={onBack} style={{ border: "none", background: "none",
          color: C.secondary, fontSize: 14, padding: "0 0 16px", display: "flex", alignItems: "center", gap: 4 }}>
          Back to sessions
        </button>
      </div>

      <div style={{ padding: "0 16px 16px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontFamily: F.serif, fontSize: 22, color: C.deepGreen, marginBottom: 2 }}>{a.headline}</div>
        <div style={{ fontSize: 13, color: C.muted }}>
          {session.date} — {session.swingType}
          {a.swingStart != null ? ` · swing ${a.swingStart.toFixed(1)}s–${a.swingEnd?.toFixed(1)}s` : ""}
        </div>
      </div>

      <div style={{ padding: 16 }}>
        {/* Opening */}
        <div style={{ border: `1px solid #B7D9BE`, borderRadius: 12, padding: 16,
          background: C.lightGreen, marginBottom: 20 }}>
          <div style={{ fontSize: 15, color: C.deepGreen, lineHeight: 1.75 }}>{a.openingMessage}</div>
        </div>

        {/* Frame strip — always available since frames are saved */}
        {frameImages.length > 0 ? (
          <FrameStrip frames={frameImages} />
        ) : a.isVideoAnalysis && (
          <div style={{ border: "1px solid #E8E4DC", borderRadius: 10, padding: "12px 14px",
            marginBottom: 20, background: "#FAFAF8" }}>
            <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
              {a.videoFramesAnalyzed} positions analyzed from the original video upload.
            </div>
          </div>
        )}

        {/* What's working */}
        {a.whatsWorking?.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <Label text="What was working" />
            <div style={{ border: "1px solid #E8E4DC", borderRadius: 12, padding: 16, background: "#fff" }}>
              {a.whatsWorking.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start",
                  paddingBottom: i < a.whatsWorking.length - 1 ? 12 : 0,
                  borderBottom: i < a.whatsWorking.length - 1 ? `1px solid ${C.border}` : "none",
                  marginBottom: i < a.whatsWorking.length - 1 ? 12 : 0 }}>
                  <span style={{ color: C.accentGreen, fontSize: 14, flexShrink: 0, marginTop: 2 }}>+</span>
                  <div style={{ fontSize: 14, color: C.secondary, lineHeight: 1.6 }}>{s}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Position breakdown */}
        {a.positionBreakdown?.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <Label text="Position by position" />
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {a.positionBreakdown.map((p, i) => {
                const cfg = STATUS[p.status] ?? STATUS["focus-area"];
                const frame = frameImages[p.frameIndex ?? i];
                return (
                  <div key={i} style={{ border: "1px solid #E8E4DC", borderRadius: 12,
                    padding: "12px 14px", background: "#fff" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                      {frame && (
                        <img src={`data:image/jpeg;base64,${frame.base64}`} alt={p.position}
                          style={{ width: 52, height: 38, objectFit: "cover", borderRadius: 5,
                            border: `2px solid ${cfg.color}44`, flexShrink: 0 }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
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
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Fixes */}
        {a.fixes?.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <Label text="Coaching fixes" />
            {a.fixes.slice(0, 3).map((fix, i) => (
              <FixCard key={i} fix={fix} frameImages={frameImages} />
            ))}
          </div>
        )}

        {/* Weekly focus */}
        {a.weeklyFocus && (
          <div style={{ background: C.deepGreen, borderRadius: 12, padding: 20, marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.5)",
              textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>
              Weekly focus
            </div>
            <div style={{ fontFamily: F.serif, fontSize: 16, color: "#fff", lineHeight: 1.65 }}>
              {a.weeklyFocus}
            </div>
          </div>
        )}

        {/* Closing */}
        {a.closingMessage && (
          <div style={{ border: "1px solid #E8E4DC", borderLeft: `3px solid ${C.accentGreen}`,
            borderRadius: 12, padding: 16, marginBottom: 20, background: "#fff" }}>
            <div style={{ fontSize: 14, color: C.secondary, lineHeight: 1.75, fontStyle: "italic" }}>
              {a.closingMessage}
            </div>
          </div>
        )}

        <button onClick={onAnalyze}
          style={{ width: "100%", padding: "13px 0", background: C.deepGreen, color: "#fff",
            border: "none", borderRadius: 8, fontSize: 15, fontWeight: 600 }}>
          Analyze new swing
        </button>
      </div>
    </div>
  );
}

export default function SessionsPage({ history, onSwitchTab }: Props) {
  const [selected, setSelected] = useState<SessionMemory | null>(null);

  if (selected) {
    return (
      <SessionDetail
        session={selected}
        onBack={() => setSelected(null)}
        onAnalyze={() => { setSelected(null); onSwitchTab("analyze"); }}
      />
    );
  }

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "24px 16px" }}>
      <div style={{ fontFamily: F.serif, fontSize: 24, color: C.deepGreen, marginBottom: 4 }}>Sessions</div>
      <div style={{ fontSize: 14, color: C.muted, marginBottom: 20 }}>
        {history.length} session{history.length !== 1 ? "s" : ""} on file
      </div>

      {history.length === 0 ? (
        <div style={{ border: "1px solid #E8E4DC", borderRadius: 12, padding: "48px 24px",
          textAlign: "center", background: "#fff" }}>
          <div style={{ fontFamily: F.serif, fontSize: 18, color: C.deepGreen, marginBottom: 8 }}>
            No sessions yet
          </div>
          <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.7, marginBottom: 20 }}>
            Upload your first swing on the Analyze tab. Your coach will remember every session.
          </div>
          <button onClick={() => onSwitchTab("analyze")}
            style={{ background: C.deepGreen, color: "#fff", border: "none",
              borderRadius: 8, padding: "11px 24px", fontSize: 14, fontWeight: 600 }}>
            Analyze a swing
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {history.map((session, i) => {
            const frames = session.analysis?.frameImages ?? [];
            const firstFrame = frames[0];
            return (
              <div key={session.id}
                style={{ border: "1px solid #E8E4DC",
                  borderLeft: `3px solid ${i === 0 ? C.accentGreen : C.border}`,
                  borderRadius: 12, background: "#fff", cursor: "pointer", overflow: "hidden" }}
                onClick={() => setSelected(session)}>
                <div style={{ display: "flex", gap: 0 }}>
                  {firstFrame && (
                    <img src={`data:image/jpeg;base64,${firstFrame.base64}`}
                      alt="P1"
                      style={{ width: 72, height: 72, objectFit: "cover", flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1, padding: 14, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                      <div style={{ fontFamily: F.serif, fontSize: 15, color: C.deepGreen, lineHeight: 1.3 }}>
                        {session.headline || session.swingType}
                      </div>
                      {i === 0 && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: C.accentGreen,
                          background: C.lightGreen, border: `1px solid #B7D9BE`,
                          padding: "2px 10px", borderRadius: 100, flexShrink: 0, marginLeft: 8 }}>
                          Latest
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: C.muted, marginBottom: session.weeklyFocus ? 4 : 0 }}>
                      {session.date} · {frames.length > 0 ? `${frames.length} positions` : session.swingType}
                    </div>
                    {session.weeklyFocus && (
                      <div style={{ fontSize: 12, color: C.secondary, lineHeight: 1.5 }}>
                        Focus: {session.weeklyFocus}
                      </div>
                    )}
                  </div>
                </div>
                {session.faultsIdentified?.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6,
                    padding: "8px 14px", borderTop: `1px solid ${C.border}` }}>
                    {session.faultsIdentified.slice(0, 3).map((f, j) => (
                      <span key={j} style={{ fontSize: 11, color: C.warning,
                        background: "#FEF3E2", border: `1px solid #F5C98A`,
                        padding: "2px 8px", borderRadius: 100 }}>{f}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
