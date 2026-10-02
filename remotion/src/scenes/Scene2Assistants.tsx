import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { COLORS } from "../theme";

const CHIPS = [
  "Plano de Aula",
  "Apostilas",
  "Slides",
  "Exercícios",
  "Avaliações",
  "Atividades / Trabalhos",
];

export const Scene2Assistants: React.FC<{ display: string; body: string }> = ({ display, body }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = spring({ frame, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ padding: "110px 130px", justifyContent: "center" }}>
        <div
          style={{
            fontFamily: body,
            fontSize: 26,
            letterSpacing: 6,
            color: COLORS.teal,
            opacity: t,
          }}
        >
          ASSISTENTES DE IA
        </div>
        <div
          style={{
            fontFamily: display,
            fontSize: 84,
            fontWeight: 800,
            color: "#fff",
            maxWidth: 1100,
            lineHeight: 1.05,
            marginTop: 14,
            opacity: t,
            transform: `translateY(${interpolate(t, [0, 1], [40, 0])}px)`,
          }}
        >
          Seis criadores que preparam sua aula inteira
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: 54, maxWidth: 1300 }}>
          {CHIPS.map((c, i) => {
            const s = spring({ frame: frame - 24 - i * 7, fps, config: { damping: 16, stiffness: 160 } });
            return (
              <div
                key={c}
                style={{
                  fontFamily: body,
                  fontSize: 32,
                  fontWeight: 600,
                  color: "#fff",
                  padding: "16px 30px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.08)",
                  border: `1px solid ${COLORS.blue}66`,
                  opacity: s,
                  transform: `translateY(${interpolate(s, [0, 1], [30, 0])}px) scale(${interpolate(s, [0, 1], [0.9, 1])})`,
                }}
              >
                {c}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};