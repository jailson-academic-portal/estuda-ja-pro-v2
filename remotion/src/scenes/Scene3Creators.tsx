import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { CreatorCard } from "../components/CreatorCard";
import { COLORS } from "../theme";

export type CreatorItem = { badge: string; title: string; desc: string; accent?: string };

export const Scene3Creators: React.FC<{
  display: string;
  body: string;
  heading: string;
  items: CreatorItem[];
}> = ({ display, body, heading, items }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = spring({ frame, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ padding: "100px 130px", justifyContent: "center", fontFamily: body }}>
        <div
          style={{
            fontFamily: display,
            fontSize: 66,
            fontWeight: 800,
            color: "#fff",
            opacity: t,
            transform: `translateX(${interpolate(t, [0, 1], [-40, 0])}px)`,
          }}
        >
          {heading}
        </div>
        <div
          style={{
            height: 5,
            width: interpolate(t, [0, 1], [0, 180]),
            background: COLORS.accent,
            borderRadius: 999,
            marginTop: 18,
          }}
        />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 30, marginTop: 52 }}>
          {items.map((it, i) => (
            <CreatorCard key={it.title} {...it} delay={18 + i * 12} />
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};