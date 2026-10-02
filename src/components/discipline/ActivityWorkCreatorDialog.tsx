import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  listAIGenerations,
  getAIGeneration,
  generateActivitySyllabusFromPlan,
  generateCaseStudyFromPlan,
  deleteAIGeneration,
} from "@/backend/ai-assistant.functions";
import { saveActivity } from "@/backend/activities.functions";
import { saveAcademicWork } from "@/backend/works.functions";
import { getDisciplineHeader } from "@/backend/disciplines.functions";
import { listDiaryAssessments } from "@/backend/submissions.functions";
import { listMyCatalogItems } from "@/backend/catalog.functions";
import { useServerFn } from "@tanstack/react-start";
import { saveCalendarEvent } from "@/backend/calendar.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, Library, Sparkles, GraduationCap, ClipboardList, Upload, FileText, X, CheckCircle2, LayoutTemplate, Check } from "lucide-react";
import { ModalLancamentoNotaDiario } from "@/components/diary/ModalLancamentoNotaDiario";
import { ActivitySyllabusDraftReview } from "./ActivitySyllabusDraftReview";
import { toast } from "sonner";
import { suggestWorkThemes } from "@/backend/theme-suggestions.functions";
import {
  getLessonPlanLinkedItems,
  type LessonPlanLinkedItemsPayload,
  type LessonPlanLinkedWork,
} from "@/backend/lesson-plan-themes.functions";
import { extractSyllabusText } from "@/lib/syllabus-extract";
import {
  ACTIVITY_RUBRICS,
  WORK_RUBRICS,
  ACTIVITY_SUBTYPE_LABELS,
  WORK_SUBTYPE_LABELS,
  templateToRubric,
} from "@/lib/rubric-library";
import { RubricLibraryDialog, type RubricSelection } from "./RubricLibraryDialog";
import { withDocumentHeaderMetadata } from "@/lib/document-header";
import { AILoadingOverlay } from "@/components/AILoadingOverlay";
import { extractDiaryAssessmentOptions } from "@/lib/diary-assessments";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Kind = "activity" | "work";
type Crit = { id: string; name: string; description?: string; weight: number; max_score: number };

const ACTIVITY_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "seminario", label: "Seminários" },
  { value: "debate", label: "Debates" },
  { value: "visita_tecnica", label: "Visitas Técnicas" },
  { value: "case_study", label: "Estudos de Caso" },
  { value: "aula_pratica", label: "Aulas Práticas" },
  { value: "workshop", label: "Workshops" },
  { value: "redacao", label: "Redação" },
  { value: "free_activity", label: "Outros" },
];
const WORK_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "tcc", label: "Trabalho de Conclusão de Curso (TCC)" },
  { value: "artigo_cientifico", label: "Artigo Científico" },
  { value: "revisao_literatura", label: "Revisão de Literatura (ou Sistemática)" },
  { value: "estudo_caso_academico", label: "Estudo de Caso" },
  { value: "projeto_intervencao", label: "Projeto de Intervenção" },
  { value: "relatorio_pesquisa", label: "Relatório de Pesquisa" },
  { value: "resumo_expandido", label: "Resumo Expandido" },
  { value: "poster_cientifico", label: "Pôster Científico" },
  { value: "tema_predefinido", label: "Trabalho Acadêmico / Tema Pré-definido pelo Professor" },
];

const DEFAULT_ACTIVITY_SUBTYPE = "seminario";
const DEFAULT_WORK_SUBTYPE = "tcc";

function MarkdownView({ children }: { children: string }) {
  const text = (children ?? "").replace(/\\n/g, "\n").replace(/\\r\\n/g, "\n");
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none [&_h1]:mt-2 [&_h1]:mb-3 [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:mt-3 [&_h3]:mb-1.5 [&_p]:my-2 [&_p]:leading-relaxed [&_ul]:my-2 [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:pl-5 [&_li]:my-1 [&_li]:leading-relaxed [&_strong]:font-semibold">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

function looksLikeMarkdown(text: string | null | undefined): boolean {
  if (!text) return false;
  return /(^|\n)\s*(#{1,6}\s|\-\s|\*\s|\d+\.\s|>\s|\|.+\|)/.test(text) || /\*\*[^*]+\*\*/.test(text);
}

interface GenItem {
  id: string;
  title: string;
  created_at: string;
}

function parsePlanModulesWithLessons(md: string): Array<{ module: string; lessons: string[] }> {
  const lines = md.split(/\r?\n/);
  const moduleRe = /^#{1,4}\s*(M[óo]dulo\s+\d+[^\n]*?)\s*$/i;
  const aulaHeadRe = /^#{2,6}\s*(Aula\s+\d+[^\n]*?)\s*$/i;
  const aulaRowRe = /^\|\s*(\d+)\s*\|\s*[^|]*\|\s*([^|]+?)\s*\|/;
  const result: Array<{ module: string; lessons: string[] }> = [];
  const byKey = new Map<string, { module: string; lessons: string[] }>();
  let current: { module: string; lessons: string[] } | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    const mm = line.match(moduleRe);
    if (mm) {
      const t = (mm[1] ?? "").trim().replace(/\s+/g, " ");
      const key = t.toLowerCase();
      let mod = byKey.get(key);
      if (!mod) {
        mod = { module: t, lessons: [] };
        byKey.set(key, mod);
        result.push(mod);
      }
      current = mod;
      continue;
    }
    if (!current) continue;
    const ah = line.match(aulaHeadRe);
    if (ah) {
      const t = (ah[1] ?? "").trim().replace(/\s+/g, " ");
      if (t && !current.lessons.some((l) => l.toLowerCase() === t.toLowerCase())) current.lessons.push(t);
      continue;
    }
    const ar = line.match(aulaRowRe);
    if (ar) {
      const num = ar[1];
      let tema = (ar[2] ?? "").trim();
      if (!tema || /^-+$/.test(tema) || /^tema/i.test(tema)) continue;
      tema = tema.replace(/<br\s*\/?>/gi, " / ").replace(/\s+/g, " ");
      const lessonName = `Aula ${num}: ${tema}`;
      if (!current.lessons.some((l) => l.toLowerCase() === lessonName.toLowerCase())) current.lessons.push(lessonName);
    }
  }
  return result;
}

/**
 * Extrai o "Banco de Temas Sugeridos" do Plano de Aula, ex.:
 *   **Estudo de Caso 1:** tema  →  { label: "Estudo de Caso 1", theme: "tema" }
 */
function parseSuggestedThemes(md: string): Array<{ label: string; theme: string }> {
  const lines = md.split(/\r?\n/);
  const out: Array<{ label: string; theme: string }> = [];
  let inSection = false;
  const sectionHeadRe = /^#{2,4}\s*Banco de Temas Sugeridos/i;
  const otherHeadRe = /^#{1,4}\s+/;
  const itemRe = /^\s*[-*•]?\s*\*\*\s*([^*:]+?)\s*:?\s*\*\*\s*:?\s*(.+?)\s*$/;
  for (const raw of lines) {
    const line = raw.trim();
    if (!inSection) {
      if (sectionHeadRe.test(line)) inSection = true;
      continue;
    }
    if (otherHeadRe.test(line) && !sectionHeadRe.test(line)) break;
    const m = line.match(itemRe);
    if (m) {
      const label = m[1].trim().replace(/\s+/g, " ");
      const theme = m[2].trim().replace(/\s+/g, " ");
      if (theme && theme.length > 2) out.push({ label, theme });
    }
  }
  return out;
}

/**
 * Extrai temas do bloco "Atividades Extras" do Plano de Aula. Aceita bullets
 * simples (`- Seminário sobre X`) ou linhas com `**Rótulo:** tema`.
 */
function parseSuggestedExtraActivities(md: string): Array<{ label: string; theme: string }> {
  const lines = md.split(/\r?\n/);
  const out: Array<{ label: string; theme: string }> = [];
  const sectionHeadRe = /^#{2,4}\s*Atividades\s+Extras\b/i;
  const otherHeadRe = /^#{1,4}\s+/;
  const boldItemRe = /^\s*[-*•]?\s*\*\*\s*([^*:]+?)\s*:?\s*\*\*\s*:?\s*(.+?)\s*$/;
  const bulletRe = /^\s*[-*•]\s+(.+?)\s*$/;
  let inSection = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!inSection) {
      if (sectionHeadRe.test(line)) inSection = true;
      continue;
    }
    if (otherHeadRe.test(line) && !sectionHeadRe.test(line)) break;
    const b = line.match(boldItemRe);
    if (b) {
      const label = b[1].trim().replace(/\s+/g, " ");
      const theme = b[2].trim().replace(/\s+/g, " ");
      if (theme && theme.length > 2) out.push({ label, theme });
      continue;
    }
    const bu = line.match(bulletRe);
    if (bu) {
      const text = bu[1].replace(/[*_`]+/g, "").trim().replace(/\s+/g, " ");
      if (text.length > 3) out.push({ label: "Atividade extra", theme: text });
    }
  }
  return out;
}

function rubricFor(kind: Kind, subtype: string): Crit[] {
  const presets = kind === "activity" ? ACTIVITY_RUBRICS : WORK_RUBRICS;
  const tpl = presets[subtype] ?? (kind === "activity" ? ACTIVITY_RUBRICS.free_activity : WORK_RUBRICS.tema_predefinido);
  return tpl ? templateToRubric(tpl) : [];
}

/** Tema clicável extraído do plano (atividade/estudo de caso). */
type PlanChip = {
  key: string;
  label: string;
  theme: string;
  instructions?: string;
  subtype?: string;
  source: "activity" | "bank";
};

const normTitle = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Mapeia o tipo textual da atividade extra do plano para o subtipo do modal. */
function extraTypeToSubtype(tipo: string): string {
  const t = tipo.toLowerCase();
  if (/semin|apresenta/.test(t)) return "seminario";
  if (/debate|mesa/.test(t)) return "debate";
  if (/visita/.test(t)) return "visita_tecnica";
  if (/pr[áa]tica|laborat/.test(t)) return "aula_pratica";
  if (/workshop|oficina/.test(t)) return "workshop";
  if (/caso/.test(t)) return "case_study";
  if (/reda|ensaio/.test(t)) return "redacao";
  return "free_activity";
}

/**
 * Une as atividades já gravadas em `activities` para o plano com os temas do
 * Banco de Temas (estudos de caso + atividades extras), sem duplicar títulos.
 */
function buildPlanChips(linked: LessonPlanLinkedItemsPayload | null): PlanChip[] {
  if (!linked) return [];
  const out: PlanChip[] = [];
  const seen = new Set<string>();
  const push = (chip: PlanChip) => {
    const k = normTitle(chip.theme);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(chip);
  };
  for (const a of linked.activities) {
    push({
      key: `act-${a.id}`,
      label: ACTIVITY_SUBTYPE_LABELS[a.subtype] ?? (a.subtype === "case_study" ? "Estudo de Caso" : "Atividade"),
      theme: a.title,
      instructions: a.instructions,
      subtype: a.subtype,
      source: "activity",
    });
  }
  linked.bank.estudos_de_caso_detalhe.forEach((c, i) => {
    const mod = c.modulo ? (c.modulo_titulo || `Módulo ${c.modulo}`) : "";
    push({
      key: `case-${i}`,
      label: mod ? `Estudo de Caso — ${mod}` : "Estudo de Caso",
      theme: c.tema,
      instructions: [
        `Estudo de caso previsto no Plano de Aula${mod ? ` — ${mod}` : ""}.`,
        `Tema: ${c.tema}`,
        "Analise o caso apresentado, levante hipóteses, justifique a interpretação dos achados e proponha a conduta adequada com base no conteúdo do módulo.",
      ].join("\n\n"),
      subtype: "case_study",
      source: "bank",
    });
  });
  linked.bank.atividades_extras.forEach((a, i) => {
    const mod = a.modulo ? (a.modulo_titulo || `Módulo ${a.modulo}`) : "";
    push({
      key: `extra-${i}`,
      label: [a.tipo || "Atividade extra", mod].filter(Boolean).join(" — "),
      theme: a.titulo,
      instructions: [`${a.tipo || "Atividade complementar"} prevista no Plano de Aula${mod ? ` — ${mod}` : ""}.`, a.descricao]
        .filter(Boolean)
        .join("\n\n"),
      subtype: extraTypeToSubtype(a.tipo),
      source: "bank",
    });
  });
  return out;
}

export function ActivityWorkCreatorDialog({
  disciplineId,
  onClose,
  onDone,
}: {
  disciplineId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<Kind>("activity");
  const [title, setTitle] = useState("");
  const [subtype, setSubtype] = useState<string>(DEFAULT_ACTIVITY_SUBTYPE);
  const [instructions, setInstructions] = useState("");
  const [formula, setFormula] = useState<"weighted_average" | "simple_average">("weighted_average");
  const [rubric, setRubric] = useState<Crit[]>(() => rubricFor("activity", DEFAULT_ACTIVITY_SUBTYPE));
  const [rubricTouched, setRubricTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showLib, setShowLib] = useState(false);

  const pad = (n: number) => String(n).padStart(2, "0");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("23:59");
  const [lateToleranceDate, setLateToleranceDate] = useState("");
  const [lateToleranceTime, setLateToleranceTime] = useState("23:59");
  const [latePenaltyType, setLatePenaltyType] = useState<"percentage" | "fixed">("percentage");
  const [includeInCalendar, setIncludeInCalendar] = useState(true);
  const [headerValues, setHeaderValues] = useState({
    institution_name: "",
    course_name: "",
    discipline_name: "",
    teacher_name: "",
  });
  const [deliveryType, setDeliveryType] = useState<"individual" | "group">("individual");
  const [maxGroupSize, setMaxGroupSize] = useState<number>(2);
  const [allowLate, setAllowLate] = useState<boolean>(true);
  const [latePenalty, setLatePenalty] = useState<number>(0.5);
  const [diaryAssessmentId, setDiaryAssessmentId] = useState<string>("");
  const [diaryOptions, setDiaryOptions] = useState<Array<{ id: string; name: string }>>([]);

  // AI block
  const [aiOpen, setAiOpen] = useState(false);
  const [plans, setPlans] = useState<GenItem[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [planStructure, setPlanStructure] = useState<Array<{ module: string; lessons: string[] }>>([]);
  const [suggestedThemes, setSuggestedThemes] = useState<Array<{ label: string; theme: string }>>([]);
  const [suggestedExtras, setSuggestedExtras] = useState<Array<{ label: string; theme: string }>>([]);
  // Itens estruturados do plano selecionado (atividades/estudos de caso e trabalho).
  const [planChips, setPlanChips] = useState<PlanChip[]>([]);
  const [planWork, setPlanWork] = useState<LessonPlanLinkedWork | null>(null);
  const [appliedChipKey, setAppliedChipKey] = useState<string | null>(null);
  const [catalogThemes, setCatalogThemes] = useState<Array<{ label: string; theme: string }>>([]);
  const loadCatalogThemes = useServerFn(listMyCatalogItems);
  const [loadingModules, setLoadingModules] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState("");
  const [customTopic, setCustomTopic] = useState("");
  const [extra, setExtra] = useState("");
  const [generating, setGenerating] = useState(false);
  // Tracks the last AI-generated syllabus id created inside this dialog.
  // If the user regenerates (e.g. switched subtype after a first attempt),
  // we delete the previous one to avoid an orphan "Ementa — <tipo antigo>"
  // showing up in Atividades/Trabalhos.
  const [lastGenId, setLastGenId] = useState<string | null>(null);

  // Anexar PDF/DOCX com as instruções (alternativa a "Gerar com IA")
  const instructionsFileRef = useRef<HTMLInputElement | null>(null);
  const [instructionsFile, setInstructionsFile] = useState<File | null>(null);
  const [extractingInstructions, setExtractingInstructions] = useState(false);
  const [releaseModal, setReleaseModal] = useState<{ open: boolean; score: number } | null>(null);
  const [showDraftReview, setShowDraftReview] = useState(false);

  const typeOptions = kind === "activity" ? ACTIVITY_TYPE_OPTIONS : WORK_TYPE_OPTIONS;
  const isCaseStudy =
    (kind === "activity" && subtype === "case_study") ||
    (kind === "work" && subtype === "estudo_caso_academico");

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await loadCatalogThemes({ data: { kind: "research_theme" } });
        if (!cancel) {
          setCatalogThemes(
            (res.items ?? []).map((it: { label: string; description: string | null }) => ({
              label: it.label,
              theme: it.description?.trim() || it.label,
            })),
          );
        }
      } catch {
        /* itens do catálogo são opcionais */
      }
    })();
    return () => {
      cancel = true;
    };
  }, [loadCatalogThemes]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await listDiaryAssessments({ data: { discipline_id: disciplineId } });
        if (!cancel) {
          const options = extractDiaryAssessmentOptions(res);
          setDiaryOptions(options.map((option) => ({ id: option.id, name: option.name })));
          setDiaryAssessmentId((current) =>
            current && !options.some((option) => option.id === current) ? "" : current,
          );
        }
      } catch {
        /* noop */
      }
    })();
    return () => {
      cancel = true;
    };
  }, [disciplineId]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const h = await getDisciplineHeader({ data: { discipline_id: disciplineId } });
        if (!cancel && h)
          setHeaderValues({
            institution_name: h.institution_name ?? "",
            course_name: h.course_name ?? "",
            discipline_name: h.discipline_name ?? "",
            teacher_name: h.teacher_name ?? "",
          });
      } catch {
        /* noop */
      }
    })();
    return () => {
      cancel = true;
    };
  }, [disciplineId]);

  const onKindChange = (k: Kind) => {
    setKind(k);
    const st = k === "activity" ? DEFAULT_ACTIVITY_SUBTYPE : DEFAULT_WORK_SUBTYPE;
    setSubtype(st);
    if (!rubricTouched) setRubric(rubricFor(k, st));
  };

  const onSubtypeChange = (val: string) => {
    setSubtype(val);
    if (!rubricTouched) setRubric(rubricFor(kind, val));
  };

  const handleAllowLateChange = (checked: boolean) => {
    setAllowLate(checked);
    if (!checked) setLatePenalty(0);
  };

  const applyTemplate = () => {
    setRubric(rubricFor(kind, subtype));
    setRubricTouched(false);
    toast.success("Rubrica sugerida aplicada");
  };

  const loadPlans = useCallback(async () => {
    setLoadingPlans(true);
    try {
      const res = await listAIGenerations({
        data: { discipline_id: disciplineId, tool: "lesson_plan", limit: 50 },
      });
      const list = Array.isArray(res?.items) ? (res.items as GenItem[]) : [];
      setPlans(list.map((p) => ({ id: p.id, title: p.title, created_at: p.created_at })));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar planos de aula");
    } finally {
      setLoadingPlans(false);
    }
  }, [disciplineId]);

  const toggleAi = () => {
    const next = !aiOpen;
    setAiOpen(next);
    if (next && plans.length === 0) loadPlans();
  };

  useEffect(() => {
    if (!selectedPlanId) {
      setPlanStructure([]);
      setSuggestedThemes([]);
      setSuggestedExtras([]);
      setPlanChips([]);
      setPlanWork(null);
      setSelectedTopic("");
      setCustomTopic("");
      return;
    }
    let cancel = false;
    setLoadingModules(true);
    (async () => {
      try {
        const [res, linked] = await Promise.all([
          getAIGeneration({ data: { id: selectedPlanId } }),
          getLessonPlanLinkedItems({ data: { disciplineId, planId: selectedPlanId } }).catch(() => null),
        ]);
        const result = (res as { result?: unknown })?.result;
        const md = typeof result === "string" ? result : JSON.stringify(result ?? "");
        const structure = parsePlanModulesWithLessons(md);

        // Dados estruturados do plano (tabelas finais + banco de temas) com
        // fallback para o parser de Markdown de planos antigos.
        const chips = buildPlanChips(linked);
        const work = linked?.work ?? null;
        const themes = work?.tema
          ? [{ label: "Tema central do plano", theme: work.tema }]
          : parseSuggestedThemes(md);
        const extras = chips.length
          ? chips.map((c) => ({ label: c.label, theme: c.theme }))
          : parseSuggestedExtraActivities(md);

        if (!cancel) {
          setPlanStructure(structure);
          setSuggestedThemes(themes);
          setSuggestedExtras(extras);
          setPlanChips(chips);
          setPlanWork(work);
          const firstTopic = themes[0]?.theme ?? extras[0]?.theme ?? "__custom__";
          setSelectedTopic(firstTopic);
        }
      } catch {
        if (!cancel) {
          setPlanStructure([]);
          setSuggestedThemes([]);
          setSuggestedExtras([]);
          setPlanChips([]);
          setPlanWork(null);
          setSelectedTopic("__custom__");
        }
      } finally {
        if (!cancel) setLoadingModules(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [selectedPlanId, disciplineId]);

  /** Preenche título, tema, tipo e instruções a partir de um item do plano. */
  const applyPlanChip = (chip: PlanChip) => {
    setSelectedTopic("__custom__");
    setCustomTopic(chip.theme);
    setTitle(chip.theme.slice(0, 160));
    if (chip.instructions) setInstructions(chip.instructions);
    if (chip.subtype && typeOptions.some((o) => o.value === chip.subtype)) {
      setSubtype(chip.subtype);
      if (!rubricTouched) setRubric(rubricFor(kind, chip.subtype));
    }
    setAppliedChipKey(chip.key);
  };

  // Aba "Trabalho Acadêmico": ao escolher um plano, o Tema central, o tipo e
  // as instruções (objetivos + critérios) são preenchidos automaticamente.
  useEffect(() => {
    if (kind !== "work" || !planWork?.tema) return;
    setSelectedTopic(planWork.tema);
    setCustomTopic(planWork.tema);
    setTitle(planWork.tema.slice(0, 160));
    if (planWork.instructions) setInstructions(planWork.instructions);
    if (planWork.subtype && WORK_TYPE_OPTIONS.some((o) => o.value === planWork.subtype)) {
      setSubtype(planWork.subtype);
      if (!rubricTouched) setRubric(rubricFor("work", planWork.subtype));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, planWork]);

  const generate = async () => {
    const topic =
      selectedTopic === "__custom__" || !selectedTopic ? customTopic.trim() : selectedTopic.trim();
    if (topic.length < 2) {
      toast.error("Informe o tema para a IA gerar o conteúdo");
      return;
    }
    if (!isCaseStudy && !selectedPlanId) {
      toast.error("Selecione um Plano de Aula para gerar a ementa");
      return;
    }
    setGenerating(true);
    try {
      // Discard the previous AI syllabus if the user is regenerating —
      // e.g. they generated with the default subtype (Seminário) and only
      // then switched to "Aula Prática". Without this, both ementas would
      // remain saved in ai_generations and appear in the module list.
      if (lastGenId) {
        try {
          await deleteAIGeneration({ data: { id: lastGenId } });
        } catch {
          /* ignore — best-effort cleanup */
        }
        setLastGenId(null);
      }
      const rubricCriteria = rubric
        .filter((c) => c.name.trim())
        .map((c) => ({
          name: c.name.trim(),
          description: c.description?.trim() || undefined,
          weight: Number.isFinite(c.weight) ? c.weight : undefined,
        }));
      const res = isCaseStudy
        ? await generateCaseStudyFromPlan({
            data: {
              discipline_id: disciplineId,
              lesson_plan_id: selectedPlanId || undefined,
              module_topic: topic,
              extra_context: extra.trim() || undefined,
              rubric_criteria: rubricCriteria,
            },
          })
        : await generateActivitySyllabusFromPlan({
            data: {
              discipline_id: disciplineId,
              lesson_plan_id: selectedPlanId,
              module_topic: topic,
              kind,
              subtype,
              extra_context: extra.trim() || undefined,
              rubric_criteria: rubricCriteria,
            },
          });
      const genId = (res as { id?: string })?.id;
      if (!genId) throw new Error("Resposta inválida da geração");
      setLastGenId(genId);
      const detail = await getAIGeneration({ data: { id: genId } });
      const result = (detail as { result?: unknown })?.result;
      const md = typeof result === "string" ? result : JSON.stringify(result ?? "");
      setInstructions(md);
      const genTitle = (detail as { title?: string })?.title;
      if (genTitle) setTitle((cur) => (cur.trim() ? cur : genTitle.slice(0, 160)));
      if (!rubricTouched) setRubric(rubricFor(kind, subtype));
      setShowDraftReview(true);
      toast.success("Conteúdo gerado pela IA — revise no rascunho");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar com IA");
    } finally {
      setGenerating(false);
    }
  };

  const submit = async (publish: boolean) => {
    if (instructionsFile && !instructions.trim()) {
      toast.error("Extraia o texto do arquivo anexado antes de salvar.");
      return;
    }
    if (!title.trim()) {
      toast.error("Informe o título");
      return;
    }
    if (!instructions.trim()) {
      toast.error("Adicione as instruções ou gere o conteúdo com a IA antes de salvar.");
      return;
    }
    if (!dueDate) {
      toast.error("Informe a data de entrega");
      return;
    }
    if (deliveryType === "group" && maxGroupSize < 2) {
      toast.error("O número máximo por grupo deve ser ao menos 2");
      return;
    }
    if (publish && !diaryAssessmentId) {
      toast.error("Selecione o campo do diário para lançar a nota antes de publicar.");
      return;
    }
    await onSave(instructions, publish ? "published" : "draft");
  };

  const onSave = async (contentToSave: string, status: "published" | "draft") => {
    const publish = status === "published";
    setSubmitting(true);
    const isoDueAt = dueDate ? new Date(`${dueDate}T${dueTime || "23:59"}:00`).toISOString() : undefined;
    const isoLateTolerance = allowLate && lateToleranceDate ? new Date(`${lateToleranceDate}T${lateToleranceTime || "23:59"}:00`).toISOString() : undefined;

    try {
      let calendarEventId: string | undefined;
      if (publish && includeInCalendar && isoDueAt) {
        try {
          const { id } = await saveCalendarEvent({
            data: {
              discipline_id: disciplineId,
              title: `${kind === "activity" ? "Atividade" : "Trabalho"}: ${title.trim()}`,
              description: instructions.trim().slice(0, 500) || undefined,
              event_date: isoDueAt,
              event_type: kind === "activity" ? "activity" : "work",
            },
          });
          calendarEventId = id;
        } catch (calError) {
          console.error("Erro ao integrar no calendário:", calError);
          // Prossegue mesmo se falhar o calendário
        }
      }

      const finalInstructions = isCaseStudy
        ? contentToSave.trim()
        : withDocumentHeaderMetadata(contentToSave.trim(), headerValues);

      if (kind === "activity") {
        await saveActivity({
          data: {
            discipline_id: disciplineId,
            title: title.trim(),
            subtype: subtype as never,
            instructions: finalInstructions || undefined,
            rubric,
            grading_formula: formula,
            allow_attachments: true,
            max_attachments: 1,
            due_at: isoDueAt,
            due_time: dueTime,
            late_tolerance_date: isoLateTolerance,
            late_tolerance_time: lateToleranceTime,
            late_penalty_type: latePenaltyType,
            delivery_type: deliveryType,
            max_group_size: deliveryType === "group" ? maxGroupSize : undefined,
            allow_late: allowLate,
            late_penalty_per_day: allowLate ? latePenalty : undefined,
            diary_assessment_id: diaryAssessmentId || undefined,
            publish,
          },
        });
      } else {
        await saveAcademicWork({
          data: {
            discipline_id: disciplineId,
            title: title.trim(),
            subtype: subtype as never,
            grading_formula: formula,
            instructions: isCaseStudy
              ? contentToSave.trim()
              : withDocumentHeaderMetadata(contentToSave.trim(), {
                  ...headerValues,
                  theme: title.trim(),
                }) || undefined,
            rubric,
            due_at: isoDueAt,
            due_time: dueTime,
            late_tolerance_date: isoLateTolerance,
            late_tolerance_time: lateToleranceTime,
            late_penalty_type: latePenaltyType,
            delivery_type: deliveryType,
            max_group_size: deliveryType === "group" ? maxGroupSize : undefined,
            allow_late: allowLate,
            late_penalty_per_day: allowLate ? latePenalty : undefined,
            diary_assessment_id: diaryAssessmentId || undefined,
            publish,
            structure_config: {
              sections: ["Introdução", "Desenvolvimento", "Conclusão", "Referências"],
            },
            format_config: { font: "Times New Roman 12", spacing: "1.5", margins: "3-2-3-2 cm" },
            cover_config: { include: true },
          },
        });
      }
      toast.success(
        publish
          ? kind === "activity"
            ? "Atividade publicada"
            : "Trabalho publicado"
          : "Rascunho salvo",
      );
      setLastGenId(null);
      handlePostRelease();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePostRelease = () => {
    // Apenas fecha e encerra o fluxo para Atividades Extras / Estudos de Caso.
    // O modal de lançamento de nota é exclusivo para a correção de submissões.
    onDone();
  };

  // If the user closes the dialog after generating an ementa but without
  // saving/publishing, discard that AI-generated syllabus so it doesn't
  // stay as an orphan record listed in Atividades/Trabalhos.
  const handleClose = () => {
    if (lastGenId) {
      deleteAIGeneration({ data: { id: lastGenId } }).catch(() => null);
    }
    setLastGenId(null);
    onClose();
  };

  return (
    <>
      <AILoadingOverlay open={generating} onCancel={() => setGenerating(false)} />
      <Dialog open onOpenChange={(o) => !o && handleClose()}>
        <DialogContent className={`${showDraftReview ? 'max-w-4xl' : 'max-w-2xl'} max-h-[92vh] overflow-y-auto transition-all duration-300`}>
          <DialogHeader>
            <DialogTitle>Criar Atividade / Trabalho Acadêmico</DialogTitle>
            <DialogDescription>
              Monte a atividade extra ou o trabalho acadêmico e publique direto aos alunos. Use a IA
              (opcional) para gerar a ementa ou o estudo de caso a partir de um Plano de Aula.
            </DialogDescription>
          </DialogHeader>

          {showDraftReview ? (
            <ActivitySyllabusDraftReview
              title={isCaseStudy ? `Estudo de Caso: ${title}` : title}
              instructions={instructions}
              onApprove={async (final) => {
                await onSave(final, "published");
              }}
              onCancel={() => setShowDraftReview(false)}
              isSubmitting={submitting}
            />
          ) : (
            <div className="space-y-4">
            {/* Destination */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onKindChange("activity")}
                className={`flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition ${
                  kind === "activity"
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "hover:bg-muted/50"
                }`}
              >
                <ClipboardList className="h-5 w-5 text-primary shrink-0" />
                <div>
                  <div className="font-medium">Atividade Extra</div>
                  <div className="text-xs text-muted-foreground">Redação, seminário, estudo de caso…</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => onKindChange("work")}
                className={`flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition ${
                  kind === "work"
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "hover:bg-muted/50"
                }`}
              >
                <GraduationCap className="h-5 w-5 text-primary shrink-0" />
                <div>
                  <div className="font-medium">Trabalho Acadêmico</div>
                  <div className="text-xs text-muted-foreground">Artigo, TCC, relatório, projeto…</div>
                </div>
              </button>
            </div>

            {/* AI block */}
            <div className="rounded-lg border">
              <button
                type="button"
                onClick={toggleAi}
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium"
              >
                <span className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" /> Gerar com IA (opcional)
                </span>
                <span className="text-xs text-muted-foreground">{aiOpen ? "Ocultar" : "Mostrar"}</span>
              </button>
              {aiOpen && (
                <div className="space-y-3 border-t p-3">
                  <div className="space-y-1.5">
                    <Label>
                      Plano de Aula {isCaseStudy ? "(opcional)" : <span className="text-destructive">*</span>}
                    </Label>
                    {loadingPlans ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Carregando planos...
                      </div>
                    ) : (
                      <select
                        className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                        value={selectedPlanId}
                        onChange={(e) => setSelectedPlanId(e.target.value)}
                      >
                        <option value="">— Selecione um plano de aula —</option>
                        {plans.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.title}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label>
                      Tema <span className="text-destructive">*</span>
                    </Label>
                    {selectedPlanId && loadingModules ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Lendo temas sugeridos...
                      </div>
                    ) : (
                      <>
                        {kind === "activity" && selectedPlanId && planChips.length > 0 && (
                          <div className="rounded-md border border-primary/20 bg-primary/5 p-2 space-y-1.5">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-primary">
                              Temas previstos no plano ({planChips.length}) — clique para preencher
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {planChips.map((chip) => {
                                const active = appliedChipKey === chip.key;
                                return (
                                  <button
                                    key={chip.key}
                                    type="button"
                                    onClick={() => applyPlanChip(chip)}
                                    title={chip.label}
                                    className={`max-w-full rounded-full border px-2.5 py-1 text-left text-[11px] leading-snug transition-colors ${
                                      active
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "border-primary/30 bg-background text-foreground hover:bg-primary/10"
                                    }`}
                                  >
                                    <span className="font-semibold">{chip.label}:</span> {chip.theme}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {kind === "work" && selectedPlanId && planWork?.tema && (
                          <p className="text-[11px] text-muted-foreground">
                            Tema central, tipo e instruções preenchidos automaticamente a partir do plano selecionado.
                          </p>
                        )}
                        {(selectedPlanId && (suggestedThemes.length > 0 || suggestedExtras.length > 0)) || catalogThemes.length > 0 ? (
                          <select
                            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                            value={selectedTopic}
                            onChange={(e) => setSelectedTopic(e.target.value)}
                          >
                            {suggestedThemes.length > 0 && (
                              <optgroup label="Trabalhos acadêmicos sugeridos">
                                {suggestedThemes.map((t, i) => (
                                  <option key={`theme-${i}`} value={t.theme}>
                                    {t.label}: {t.theme}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            {suggestedExtras.length > 0 && (
                              <optgroup label="Atividades extras sugeridas">
                                {suggestedExtras.map((t, i) => (
                                  <option key={`extra-${i}`} value={t.theme}>
                                    {t.label}: {t.theme}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            {catalogThemes.length > 0 && (
                              <optgroup label="Temas do catálogo (Admin)">
                                {catalogThemes.map((t, i) => (
                                  <option key={`cat-${i}`} value={t.theme}>
                                    {t.label}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            <option value="__custom__">Outro tema (digitar abaixo)…</option>
                          </select>
                        ) : null}
                        {(selectedTopic === "__custom__" ||
                          !selectedPlanId ||
                          (suggestedThemes.length === 0 && suggestedExtras.length === 0 && catalogThemes.length === 0)) && (
                          <Input
                            value={customTopic}
                            onChange={(e) => setCustomTopic(e.target.value)}
                            placeholder="Digite o tema da atividade (ou selecione um plano acima)"
                          />
                        )}
                      </>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label>Contexto adicional (opcional)</Label>
                    <Textarea
                      rows={2}
                      value={extra}
                      onChange={(e) => setExtra(e.target.value)}
                      placeholder="Ex.: público-alvo, recortes, restrições…"
                    />
                  </div>

                  <Button type="button" onClick={generate} disabled={generating} className="w-full">
                    {generating ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4 mr-2" />
                    )}
                    {isCaseStudy ? "Gerar estudo de caso" : "Gerar ementa"} com IA
                  </Button>
                  <p className="text-[11px] text-muted-foreground">
                    O conteúdo gerado preenche as Instruções abaixo e pode ser editado antes de publicar.
                  </p>
                  <div className="flex justify-center pt-1">
                    <Button 
                      type="button" 
                      variant="link" 
                      size="sm" 
                      className="text-xs text-primary"
                      onClick={async () => {
                        const topic = selectedTopic === "__custom__" || !selectedTopic ? customTopic.trim() : selectedTopic.trim();
                        if (!topic) {
                          toast.error("Informe o tema para sugerir");
                          return;
                        }
                        setGenerating(true);
                        try {
                          const { suggestions: res } = await suggestWorkThemes({ data: { topic } });
                          if (res) {
                            setExtra((prev) => prev ? `${prev}\n\nSugestões de temas:\n${res}` : `Sugestões de temas:\n${res}`);
                            toast.success("Sugestões adicionadas ao contexto");
                          }
                        } catch (e) {
                          toast.error("Erro ao sugerir temas");
                        } finally {
                          setGenerating(false);
                        }
                      }}
                    >
                      <Sparkles className="h-3 w-3 mr-1" /> Sugerir Temas com IA
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* PADRONIZAÇÃO: 1. Título, 2. Vínculo, 3. Descrição/Instruções, 4. Data Limite, 5. Rubrica */}
            <div className="space-y-4 pt-2 border-t">
              <div className="space-y-1.5">
                <Label>1. Título do Trabalho/Caso/Atividade <span className="text-destructive">*</span></Label>
                <Input 
                  value={title} 
                  onChange={(e) => setTitle(e.target.value)} 
                  placeholder="Título da atividade ou trabalho"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>2. Módulo/Vínculo <span className="text-destructive">*</span></Label>
                  <select
                    className="border rounded-md px-2 py-1.5 text-sm w-full h-9"
                    value={subtype}
                    onChange={(e) => onSubtypeChange(e.target.value)}
                  >
                    {typeOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Lançar nota no diário</Label>
                  <select
                    className="border rounded-md px-2 py-1.5 text-sm w-full h-9"
                    value={diaryAssessmentId}
                    onChange={(e) => setDiaryAssessmentId(e.target.value)}
                  >
                    <option value="">Selecione a coluna…</option>
                    {diaryOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>3. Descrição / Instruções detalhadas <span className="text-destructive">*</span></Label>
                <Textarea
                  rows={6}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Descreva a atividade/trabalho ou gere com a IA acima."
                />
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <input
                    ref={instructionsFileRef}
                    type="file"
                    accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      if (!f) return;
                      if (f.size > 10 * 1024 * 1024) {
                        toast.error("Arquivo deve ter no máximo 10 MB");
                        return;
                      }
                      setInstructionsFile(f);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-[11px]"
                    onClick={() => instructionsFileRef.current?.click()}
                  >
                    <Upload className="h-3.5 w-3.5 mr-1.5" />
                    {instructionsFile ? "Trocar arquivo" : "Anexar PDF/Word"}
                  </Button>
                  {instructionsFile && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-8 text-[11px]"
                      disabled={extractingInstructions}
                      onClick={async () => {
                        if (!instructionsFile) return;
                        setExtractingInstructions(true);
                        try {
                          const text = await extractSyllabusText(instructionsFile);
                          if (!text) {
                            toast.error("Nenhum texto encontrado no arquivo");
                            return;
                          }
                          setInstructions((prev) =>
                            prev?.trim() ? `${prev.trim()}\n\n${text}` : text,
                          );
                          toast.success("Texto importado");
                        } catch (err) {
                          toast.error("Falha ao extrair");
                        } finally {
                          setExtractingInstructions(false);
                        }
                      }}
                    >
                      {extractingInstructions ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                      )}
                      Extrair texto
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-4 p-4 bg-muted/30 rounded-lg border">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">4. Data Limite de Entrega <span className="text-destructive">*</span></Label>
                    <Input 
                      type="date" 
                      className="h-9"
                      value={dueDate} 
                      onChange={(e) => setDueDate(e.target.value)} 
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Horário Limite</Label>
                    <Input 
                      type="time" 
                      className="h-9"
                      value={dueTime} 
                      onChange={(e) => setDueTime(e.target.value)} 
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                      <Checkbox checked={allowLate} onCheckedChange={(v) => handleAllowLateChange(v === true)} />
                      Aceitar entrega com atraso
                    </label>
                    <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                      <Checkbox 
                        checked={includeInCalendar} 
                        onCheckedChange={(v) => setIncludeInCalendar(v === true)} 
                      />
                      Integrar no Calendário
                    </label>
                  </div>

                  {allowLate && (
                    <div className="space-y-3 p-3 bg-white/50 rounded border animate-in fade-in slide-in-from-top-1">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-[10px] uppercase font-bold text-muted-foreground">Tolerância Máxima (Data)</Label>
                          <Input 
                            type="date" 
                            className="h-8 text-xs"
                            value={lateToleranceDate} 
                            onChange={(e) => setLateToleranceDate(e.target.value)} 
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-[10px] uppercase font-bold text-muted-foreground">Tolerância Máxima (Hora)</Label>
                          <Input 
                            type="time" 
                            className="h-8 text-xs"
                            value={lateToleranceTime} 
                            onChange={(e) => setLateToleranceTime(e.target.value)} 
                          />
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-4">
                        <div className="flex-1 space-y-1.5">
                          <Label className="text-[10px] uppercase font-bold text-muted-foreground">Tipo de Desconto</Label>
                          <select
                            className="w-full h-8 text-xs border rounded px-2"
                            value={latePenaltyType}
                            onChange={(e) => setLatePenaltyType(e.target.value as "percentage" | "fixed")}
                          >
                            <option value="percentage">Percentual (%)</option>
                            <option value="fixed">Fixo (Pontos)</option>
                          </select>
                        </div>
                        <div className="flex-1 space-y-1.5">
                          <Label className="text-[10px] uppercase font-bold text-muted-foreground">Valor do Desconto / dia</Label>
                          <Input
                            type="number"
                            step="0.1"
                            placeholder="0.5"
                            className="h-8 text-xs"
                            value={latePenalty}
                            onChange={(e) => setLatePenalty(Number(e.target.value))}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="space-y-4 pt-2 border-t">
              <div className="space-y-2 rounded-md border p-3">
                <Label>Cabeçalho editável do documento</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Input
                    placeholder="Instituição"
                    value={headerValues.institution_name}
                    onChange={(e) => setHeaderValues((p) => ({ ...p, institution_name: e.target.value }))}
                  />
                  <Input
                    placeholder="Curso"
                    value={headerValues.course_name}
                    onChange={(e) => setHeaderValues((p) => ({ ...p, course_name: e.target.value }))}
                  />
                  <Input
                    placeholder="Disciplina"
                    value={headerValues.discipline_name}
                    onChange={(e) => setHeaderValues((p) => ({ ...p, discipline_name: e.target.value }))}
                  />
                  <Input
                    placeholder="Professor(a)"
                    value={headerValues.teacher_name}
                    onChange={(e) => setHeaderValues((p) => ({ ...p, teacher_name: e.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-2 rounded-md border p-3">
                <Label>Configurações de entrega</Label>
                <RadioGroup
                  value={deliveryType}
                  onValueChange={(v) => setDeliveryType(v as "individual" | "group")}
                  className="flex gap-6 py-1"
                >
                  <label className="flex items-center gap-2 text-sm cursor-pointer font-medium">
                    <RadioGroupItem value="individual" /> Individual
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer font-medium">
                    <RadioGroupItem value="group" /> Em grupo
                  </label>
                </RadioGroup>
                {deliveryType === "group" && (
                  <div className="pt-1">
                    <Label className="text-xs">Número máximo de alunos por grupo</Label>
                    <Input
                      type="number"
                      min={2}
                      value={maxGroupSize}
                      onChange={(e) => setMaxGroupSize(Math.max(2, Number(e.target.value)))}
                    />
                  </div>
                )}
              </div>

              <div>
                <Label>Fórmula da nota final</Label>
                <select
                  className="border rounded-md px-2 py-1.5 text-sm w-full h-9"
                  value={formula}
                  onChange={(e) => setFormula(e.target.value as "weighted_average" | "simple_average")}
                >
                  <option value="weighted_average">Média ponderada</option>
                  <option value="simple_average">Média simples</option>
                </select>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>5. Critérios de Avaliação / Rubrica <span className="text-destructive">*</span></Label>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" type="button" className="h-7 text-[10px]" onClick={() => setShowLib(true)}>
                      <Library className="h-3 w-3 mr-1" /> Biblioteca
                    </Button>
                    <Button size="sm" variant="ghost" type="button" className="h-7 text-[10px]" onClick={applyTemplate}>
                      Restaurar
                    </Button>
                  </div>
                </div>
                <div className="space-y-2 mt-2">
                  {rubric.map((c, i) => (
                    <div key={c.id} className="border rounded p-2 space-y-2">
                      <div className="flex gap-2 items-center">
                        <Input
                          value={c.name}
                          onChange={(e) => {
                            setRubricTouched(true);
                            setRubric(rubric.map((r, idx) => (idx === i ? { ...r, name: e.target.value } : r)));
                          }}
                          placeholder="Critério"
                        />
                        <Input
                          type="number"
                          className="w-20"
                          value={c.weight}
                          onChange={(e) => {
                            setRubricTouched(true);
                            setRubric(rubric.map((r, idx) => (idx === i ? { ...r, weight: Number(e.target.value) } : r)));
                          }}
                          placeholder="Peso %"
                        />
                        <Input
                          type="number"
                          className="w-20"
                          value={c.max_score}
                          onChange={(e) => {
                            setRubricTouched(true);
                            setRubric(rubric.map((r, idx) => (idx === i ? { ...r, max_score: Number(e.target.value) } : r)));
                          }}
                          placeholder="Máx"
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          onClick={() => {
                            setRubricTouched(true);
                            setRubric(rubric.filter((_, idx) => idx !== i));
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <Textarea
                        rows={2}
                        placeholder="Descrição do critério"
                        value={c.description ?? ""}
                        onChange={(e) => {
                          setRubricTouched(true);
                          setRubric(rubric.map((r, idx) => (idx === i ? { ...r, description: e.target.value } : r)));
                        }}
                      />
                    </div>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setRubricTouched(true);
                      setRubric([...rubric, { id: crypto.randomUUID(), name: "", weight: 0, max_score: 10 }]);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> Critério
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Soma dos pesos: {rubric.reduce((s, c) => s + (c.weight || 0), 0)}%
                  </p>
                </div>
              </div>
              </div>
            </div>
          )}

          {!showDraftReview && (
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={handleClose}>
                Cancelar
              </Button>
              <Button variant="outline" disabled={submitting} onClick={() => submit(false)}>
                Salvar rascunho
              </Button>
              <Button disabled={submitting} onClick={() => submit(true)}>
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Publicar
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      {showLib && (
        <RubricLibraryDialog
          scope={kind}
          onClose={() => setShowLib(false)}
          onSelect={(sel: RubricSelection) => {
            setRubricTouched(true);
            setRubric(sel.criteria);
            setFormula(sel.grading_formula);
            setShowLib(false);
          }}
        />
      )}
      {releaseModal && (
        <ModalLancamentoNotaDiario
          open={releaseModal.open}
          onClose={() => {
            setReleaseModal(null);
            onDone();
          }}
          disciplineId={disciplineId}
          studentId="" 
          studentName="Lançamento Geral (Configuração)"
          obtainedScore={releaseModal.score}
          maxScore={10}
          defaultColumnId={diaryAssessmentId || null}
          activityRef={{
            id: "new",
            type: kind,
            title: title || "Nova Atividade"
          }}
          onSuccess={onDone}
        />
      )}
    </>
  );
}
