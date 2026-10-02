import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { COLORS } from "../theme";

export type PreviewKind = "plan" | "doc" | "slides" | "activity" | "quiz" | "exam";

const useReveal = (delay: number) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping: 20, stiffness: 150 } });
};

const Line: React.FC<{ w: number; delay: number; strong?: boolean }> = ({ w, delay, strong }) => {
  const s = useReveal(delay);
  return (
    <div
      style={{
        width: `${w * s}%`,
        height: strong ? 14 : 9,
        borderRadius: 999,
        background: strong ? "#25406F" : "#C3CFE3",
        marginBottom: strong ? 14 : 11,
      }}
    />
  );
};

const Sheet: React.FC<{ delay: number; children: React.ReactNode; pad?: number }> = ({
  delay,
  children,
  pad = 26,
}) => {
  const s = useReveal(delay);
  return (
    <div
      style={{
        opacity: s,
        transform: `translateY(${(1 - s) * 26}px)`,
        background: "#fff",
        borderRadius: 14,
        border: "1px solid #E1E8F4",
        boxShadow: "0 12px 26px rgba(15,36,80,0.08)",
        padding: pad,
      }}
    >
      {children}
    </div>
  );
};

const Chip: React.FC<{ text: string; accent: string; delay: number }> = ({
  text,
  accent,
  delay,
}) => {
  const s = useReveal(delay);
  return (
    <div
      style={{
        opacity: s,
        transform: `scale(${0.85 + 0.15 * s})`,
        fontSize: 15,
        fontWeight: 700,
        color: "#0B1730",
        background: `${accent}2E`,
        border: `1px solid ${accent}`,
        borderRadius: 999,
        padding: "6px 14px",
      }}
    >
      {text}
    </div>
  );
};

export const MockPreview: React.FC<{
  kind: PreviewKind;
  accent: string;
  display: string;
  start: number;
  title: string;
}> = ({ kind, accent, display, start, title }) => {
  const frame = useCurrentFrame();
  const scroll = interpolate(frame, [start + 60, start + 150], [0, -60], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div style={{ flex: 1, padding: "22px 26px", overflow: "hidden", position: "relative" }}>
      <div
        style={{
          fontFamily: display,
          fontSize: 24,
          fontWeight: 700,
          color: "#12203C",
          marginBottom: 16,
        }}
      >
        {title}
      </div>
      <div style={{ transform: `translateY(${scroll}px)` }}>
        {kind === "plan" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {[
              { t: "Objetivos de aprendizagem", d: start },
              { t: "Conteúdos e materiais", d: start + 18 },
              { t: "Etapas da aula (5 momentos)", d: start + 36 },
              { t: "Avaliação e evidências", d: start + 54 },
            ].map((row, i) => (
              <Sheet key={row.t} delay={row.d} pad={20}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 10,
                      background: accent,
                      color: "#0B1730",
                      fontWeight: 800,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 18,
                    }}
                  >
                    {i + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#12203C", marginBottom: 8 }}>
                      {row.t}
                    </div>
                    <Line w={82} delay={row.d + 8} />
                  </div>
                </div>
              </Sheet>
            ))}
          </div>
        )}

        {kind === "doc" && (
          <Sheet delay={start} pad={30}>
            <Line w={62} delay={start + 4} strong />
            <Line w={96} delay={start + 14} />
            <Line w={90} delay={start + 22} />
            <Line w={72} delay={start + 30} />
            <div style={{ height: 10 }} />
            <Line w={48} delay={start + 40} strong />
            <Line w={94} delay={start + 48} />
            <Line w={86} delay={start + 56} />
            <div
              style={{
                marginTop: 16,
                borderLeft: `4px solid ${accent}`,
                background: `${accent}14`,
                borderRadius: 8,
                padding: "14px 16px",
              }}
            >
              <Line w={78} delay={start + 66} />
              <Line w={60} delay={start + 74} />
            </div>
          </Sheet>
        )}

        {kind === "slides" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {[0, 1, 2, 3].map((i) => (
              <Sheet key={i} delay={start + i * 16} pad={0}>
                <div
                  style={{
                    height: 150,
                    borderRadius: 13,
                    background:
                      i % 2 === 0
                        ? "linear-gradient(135deg,#0F2450,#1B3D7A)"
                        : "linear-gradient(135deg,#FFFFFF,#EAF0FA)",
                    padding: 18,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      width: 46,
                      height: 6,
                      borderRadius: 999,
                      background: accent,
                    }}
                  />
                  <div
                    style={{
                      fontFamily: display,
                      fontSize: 22,
                      fontWeight: 700,
                      color: i % 2 === 0 ? "#fff" : "#12203C",
                    }}
                  >
                    {["Capa", "Conceitos", "Aplicação clínica", "Resumo"][i]}
                  </div>
                  <div
                    style={{
                      width: "78%",
                      height: 8,
                      borderRadius: 999,
                      background: i % 2 === 0 ? "#4E6DA6" : "#C3CFE3",
                    }}
                  />
                </div>
              </Sheet>
            ))}
          </div>
        )}

        {kind === "activity" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Sheet delay={start} pad={22}>
              <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                <Chip text="Entrega: 12/09" accent={accent} delay={start + 8} />
                <Chip text="Grupos de 4" accent={COLORS.teal} delay={start + 16} />
                <Chip text="Rubrica anexada" accent={COLORS.blue} delay={start + 24} />
              </div>
              <Line w={92} delay={start + 30} />
              <Line w={80} delay={start + 38} />
            </Sheet>
            {[0, 1, 2].map((i) => (
              <Sheet key={i} delay={start + 46 + i * 14} pad={16}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 8,
                      border: `2px solid ${accent}`,
                      background: `${accent}22`,
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <Line w={[70, 58, 64][i]} delay={start + 52 + i * 14} />
                  </div>
                </div>
              </Sheet>
            ))}
          </div>
        )}

        {kind === "quiz" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {[0, 1].map((q) => (
              <Sheet key={q} delay={start + q * 26} pad={20}>
                <div style={{ fontSize: 19, fontWeight: 700, color: "#12203C", marginBottom: 12 }}>
                  Questão {q + 1}
                </div>
                <Line w={88} delay={start + q * 26 + 6} />
                <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 6 }}>
                  {["A", "B", "C", "D"].map((opt, i) => {
                    const correct = i === (q === 0 ? 2 : 1);
                    const d = start + q * 26 + 12 + i * 6;
                    const s = useReveal(d);
                    const mark = useReveal(start + q * 26 + 46);
                    return (
                      <div
                        key={opt}
                        style={{
                          opacity: s,
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "8px 12px",
                          borderRadius: 10,
                          border: `1.5px solid ${correct && mark > 0.4 ? COLORS.teal : "#E1E8F4"}`,
                          background: correct && mark > 0.4 ? `${COLORS.teal}1F` : "#FBFCFE",
                        }}
                      >
                        <div
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: 999,
                            background: correct && mark > 0.4 ? COLORS.teal : "#E4EAF5",
                            color: "#0B1730",
                            fontSize: 13,
                            fontWeight: 800,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {opt}
                        </div>
                        <div
                          style={{
                            flex: 1,
                            height: 8,
                            borderRadius: 999,
                            background: "#C3CFE3",
                            maxWidth: `${[74, 62, 80, 56][i]}%`,
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </Sheet>
            ))}
          </div>
        )}

        {kind === "exam" && (
          <div style={{ display: "grid", gridTemplateColumns: "1.15fr 0.85fr", gap: 16 }}>
            <Sheet delay={start} pad={22}>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                {["A", "B", "C", "D"].map((v, i) => (
                  <Chip key={v} text={`Versão ${v}`} accent={accent} delay={start + 6 + i * 8} />
                ))}
              </div>
              <Line w={70} delay={start + 30} strong />
              <Line w={94} delay={start + 38} />
              <Line w={86} delay={start + 46} />
              <Line w={64} delay={start + 54} />
              <Line w={90} delay={start + 62} />
            </Sheet>
            <Sheet delay={start + 20} pad={20}>
              <div style={{ fontSize: 17, fontWeight: 700, color: "#12203C", marginBottom: 12 }}>
                Folha de respostas
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[0, 1, 2, 3, 4, 5].map((r) => {
                  const filled = useReveal(start + 40 + r * 9);
                  const chosen = [1, 3, 0, 2, 1, 3][r];
                  return (
                    <div key={r} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 22, fontSize: 14, color: "#7A8AA8", fontWeight: 700 }}>
                        {r + 1}
                      </div>
                      {[0, 1, 2, 3].map((c) => (
                        <div
                          key={c}
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: 999,
                            border: "2px solid #B9C6DD",
                            background:
                              c === chosen && filled > 0.5 ? "#12203C" : "transparent",
                          }}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </Sheet>
          </div>
        )}
      </div>
    </div>
  );
};