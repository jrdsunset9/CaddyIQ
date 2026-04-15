import { C } from "../design";

export default function ProfilePage() {
  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 0 24px" }}>
      <div style={{ padding: "20px 20px 20px", background: C.card, borderBottom: `1px solid ${C.separator}` }}>
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.5px", color: C.black, marginBottom: 4 }}>
          Profile
        </div>
        <div style={{ fontSize: 15, color: C.muted }}>Your golfer profile</div>
      </div>

      <div style={{ padding: "40px 16px", textAlign: "center" }}>
        <div style={{ width: 80, height: 80, borderRadius: "50%", background: "rgba(22,163,74,0.12)",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36,
          margin: "0 auto 20px" }}>
          👤
        </div>
        <div style={{ fontSize: 17, fontWeight: 600, color: C.black, marginBottom: 8 }}>
          Coming soon
        </div>
        <div style={{ fontSize: 15, color: C.muted, maxWidth: 280, margin: "0 auto", lineHeight: 1.6 }}>
          Handicap tracking, goal setting, and coach notes will live here.
        </div>
      </div>
    </div>
  );
}
