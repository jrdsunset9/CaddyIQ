/**
 * CaddyIQ Analytics — Strokes Gained calculations
 *
 * Uses Mark Broadie's Strokes Gained methodology with PGA Tour benchmark
 * tables. All rounds are read from localStorage `ciq_rounds`.
 *
 * Formula: SG = Starting benchmark − Finishing benchmark − 1
 */

// ───────────────────────────────────────────────────────────────────────────
// Types

export interface RoundHole {
  hole: number;
  par: number;
  strokes: number;
  putts: number;
  fairwayHit: boolean | null;
  gir: boolean | null;
}

export interface Round {
  id: string;
  date: string;                  // ISO or display format
  courseName: string;
  courseId: string;
  teeBox: "black" | "blue" | "white" | "red";
  coursePar: number;
  totalStrokes: number;
  scoreToPar: number;
  holes: RoundHole[];
  holeDistances: number[];       // index 0 = hole 1 distance in yards (0 if unknown)
}

export interface StrokesGainedPerRound {
  sgOtt: number;
  sgApp: number;
  sgArg: number;
  sgPutt: number;
  sgTotal: number;
}

export interface CareerSummary {
  totalRounds: number;
  scoringAverage: number;
  handicapIndex: number | null;
  bestRoundScore: number | null;
  bestRoundToPar: number | null;
  fairwayPct: number;            // 0-100
  girPct: number;                // 0-100
  puttsPerRound: number;
  sandSavePct: number;           // 0-100 (approximation)
  threePuttRate: number;         // 0-100
  sgOtt: number;
  sgApp: number;
  sgArg: number;
  sgPutt: number;
  sgTotal: number;
  last8Rounds: Array<{ date: string; score: number; toPar: number }>;
  tourAverages: typeof TOUR_AVERAGES;
}

// ───────────────────────────────────────────────────────────────────────────
// PGA Tour benchmark tables (Broadie)

// Tee shot expected strokes by hole yardage (par 4 / par 5 tees).
const TEE_BENCH: Record<number, number> = {
  300: 3.71, 320: 3.78, 340: 3.84, 360: 3.90, 380: 3.95,
  400: 4.00, 420: 4.05, 440: 4.10, 460: 4.14, 480: 4.18,
  500: 4.22, 520: 4.55, 540: 4.60, 560: 4.65, 580: 4.69, 600: 4.73,
};

// Approach shot expected strokes from the fairway (yardage to pin).
const APP_BENCH: Record<number, number> = {
  50: 2.40, 75: 2.60, 100: 2.75, 125: 2.88, 150: 2.98,
  175: 3.08, 200: 3.18, 225: 3.28,
};

// Putting expected strokes by first-putt distance in feet.
const PUTT_BENCH: Record<number, number> = {
  3: 1.07, 4: 1.14, 5: 1.20, 6: 1.26, 8: 1.38, 10: 1.48,
  12: 1.57, 15: 1.68, 20: 1.83, 25: 1.95, 30: 2.04, 40: 2.19,
  50: 2.30, 60: 2.39,
};

// PGA Tour reference averages (used for comparison labels in UI).
export const TOUR_AVERAGES = {
  fairwayPct: 61,
  girPct: 65,
  puttsPerRound: 29.0,
  sandSavePct: 49,
  threePuttRate: 2.9,
  scoringAverage: 70.8,
} as const;

// ───────────────────────────────────────────────────────────────────────────
// Interpolation helpers

function lookupBenchmark(table: Record<number, number>, key: number): number {
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  if (key <= keys[0]) return table[keys[0]];
  if (key >= keys[keys.length - 1]) return table[keys[keys.length - 1]];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (key >= a && key <= b) {
      const t = (key - a) / (b - a);
      return table[a] + t * (table[b] - table[a]);
    }
  }
  return table[keys[keys.length - 1]];
}

// ───────────────────────────────────────────────────────────────────────────
// Per-hole strokes gained estimates
//
// We only have hole-level aggregates (strokes, putts, fairwayHit, gir), so
// per-shot SG is estimated using conventional assumptions:
//
// • First-putt distance: GIR hit → 18 ft average; missed green → 30 ft.
// • Tee distance: par 4 default 380 yds, par 5 default 520 yds,
//   unless hole has a recorded yardage.
// • Approach distance remaining: par 4 → 150 yds, par 5 → 100 yds
//   (post-second-shot). Missed fairways lose ~0.1 in approach.
// • Around-green: each up-and-down (missed GIR, 2 or fewer strokes
//   after reaching ≤30 yds) adds +0.2 SG; fails lose 0.4.

function sgPuttHole(h: RoundHole): number {
  // Null GIR → unknown first-putt distance. Skip rather than assume "missed".
  if (h.gir == null) return 0;
  const firstPuttFt = h.gir === true ? 18 : 30;
  const benchmark = lookupBenchmark(PUTT_BENCH, firstPuttFt);
  // SG_putt = expected putts from that distance − actual putts
  return benchmark - h.putts;
}

function sgOttHole(h: RoundHole, yards: number | undefined): number {
  if (h.par < 4) return 0; // par 3 has no tee SG in this model
  const teeYards = yards && yards > 0 ? yards : h.par === 5 ? 520 : 380;
  const startBench = lookupBenchmark(TEE_BENCH, teeYards);

  // After the tee shot, approach distance remaining:
  // par 4 → 150 yds default, par 5 → 220 yds remaining (first of two approach shots).
  const approachRemaining = h.par === 5 ? 220 : 150;
  const finishBench = lookupBenchmark(APP_BENCH, approachRemaining);

  // Fairway miss penalty only when explicitly marked missed. Null = unknown, no penalty.
  const missPenalty = h.fairwayHit === false ? 0.15 : 0;
  return startBench - finishBench - 1 - missPenalty;
}

function sgAppHole(h: RoundHole): number {
  if (h.par < 3) return 0;
  // Null GIR → unknown approach outcome. Skip.
  if (h.gir == null) return 0;
  const approachDist = h.par === 5 ? 100 : h.par === 3 ? 160 : 150;
  const startBench = lookupBenchmark(APP_BENCH, approachDist);

  // Finish: on green → 18 ft putt benchmark; missed green → 30 yds chip context.
  const finishBench = h.gir === true
    ? lookupBenchmark(PUTT_BENCH, 18)
    : lookupBenchmark(PUTT_BENCH, 30) + 0.4; // estimated short-game carry
  return startBench - finishBench - 1;
}

function sgArgHole(h: RoundHole): number {
  // Null GIR → cannot attribute around-green performance.
  if (h.gir == null) return 0;
  if (h.gir === true) return 0;
  // Missed green: if par was achieved or better → up-and-down made (+0.2)
  // else small penalty scaling with strokes over par after the miss.
  const scoreVsPar = h.strokes - h.par;
  if (scoreVsPar <= 0) return 0.2;
  if (scoreVsPar === 1) return -0.1;
  return -0.4;
}

export function computeRoundSG(round: Round): StrokesGainedPerRound {
  let sgOtt = 0, sgApp = 0, sgArg = 0, sgPutt = 0;
  round.holes.forEach((h) => {
    const dist = round.holeDistances?.[h.hole - 1];
    sgOtt  += sgOttHole(h, dist);
    sgApp  += sgAppHole(h);
    sgArg  += sgArgHole(h);
    sgPutt += sgPuttHole(h);
  });
  // Normalize to per-round (assume 18 holes; scale if fewer).
  const scale = round.holes.length > 0 ? 18 / round.holes.length : 1;
  sgOtt *= scale;
  sgApp *= scale;
  sgArg *= scale;
  sgPutt *= scale;
  return {
    sgOtt,
    sgApp,
    sgArg,
    sgPutt,
    sgTotal: sgOtt + sgApp + sgArg + sgPutt,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Career summary

export function computeCareerSummary(rounds: Round[]): CareerSummary {
  if (rounds.length === 0) {
    return {
      totalRounds: 0,
      scoringAverage: 0,
      handicapIndex: null,
      bestRoundScore: null,
      bestRoundToPar: null,
      fairwayPct: 0,
      girPct: 0,
      puttsPerRound: 0,
      sandSavePct: 0,
      threePuttRate: 0,
      sgOtt: 0, sgApp: 0, sgArg: 0, sgPutt: 0, sgTotal: 0,
      last8Rounds: [],
      tourAverages: TOUR_AVERAGES,
    };
  }

  // Scoring
  const scoringAverage = rounds.reduce((s, r) => s + r.totalStrokes, 0) / rounds.length;

  // Handicap (simplified USGA-style): avg of best 8 score-to-par of last 20.
  // We don't have course rating/slope, so "differential" is approximated as
  // score-to-par directly, clamped at ≥ 0 (no plus handicaps without rating).
  // This is an approximation — not a USGA-certified index.
  const diffs = rounds
    .slice(0, 20)
    .map((r) => r.totalStrokes - r.coursePar);
  diffs.sort((a, b) => a - b);
  const sampleSize = Math.min(8, diffs.length);
  const handicapIndex = sampleSize > 0
    ? Math.max(0, diffs.slice(0, sampleSize).reduce((s, d) => s + d, 0) / sampleSize)
    : null;

  // Best round
  let bestRoundScore: number | null = null;
  let bestRoundToPar: number | null = null;
  rounds.forEach((r) => {
    if (bestRoundScore === null || r.totalStrokes < bestRoundScore) {
      bestRoundScore = r.totalStrokes;
      bestRoundToPar = r.scoreToPar;
    }
  });

  // Fairway / GIR / putts / 3-putt / sand save
  let fairwayEligible = 0, fairwayHits = 0;
  let girEligible = 0, girHits = 0;
  let totalPutts = 0;
  let threePutts = 0;
  let missedGir = 0, upAndDowns = 0;

  rounds.forEach((r) => {
    r.holes.forEach((h) => {
      // Fairway % — only count holes where the toggle was actually recorded
      // (par ≥ 4 AND fairwayHit non-null). Null is "unknown", not "missed".
      if (h.par >= 4 && h.fairwayHit !== null) {
        fairwayEligible++;
        if (h.fairwayHit === true) fairwayHits++;
      }
      // GIR % — only count holes with a recorded green outcome.
      if (h.gir !== null) {
        girEligible++;
        if (h.gir === true) girHits++;
        if (h.putts >= 3) threePutts++;
        if (h.gir === false) {
          missedGir++;
          // Up-and-down proxy: putts <= 2 AND strokes - par <= 1.
          if (h.putts <= 2 && h.strokes - h.par <= 1) upAndDowns++;
        }
      }
      totalPutts += h.putts;
    });
  });

  const fairwayPct = fairwayEligible > 0 ? (fairwayHits / fairwayEligible) * 100 : 0;
  const girPct = girEligible > 0 ? (girHits / girEligible) * 100 : 0;
  const puttsPerRound = totalPutts / rounds.length;
  const threePuttRate = girEligible > 0 ? (threePutts / girEligible) * 100 : 0;
  // Sand-save proxy (no sand flag in data): up-and-down% on missed greens.
  const sandSavePct = missedGir > 0 ? (upAndDowns / missedGir) * 100 : 0;

  // Strokes Gained totals (averaged per round)
  let sgOtt = 0, sgApp = 0, sgArg = 0, sgPutt = 0;
  rounds.forEach((r) => {
    const sg = computeRoundSG(r);
    sgOtt += sg.sgOtt; sgApp += sg.sgApp; sgArg += sg.sgArg; sgPutt += sg.sgPutt;
  });
  const n = rounds.length;
  sgOtt /= n; sgApp /= n; sgArg /= n; sgPutt /= n;

  // Last 8 rounds (chronological, most recent last for charting)
  const last8Rounds = rounds.slice(0, 8).reverse().map((r) => ({
    date: r.date,
    score: r.totalStrokes,
    toPar: r.scoreToPar,
  }));

  return {
    totalRounds: rounds.length,
    scoringAverage,
    handicapIndex,
    bestRoundScore,
    bestRoundToPar,
    fairwayPct,
    girPct,
    puttsPerRound,
    sandSavePct,
    threePuttRate,
    sgOtt, sgApp, sgArg, sgPutt,
    sgTotal: sgOtt + sgApp + sgArg + sgPutt,
    last8Rounds,
    tourAverages: TOUR_AVERAGES,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Text block for Claude prompt injection

export function formatAnalyticsForPrompt(
  summary: CareerSummary,
  rounds: Round[] = [],
): string {
  if (summary.totalRounds === 0) return "";

  // Figure out which stat lines have real data behind them. If every hole
  // in localStorage has a null fairway/GIR flag, suppress those lines rather
  // than shipping "0%" to the coach (which the AI would interpret as real).
  let hasFairway = false;
  let hasGir = false;
  for (const r of rounds) {
    for (const h of r.holes) {
      if (h.fairwayHit !== null) hasFairway = true;
      if (h.gir !== null) hasGir = true;
    }
  }

  const fmtSG = (n: number) => (n >= 0 ? `+${n.toFixed(2)}` : n.toFixed(2));
  const weakest = [
    { k: "off the tee",      v: summary.sgOtt },
    { k: "approach",         v: summary.sgApp },
    { k: "around the green", v: summary.sgArg },
    { k: "putting",          v: summary.sgPutt },
  ].sort((a, b) => a.v - b.v)[0];

  const lines = [
    `PLAYER ANALYTICS (career over ${summary.totalRounds} round${summary.totalRounds === 1 ? "" : "s"}):`,
    `- Scoring average: ${summary.scoringAverage.toFixed(1)} (Tour ${TOUR_AVERAGES.scoringAverage})`,
    `- Handicap approximation: ${summary.handicapIndex !== null ? summary.handicapIndex.toFixed(1) : "n/a"}`,
  ];

  if (hasFairway) lines.push(`- Fairways hit: ${summary.fairwayPct.toFixed(0)}% (Tour ${TOUR_AVERAGES.fairwayPct}%)`);
  if (hasGir) {
    lines.push(`- Greens in regulation: ${summary.girPct.toFixed(0)}% (Tour ${TOUR_AVERAGES.girPct}%)`);
    lines.push(`- 3-putt rate: ${summary.threePuttRate.toFixed(1)}% (Tour ${TOUR_AVERAGES.threePuttRate}%)`);
  }
  lines.push(`- Putts per round: ${summary.puttsPerRound.toFixed(1)} (Tour ${TOUR_AVERAGES.puttsPerRound})`);

  // Only surface SG when at least GIR or fairway data exists; otherwise the
  // SG values are pure assumption and would mislead coaching advice.
  if (hasGir || hasFairway) {
    lines.push(`- Strokes Gained Off-Tee: ${fmtSG(summary.sgOtt)}`);
    lines.push(`- Strokes Gained Approach: ${fmtSG(summary.sgApp)}`);
    lines.push(`- Strokes Gained Around-Green: ${fmtSG(summary.sgArg)}`);
    lines.push(`- Strokes Gained Putting: ${fmtSG(summary.sgPutt)}`);
    lines.push(`- Weakest area: ${weakest.k} (${fmtSG(weakest.v)})`);
  }
  lines.push("");
  lines.push(`When giving coaching advice, weight fixes toward this player's weakest area. Mention the analytics context when directly relevant (e.g. a swing fault that explains low SG off-tee), but do not dump raw numbers into the advice.`);
  return lines.join("\n");
}
