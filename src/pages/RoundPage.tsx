import { useState, useEffect, useRef, useCallback } from "react";
import { C, F } from "../design";
import type { FeelProfile } from "../App";

export interface HoleInfo {
  holeNumber: number;
  par: number;
  distances: { black: number; blue: number; white: number; red: number };
}

export interface CourseResult {
  id: string;
  name: string;
  city: string;
  state: string;
  par: number;
  holes: HoleInfo[];
}

interface HoleData {
  hole: number;
  par: number;
  strokes: number;
  putts: number;
  fairwayHit: boolean | null;
  gir: boolean | null;
}

type TeeBox = "black" | "blue" | "white" | "red";
type FeelStep = "shot" | "contact" | "feels";

const SHOT_SHAPES = [
  { id: "Draw",         sub: "Mild right to left", full: false },
  { id: "Hook",         sub: "Strong right to left", full: false },
  { id: "Fade",         sub: "Mild left to right", full: false },
  { id: "Slice",        sub: "Strong left to right", full: false },
  { id: "Pull",         sub: "Straight left", full: false },
  { id: "Push",         sub: "Straight right", full: false },
  { id: "Two-way miss", sub: "Both directions, inconsistent", full: true },
];

const CONTACTS = [
  { id: "Clean and solid", sub: "Ball coming off well, good compression" },
  { id: "Heavy / fat",     sub: "Hitting the ground before the ball" },
  { id: "Thin / topped",   sub: "Catching the top of the ball" },
  { id: "Off the heel",    sub: "Contact toward the hosel" },
  { id: "Off the toe",     sub: "Contact toward the outer edge" },
];

interface Props {
  onFeelSaved: (profile: FeelProfile) => void;
  /** Notifies App after a round is persisted to `ciq_rounds` so the
   * in-memory round history (useRoundHistory) refreshes immediately. */
  onRoundSaved?: () => void;
}

function Stepper({ value, onDec, onInc }: { value: number; onDec: () => void; onInc: () => void }) {
  const btn: React.CSSProperties = {
    width: 36, height: 36, border: `1px solid ${C.borderDark}`, background: C.card,
    fontSize: 18, color: C.deepGreen, borderRadius: 6, display: "flex",
    alignItems: "center", justifyContent: "center",
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <button style={btn} onClick={onDec}>−</button>
      <span style={{ fontFamily: F.serif, fontSize: 28, color: C.deepGreen, minWidth: 32, textAlign: "center" }}>{value}</span>
      <button style={btn} onClick={onInc}>+</button>
    </div>
  );
}

function Toggle({ options, value, onChange }: { options: string[]; value: string | null; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {options.map(o => (
        <button key={o} onClick={() => onChange(o)}
          style={{ padding: "7px 16px", borderRadius: 100,
            border: value === o ? `1.5px solid ${C.accentGreen}` : `1px solid ${C.borderDark}`,
            background: value === o ? C.lightGreen : C.card,
            color: value === o ? C.accentGreen : C.secondary, fontSize: 13, fontWeight: 500 }}>
          {o}
        </button>
      ))}
    </div>
  );
}

function scoreLabel(strokes: number, par: number) {
  const d = strokes - par;
  if (d <= -2) return { text: "Eagle", color: C.accentGreen };
  if (d === -1) return { text: "Birdie", color: C.accentGreen };
  if (d === 0)  return { text: "Par",   color: C.secondary };
  if (d === 1)  return { text: "Bogey", color: C.warning };
  if (d === 2)  return { text: "Double", color: "#993300" };
  return { text: `+${d}`, color: "#993300" };
}

function scoreToParStr(d: number) { return d === 0 ? "E" : d > 0 ? `+${d}` : `${d}`; }

function useDebounce<T>(value: T, delay: number): T {
  const [dv, setDv] = useState(value);
  useEffect(() => { const t = setTimeout(() => setDv(value), delay); return () => clearTimeout(t); }, [value, delay]);
  return dv;
}

export default function RoundPage({ onFeelSaved, onRoundSaved }: Props) {
  const [screen, setScreen] = useState<"select" | "round" | "feel" | "confirm">("select");

  // Course search
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 400);
  const [searchResults, setSearchResults] = useState<CourseResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<CourseResult | null>(null);
  const [teeBox, setTeeBox] = useState<TeeBox>("blue");

  // Round state
  const [holes, setHoles] = useState<HoleData[]>([]);
  const [currentHole, setCurrentHole] = useState(1);
  const [editingHole, setEditingHole] = useState<number | null>(null);
  const [returnToHole, setReturnToHole] = useState<number | null>(null);
  const [strokes, setStrokes] = useState(4);
  const [putts, setPutts] = useState(2);
  const [fairway, setFairway] = useState<string | null>(null);
  const [gir, setGir] = useState<string | null>(null);
  const [showScorecardModal, setShowScorecardModal] = useState(false);

  // Feel profile
  const [feelStep, setFeelStep] = useState<FeelStep>("shot");
  const [shotShape, setShotShape] = useState<string | null>(null);
  const [contact, setContact] = useState<string | null>(null);
  const [customFeels, setCustomFeels] = useState("");

  // Load initial courses on mount
  useEffect(() => {
    fetch("/api/courses?q=")
      .then(r => r.json())
      .then((d: { courses: CourseResult[] }) => setSearchResults(d.courses ?? []))
      .catch(() => {});
  }, []);

  // Live search
  useEffect(() => {
    if (debouncedSearch.length < 2) {
      fetch("/api/courses?q=")
        .then(r => r.json())
        .then((d: { courses: CourseResult[] }) => setSearchResults(d.courses ?? []))
        .catch(() => {});
      return;
    }
    setSearching(true);
    fetch(`/api/courses?q=${encodeURIComponent(debouncedSearch)}`)
      .then(r => r.json())
      .then((d: { courses: CourseResult[] }) => setSearchResults(d.courses ?? []))
      .catch(() => {})
      .finally(() => setSearching(false));
  }, [debouncedSearch]);

  const getHolePar = useCallback((holeNum: number): number => {
    if (selected?.holes?.length >= 18) return selected.holes[holeNum - 1].par;
    return 4;
  }, [selected]);

  const getHoleDist = useCallback((holeNum: number): number | null => {
    if (!selected?.holes?.length) return null;
    const h = selected.holes[holeNum - 1];
    if (!h) return null;
    const d = h.distances[teeBox];
    return d > 0 ? d : null;
  }, [selected, teeBox]);

  const totalPar = selected?.par ?? 72;
  const totalStrokes = holes.reduce((s, h) => s + h.strokes, 0);
  const totalParSoFar = holes.reduce((s, h) => s + h.par, 0);
  const scoreToPar = totalStrokes - totalParSoFar;
  const roundComplete = holes.length >= 18;

  const displayHole = editingHole ?? currentHole;

  // Load data when navigating to a completed hole
  const loadHoleData = useCallback((holeNum: number) => {
    const existing = holes.find(h => h.hole === holeNum);
    if (existing) {
      // Restore exactly what the golfer entered — do not reset to par.
      setStrokes(existing.strokes);
      setPutts(existing.putts);
      setFairway(existing.fairwayHit === true ? "Fairway" : existing.fairwayHit === false ? "Missed" : null);
      setGir(existing.gir === true ? "GIR" : existing.gir === false ? "Missed" : null);
    } else {
      // Unplayed hole — default strokes to the hole's par so the stepper
      // starts at a sane value for par 3s and par 5s alike.
      setStrokes(getHolePar(holeNum));
      setPutts(2); setFairway(null); setGir(null);
    }
  }, [holes, getHolePar]);

  const navigateToHole = (holeNum: number) => {
    const isDone = holes.some(h => h.hole === holeNum);
    if (!isDone && holeNum !== currentHole) return;
    if (isDone) {
      setReturnToHole(currentHole);
      setEditingHole(holeNum);
      loadHoleData(holeNum);
    } else {
      setEditingHole(null);
      setReturnToHole(null);
      loadHoleData(holeNum);
    }
  };

  const saveHole = (isUpdate: boolean) => {
    const holeNum = displayHole;
    const par = getHolePar(holeNum);
    const newHole: HoleData = {
      hole: holeNum, par, strokes, putts,
      // Par 3s don't have a fairway concept — force null so analytics
      // don't count them in FIR percentages (and so stale state from a
      // previous par 4 can't leak through the hidden toggle).
      fairwayHit: par === 3
        ? null
        : fairway === "Fairway" ? true : fairway === "Missed" ? false : null,
      gir: gir === "GIR" ? true : gir === "Missed" ? false : null,
    };
    const updated = [...holes.filter(h => h.hole !== holeNum), newHole].sort((a, b) => a.hole - b.hole);
    setHoles(updated);

    if (isUpdate && returnToHole !== null) {
      const target = returnToHole;
      setEditingHole(null);
      setReturnToHole(null);
      setCurrentHole(target);
      loadHoleData(target);
    } else {
      setEditingHole(null);
      setReturnToHole(null);
      if (holeNum < 18) {
        const next = holeNum + 1;
        setCurrentHole(next);
        const nextExisting = updated.find(h => h.hole === next);
        if (nextExisting) {
          setStrokes(nextExisting.strokes); setPutts(nextExisting.putts);
          setFairway(nextExisting.fairwayHit === true ? "Fairway" : nextExisting.fairwayHit === false ? "Missed" : null);
          setGir(nextExisting.gir === true ? "GIR" : nextExisting.gir === false ? "Missed" : null);
        } else {
          // Default strokes to the next hole's par.
          setStrokes(getHolePar(next));
          setPutts(2); setFairway(null); setGir(null);
        }
      }
    }
  };

  const saveFeelProfile = () => {
    const now = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const entry = { date: now, shotShape: shotShape ?? "", contact: contact ?? "", customFeels };
    const existing: FeelProfile = JSON.parse(localStorage.getItem("ciq_feel_profile") || "null") || { shotShape: "", contact: "", customFeels: "", lastUpdated: "", history: [] };
    const profile: FeelProfile = {
      shotShape: shotShape ?? "", contact: contact ?? "", customFeels,
      lastUpdated: now, history: [entry, ...(existing.history ?? [])].slice(0, 10),
    };

    // Persist the round to localStorage `ciq_rounds` for Analytics.
    // Strictly additive — does not alter existing feel-save behavior.
    if (selected && holes.length > 0) {
      try {
        const holeDistances = Array.from({ length: 18 }, (_, i) => {
          const info = selected.holes?.[i];
          if (!info) return 0;
          const d = info.distances?.[teeBox];
          return d && d > 0 ? d : 0;
        });
        // Use sum of played-hole pars so `scoreToPar` stays internally
        // consistent. For 18-hole rounds this equals the course total;
        // for partial rounds it stays accurate.
        const playedPar = holes.reduce((s, h) => s + h.par, 0);
        const round = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          date: now,
          courseName: selected.name,
          courseId: selected.id,
          teeBox,
          coursePar: playedPar > 0 ? playedPar : totalPar,
          totalStrokes,
          scoreToPar,
          holes,
          holeDistances,
        };
        const prior = JSON.parse(localStorage.getItem("ciq_rounds") || "[]");
        const updated = [round, ...(Array.isArray(prior) ? prior : [])].slice(0, 100);
        localStorage.setItem("ciq_rounds", JSON.stringify(updated));
        onRoundSaved?.();
      } catch {}
    }

    onFeelSaved(profile);
    setScreen("confirm");
  };

  const primaryBtn: React.CSSProperties = {
    width: "100%", padding: "13px 0", background: C.deepGreen, color: "#fff",
    border: "none", borderRadius: 8, fontSize: 15, fontWeight: 600, letterSpacing: "0.01em",
  };
  const secondaryBtn: React.CSSProperties = {
    background: "none", border: "none", color: C.accentGreen, fontSize: 14,
    fontWeight: 500, padding: "8px 0",
  };

  // ── Course selector ──
  if (screen === "select") {
    return (
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "24px 16px" }}>
        <div style={{ fontFamily: F.serif, fontSize: 24, color: C.deepGreen, marginBottom: 4 }}>Start a round</div>
        <div style={{ fontSize: 14, color: C.muted, marginBottom: 20 }}>Find your course and track every hole</div>

        <div style={{ position: "relative", marginBottom: 8 }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by course name or city..."
            style={{ width: "100%", padding: "12px 14px", border: C.cardBorder, borderRadius: 8,
              fontSize: 15, color: C.body, background: C.card }} />
          {searching && (
            <div style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)" }}>
              <div style={{ width: 16, height: 16, border: `2px solid ${C.border}`,
                borderTop: `2px solid ${C.accentGreen}`, borderRadius: "50%",
                animation: "spin 0.8s linear infinite" }} />
            </div>
          )}
        </div>

        <div style={{ border: C.cardBorder, borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
          {searchResults.slice(0, 8).map((c, i) => (
            <div key={c.id} onClick={() => setSelected(c)}
              style={{ padding: "14px 16px", borderTop: i ? `1px solid ${C.border}` : "none",
                background: selected?.id === c.id ? C.lightGreen : C.card,
                cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: F.serif, fontSize: 15, color: C.deepGreen, marginBottom: 1 }}>{c.name}</div>
                <div style={{ fontSize: 13, color: C.muted }}>{c.city}{c.state ? `, ${c.state}` : ""}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0, marginLeft: 12 }}>
                <span style={{ fontSize: 13, color: C.secondary }}>Par {c.par}</span>
                {selected?.id === c.id && (
                  <span style={{ color: C.accentGreen, fontWeight: 700, fontSize: 14 }}>✓</span>
                )}
              </div>
            </div>
          ))}
          {searchResults.length === 0 && (
            <div style={{ padding: "24px 16px", textAlign: "center", color: C.muted, fontSize: 14 }}>
              {searching ? "Searching..." : "No courses found. Try a different name or city."}
            </div>
          )}
        </div>

        {selected && (
          <div style={{ border: C.cardBorder, borderRadius: 10, padding: "12px 14px",
            background: C.card, marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: C.muted, textTransform: "uppercase",
              letterSpacing: "0.08em", marginBottom: 8 }}>Tee box</div>
            <div style={{ display: "flex", gap: 8 }}>
              {(["black", "blue", "white", "red"] as TeeBox[]).map(t => (
                <button key={t} onClick={() => setTeeBox(t)}
                  style={{ padding: "7px 14px", borderRadius: 100, fontSize: 13,
                    textTransform: "capitalize", fontWeight: teeBox === t ? 600 : 400,
                    border: teeBox === t ? `1.5px solid ${C.accentGreen}` : `1px solid ${C.borderDark}`,
                    background: teeBox === t ? C.lightGreen : C.card,
                    color: teeBox === t ? C.accentGreen : C.secondary }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}

        <button style={{ ...primaryBtn, opacity: selected ? 1 : 0.45, marginBottom: 12 }}
          disabled={!selected} onClick={() => {
            setCurrentHole(1); setHoles([]);
            // Default strokes to hole 1's par (falls back to 4 for manual courses).
            const firstPar = selected?.holes?.[0]?.par ?? 4;
            setStrokes(firstPar); setPutts(2); setFairway(null); setGir(null);
            setScreen("round");
          }}>
          {selected ? `Start round at ${selected.name.split(" ").slice(0, 3).join(" ")}` : "Select a course above"}
        </button>
        <button style={secondaryBtn} onClick={() => {
          setSelected({ id: "manual", name: "My Course", city: "", state: "", par: 72, holes: [] });
          setCurrentHole(1); setHoles([]);
          // Manual courses have no hole data → default stroke stepper to 4 (par).
          setStrokes(4); setPutts(2); setFairway(null); setGir(null);
          setScreen("round");
        }}>
          Can't find your course? Enter pars manually
        </button>
      </div>
    );
  }

  // ── Scorecard modal ──
  const ScorecardModal = () => (
    <div style={{ position: "fixed", inset: 0, zIndex: 2000, display: "flex", flexDirection: "column",
      background: "rgba(15,36,23,0.7)", backdropFilter: "blur(4px)" }}
      onClick={() => setShowScorecardModal(false)}>
      <div onClick={e => e.stopPropagation()}
        style={{ position: "absolute", bottom: 0, left: 0, right: 0,
          background: C.bg, borderRadius: "20px 20px 0 0", padding: "20px 0 32px",
          maxHeight: "70vh", overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "0 16px 16px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontFamily: F.serif, fontSize: 18, color: C.deepGreen }}>Scorecard</div>
          <button onClick={() => setShowScorecardModal(false)}
            style={{ border: "none", background: "none", color: C.muted, fontSize: 20 }}>×</button>
        </div>
        {holes.length === 0 ? (
          <div style={{ padding: "24px 16px", textAlign: "center", color: C.muted, fontSize: 14 }}>
            No holes completed yet
          </div>
        ) : (
          holes.map(h => {
            const sl = scoreLabel(h.strokes, h.par);
            return (
              <div key={h.hole} onClick={() => { setShowScorecardModal(false); navigateToHole(h.hole); }}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "12px 16px", borderBottom: `1px solid ${C.border}`,
                  background: displayHole === h.hole ? C.lightGreen : "transparent", cursor: "pointer" }}>
                <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                  <span style={{ fontSize: 13, color: C.muted, minWidth: 24 }}>H{h.hole}</span>
                  <span style={{ fontSize: 13, color: C.secondary }}>Par {h.par}</span>
                  <span style={{ fontFamily: F.serif, fontSize: 15, color: C.deepGreen }}>{h.strokes} strokes</span>
                  <span style={{ fontSize: 12, color: C.muted }}>{h.putts} putts</span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: sl.color }}>{sl.text}</span>
              </div>
            );
          })
        )}
        <div style={{ padding: "12px 16px", borderTop: `1px solid ${C.border}`,
          display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, color: C.muted }}>Total ({holes.length} holes)</span>
          <span style={{ fontFamily: F.serif, fontSize: 16, fontWeight: 600,
            color: scoreToPar <= 0 ? C.accentGreen : C.warning }}>
            {scoreToParStr(scoreToPar)}
          </span>
        </div>
      </div>
    </div>
  );

  // ── Active round ──
  if (screen === "round") {
    const hPar = getHolePar(displayHole);
    const hDist = getHoleDist(displayHole);
    const isEditingCompleted = editingHole !== null;

    const prevDisabled = displayHole <= 1;
    const nextDisabled = displayHole >= 18 || (!holes.some(h => h.hole === displayHole) && displayHole >= currentHole);

    return (
      <div style={{ maxWidth: 680, margin: "0 auto" }}>
        {showScorecardModal && <ScorecardModal />}

        {/* Hero card */}
        <div style={{ background: C.deepGreen, padding: "20px 20px 18px" }}>
          <div style={{ fontFamily: F.serif, fontSize: 18, color: "#fff", marginBottom: 2 }}>
            {selected?.name}
          </div>
          <div style={{ display: "flex", gap: 24, marginTop: 8 }}>
            <div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Hole</div>
              <div style={{ fontFamily: F.serif, fontSize: 28, color: "#fff" }}>{displayHole}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Score</div>
              <div style={{ fontFamily: F.serif, fontSize: 28,
                color: scoreToPar < 0 ? "#8BC496" : scoreToPar === 0 ? "#fff" : "#F5C98A" }}>
                {holes.length === 0 ? "E" : scoreToParStr(scoreToPar)}
              </div>
            </div>
            <div onClick={() => setShowScorecardModal(true)} style={{ cursor: "pointer" }}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Thru
              </div>
              <div style={{ fontFamily: F.serif, fontSize: 28, color: "#fff",
                borderBottom: "1px dotted rgba(255,255,255,0.3)" }}>
                {holes.length}
              </div>
            </div>
          </div>

          {/* Hole progress row — tappable */}
          <div style={{ display: "flex", gap: 4, marginTop: 14, flexWrap: "wrap" }}>
            {Array.from({ length: 18 }, (_, i) => {
              const n = i + 1;
              const done = holes.some(h => h.hole === n);
              const active = n === displayHole;
              const future = !done && n > currentHole;
              return (
                <div key={n}
                  onClick={() => { if (done || n === currentHole) navigateToHole(n); }}
                  style={{ width: 26, height: 26, borderRadius: "50%", display: "flex",
                    alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 600,
                    cursor: done ? "pointer" : "default",
                    background: active ? "#fff" : done ? C.accentGreen : "rgba(255,255,255,0.12)",
                    color: active ? C.deepGreen : done ? "#fff" : future ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.45)",
                    opacity: future ? 0.5 : 1 }}>
                  {n}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ padding: "16px" }}>
          {/* Edit mode banner */}
          {isEditingCompleted && (
            <div style={{ background: "#FEF3E2", border: `1px solid #F5C98A`, borderRadius: 8,
              padding: "10px 14px", marginBottom: 12, display: "flex", justifyContent: "space-between",
              alignItems: "center" }}>
              <span style={{ fontSize: 13, color: C.warning }}>
                Editing Hole {editingHole}
              </span>
              <button onClick={() => { setEditingHole(null); setReturnToHole(null); loadHoleData(currentHole); }}
                style={{ border: "none", background: "none", color: C.warning, fontSize: 13, fontWeight: 600 }}>
                Cancel
              </button>
            </div>
          )}

          {/* Current / editing hole card */}
          {(!roundComplete || isEditingCompleted) && (
            <div style={{ border: C.cardBorder, borderRadius: 12, padding: 16, background: C.card, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
                <div style={{ fontFamily: F.serif, fontSize: 20, color: C.deepGreen }}>
                  Hole {displayHole}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 14, color: C.secondary }}>Par {hPar}</div>
                  {hDist && (
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>
                      {hDist} yds ({teeBox})
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 12, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Strokes</div>
                  <Stepper value={strokes} onDec={() => setStrokes(Math.max(1, strokes - 1))} onInc={() => setStrokes(strokes + 1)} />
                </div>
                <div>
                  <div style={{ fontSize: 12, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Putts</div>
                  <Stepper value={putts} onDec={() => setPutts(Math.max(0, putts - 1))} onInc={() => setPutts(putts + 1)} />
                </div>
              </div>

              {/* On par 3 holes, fairway hit is not a meaningful stat —
                  the row is omitted entirely rather than shown blank.
                  GIR always renders. */}
              <div style={{
                display: "grid",
                gridTemplateColumns: hPar === 3 ? "1fr" : "1fr 1fr",
                gap: 16, marginBottom: 20,
              }}>
                {hPar !== 3 && (
                  <div>
                    <div style={{ fontSize: 12, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Fairway</div>
                    <Toggle options={["Fairway", "Missed"]} value={fairway} onChange={setFairway} />
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 12, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Green</div>
                  <Toggle options={["GIR", "Missed"]} value={gir} onChange={setGir} />
                </div>
              </div>

              <button style={primaryBtn} onClick={() => saveHole(isEditingCompleted)}>
                {isEditingCompleted ? "Update hole" : displayHole < 18 ? "Save and next hole" : "Save hole 18"}
              </button>

              {/* Prev / Next navigation */}
              {!isEditingCompleted && (
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
                  <button
                    disabled={prevDisabled}
                    onClick={() => { if (!prevDisabled) navigateToHole(displayHole - 1); }}
                    style={{ border: "none", background: "none", fontSize: 13, fontWeight: 500,
                      color: prevDisabled ? C.border : C.muted,
                      cursor: prevDisabled ? "default" : "pointer" }}>
                    Previous hole
                  </button>
                  <button
                    disabled={nextDisabled}
                    onClick={() => { if (!nextDisabled) navigateToHole(displayHole + 1); }}
                    style={{ border: "none", background: "none", fontSize: 13, fontWeight: 500,
                      color: nextDisabled ? C.border : C.muted,
                      cursor: nextDisabled ? "default" : "pointer" }}>
                    Next hole
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Finish round */}
          {roundComplete && !isEditingCompleted && (
            <div style={{ border: `1px solid ${C.accentGreen}`, borderRadius: 12, padding: 16,
              background: C.lightGreen, marginBottom: 16, textAlign: "center" }}>
              <div style={{ fontFamily: F.serif, fontSize: 16, color: C.deepGreen, marginBottom: 4 }}>
                Round complete
              </div>
              <div style={{ fontSize: 14, color: C.secondary, marginBottom: 14 }}>
                {totalStrokes} strokes — {scoreToParStr(scoreToPar)} ({totalPar} par)
              </div>
              <button style={primaryBtn} onClick={() => setScreen("feel")}>
                Finish round and log feels
              </button>
            </div>
          )}

          {/* Running scorecard */}
          {holes.length > 0 && (
            <div>
              <div style={{ fontSize: 12, color: C.muted, textTransform: "uppercase",
                letterSpacing: "0.08em", marginBottom: 10 }}>
                Scorecard
              </div>
              <div style={{ border: C.cardBorder, borderRadius: 12, overflow: "hidden" }}>
                {[...holes].reverse().map((h, i) => {
                  const sl = scoreLabel(h.strokes, h.par);
                  return (
                    <div key={h.hole}
                      onClick={() => navigateToHole(h.hole)}
                      style={{ padding: "12px 16px", borderTop: i ? `1px solid ${C.border}` : "none",
                        background: displayHole === h.hole ? C.lightGreen : C.card,
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        cursor: "pointer" }}>
                      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                        <span style={{ fontSize: 14, color: C.muted, minWidth: 20 }}>H{h.hole}</span>
                        <span style={{ fontFamily: F.serif, fontSize: 15, color: C.deepGreen }}>{h.strokes}</span>
                        <span style={{ fontSize: 13, color: C.muted }}>/ {h.putts} putts</span>
                      </div>
                      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                        <span style={{ fontSize: 13, color: sl.color }}>{sl.text}</span>
                        <span style={{ fontSize: 12, color: C.muted }}>Edit</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Post-round feel check ──
  if (screen === "feel") {
    const steps: FeelStep[] = ["shot", "contact", "feels"];
    const stepIdx = steps.indexOf(feelStep);
    const backBtn = (
      <button onClick={() => setFeelStep(steps[stepIdx - 1])}
        style={{ background: "none", border: "none", color: C.secondary, fontSize: 14,
          padding: "0 0 16px", display: "flex", alignItems: "center", gap: 4 }}>
        Back
      </button>
    );

    return (
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "24px 16px" }}>
        <div style={{ fontSize: 12, color: C.muted, textTransform: "uppercase",
          letterSpacing: "0.08em", marginBottom: 4 }}>
          Step {stepIdx + 1} of 3
        </div>
        <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 24 }}>
          {steps.map((_, i) => (
            <div key={i} style={{ width: 6, height: 6, borderRadius: "50%",
              background: i <= stepIdx ? C.accentGreen : C.borderDark }} />
          ))}
        </div>

        {feelStep === "shot" && (
          <div style={{ border: C.cardBorder, borderRadius: 12, padding: 16, background: C.card }}>
            <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase",
              letterSpacing: "0.1em", marginBottom: 8 }}>Shot shape</div>
            <div style={{ fontFamily: F.serif, fontSize: 16, color: C.deepGreen, marginBottom: 20 }}>
              What was your predominant miss today?
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 20 }}>
              {SHOT_SHAPES.map(s => (
                <button key={s.id} onClick={() => setShotShape(s.id)}
                  style={{ gridColumn: s.full ? "1/-1" : "auto",
                    padding: "12px 10px", borderRadius: 8, textAlign: "left",
                    border: shotShape === s.id ? `1.5px solid ${C.accentGreen}` : `1px solid ${C.borderDark}`,
                    background: shotShape === s.id ? C.lightGreen : C.card }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.deepGreen }}>{s.id}</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{s.sub}</div>
                </button>
              ))}
            </div>
            <button style={{ ...primaryBtn, opacity: shotShape ? 1 : 0.4 }} disabled={!shotShape}
              onClick={() => setFeelStep("contact")}>
              Next
            </button>
          </div>
        )}

        {feelStep === "contact" && (
          <div style={{ border: C.cardBorder, borderRadius: 12, padding: 16, background: C.card }}>
            {backBtn}
            <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase",
              letterSpacing: "0.1em", marginBottom: 8 }}>Ball contact</div>
            <div style={{ fontFamily: F.serif, fontSize: 16, color: C.deepGreen, marginBottom: 20 }}>
              How did the contact feel overall?
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
              {CONTACTS.map(c => (
                <button key={c.id} onClick={() => setContact(c.id)}
                  style={{ padding: "12px 14px", borderRadius: 8, textAlign: "left",
                    border: contact === c.id ? `1.5px solid ${C.accentGreen}` : `1px solid ${C.borderDark}`,
                    background: contact === c.id ? C.lightGreen : C.card,
                    display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
                    border: `2px solid ${contact === c.id ? C.accentGreen : C.borderDark}`,
                    background: contact === c.id ? C.accentGreen : "transparent" }} />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.deepGreen }}>{c.id}</div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>{c.sub}</div>
                  </div>
                </button>
              ))}
            </div>
            <button style={{ ...primaryBtn, opacity: contact ? 1 : 0.4 }} disabled={!contact}
              onClick={() => setFeelStep("feels")}>
              Next
            </button>
          </div>
        )}

        {feelStep === "feels" && (
          <div style={{ border: C.cardBorder, borderRadius: 12, padding: 16, background: C.card }}>
            {backBtn}
            <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase",
              letterSpacing: "0.1em", marginBottom: 8 }}>Personal feels</div>
            <div style={{ fontFamily: F.serif, fontSize: 16, color: C.deepGreen, marginBottom: 16 }}>
              Did anything feel off in your swing today?
            </div>
            <textarea value={customFeels} onChange={e => setCustomFeels(e.target.value)} rows={4}
              placeholder="e.g. felt like I was losing my lag early, kept getting stuck on the downswing..."
              style={{ width: "100%", padding: "12px 14px", border: `1px solid ${C.borderDark}`,
                borderRadius: 8, fontSize: 14, color: C.body, background: C.card,
                resize: "none", marginBottom: 10, lineHeight: 1.6 }} />
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, marginBottom: 20 }}>
              This gets added to your feel profile. The AI will look for these patterns in your next video analysis.
            </div>
            <button style={primaryBtn} onClick={saveFeelProfile}>Save to profile</button>
          </div>
        )}
      </div>
    );
  }

  // ── Confirmation ──
  if (screen === "confirm") {
    return (
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "48px 16px", textAlign: "center" }}>
        <div style={{ width: 52, height: 52, borderRadius: "50%", background: C.lightGreen,
          border: `1px solid ${C.accentGreen}`, display: "flex", alignItems: "center",
          justifyContent: "center", margin: "0 auto 20px", fontSize: 20, color: C.accentGreen }}>
          +
        </div>
        <div style={{ fontFamily: F.serif, fontSize: 22, color: C.deepGreen, marginBottom: 8 }}>
          Round logged
        </div>
        <div style={{ fontSize: 15, color: C.secondary, marginBottom: 8 }}>
          {totalStrokes} strokes — {scoreToParStr(scoreToPar)} ({totalPar} par)
        </div>
        <div style={{ fontSize: 14, color: C.muted, marginBottom: 28, lineHeight: 1.7 }}>
          Your feel profile is updated. Upload a swing on the Analyze tab and the AI will look for these patterns.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginBottom: 28 }}>
          {shotShape && (
            <span style={{ fontSize: 13, color: C.accentGreen, background: C.lightGreen,
              border: `1px solid #B7D9BE`, padding: "4px 14px", borderRadius: 100 }}>
              {shotShape}
            </span>
          )}
          {contact && (
            <span style={{ fontSize: 13, color: C.accentGreen, background: C.lightGreen,
              border: `1px solid #B7D9BE`, padding: "4px 14px", borderRadius: 100 }}>
              {contact}
            </span>
          )}
        </div>
        <button onClick={() => {
          setScreen("select"); setHoles([]); setCurrentHole(1);
          setShotShape(null); setContact(null); setCustomFeels("");
          setFeelStep("shot"); setSelected(null); setSearch("");
        }} style={{ ...primaryBtn }}>
          Start another round
        </button>
      </div>
    );
  }

  return null;
}
