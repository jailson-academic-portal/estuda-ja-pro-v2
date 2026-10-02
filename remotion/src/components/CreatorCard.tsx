import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { COLORS } from "../theme";

export const CreatorCard: React.FC<{
  title: string;
  desc: string;
  badge: string;
  delay: number;
  accent?: string;
}> = ({ title, desc, badge, delay, accent = COLORS.blue }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 18, stiffness: 140 } });
  const y = interpolate(s, [0, 1], [40, 0]);
  const blur = interpolate(s, [0, 1], [8, 0]);
  return (
    <div
      style={{
        opacity: s,
        transform: `translateY(${y}px)`,
        filter: `blur(${blur}px)`,
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: 22,
        padding: "26px 28px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          alignSelf: "flex-start",
          fontSize: 20,
          letterSpacing: 2,
          fontWeight: 700,
          color: accent,
          background: `${accent}22`,
          borderRadius: 999,
          padding: "6px 16px",
        }}
      >
        {badge}
      </div>
      <div style={{ fontSize: 38, fontWeight: 800, color: "#fff" }}>{title}</div>
      <div style={{ fontSize: 24, lineHeight: 1.35, color: COLORS.muted }}>{desc}</div>
    </div>
  );
};