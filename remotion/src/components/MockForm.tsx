import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { COLORS } from "../theme";

export type Field = { label: string; value: string };

const Typed: React.FC<{ text: string; start: number; speed?: number }> = ({
  text,
  start,
  speed = 1.6,
}) => {
  const frame = useCurrentFrame();
  const n = Math.max(0, Math.min(text.length, Math.round((frame - start) * speed)));
  const done = n >= text.length;
  return (
    <span>
      {text.slice(0, n)}
      {!done && n > 0 ? (
        <span style={{ opacity: frame % 16 < 8 ? 1 : 0, color: COLORS.blue }}>|</span>
      ) : null}
    </span>
  );
};

export const MockForm: React.FC<{
  fields: Field[];
  accent: string;
  cta: string;
  display: string;
  startAt?: number;
}> = ({ fields, accent, cta, display, startAt = 12 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pressStart = startAt + fields.length * 22 + 12;
  const press = spring({
    frame: frame - pressStart,
    fps,
    config: { damping: 12, stiffness: 220 },
  });
  const pressScale = 1 - 0.06 * Math.sin(Math.PI * Math.min(1, press));
  const progress = interpolate(frame, [pressStart + 8, pressStart + 60], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        width: 430,
        padding: "26px 26px",
        borderRight: "1px solid #DDE5F2",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        background: "#FFFFFF",
      }}
    >
      {fields.map((f, i) => {
        const s = spring({
          frame: frame - (startAt + i * 22 - 10),
          fps,
          config: { damping: 20, stiffness: 160 },
        });
        return (
          <div key={f.label} style={{ opacity: s, transform: `translateY(${(1 - s) * 14}px)` }}>
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: "#5A6B8C",
                letterSpacing: 0.6,
                marginBottom: 7,
              }}
            >
              {f.label}
            </div>
            <div
              style={{
                minHeight: 48,
                borderRadius: 12,
                border: `1.5px solid ${frame > startAt + i * 22 ? accent : "#D6DFEE"}`,
                background: "#F7F9FD",
                padding: "12px 14px",
                fontSize: 19,
                color: "#12203C",
                fontWeight: 600,
              }}
            >
              <Typed text={f.value} start={startAt + i * 22} />
            </div>
          </div>
        );
      })}

      <div
        style={{
          marginTop: "auto",
          transform: `scale(${pressScale})`,
          background: accent,
          borderRadius: 14,
          padding: "16px 20px",
          textAlign: "center",
          fontFamily: display,
          fontWeight: 700,
          fontSize: 22,
          color: "#0B1730",
          boxShadow: `0 12px 26px ${accent}55`,
        }}
      >
        {cta}
      </div>
      <div style={{ height: 8, borderRadius: 999, background: "#E4EAF5", overflow: "hidden" }}>
        <div
          style={{
            width: `${progress * 100}%`,
            height: "100%",
            background: `linear-gradient(90deg, ${COLORS.teal}, ${accent})`,
          }}
        />
      </div>
      <div style={{ fontSize: 14, color: "#7A8AA8", textAlign: "center" }}>
        {progress >= 1 ? "Concluído — pronto para baixar" : "Gerando com IA…"}
      </div>
    </div>
  );
};