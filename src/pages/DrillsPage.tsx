import { useState } from "react";
import { C, F } from "../design";

type Difficulty = "Beginner" | "Intermediate" | "Advanced";

interface Drill {
  title: string;
  description: string;
  difficulty: Difficulty;
  youtubeQuery: string;
}

const DIFFICULTY_STYLE: Record<Difficulty, { color: string; bg: string; border: string }> = {
  Beginner:     { color: C.accentGreen, bg: C.lightGreen,  border: "#B7D9BE" },
  Intermediate: { color: C.warning,     bg: "#FEF3E2",     border: "#F5C98A" },
  Advanced:     { color: C.secondary,   bg: "#F5F0E8",     border: C.borderDark },
};

const CATEGORIES = [
  {
    id: "full",
    label: "Full Swing",
    drills: [
      {
        title: "Gate Drill",
        description: "Place two tees just wider than your clubhead and practice rolling the club through without hitting either one. Teaches a neutral swing path and eliminates the two most common direction errors.",
        difficulty: "Beginner" as Difficulty,
        youtubeQuery: "gate drill golf swing path neutral",
      },
      {
        title: "Pump Drill",
        description: "Take the club to the top of your backswing and pump it down to the delivery position two or three times before releasing. Trains the shallow transition move used by Jon Rahm and Viktor Hovland.",
        difficulty: "Intermediate" as Difficulty,
        youtubeQuery: "pump drill golf downswing shallow transition",
      },
      {
        title: "Step Drill",
        description: "Pull your trail foot back eighteen inches at address to drop the trail shoulder and feel the correct downswing slot. Used by Claude Harmon III to quickly fix over-the-top tendencies.",
        difficulty: "Intermediate" as Difficulty,
        youtubeQuery: "step drill golf trail foot downswing slot",
      },
      {
        title: "Trail Arm Drill",
        description: "Hit half shots with your trail arm only, keeping the elbow softly bent and the forearm rotating through impact. Builds the pivot-driven release pattern that stops casting.",
        difficulty: "Intermediate" as Difficulty,
        youtubeQuery: "trail arm golf drill release casting",
      },
      {
        title: "Alignment Stick Path Drill",
        description: "Lay an alignment stick along your ball-to-target line and practice swinging with the clubhead tracking just inside it on the way down and through. Gives instant visual feedback on swing direction.",
        difficulty: "Beginner" as Difficulty,
        youtubeQuery: "alignment stick swing path drill golf",
      },
      {
        title: "Towel Under Arms Drill",
        description: "Tuck a small towel under both arms and keep it there through the full swing. If it drops, your arms have disconnected from your body rotation — the root cause of most inconsistency.",
        difficulty: "Beginner" as Difficulty,
        youtubeQuery: "towel under arms golf drill connection body rotation",
      },
    ] as Drill[],
  },
  {
    id: "short",
    label: "Pitching and Chipping",
    drills: [
      {
        title: "Hinge and Hold",
        description: "Set the wrists early on the backswing and hold that hinge through impact without releasing. Creates the downward strike and forward shaft lean needed for consistent chipping.",
        difficulty: "Intermediate" as Difficulty,
        youtubeQuery: "hinge and hold chipping drill golf",
      },
      {
        title: "Bump and Run",
        description: "Use a 7 or 8 iron to run the ball along the ground with a putting stroke. Removes loft, eliminates scooping, and builds feel for low-trajectory shots around the green.",
        difficulty: "Beginner" as Difficulty,
        youtubeQuery: "bump and run chip shot golf technique",
      },
      {
        title: "Clock System Drill",
        description: "Hit pitch shots using different backswing lengths labeled as clock positions — 7 o'clock, 9 o'clock, 11 o'clock — and measure how far each length carries. Builds reliable distance control.",
        difficulty: "Intermediate" as Difficulty,
        youtubeQuery: "clock system pitching drill distance control golf",
      },
      {
        title: "Weight Forward Drill",
        description: "Set up with sixty percent of your weight on your lead foot and keep it there throughout the swing. Eliminates the weight shift that causes fat and thin contact around the greens.",
        difficulty: "Beginner" as Difficulty,
        youtubeQuery: "weight forward chipping drill golf contact",
      },
      {
        title: "Ball Back Drill",
        description: "Position the ball two to three inches back of center in your stance and note how the shaft naturally leans forward. Hit chip shots from this position to train the steep, descending strike.",
        difficulty: "Beginner" as Difficulty,
        youtubeQuery: "ball back stance chipping drill golf steep strike",
      },
      {
        title: "Shaft Lean Drill",
        description: "Place an alignment stick through the grip end of your club. At impact, the stick must point toward your lead hip — not toward the ball or your trail leg. Guarantees forward shaft lean at contact.",
        difficulty: "Intermediate" as Difficulty,
        youtubeQuery: "shaft lean drill golf chipping alignment stick",
      },
    ] as Drill[],
  },
  {
    id: "putting",
    label: "Putting",
    drills: [
      {
        title: "Gate Putting Drill",
        description: "Place two tees just wider than your putter head on either side of the ball. Stroke through the gate without hitting either tee. Reveals and corrects path errors that cause pulls and pushes.",
        difficulty: "Beginner" as Difficulty,
        youtubeQuery: "gate putting drill path golf",
      },
      {
        title: "Coin Drill",
        description: "Place a coin on the putting green and practice making contact between the coin and the ball, hitting the coin toward the target first. Trains a square face and precise low point.",
        difficulty: "Intermediate" as Difficulty,
        youtubeQuery: "coin drill putting golf face angle",
      },
      {
        title: "String Line Drill",
        description: "Stretch a string at hole height on a straight six-foot putt. Practice rolling the ball directly under the string. Gives instant feedback on start line — the most important variable in putting.",
        difficulty: "Intermediate" as Difficulty,
        youtubeQuery: "string line putting drill start line golf",
      },
      {
        title: "3-6-9 Foot Drill",
        description: "Place balls at three feet, six feet, and nine feet. Make all three before moving on. Track how many rounds it takes to complete the circuit. Builds pressure confidence from short range out.",
        difficulty: "Beginner" as Difficulty,
        youtubeQuery: "3 6 9 foot putting drill confidence circle",
      },
      {
        title: "Chalk Line Drill",
        description: "Snap a chalk line on the practice green between the ball and the hole. Practice rolling your putts directly along the line. Shows exactly where the ball departs from the intended path.",
        difficulty: "Beginner" as Difficulty,
        youtubeQuery: "chalk line putting drill straight path golf",
      },
      {
        title: "Metronome Tempo Drill",
        description: "Use a metronome app set to 72 beats per minute. Stroke the putter so the backswing hits the first beat and the through-stroke hits the second. Builds the even tempo used by the best putters on tour.",
        difficulty: "Intermediate" as Difficulty,
        youtubeQuery: "metronome putting drill tempo rhythm golf",
      },
    ] as Drill[],
  },
];

export default function DrillsPage() {
  const [activeCategory, setActiveCategory] = useState("full");
  const category = CATEGORIES.find(c => c.id === activeCategory)!;

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 0 24px" }}>
      {/* Header */}
      <div style={{ padding: "24px 16px 0", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontFamily: F.serif, fontSize: 24, color: C.deepGreen, marginBottom: 4 }}>
          Drill Library
        </div>
        <div style={{ fontSize: 14, color: C.muted, marginBottom: 16 }}>
          Curated practice drills from the world's best coaches
        </div>

        {/* Category tabs */}
        <div style={{ display: "flex", gap: 0 }}>
          {CATEGORIES.map(cat => (
            <button key={cat.id} onClick={() => setActiveCategory(cat.id)}
              style={{ flex: 1, padding: "10px 6px 12px", border: "none", background: "transparent",
                fontSize: 13, fontWeight: 500, letterSpacing: "0.01em",
                color: activeCategory === cat.id ? C.deepGreen : C.muted,
                borderBottom: activeCategory === cat.id
                  ? `2px solid ${C.accentGreen}` : `2px solid transparent`,
                transition: "all 0.15s" }}>
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 10 }}>
        {category.drills.map((drill, i) => {
          const diffStyle = DIFFICULTY_STYLE[drill.difficulty];
          const query = encodeURIComponent(drill.youtubeQuery);
          return (
            <div key={i} style={{ border: "1px solid #E8E4DC", borderRadius: 12, padding: 16, background: "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div style={{ fontFamily: F.serif, fontSize: 17, color: C.deepGreen, lineHeight: 1.2, flex: 1 }}>
                  {drill.title}
                </div>
                <span style={{ flexShrink: 0, marginLeft: 12, fontSize: 11, fontWeight: 600,
                  color: diffStyle.color, background: diffStyle.bg, border: `1px solid ${diffStyle.border}`,
                  padding: "3px 10px", borderRadius: 100 }}>
                  {drill.difficulty}
                </span>
              </div>

              <div style={{ fontSize: 14, color: C.secondary, lineHeight: 1.7, marginBottom: 12 }}>
                {drill.description}
              </div>

              <a href={`https://www.youtube.com/results?search_query=${query}`}
                target="_blank" rel="noopener noreferrer"
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                  textDecoration: "none", border: `1px solid ${C.border}`, borderRadius: 8,
                  padding: "10px 12px" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.deepGreen }}>Watch on YouTube</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{drill.youtubeQuery}</div>
                </div>
                <span style={{ fontSize: 13, color: C.muted }}>→</span>
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}
