import { useState } from "react";
import { C, F } from "./design";
import RoundPage from "./pages/RoundPage";
import AnalyzePage from "./pages/AnalyzePage";
import SessionsPage from "./pages/SessionsPage";
import DrillsPage from "./pages/DrillsPage";

type Tab = "round" | "analyze" | "sessions" | "drills";

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

export interface AnalysisResult {
  headline: string;
  openingMessage: string;
  whatsWorking: string[];
  positionBreakdown: Array<{
    position: string;
    positionCode: string;
    label: string;
    timestamp: number;
    frameIndex: number;
    observation: string;
    status: "strength" | "improving" | "focus-area";
    coachNote: string;
  }>;
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

export default function App() {
  const [tab, setTab] = useState<Tab>("round");
  const { profile, save: saveProfile } = useFeelProfile();
  const { history, add: addSession } = useSessionHistory();

  const TABS: { id: Tab; label: string }[] = [
    { id: "round",    label: "Round" },
    { id: "analyze",  label: "Analyze" },
    { id: "sessions", label: "Sessions" },
    { id: "drills",   label: "Drills" },
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
        {tab === "round"    && <RoundPage onFeelSaved={saveProfile} />}
        {tab === "analyze"  && <AnalyzePage feelProfile={profile} sessionHistory={history} onSessionSaved={addSession} onSwitchTab={setTab} />}
        {tab === "sessions" && <SessionsPage history={history} onSwitchTab={setTab} />}
        {tab === "drills"   && <DrillsPage />}
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
