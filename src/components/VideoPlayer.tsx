import { useRef, useState, useEffect, useCallback } from "react";
import { C, F, STATUS } from "../design";
import type { FrameImage } from "../App";

export interface MarkedPosition {
  position: string;
  label: string;
  timestamp: number;
  status: "strength" | "improving" | "focus-area";
  coachNote: string;
}

interface Props {
  videoUrl: string;
  duration: number;
  frameTimestamps: number[];
  positions: MarkedPosition[];
  frameImages?: FrameImage[];
  onPositionClick?: (index: number) => void;
}

export default function VideoPlayer({ videoUrl, duration, frameTimestamps, positions, frameImages = [], onPositionClick }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [activeThumb, setActiveThumb] = useState<number | null>(null);
  const [activeMarker, setActiveMarker] = useState<MarkedPosition | null>(null);
  const thumbRefs = useRef<(HTMLDivElement | null)[]>([]);

  const onTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setCurrentTime(v.currentTime);

    let closest: MarkedPosition | null = null;
    let closestDist = Infinity;
    positions.forEach((p, i) => {
      const dist = Math.abs(p.timestamp - v.currentTime);
      if (dist < closestDist) { closestDist = dist; closest = p; }
    });

    if (closestDist < 0.5) {
      setActiveMarker(closest);
      const idx = positions.findIndex(p => p === closest);
      if (idx !== -1) {
        setActiveThumb(idx);
        thumbRefs.current[idx]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
    } else {
      setActiveMarker(null);
    }
  }, [positions]);

  const seekTo = (t: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = t;
      setCurrentTime(t);
      videoRef.current.pause();
      setPlaying(false);
    }
  };

  const handleMarkerClick = (idx: number) => {
    const ts = frameTimestamps[idx];
    if (ts !== undefined) seekTo(ts);
    setActiveThumb(idx);
    onPositionClick?.(idx);
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (playing) { videoRef.current.pause(); setPlaying(false); }
    else { videoRef.current.play(); setPlaying(true); }
  };

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div>
      {/* Video */}
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

        {/* Overlay on pause near marker */}
        {activeMarker && !playing && (
          <div style={{ position: "absolute", top: 10, left: 10, right: 10,
            background: "rgba(15,36,23,0.88)", borderRadius: 8, padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: STATUS[activeMarker.status].color,
                background: STATUS[activeMarker.status].bg,
                border: `1px solid ${STATUS[activeMarker.status].border}`,
                padding: "2px 8px", borderRadius: 100 }}>
                {activeMarker.position} — {STATUS[activeMarker.status].label}
              </span>
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.9)", lineHeight: 1.5, fontFamily: F.sans }}>
              {activeMarker.coachNote}
            </div>
          </div>
        )}

        {/* Play/pause button */}
        <button onClick={togglePlay} style={{ position: "absolute", bottom: 10, right: 10,
          width: 36, height: 36, borderRadius: "50%", background: "rgba(15,36,23,0.7)",
          border: `1px solid rgba(255,255,255,0.2)`, color: "#fff", fontSize: 14,
          display: "flex", alignItems: "center", justifyContent: "center" }}>
          {playing ? "II" : "▶"}
        </button>
      </div>

      {/* Custom scrubber */}
      <div style={{ marginTop: 10, padding: "0 2px" }}>
        <div
          style={{ position: "relative", height: 4, background: C.border, borderRadius: 2, cursor: "pointer" }}
          onClick={e => {
            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
            const t = ((e.clientX - rect.left) / rect.width) * duration;
            seekTo(Math.max(0, Math.min(t, duration)));
          }}>
          <div style={{ position: "absolute", left: 0, top: 0, height: "100%",
            width: `${pct}%`, background: C.accentGreen, borderRadius: 2, transition: "width 0.1s linear" }} />

          {positions.map((p, i) => {
            const left = duration > 0 ? (p.timestamp / duration) * 100 : 0;
            const cfg = STATUS[p.status];
            const isActive = activeThumb === i;
            return (
              <div key={i}
                onClick={e => { e.stopPropagation(); handleMarkerClick(i); }}
                title={`${p.position} — ${p.label}`}
                style={{ position: "absolute", top: "50%", transform: "translate(-50%, -50%)",
                  left: `${left}%`, cursor: "pointer",
                  width: isActive ? 14 : 10, height: isActive ? 14 : 10, borderRadius: "50%",
                  background: cfg.color, border: `2px solid #fff`, zIndex: 2,
                  transition: "all 0.15s", boxShadow: isActive ? `0 0 0 3px ${cfg.color}55` : "none" }} />
            );
          })}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <span style={{ fontSize: 11, color: C.muted }}>{currentTime.toFixed(1)}s</span>
          <span style={{ fontSize: 11, color: C.muted }}>{duration.toFixed(1)}s</span>
        </div>
      </div>

      {/* Thumbnail strip from extracted frames */}
      {frameImages.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase",
            letterSpacing: "0.08em", marginBottom: 8 }}>
            Positions P1 — P{frameImages.length}
          </div>
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
            {frameImages.map((frame, i) => {
              const pos = positions[i];
              const cfg = pos ? STATUS[pos.status] : STATUS["improving"];
              const isActive = activeThumb === i;
              return (
                <div
                  key={i}
                  ref={el => { thumbRefs.current[i] = el; }}
                  onClick={() => handleMarkerClick(i)}
                  style={{ flexShrink: 0, cursor: "pointer", borderRadius: 8, overflow: "hidden",
                    border: isActive ? `2px solid ${cfg.color}` : `2px solid ${cfg.color}55`,
                    transition: "all 0.2s", boxShadow: isActive ? `0 0 0 2px ${cfg.color}44` : "none" }}>
                  <img src={`data:image/jpeg;base64,${frame.base64}`}
                    alt={frame.code}
                    style={{ width: 76, height: 52, objectFit: "cover", display: "block" }} />
                  <div style={{ background: isActive ? cfg.bg : C.bg,
                    padding: "3px 4px", textAlign: "center",
                    borderTop: `1px solid ${isActive ? cfg.border : C.border}` }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: isActive ? cfg.color : C.muted }}>
                      {frame.code}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Active position details */}
      {activeThumb !== null && positions[activeThumb] && (
        <div style={{ marginTop: 10,
          border: `1px solid ${STATUS[positions[activeThumb].status].border}`,
          borderLeft: `3px solid ${STATUS[positions[activeThumb].status].color}`,
          borderRadius: 10, padding: "12px 14px",
          background: STATUS[positions[activeThumb].status].bg }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.deepGreen, marginBottom: 3 }}>
            {positions[activeThumb].position} — {positions[activeThumb].label}
          </div>
          <div style={{ fontSize: 13, color: C.secondary, lineHeight: 1.6 }}>
            {positions[activeThumb].coachNote}
          </div>
        </div>
      )}
    </div>
  );
}
