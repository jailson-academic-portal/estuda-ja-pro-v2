import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { COLORS } from "../theme";

export const AppWindow: React.FC<{
  moduleName: string;
  accent: string;
  display: string;
  delay?: number;
  children: React.ReactNode;
}> = ({ moduleName, accent, display, delay = 0, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 22, stiffness: 130 } });
  const y = interpolate(s, [0, 1], [70, 0]);
  const scale = interpolate(s, [0, 1], [0.94, 1]);
  return (
    <div
      style={{
        opacity: s,
        transform: `translateY(${y}px) scale(${scale})`,
        width: 1180,
        borderRadius: 20,
        overflow: "hidden",
        background: "#FFFFFF",
        boxShadow: "0 40px 90px rgba(2,8,25,0.55)",
        border: "1px solid rgba(255,255,255,0.25)",
      }}
    >
      <div
        style={{
          height: 58,
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "0 22px",
          background: "#0F2450",
        }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
            <div key={c} style={{ width: 12, height: 12, borderRadius: 999, background: c }} />
          ))}
        </div>
        <div
          style={{
            marginLeft: 10,
            fontFamily: display,
            fontSize: 20,
            fontWeight: 700,
            color: "#fff",
            letterSpacing: 0.4,
          }}
        >
          EstudaJá Pro
        </div>
        <div
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: accent,
            background: `${accent}26`,
            borderRadius: 999,
            padding: "5px 14px",
            letterSpacing: 1.4,
          }}
        >
          {moduleName}
        </div>
        <div style={{ marginLeft: "auto", fontSize: 15, color: COLORS.muted }}>
          Assistente IA
        </div>
      </div>
      <div style={{ display: "flex", height: 520, background: COLORS.paper }}>{children}</div>
    </div>
  );
};