import type { CoachingPoint } from "../App";

/** The 6 canonical checkpoints shown in the persistent checkpoint bar.
 * The backend does NOT guarantee one coachingPoint per phase — it returns
 * a dynamic 4-7 point list (2 strengths, 2 priority fixes, 0-3 extra
 * observations) with freeform positionLabel text. This module buckets
 * that dynamic list into the fixed 6 phases on the frontend, so no
 * backend schema change is needed (see CaddyIQ session notes — "option a"). */
export const PHASES = [
  "Address",
  "Backswing",
  "Top",
  "Downswing",
  "Impact",
  "Follow-Through",
] as const;

export type Phase = (typeof PHASES)[number];
export type Severity = "green" | "yellow" | "red";

const SEVERITY_RANK: Record<Severity, number> = { green: 0, yellow: 1, red: 2 };

/** Map a coaching point's positionLabel (e.g. "P4 — Top of backswing",
 * "Grip fault — Address", "Early extension — P6") to a phase index 0-5.
 * Tries, in order: explicit P-number (matches the documented backend
 * label format), then keyword matching, then coachingPriority range
 * (the backend's PRIORITY ORDER table is a strict, always-present
 * fallback signal). Returns -1 only if every heuristic fails. */
function mapToPhaseIndex(label: string, coachingPriority: number | undefined): number {
  const s = (label || "").toLowerCase();

  const pMatch = s.match(/\bp\s*(\d{1,2})\b/);
  if (pMatch) {
    const n = parseInt(pMatch[1], 10);
    if (n <= 1) return 0; // Address
    if (n <= 3) return 1; // Backswing
    if (n === 4) return 2; // Top
    if (n <= 6) return 3; // Downswing
    if (n === 7) return 4; // Impact
    return 5; // Follow-Through (8-10+)
  }

  if (/address|setup|grip|stance|posture|alignment/.test(s)) return 0;
  if (/takeaway|backswing|halfway back/.test(s)) return 1;
  if (/\btop\b/.test(s)) return 2;
  if (/downswing|transition|casting|early extension|lag|sequenc/.test(s)) return 3;
  if (/impact|strike|contact|ball[- ]?first/.test(s)) return 4;
  if (/follow.?through|finish|release|extension through/.test(s)) return 5;

  // Fallback: the backend's documented PRIORITY ORDER table maps
  // coachingPriority ranges to swing stages regardless of label text.
  if (typeof coachingPriority === "number") {
    if (coachingPriority <= 3) return 0;
    if (coachingPriority <= 6) return 1;
    if (coachingPriority <= 9) return 2;
    if (coachingPriority <= 13) return 3;
    if (coachingPriority <= 17) return 4;
    if (coachingPriority <= 19) return 5;
    // 20-30 = strengths, no stage signal from priority alone
  }

  return -1;
}

export interface Checkpoint {
  phase: Phase;
  phaseIndex: number;
  /** Worst severity among points bucketed into this phase.
   *  Defaults to "green" when nothing was flagged here. */
  severity: Severity;
  /** Timestamp of the representative (most severe) point, or null if empty. */
  timestamp: number | null;
  frameIndex: number | null;
  /** All coaching points bucketed into this phase, sorted by priority. */
  points: CoachingPoint[];
}

/** Buckets a dynamic coachingPoints list into the 6 fixed checkpoints.
 * Phases with no mapped point default to severity "green" (unflagged =
 * assumed fine) with no seekable timestamp. */
export function buildCheckpoints(coachingPoints: CoachingPoint[]): Checkpoint[] {
  const buckets: CoachingPoint[][] = PHASES.map(() => []);
  const unmapped: CoachingPoint[] = [];

  for (const cp of coachingPoints) {
    const idx = mapToPhaseIndex(cp.positionLabel, cp.coachingPriority);
    if (idx >= 0) buckets[idx].push(cp);
    else unmapped.push(cp);
  }
  // Last resort — genuinely unmapped points (extremely rare given the
  // fallback chain above) land in Address rather than being silently
  // dropped from the breakdown entirely.
  if (unmapped.length > 0) buckets[0].push(...unmapped);

  return PHASES.map((phase, i) => {
    const points = buckets[i].sort(
      (a, b) => (a.coachingPriority ?? 99) - (b.coachingPriority ?? 99),
    );
    if (points.length === 0) {
      return { phase, phaseIndex: i, severity: "green", timestamp: null, frameIndex: null, points };
    }
    let worst: Severity = "green";
    let rep = points[0];
    for (const p of points) {
      const sev = p.severity ?? "green";
      if (SEVERITY_RANK[sev] > SEVERITY_RANK[worst]) { worst = sev; rep = p; }
    }
    return {
      phase,
      phaseIndex: i,
      severity: worst,
      timestamp: rep.timestamp ?? null,
      frameIndex: rep.frameIndex ?? null,
      points,
    };
  });
}
