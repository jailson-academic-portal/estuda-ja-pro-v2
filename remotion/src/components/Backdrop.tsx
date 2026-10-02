import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { bgGradient, COLORS } from "../theme";

export const Backdrop: React.FC<{ tone?: "dark" | "light" }> = ({ tone = "dark" }) => {
  const frame = useCurrentFrame();
  const drift = interpolate(frame, [0, 600], [0, 90]);
  const drift2 = interpolate(frame, [0, 600], [0, -70]);
  return (
    <AbsoluteFill
      style={{
        background: tone === "dark" ? bgGradient : "linear-gradient(150deg,#FFFFFF 0%,#E8EFFA 100%)",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 900,
          height: 900,
          borderRadius: "50%",
          left: -260 + drift,
          top: -300,
          background: `radial-gradient(circle, ${COLORS.blue}44 0%, transparent 65%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 760,
          height: 760,
          borderRadius: "50%",
          right: -240 + drift2,
          bottom: -280,
          background: `radial-gradient(circle, ${COLORS.teal}33 0%, transparent 65%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "80px 80px",
          opacity: tone === "dark" ? 1 : 0.35,
        }}
      />
    </AbsoluteFill>
  );
};