import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { COLORS } from "../theme";

export const Scene1Intro: React.FC<{ display: string; body: string }> = ({ display, body }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const logo = spring({ frame, fps, config: { damping: 12, stiffness: 120 } });
  const titleS = spring({ frame: frame - 12, fps, config: { damping: 200 } });
  const subS = spring({ frame: frame - 26, fps, config: { damping: 200 } });
  const float = Math.sin(frame / 26) * 8;
  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
        <Img
          src={staticFile("images/owl.png")}
          style={{
            width: 190,
            transform: `scale(${interpolate(logo, [0, 1], [0.6, 1])}) translateY(${float}px)`,
            opacity: logo,
          }}
        />
        <div
          style={{
            fontFamily: display,
            fontSize: 116,
            fontWeight: 800,
            color: "#fff",
            marginTop: 24,
            letterSpacing: -2,
            opacity: titleS,
            transform: `translateY(${interpolate(titleS, [0, 1], [40, 0])}px)`,
          }}
        >
          EstudaJá <span style={{ color: COLORS.accent }}>Pro</span>
        </div>
        <div
          style={{
            fontFamily: body,
            fontSize: 36,
            color: COLORS.muted,
            marginTop: 14,
            opacity: subS,
            transform: `translateY(${interpolate(subS, [0, 1], [24, 0])}px)`,
          }}
        >
          Plataforma acadêmica integrada — do ensino médio à pós-graduação
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};