import { useRef, useState, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import { C, F, STATUS } from "../design";
import type { SelectedFrame } from "../App";

/** Imperative handle exposed by VideoPlayer so parents can seek the video
 * from outside the component (e.g. when a coaching card is tapped). */
export interface VideoPlayerHandle {
  seekTo: (timestamp: number) => void;
}

export interface MarkedPosition {
  position: string;
  label: string;
  timestamp: number;
  status: "strength" | "improving" | "focus-area" | "extra-observation";
  coachNote: string;
}

// Colors for extra-observation (white/neutral) not in STATUS default renders
const EXTRA_OBS = { color: "#FFFFFF", bg: "rgba(15,36,23,0.65)", border: "rgba(255,255,255,0.4)", label: "Note" };

function statusCfg(status: string) {
  if (status === "extra-observation") return EXTRA_OBS;
  return STATUS[status as keyof typeof STATUS] ?? STATUS["focus-area"];
}

interface Props {
  videoUrl: string;
  duration: number;
  /** Timestamps of ALL extracted frames — used for timeline dot placement */
  frameTimestamps: number[];
  /** Coaching-point-derived positions for timeline dots */
  positions: MarkedPosition[];
  /** Selected coaching-point frames shown in the thumbnail strip */
  selectedFrames?: SelectedFrame[];
  /** Called with the pointIndex of the coaching card to scroll to */
  onFrameClick?: (pointIndex: number) => void;
}

const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(function VideoPlayer({
  videoUrl,
  duration,
  frameTimestamps,
  positions,
  selectedFrames = [],
  onFrameClick,
}, ref) {
  const videoRef   = useRef<HTMLVideoElement>(null);
  const thumbRefs  = useRef<(HTMLDivElement | null)[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing,     setPlaying]     = useState(false);
  const [activeIdx,   setActiveIdx]   = useState<number | null>(null);

  // Auto-highlight nearest selected frame as video plays
  const onTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v || selectedFrames.length === 0) return;
    setCurrentTime(v.currentTime);

    let closest = -1;
    let dist    = Infinity;
    selectedFrames.forEach((f, i) => {
      const d = Math.abs(f.timestamp - v.currentTime);
      if (d < dist) { dist = d; closest = i; }
    });
    if (dist < 0.4) {
      setActiveIdx(closest);
      thumbRefs.current[closest]?.scrollIntoView({
        behavior: "smooth", block: "nearest", inline: "center",
      });
    } else {
      setActiveIdx(null);
    }
  }, [selectedFrames]);

  const seekTo = (t: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = t;
      setCurrentTime(t);
      videoRef.current.pause();
      setPlaying(false);
    }
  };

  // Expose seekTo to parent so coaching cards can drive the video.
  useImperativeHandle(ref, () => ({ seekTo }), []);

  const handleThumbClick = (i: number) => {
    const frame = selectedFrames[i];
    if (!frame) return;
    seekTo(frame.timestamp);
    setActiveIdx(i);
    onFrameClick?.(frame.pointIndex);
  };

  const handleDotClick = (i: number) => {
    const p = positions[i];
    if (!p) return;
    seekTo(p.timestamp);
    // Find matching selected frame
    const fi = selectedFrames.findIndex(
      (f) => Math.abs(f.timestamp - p.timestamp) < 0.15,
    );
    if (fi !== -1) {
      setActiveIdx(fi);
      onFrameClick?.(selectedFrames[fi].pointIndex);
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (playing) { videoRef.current.pause(); setPlaying(false); }
    else          { videoRef.current.play();  setPlaying(true);  }
  };

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const activeMarker =
    activeIdx !== null ? positions.find((p) => {
      const f = selectedFrames[activeIdx];
      return f && Math.abs(p.timestamp - f.timestamp) < 0.15;
    }) ?? null
    : null;

  return (
    <div>
      {/* ── Video ─────────────────────────────────────────────────────── */}
      <div style={{ position: "relative", background: "#000", borderRadius: 8, overflow: "hidden" }}>
        <video
          ref={videoRef}
          src={videoUrl}
          style={{ width: "100%", display: "block", maxHeight: 360, objectFit: "contain" }}
          playsInline
          onTimeUpdate={onTimeUpdate}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onClick={togglePlay}
        />

        {/* Position overlay when paused near a marker */}
        {activeMarker && !playing && (
          <div style={{
            position: "absolute", top: 10, left: 10, right: 10,
            background: "rgba(15,36,23,0.88)", borderRadius: 8, padding: "10px 14px",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{
                fontSize: 10, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.06em",
                color: statusCfg(activeMarker.status).color,
                background: statusCfg(activeMarker.status).bg,
                border: `1px solid ${statusCfg(activeMarker.status).border}`,
                padding: "2px 8px", borderRadius: 100,
              }}>
                {activeMarker.position} — {statusCfg(activeMarker.status).label}
              </span>
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.9)", lineHeight: 1.5, fontFamily: F.sans }}>
              {activeMarker.coachNote}
            </div>
          </div>
        )}

        {/* Play/pause button */}
        <button
          onClick={togglePlay}
          style={{
            position: "absolute", bottom: 10, right: 10,
            width: 36, height: 36, borderRadius: "50%",
            background: "rgba(15,36,23,0.7)",
            border: "1px solid rgba(255,255,255,0.2)",
            color: "#fff", fontSize: 14,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {playing ? "II" : "▶"}
        </button>
      </div>

      {/* ── Timeline scrubber with colored dots ───────────────────────── */}
      <div style={{ marginTop: 10, padding: "0 2px" }}>
        <div
          style={{ position: "relative", height: 4, background: C.border, borderRadius: 2, cursor: "pointer" }}
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
            seekTo(Math.max(0, Math.min(((e.clientX - rect.left) / rect.width) * duration, duration)));
          }}
        >
          {/* Playhead */}
          <div style={{
            position: "absolute", left: 0, top: 0, height: "100%",
            width: `${pct}%`, background: C.accentGreen, borderRadius: 2, transition: "width 0.1s linear",
          }} />

          {/* Coaching-point dots — positioned by exact timestamp */}
          {positions.map((p, i) => {
            const left = duration > 0 ? (p.timestamp / duration) * 100 : 0;
            const cfg  = statusCfg(p.status);
            const fi   = selectedFrames.findIndex(
              (f) => Math.abs(f.timestamp - p.timestamp) < 0.15,
            );
            const isActive = fi !== -1 && activeIdx === fi;
            return (
              <div
                key={i}
                onClick={(e) => { e.stopPropagation(); handleDotClick(i); }}
                title={`${p.position} — ${p.label}`}
                style={{
                  position: "absolute", top: "50%",
                  transform: "translate(-50%, -50%)",
                  left: `${left}%`, cursor: "pointer",
                  width: isActive ? 14 : 10, height: isActive ? 14 : 10,
                  borderRadius: "50%",
                  background: p.status === "strength" ? C.accentGreen
                            : p.status === "extra-observation" ? "#E5E5E5"
                            : C.warning,
                  border: "2px solid #fff", zIndex: 2,
                  transition: "all 0.15s",
                  boxShadow: isActive ? `0 0 0 3px ${cfg.color}55` : "none",
                }}
              />
            );
          })}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <span style={{ fontSize: 11, color: C.muted }}>{currentTime.toFixed(1)}s</span>
          <span style={{ fontSize: 11, color: C.muted }}>{duration.toFixed(1)}s</span>
        </div>
      </div>

      {/* ── Thumbnail strip — labeled coaching frames ──────────────────── */}
      {selectedFrames.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{
            fontSize: 10, color: C.muted, textTransform: "uppercase" as const,
            letterSpacing: "0.08em", marginBottom: 8,
          }}>
            {selectedFrames.length} coaching positions
          </div>
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
            {selectedFrames.map((frame, i) => {
              const isActive = activeIdx === i;
              const borderColor =
                frame.status === "strength"
                  ? C.accentGreen
                  : frame.status === "extra-observation"
                  ? "#E5E5E5"
                  : C.warning;
              return (
                <div
                  key={i}
                  ref={(el) => { thumbRefs.current[i] = el; }}
                  onClick={() => handleThumbClick(i)}
                  style={{
                    flexShrink: 0, cursor: "pointer", borderRadius: 8, overflow: "hidden",
                    border: isActive
                      ? `2px solid ${borderColor}`
                      : `2px solid ${borderColor}55`,
                    boxShadow: isActive ? `0 0 0 2px ${borderColor}44` : "none",
                    transition: "all 0.2s",
                  }}
                >
                  <img
                    src={`data:image/jpeg;base64,${frame.base64}`}
                    alt={frame.shortLabel}
                    style={{ width: 76, height: 52, objectFit: "cover", display: "block" }}
                  />
                  <div style={{
                    padding: "3px 4px", textAlign: "center" as const,
                    background: isActive ? (
                      frame.status === "strength" ? C.lightGreen
                      : frame.status === "extra-observation" ? "rgba(255,255,255,0.15)"
                      : "#FEF3E2"
                    ) : C.bg,
                    borderTop: `1px solid ${isActive ? borderColor : C.border}`,
                  }}>
                    <div style={{
                      fontSize: 10, fontWeight: 700,
                      color: isActive ? borderColor : C.muted,
                    }}>
                      {frame.shortLabel}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Active position details ────────────────────────────────────── */}
      {activeIdx !== null && selectedFrames[activeIdx] && (
        <div style={{
          marginTop: 10,
          border: `1px solid ${
            selectedFrames[activeIdx].status === "strength" ? C.accentGreen
            : selectedFrames[activeIdx].status === "extra-observation" ? "rgba(255,255,255,0.3)"
            : C.warning
          }44`,
          borderLeft: `3px solid ${
            selectedFrames[activeIdx].status === "strength" ? C.accentGreen
            : selectedFrames[activeIdx].status === "extra-observation" ? "#E5E5E5"
            : C.warning
          }`,
          borderRadius: 10, padding: "12px 14px",
          background:
            selectedFrames[activeIdx].status === "strength" ? C.lightGreen
            : selectedFrames[activeIdx].status === "extra-observation" ? "rgba(15,36,23,0.04)"
            : "#FEF3E2",
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.deepGreen, marginBottom: 3 }}>
            {selectedFrames[activeIdx].fullLabel}
          </div>
          <div style={{ fontSize: 12, color: C.muted }}>
            {selectedFrames[activeIdx].timestamp.toFixed(2)}s into video
          </div>
        </div>
      )}
    </div>
  );
});

export default VideoPlayer;
