import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { COLORS } from "../theme";

export const Scene5Outro: React.FC<{ display: string; body: string }> = ({ display, body }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = spring({ frame, fps, config: { damping: 200 } });
  const url = spring({ frame: frame - 30, fps, config: { damping: 14, stiffness: 130 } });
  const float = Math.sin(frame / 24) * 6;
  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", fontFamily: body }}>
        <Img
          src={staticFile("images/owl.png")}
          style={{ width: 130, opacity: t, transform: `translateY(${float}px)` }}
        />
        <div
          style={{
            fontFamily: display,
            fontSize: 76,
            fontWeight: 800,
            color: "#fff",
            marginTop: 26,
            textAlign: "center",
            maxWidth: 1200,
            lineHeight: 1.1,
            opacity: t,
            transform: `translateY(${interpolate(t, [0, 1], [30, 0])}px)`,
          }}
        >
          Mais tempo ensinando. Menos tempo preparando.
        </div>
        <div
          style={{
            marginTop: 46,
            padding: "22px 54px",
            borderRadius: 999,
            background: COLORS.accent,
            color: COLORS.ink,
            fontSize: 40,
            fontWeight: 800,
            opacity: url,
            transform: `scale(${interpolate(url, [0, 1], [0.85, 1])})`,
          }}
        >
          estudaja.com
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};