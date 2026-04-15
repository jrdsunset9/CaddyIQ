export const C = {
  bg:          "#FAFAF8",
  card:        "#FFFFFF",
  deepGreen:   "#0F2417",
  accentGreen: "#2A6640",
  lightGreen:  "#EDF4EE",
  muted:       "#9A8F7E",
  border:      "#E8E4DC",
  borderDark:  "#D5D0C4",
  body:        "#0F2417",
  secondary:   "#5C5445",
  warning:     "#B45309",
  cardBorder:  "1px solid #E8E4DC",
} as const;

export const F = {
  serif: "Georgia, 'Times New Roman', serif",
  sans:  "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
} as const;

export const STATUS = {
  "strength":   { color: "#2A6640", bg: "#EDF4EE", border: "#B7D9BE", label: "Strength" },
  "improving":  { color: "#B45309", bg: "#FEF3E2", border: "#F5C98A", label: "Improving" },
  "focus-area": { color: "#B45309", bg: "#FEF3E2", border: "#F5C98A", label: "Focus area" },
} as const;

export const card: React.CSSProperties = {
  background: "#FFFFFF",
  border: "1px solid #E8E4DC",
  borderRadius: 12,
  padding: 16,
};

// so the import doesn't break
import type React from "react";
