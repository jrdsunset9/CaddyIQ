import { useRef, useState, forwardRef, useImperativeHandle } from "react";
import { C } from "../design";

/** Imperative handle exposed by VideoPlayer so parents can seek the video
 * from outside the component (e.g. when a checkpoint dot is tapped). */
export interface VideoPlayerHandle {
  seekTo: (timestamp: number) => void;
}

interface Props {
  videoUrl: string;
  duration: number;
}

// Real per-clip frame rate isn't returned by the backend (iPhone clips can
// be 30/60/240fps slow-mo), so frame-step uses a fixed approximation rather
// than true frame accuracy. 1/30s is a reasonable default for review pacing.
const FRAME_STEP = 1 / 30;
const SPEEDS = [0.25, 0.5, 1] as const;
type Speed = (typeof SPEEDS)[number];

const stepBtnStyle: React.CSSProperties = {
  width: 38, height: 38, borderRadius: "50%",
  border: `1px solid ${C.border}`, background: C.card,
  color: C.deepGreen, fontSize: 15,
  display: "flex", alignItems: "center", justifyContent: "center",
  cursor: "pointer",
};

const playBtnStyle: React.CSSProperties = {
  width: 46, height: 46, borderRadius: "50%",
  border: "none", background: C.deepGreen,
  color: "#fff", fontSize: 16,
  display: "flex", alignItems: "center", justifyContent: "center",
  cursor: "pointer",
};

const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(function VideoPlayer({
  videoUrl,
  duration,
}, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);

  const seekTo = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    const clamped = Math.max(0, Math.min(duration, t));
    v.currentTime = clamped;
    setCurrentTime(clamped);
    v.pause();
    setPlaying(false);
  };

  // Expose seekTo to parent (checkpoint bar taps drive the video from
  // outside this component). Listed as a dep so a future state capture
  // inside seekTo doesn't silently pin the handle to a stale closure.
  useImperativeHandle(ref, () => ({ seekTo }), [seekTo]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) { v.pause(); setPlaying(false); }
    else         { v.play();  setPlaying(true);  }
  };

  const stepFrame = (dir: 1 | -1) => {
    const v = videoRef.current;
    if (!v) return;
    seekTo(v.currentTime + dir * FRAME_STEP);
  };

  const setPlaybackRate = (r: Speed) => {
    setSpeed(r);
    if (videoRef.current) videoRef.current.playbackRate = r;
  };

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div>
      {/* ── Video — the primary focus, minimal chrome around it ── */}
      <div style={{ position: "relative", background: "#000", borderRadius: 10, overflow: "hidden" }}>
        <video
          ref={videoRef}
          src={videoUrl}
          style={{ width: "100%", display: "block", maxHeight: 440, objectFit: "contain" }}
          playsInline
          onTimeUpdate={() => { if (videoRef.current) setCurrentTime(videoRef.current.currentTime); }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onClick={togglePlay}
        />
      </div>

      {/* ── Scrubber ── */}
      <div style={{ marginTop: 10, padding: "0 2px" }}>
        <div
          style={{ position: "relative", height: 4, background: C.border, borderRadius: 2, cursor: "pointer" }}
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
            seekTo(((e.clientX - rect.left) / rect.width) * duration);
          }}
        >
          <div style={{
            position: "absolute", left: 0, top: 0, height: "100%",
            width: `${pct}%`, background: C.accentGreen, borderRadius: 2,
            transition: "width 0.1s linear",
          }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <span style={{ fontSize: 11, color: C.muted }}>{currentTime.toFixed(1)}s</span>
          <span style={{ fontSize: 11, color: C.muted }}>{duration.toFixed(1)}s</span>
        </div>
      </div>

      {/* ── Playback controls: speed, frame-step, play/pause — centered, minimal ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 14 }}>
        <div style={{
          display: "flex", gap: 2, marginRight: 10,
          border: `1px solid ${C.border}`, borderRadius: 8, padding: 2,
        }}>
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setPlaybackRate(s)}
              style={{
                padding: "5px 9px", borderRadius: 6, border: "none",
                background: speed === s ? C.deepGreen : "transparent",
                color: speed === s ? "#fff" : C.muted,
                fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}
            >
              {s}x
            </button>
          ))}
        </div>

        <button onClick={() => stepFrame(-1)} aria-label="Previous frame" style={stepBtnStyle}>◁|</button>
        <button onClick={togglePlay} aria-label={playing ? "Pause" : "Play"} style={playBtnStyle}>
          {playing ? "II" : "▶"}
        </button>
        <button onClick={() => stepFrame(1)} aria-label="Next frame" style={stepBtnStyle}>|▷</button>
      </div>
    </div>
  );
});

export default VideoPlayer;
