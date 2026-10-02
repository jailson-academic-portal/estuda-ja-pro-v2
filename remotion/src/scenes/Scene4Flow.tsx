import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { COLORS } from "../theme";

const STEPS = [
  { n: "1", t: "Plano de Aula", d: "Objetivos, etapas e avaliação" },
  { n: "2", t: "Apostila", d: "Material completo do módulo" },
  { n: "3", t: "Slides", d: "Apresentação em PPTX e PDF" },
  { n: "4", t: "Exercícios e Avaliações", d: "Com gabarito e correção" },
];

export const Scene4Flow: React.FC<{ display: string; body: string }> = ({ display, body }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = spring({ frame, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ padding: "110px 130px", justifyContent: "center", fontFamily: body }}>
        <div style={{ fontFamily: display, fontSize: 62, fontWeight: 800, color: "#fff", opacity: t }}>
          Tudo conectado, do plano à correção
        </div>
        <div style={{ display: "flex", alignItems: "stretch", gap: 22, marginTop: 70 }}>
          {STEPS.map((s, i) => {
            const sp = spring({ frame: frame - 20 - i * 14, fps, config: { damping: 15, stiffness: 150 } });
            return (
              <div key={s.n} style={{ display: "flex", alignItems: "center", gap: 22, flex: 1 }}>
                <div
                  style={{
                    flex: 1,
                    opacity: sp,
                    transform: `translateY(${interpolate(sp, [0, 1], [36, 0])}px)`,
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.14)",
                    borderRadius: 20,
                    padding: "26px 22px",
                    minHeight: 230,
                  }}
                >
                  <div
                    style={{
                      width: 54,
                      height: 54,
                      borderRadius: 16,
                      background: COLORS.accent,
                      color: COLORS.ink,
                      fontWeight: 800,
                      fontSize: 30,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {s.n}
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "#fff", marginTop: 18 }}>{s.t}</div>
                  <div style={{ fontSize: 22, color: COLORS.muted, marginTop: 8, lineHeight: 1.3 }}>{s.d}</div>
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    style={{
                      width: 26,
                      height: 4,
                      borderRadius: 999,
                      background: COLORS.teal,
                      opacity: spring({ frame: frame - 30 - i * 14, fps, config: { damping: 200 } }),
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};