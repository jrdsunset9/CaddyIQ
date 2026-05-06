import { useState, useEffect } from "react";
import { C, F } from "./design";
import RoundPage from "./pages/RoundPage";
import AnalyzePage from "./pages/AnalyzePage";
import SessionsPage from "./pages/SessionsPage";
import DrillsPage from "./pages/DrillsPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import type { Round } from "./lib/analytics";

type Tab = "round" | "analyze" | "sessions" | "drills" | "analytics";

export interface FeelProfile {
  shotShape: string;
  contact: string;
  customFeels: string;
  lastUpdated: string;
  history: Array<{ date: string; shotShape: string; contact: string; customFeels: string }>;
}

export interface FrameImage {
  base64: string;
  timestamp: number;
  code: string;
  position: string;
}

/** One coaching point — either a strength, a focused fix, or an extra observation. */
export interface CoachingPoint {
  positionLabel: string;           // e.g. "P4 — Top of backswing" or "Grip fault — Address"
  frameIndex: number;              // exact index into frameImages[]
  timestamp: number;               // exact timestamp in original video
  status: "strength" | "focus-area" | "extra-observation";
  observation: string;
  coachingPriority: number;        // lower = fix first; strengths get 20+
  // Fix-only fields (omitted for strengths):
  title?: string;
  description?: string;
  proRef?: { player: string; comparison: string };
  feelingCue?: string;
  feelingCueCredit?: string;
  practiceDrill?: { name: string; description: string; reps: string };
  youtubeSearch?: { query: string; channel: string };
}

/** A coaching-point frame enriched for the VideoPlayer thumbnail strip. */
export interface SelectedFrame {
  base64: string;
  timestamp: number;
  shortLabel: string;   // "P4" or "Grip"
  fullLabel: string;    // "P4 — Top of backswing" or "Grip fault — Address"
  status: "strength" | "focus-area" | "extra-observation";
  pointIndex: number;   // index into coachingPoints[] array
}

export interface AnalysisResult {
  headline: string;
  openingMessage: string;
  whatsWorking: string[];
  /** New: dynamic 8-14 coaching points with annotations and priority ordering. */
  coachingPoints?: CoachingPoint[];
  /** Legacy: derived from coachingPoints for backward-compat with session history display. */
  fixes: Array<{
    priority: number;
    title: string;
    position: string;
    positionCode: string;
    frameIndex: number;
    timestamp: number;
    description: string;
    proRef?: { player: string; comparison: string };
    feelingCue?: string;
    feelingCueCredit?: string;
    practiceDrill?: { name: string; description: string; reps: string };
    youtubeSearch?: { query: string; channel: string };
  }>;
  weeklyFocus: string;
  closingMessage: string;
  sessionSummary: { faultsIdentified: string[]; improvementsNoted: string[] };
  videoFramesAnalyzed: number;
  isVideoAnalysis: boolean;
  videoDuration: number;
  frameTimestamps: number[];
  frameImages: FrameImage[];
  swingStart: number;
  swingEnd: number;
}

export interface SessionMemory {
  id: string;
  date: string;
  swingType: string;
  headline: string;
  faultsIdentified: string[];
  improvementsNoted: string[];
  weeklyFocus: string;
  analysis?: AnalysisResult;
}

/** A check-in response captured before a new analysis — used to adapt the
 * coaching advice progression (de-prioritize fixed items, escalate struggles). */
export interface CheckinResponse {
  date: string;
  focus: string;
  response: "improving" | "struggling" | "not_yet";
}

function useFeelProfile() {
  const [profile, setProfile] = useState<FeelProfile | null>(() => {
    try { return JSON.parse(localStorage.getItem("ciq_feel_profile") || "null"); } catch { return null; }
  });
  const save = (p: FeelProfile) => {
    setProfile(p);
    try { localStorage.setItem("ciq_feel_profile", JSON.stringify(p)); } catch {}
  };
  return { profile, save };
}

function useSessionHistory() {
  const [history, setHistory] = useState<SessionMemory[]>(() => {
    try { return JSON.parse(localStorage.getItem("ciq_sessions") || "[]"); } catch { return []; }
  });
  const add = (entry: SessionMemory) => {
    const updated = [entry, ...history].slice(0, 30);
    setHistory(updated);
    try { localStorage.setItem("ciq_sessions", JSON.stringify(updated)); } catch {}
  };
  return { history, add };
}

function useRoundHistory() {
  const [rounds, setRounds] = useState<Round[]>(() => {
    try { return JSON.parse(localStorage.getItem("ciq_rounds") || "[]"); } catch { return []; }
  });
  // Round writes happen inside RoundPage (not through this hook), so we
  // refresh from storage on window focus and cross-tab storage events.
  useEffect(() => {
    const reload = () => {
      try { setRounds(JSON.parse(localStorage.getItem("ciq_rounds") || "[]")); } catch {}
    };
    window.addEventListener("focus", reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener("focus", reload);
      window.removeEventListener("storage", reload);
    };
  }, []);
  const reload = () => {
    try { setRounds(JSON.parse(localStorage.getItem("ciq_rounds") || "[]")); } catch {}
  };
  return { rounds, reload };
}

function useCheckinResponses() {
  const [responses, setResponses] = useState<CheckinResponse[]>(() => {
    try { return JSON.parse(localStorage.getItem("ciq_checkin_responses") || "[]"); } catch { return []; }
  });
  const add = (entry: CheckinResponse) => {
    const updated = [entry, ...responses].slice(0, 60);
    setResponses(updated);
    try { localStorage.setItem("ciq_checkin_responses", JSON.stringify(updated)); } catch {}
  };
  /** Remove all "improving" responses for a given focus — used by the
   * "Still relevant?" restore action in the Sessions archived list. */
  const restoreFocus = (focus: string) => {
    const updated = responses.filter(
      (r) => !(r.focus === focus && r.response === "improving"),
    );
    setResponses(updated);
    try { localStorage.setItem("ciq_checkin_responses", JSON.stringify(updated)); } catch {}
  };
  return { responses, add, restoreFocus };
}

export default function App() {
  const [tab, setTab] = useState<Tab>("round");
  const { profile, save: saveProfile } = useFeelProfile();
  const { history, add: addSession } = useSessionHistory();
  const { responses: checkinResponses, add: addCheckin, restoreFocus: restoreCheckinFocus } = useCheckinResponses();
  const { rounds, reload: reloadRounds } = useRoundHistory();

  const TABS: { id: Tab; label: string }[] = [
    { id: "round",     label: "Round" },
    { id: "analyze",   label: "Analyze" },
    { id: "sessions",  label: "Sessions" },
    { id: "analytics", label: "Analytics" },
    { id: "drills",    label: "Drills" },
  ];

  return (
    <div style={{ fontFamily: F.sans, background: C.bg, minHeight: "100dvh", overflowX: "hidden" }}>
      <style>{`
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        body { margin: 0; }
        ::-webkit-scrollbar { display: none; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes highlightFade { 0%,100% { box-shadow: none; } 40% { box-shadow: 0 0 0 3px #2A6640; } }
        textarea:focus, input:focus, select:focus { outline: none; }
        button { font-family: inherit; cursor: pointer; }
        a { color: inherit; }
      `}</style>

      <div style={{ position: "sticky", top: 0, zIndex: 900, background: C.bg,
        borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center",
        justifyContent: "space-between", padding: "0 20px", height: 52 }}>
        <div style={{ fontFamily: F.serif, fontSize: 20, color: C.deepGreen }}>
          Caddy<span style={{ fontStyle: "italic", color: C.accentGreen }}>IQ</span>
        </div>
        <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#E8F0EB",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, fontWeight: 600, color: C.accentGreen, letterSpacing: "0.02em" }}>
          YO
        </div>
      </div>

      <div style={{ paddingBottom: 64 }}>
        {tab === "round"     && <RoundPage onFeelSaved={saveProfile} onRoundSaved={reloadRounds} />}
        {tab === "analyze"   && <AnalyzePage feelProfile={profile} sessionHistory={history} checkinResponses={checkinResponses} roundHistory={rounds} onCheckinSaved={addCheckin} onSessionSaved={addSession} onSwitchTab={setTab} />}
        {tab === "sessions"  && <SessionsPage history={history} checkinResponses={checkinResponses} onRestoreFocus={restoreCheckinFocus} onSwitchTab={setTab} />}
        {tab === "analytics" && <AnalyticsPage rounds={rounds} onSwitchTab={setTab} />}
        {tab === "drills"    && <DrillsPage />}
      </div>

      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: 52,
        background: "rgba(250,250,248,0.96)", backdropFilter: "blur(12px)",
        borderTop: `1px solid ${C.border}`, display: "flex", zIndex: 1000 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ flex: 1, border: "none", background: "transparent", padding: "12px 0 10px",
              display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 500, letterSpacing: "0.01em",
              color: tab === t.id ? C.deepGreen : C.muted,
              borderBottom: tab === t.id ? `2px solid ${C.accentGreen}` : "2px solid transparent",
              paddingBottom: 2, transition: "all 0.15s" }}>
              {t.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
