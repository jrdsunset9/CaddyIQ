import { useMemo } from "react";
import { C, F } from "../design";
import {
  computeCareerSummary,
  TOUR_AVERAGES,
  type Round,
  type CareerSummary,
} from "../lib/analytics";

type Tab = "round" | "analyze" | "sessions" | "drills" | "analytics";

interface Props {
  rounds: Round[];
  onSwitchTab: (tab: Tab) => void;
}

// ───────────────────────────────────────────────────────────────────────────
// Color utilities

const NEGATIVE = "#E07B5A";
const NEAR_ZERO = "#7FB890";
const AMBER = "#D9A05B";
const WHITE = "#FAFAF8";
const HEADER_BG = "#0F2417";

/** Color-code a Strokes Gained value for the mini cards in the header. */
function sgColor(v: number): string {
  if (v < -0.3) return NEGATIVE;
  if (v > 0.3)  return "#8BC496";
  return NEAR_ZERO;
}

function fmtSG(v: number): string {
  return v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2);
}

// ───────────────────────────────────────────────────────────────────────────
// Small presentational components

function SGCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={{
      flex: 1,
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: 10,
      padding: "10px 10px 12px",
      minWidth: 0,
    }}>
      <div style={{
        fontSize: 10, color: "rgba(255,255,255,0.55)",
        textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: F.serif,
        fontSize: 18,
        color: sgColor(value),
        fontWeight: 500,
      }}>
        {fmtSG(value)}
      </div>
    </div>
  );
}

function StatRow({
  label, value, tour, better,
}: {
  label: string;
  value: string;
  tour: string;
  better: "higher" | "lower" | null;
}) {
  return (
    <div style={{
      border: C.cardBorder, borderRadius: 12, background: C.card,
      padding: "14px 14px 12px",
    }}>
      <div style={{ fontSize: 11, color: C.muted, textTransform: "uppercase",
        letterSpacing: "0.08em", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontFamily: F.serif, fontSize: 22, color: C.deepGreen, marginBottom: 4 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: C.muted }}>
        Tour avg {tour}
        {better && <span style={{ marginLeft: 4, color: C.muted }}>
          ({better === "higher" ? "higher is better" : "lower is better"})
        </span>}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// 8-round trend bar chart

function TrendChart({ summary }: { summary: CareerSummary }) {
  const bars = summary.last8Rounds;
  if (bars.length === 0) return null;

  const maxScore = Math.max(...bars.map((b) => b.score), summary.scoringAverage + 5);
  const minScore = Math.min(...bars.map((b) => b.score), summary.scoringAverage - 5);
  const range = Math.max(maxScore - minScore, 1);

  return (
    <div style={{ border: C.cardBorder, borderRadius: 12, background: C.card, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <div style={{ fontFamily: F.serif, fontSize: 16, color: C.deepGreen }}>
          Last {bars.length} round{bars.length === 1 ? "" : "s"}
        </div>
        <div style={{ fontSize: 12, color: C.muted }}>
          Average {summary.scoringAverage.toFixed(1)}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 140, position: "relative" }}>
        {/* Average line */}
        <div style={{
          position: "absolute", left: 0, right: 0,
          bottom: `${((summary.scoringAverage - minScore) / range) * 100}%`,
          borderTop: `1px dashed ${C.borderDark}`,
          pointerEvents: "none",
        }} />
        {bars.map((b, i) => {
          const h = Math.max(((b.score - minScore) / range) * 100, 6);
          const better = b.score <= summary.scoringAverage;
          return (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "flex-end", height: "100%", minWidth: 0 }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>
                {b.score}
              </div>
              <div style={{
                width: "100%",
                height: `${h}%`,
                background: better ? C.accentGreen : AMBER,
                borderRadius: "4px 4px 0 0",
              }} />
              <div style={{ fontSize: 9, color: C.muted, marginTop: 4, whiteSpace: "nowrap",
                overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
                {b.date.split(",")[0]}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Main component

export default function AnalyticsPage({ rounds, onSwitchTab }: Props) {
  const summary = useMemo(() => computeCareerSummary(rounds), [rounds]);

  // Empty state
  if (summary.totalRounds === 0) {
    return (
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "48px 20px", textAlign: "center" }}>
        <div style={{ fontFamily: F.serif, fontSize: 24, color: C.deepGreen, marginBottom: 10 }}>
          No rounds yet
        </div>
        <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.7, marginBottom: 28, maxWidth: 420, margin: "0 auto 28px" }}>
          Play a round on the Round tab and save your feel profile at the end.
          Your analytics build up automatically — scoring trend, fairways, greens, putts, and Strokes Gained against Tour benchmarks.
        </div>
        <button
          onClick={() => onSwitchTab("round")}
          style={{
            padding: "12px 24px", background: C.deepGreen, color: "#fff",
            border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600,
          }}
        >
          Start a round
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 680, margin: "0 auto" }}>
      {/* ── Header (dark green) ── */}
      <div style={{ background: HEADER_BG, padding: "20px 20px 22px", color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <div style={{ fontFamily: F.serif, fontSize: 22, color: "#fff" }}>
            Caddy<span style={{ fontStyle: "italic", color: "#8BC496" }}>IQ</span>
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)",
            textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Career · {summary.totalRounds} round{summary.totalRounds === 1 ? "" : "s"}
          </div>
        </div>

        {/* Scoring average + handicap */}
        <div style={{ display: "flex", gap: 24, alignItems: "flex-end", marginTop: 10, marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)",
              textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>
              Scoring average
            </div>
            <div style={{ fontFamily: F.serif, fontSize: 36, color: "#fff", lineHeight: 1 }}>
              {summary.scoringAverage.toFixed(1)}
            </div>
          </div>
          <div style={{ paddingBottom: 4 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)",
              textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>
              Handicap
            </div>
            <div style={{ fontFamily: F.serif, fontSize: 20, color: "#fff" }}>
              {summary.handicapIndex !== null ? summary.handicapIndex.toFixed(1) : "—"}
            </div>
          </div>
        </div>

        {/* 4 SG mini cards */}
        <div style={{ display: "flex", gap: 8 }}>
          <SGCard label="Off tee"        value={summary.sgOtt} />
          <SGCard label="Approach"       value={summary.sgApp} />
          <SGCard label="Around green"   value={summary.sgArg} />
          <SGCard label="Putting"        value={summary.sgPutt} />
        </div>
      </div>

      {/* ── Body (warm white) ── */}
      <div style={{ background: WHITE, padding: "16px 16px 28px" }}>
        {/* Trend chart */}
        <div style={{ marginBottom: 16 }}>
          <TrendChart summary={summary} />
        </div>

        {/* Stat detail grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          <StatRow
            label="Fairways hit"
            value={`${summary.fairwayPct.toFixed(0)}%`}
            tour={`${TOUR_AVERAGES.fairwayPct}%`}
            better="higher"
          />
          <StatRow
            label="Greens in regulation"
            value={`${summary.girPct.toFixed(0)}%`}
            tour={`${TOUR_AVERAGES.girPct}%`}
            better="higher"
          />
          <StatRow
            label="Putts / round"
            value={summary.puttsPerRound.toFixed(1)}
            tour={TOUR_AVERAGES.puttsPerRound.toFixed(1)}
            better="lower"
          />
          <StatRow
            label="Sand save"
            value={`${summary.sandSavePct.toFixed(0)}%`}
            tour={`${TOUR_AVERAGES.sandSavePct}%`}
            better="higher"
          />
          <StatRow
            label="3-putt rate"
            value={`${summary.threePuttRate.toFixed(1)}%`}
            tour={`${TOUR_AVERAGES.threePuttRate}%`}
            better="lower"
          />
          <StatRow
            label="Best round"
            value={
              summary.bestRoundScore !== null
                ? `${summary.bestRoundScore} (${
                    summary.bestRoundToPar !== null
                      ? summary.bestRoundToPar === 0
                        ? "E"
                        : summary.bestRoundToPar > 0
                          ? `+${summary.bestRoundToPar}`
                          : `${summary.bestRoundToPar}`
                      : "—"
                  })`
                : "—"
            }
            tour="—"
            better={null}
          />
        </div>

        {/* Footnote */}
        <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.6, padding: "4px 4px 0" }}>
          Strokes Gained uses Mark Broadie's PGA Tour benchmarks. Positive values beat Tour average; negative values trail it.
          Your weakest area gets extra attention in swing analysis.
        </div>
      </div>
    </div>
  );
}
