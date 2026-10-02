import { AbsoluteFill } from "remotion";
import React from "react";
import { TransitionSeries, springTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { loadFont as loadDisplay } from "@remotion/google-fonts/SpaceGrotesk";
import { loadFont as loadBody } from "@remotion/google-fonts/Manrope";
import { Scene1Intro } from "./scenes/Scene1Intro";
import { Scene2Assistants } from "./scenes/Scene2Assistants";
import { Scene4Flow } from "./scenes/Scene4Flow";
import { Scene5Outro } from "./scenes/Scene5Outro";
import { CreatorShowcase } from "./scenes/CreatorShowcase";
import type { PreviewKind } from "./components/MockPreview";
import { COLORS } from "./theme";

const display = loadDisplay("normal", { weights: ["700"], subsets: ["latin"] }).fontFamily;
const body = loadBody("normal", { weights: ["400", "600", "800"], subsets: ["latin"] }).fontFamily;

const T = (dur: number) => springTiming({ config: { damping: 200 }, durationInFrames: dur });

const SHOWCASES: {
  badge: string;
  headline: string;
  sub: string;
  accent: string;
  cta: string;
  kind: PreviewKind;
  previewTitle: string;
  fields: { label: string; value: string }[];
}[] = [
  {
    badge: "PLANO DE AULA",
    headline: "Da ementa ao plano de aula",
    sub: "Objetivos, etapas e avaliação estruturados em minutos.",
    accent: COLORS.teal,
    cta: "Gerar plano de aula",
    kind: "plan",
    previewTitle: "Módulo 1 — Aula 2 · Plano gerado",
    fields: [
      { label: "DISCIPLINA", value: "Farmacognosia" },
      { label: "TEMA DA AULA", value: "Metabólitos secundários" },
      { label: "CARGA HORÁRIA", value: "2 aulas de 50 min" },
    ],
  },
  {
    badge: "APOSTILAS",
    headline: "Apostila didática completa",
    sub: "Conteúdo do módulo com exemplos, resumos e referências.",
    accent: COLORS.accent,
    cta: "Gerar apostila",
    kind: "doc",
    previewTitle: "Apostila — Módulo 1 · Pré-visualização",
    fields: [
      { label: "BASE", value: "Plano de aula do módulo" },
      { label: "PROFUNDIDADE", value: "Graduação — completa" },
      { label: "FORMATO", value: "DOCX e PDF" },
    ],
  },
  {
    badge: "SLIDES",
    headline: "Aula pronta para projetar",
    sub: "Apresentação no estilo Gamma, exportada em PPTX e PDF.",
    accent: COLORS.blue,
    cta: "Gerar slides",
    kind: "slides",
    previewTitle: "Apresentação — 14 slides",
    fields: [
      { label: "TEMA", value: "Metabólitos secundários" },
      { label: "TEMA VISUAL", value: "Azul acadêmico" },
      { label: "DATA DA AULA", value: "12/09 — agenda" },
    ],
  },
  {
    badge: "ATIVIDADES / TRABALHOS",
    headline: "Atividades e trabalhos acadêmicos",
    sub: "Instruções, grupos, rubrica e prazo publicados de uma vez.",
    accent: COLORS.teal,
    cta: "Publicar atividade",
    kind: "activity",
    previewTitle: "Trabalho acadêmico — publicado para a turma",
    fields: [
      { label: "TIPO", value: "Trabalho em grupo" },
      { label: "TEMA", value: "Plantas medicinais no SUS" },
      { label: "PRAZO", value: "12/09 às 23:59" },
    ],
  },
  {
    badge: "EXERCÍCIOS",
    headline: "Prática com correção comentada",
    sub: "Múltipla escolha, V/F e lacunas — com gabarito automático.",
    accent: COLORS.accent,
    cta: "Gerar lista de exercícios",
    kind: "quiz",
    previewTitle: "Lista gerada — 10 questões com gabarito",
    fields: [
      { label: "MÓDULO", value: "Módulo 1 — Fundamentos" },
      { label: "QUESTÕES", value: "6 múltipla escolha · 4 V/F" },
      { label: "DIFICULDADE", value: "Intermediária" },
    ],
  },
  {
    badge: "AVALIAÇÕES",
    headline: "Provas com leitura por câmera",
    sub: "Versões embaralhadas, folha de respostas e correção por OMR.",
    accent: COLORS.blue,
    cta: "Gerar avaliação",
    kind: "exam",
    previewTitle: "Avaliação — 4 versões + folha de respostas",
    fields: [
      { label: "AVALIAÇÃO", value: "Prova bimestral" },
      { label: "VERSÕES", value: "A, B, C e D" },
      { label: "VALOR TOTAL", value: "10,00 pontos" },
    ],
  },
];

export const MainVideo: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: COLORS.ink, fontFamily: body }}>
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={110}>
        <Scene1Intro display={display} body={body} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={T(20)} />

      <TransitionSeries.Sequence durationInFrames={140}>
        <Scene2Assistants display={display} body={body} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slide({ direction: "from-right" })} timing={T(20)} />

      {SHOWCASES.map((s, i) => (
        <React.Fragment key={s.badge}>
          <TransitionSeries.Sequence durationInFrames={238}>
            <CreatorShowcase display={display} body={body} {...s} />
          </TransitionSeries.Sequence>
          <TransitionSeries.Transition
            presentation={i % 2 === 0 ? slide({ direction: "from-right" }) : fade()}
            timing={T(20)}
          />
        </React.Fragment>
      ))}

      <TransitionSeries.Sequence durationInFrames={150}>
        <Scene4Flow display={display} body={body} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={T(20)} />

      <TransitionSeries.Sequence durationInFrames={150}>
        <Scene5Outro display={display} body={body} />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  </AbsoluteFill>
);