import { z } from "zod";
import { useAuth } from "@/lib/auth-context";
import { cn, sortItemsNumerically } from "@/lib/utils";
import { sanitizeConceptTopic, sanitizeExtractedConcept, sanitizeListTitle, sanitizeTitleList } from "@/lib/text-sanitize";
import {
  Component,
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
  type ChangeEvent,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { SimulSaudeModule } from "./SimulSaudeModule";
import { ClinicalCaseGenerator } from "@/components/simulsaude/ClinicalCaseGenerator";
import { suggestWorkThemes } from "@/backend/theme-suggestions.functions";
import { suggestClinicalCaseTitle } from "@/backend/clinical-theme-suggestions.functions";
import {
  Loader2,
  Sparkles,
  FileDown,
  Presentation,
  Trash2,
  BookOpen,
  ClipboardList,
  FileText,
  Layers,
  FileQuestion,
  Network,
  GraduationCap,
  MessageSquare,
  ScrollText,
  ListChecks,
  Send,
  Upload,
  X,
  Copy,
  Check,
  Plus,
  Pencil,
  Stethoscope,
  Wand2,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { AILoadingOverlay } from "@/components/AILoadingOverlay";
import { BulkDeleteBar } from "@/components/BulkDeleteBar";
import { ActivityWorkCreatorDialog } from "./ActivityWorkCreatorDialog";
import {
  generateAIContent,
  listAIGenerations,
  getAIGeneration,
  deleteAIGeneration,
  chatWithAssistant,
  generateLessonPlan,
  generateApostila,
  generateSlidesFromApostila,
  generateExerciseListFromApostila as rawGenerateExerciseListFromApostila,
  publishExerciseListAsExercise,
  previewExerciseListQuestions,
  generateCaseStudyFromPlan,
  generateActivitySyllabusFromPlan,
  getAssessmentHeader,
  updateAIGenerationContent,
} from "@/backend/ai-assistant.functions";
import { generateAssessmentFromApostila as rawGenerateAssessmentFromApostila } from "@/backend/ai-assistant.functions";
import { exportGenerationDOCX, exportGenerationPDF, exportGenerationPPTX } from "@/backend/ai-export.functions";
import { saveCalendarEvent } from "@/backend/calendar.functions";
import { generateAssessment as rawGenerateStructuredAssessment, exportAssessmentPDF, listAssessmentTargets } from "@/backend/assessments.functions";

const truncateArgs = (args: any) => {
  if (!args || !args.data) return args;
  const data = { ...args.data };
  if (data.topics && Array.isArray(data.topics)) {
    const arrayDeTopicosDaIA = data.topics;
    const safeTopics = arrayDeTopicosDaIA.map((t: any) => String(t).substring(0, 190));
    data.topics = safeTopics;
  }
  if (data.title && typeof data.title === "string") {
    data.title = data.title.substring(0, 500);
  }
  if (data.module_label && typeof data.module_label === "string") {
    data.module_label = data.module_label.substring(0, 190);
  }
  if (data.lesson_title && typeof data.lesson_title === "string") {
    data.lesson_title = data.lesson_title.substring(0, 190);
  }
  return { ...args, data };
};

const generateExerciseListFromApostila = (args: any) => rawGenerateExerciseListFromApostila(truncateArgs(args));
const generateAssessmentFromApostila = (args: any) => rawGenerateAssessmentFromApostila(truncateArgs(args));
const generateStructuredAssessment = (args: any) => rawGenerateStructuredAssessment(truncateArgs(args));
import { listAssessmentHeaderTemplates } from "@/backend/assessment-headers.functions";
import { normalizeAIContent } from "@/lib/ai-content";
import { extractSyllabusText } from "@/lib/syllabus-extract";
import { supabase } from "@/integrations/supabase/client";
import { DispatchToStudentDialog } from "./DispatchToStudentDialog";
import { RubricLibraryDialog, type RubricSelection } from "./RubricLibraryDialog";
import { AssessmentReviewDialog } from "./AssessmentReviewDialog";
import { ACTIVITY_RUBRICS, WORK_RUBRICS, templateToRubric } from "@/lib/rubric-library";
import {
  SLIDE_COLOR_THEMES,
  SLIDE_TEMPLATES,
  type SlideColorThemeKey,
  type SlideTemplateKey,
} from "@/lib/slide-design";

declare global {
  interface Window {
    __estudajaDomMutationGuard?: boolean;
  }
}

function installDomMutationGuard() {
  // Silent guard
  if (
    typeof window === "undefined" ||
    typeof Node === "undefined" ||
    window.__estudajaDomMutationGuard
  ) {
    return;
  }

  window.__estudajaDomMutationGuard = true;
  const nativeInsertBefore = Node.prototype.insertBefore;
  const nativeRemoveChild = Node.prototype.removeChild;

  Node.prototype.insertBefore = function <T extends Node>(
    this: Node,
    newNode: T,
    referenceNode: Node | null,
  ): T {
    if (referenceNode && referenceNode.parentNode !== this) {
      return nativeInsertBefore.call(this, newNode, null) as T;
    }
    return nativeInsertBefore.call(this, newNode, referenceNode) as T;
  };

  Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      return child;
    }
    return nativeRemoveChild.call(this, child) as T;
  };
}

installDomMutationGuard();

type ToolKey =
  | "lesson_plan"
  | "apostila"
  | "slides"
  | "exercise_list"
  | "case_study"
  | "summary"
  | "quiz"
  | "concept_map"
  | "study_guide"
  | "feedback_template"
  | "activity_syllabus"
  | "activity_creator"
  | "simulsaude_creator";

const TOOLS: Array<{
  key: ToolKey;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
  supportsPPTX?: boolean;
}> = [
  {
    key: "simulsaude_creator",
    label: "MÓDULO PRÁTICO",
    description: "Crie casos clínicos e simulações realistas com o SimulSaúde",
    icon: Stethoscope,
    color: "blue",
  },
  {
    key: "activity_creator",
    label: "ATIVIDADES / TRABALHOS",
    description: "Monte e publique atividades extras ou trabalhos acadêmicos — com IA opcional",
    icon: ClipboardList,
    color: "orange",
  },
  {
    key: "lesson_plan",
    label: "PLANO DE AULA",
    description: "Objetivos, materiais, etapas e avaliação",
    icon: BookOpen,
    color: "teal",
  },
  {
    key: "apostila",
    label: "APOSTILAS",
    description: "Gera uma apostila completa a partir de um Plano de Aula",
    icon: BookOpen,
    color: "purple",
  },
  {
    key: "slides",
    label: "SLIDES",
    description: "Apresentação estruturada (PPTX/PDF)",
    icon: Presentation,
    color: "blue",
    supportsPPTX: true,
  },
  {
    key: "exercise_list",
    label: "EXERCÍCIOS",
    description: "Gere exercícios didáticos com gabarito detalhado para suas aulas.",
    icon: ListChecks,
    color: "green",
  },
  {
    key: "quiz",
    label: "AVALIAÇÕES",
    description: "Avaliação completa por módulo/tema, com tipos variados e gabarito",
    icon: FileQuestion,
    color: "green",
  },
];

interface GenItem {
  id: string;
  title: string;
  tool: string;
  created_at: string;
}

type GeneratedContentResponse = { id: string };
type GenerationDetailResponse = { title: string; tool: string; result: unknown; prompt?: unknown };
type ExportResponse = { base64: string; mime: string; filename: string };

export function AIAssistantModule({ disciplineId }: { disciplineId: string }) {
  return (
    <AIAssistantErrorBoundary resetKey={disciplineId}>
      <AIAssistantModuleContent disciplineId={disciplineId} />
    </AIAssistantErrorBoundary>
  );
}

class AIAssistantErrorBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { hasError: boolean; message: string }
> {
  state = { hasError: false, message: "" };

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : "Erro inesperado ao abrir o assistente.",
    };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error("AIAssistantModule crashed", error, errorInfo);
  }

  componentDidUpdate(prevProps: { resetKey: string }) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, message: "" });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="rounded-xl border bg-card p-6 space-y-3"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <div className="flex items-center gap-2 font-semibold">
            <Sparkles className="h-5 w-5 text-primary" /> Assistente de IA
          </div>
          <p className="text-sm text-muted-foreground">
            Não foi possível carregar o assistente agora. O chat da disciplina continua disponível
            ao recarregar o módulo.
          </p>
          {this.state.message && (
            <p className="text-xs text-muted-foreground">Detalhe: {this.state.message}</p>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => this.setState({ hasError: false, message: "" })}
          >
            Tentar novamente
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

function isGenItem(value: unknown): value is GenItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<GenItem>;
  return (
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.tool === "string" &&
    typeof item.created_at === "string"
  );
}

/** Garante que cada select liste apenas documentos do tipo esperado. */
function onlyTool(items: unknown, tool: string): GenItem[] {
  return Array.isArray(items) ? items.filter(isGenItem).filter((d) => d.tool === tool) : [];
}


function hasGeneratedContentId(value: unknown): value is GeneratedContentResponse {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Partial<GeneratedContentResponse>).id === "string"
  );
}

function isGenerationDetail(value: unknown): value is GenerationDetailResponse {
  if (!value || typeof value !== "object") return false;
  const generation = value as Partial<GenerationDetailResponse>;
  return (
    typeof generation.title === "string" &&
    typeof generation.tool === "string" &&
    "result" in generation
  );
}

function isExportResponse(value: unknown): value is ExportResponse {
  if (!value || typeof value !== "object") return false;
  const file = value as Partial<ExportResponse>;
  return (
    typeof file.base64 === "string" &&
    typeof file.mime === "string" &&
    typeof file.filename === "string"
  );
}

/* ============================================================================
 * Criador de Avaliações — UI dialog
 * ============================================================================ */

type AssessmentTypeKey =
  | "multipla_escolha"
  | "discursiva"
  | "verdadeiro_falso"
  | "completar_lacunas"
  | "aplicacao_conceitos"
  | "comparacao_contraste"
  | "calculo"
  | "associacao";

type AssessmentDistribution = Record<AssessmentTypeKey, number>;

type AnswerFormat = "multipla_escolha" | "gabarito_direto";
type FormattableTypeKey = "verdadeiro_falso" | "completar_lacunas" | "calculo" | "associacao";
type AssessmentFormats = Record<FormattableTypeKey, AnswerFormat>;
type AssessmentHeader = { discipline: string; professor: string };
type AssessmentDifficulty = "facil" | "medio" | "dificil" | "superior";
type AssessmentDifficultyCounts = Record<AssessmentDifficulty, number>;
type AssessmentDifficultyByType = Record<AssessmentTypeKey, AssessmentDifficultyCounts>;

const DIFFICULTY_OPTIONS: Array<{ value: AssessmentDifficulty; label: string }> = [
  { value: "facil", label: "Básico" },
  { value: "medio", label: "Intermediário" },
  { value: "dificil", label: "Avançado" },
  { value: "superior", label: "Superior/Universitário" },
];

const DIFFICULTY_LEVELS: AssessmentDifficulty[] = ["facil", "medio", "dificil", "superior"];
const DIFFICULTY_SHORT_LABELS: Record<AssessmentDifficulty, string> = {
  facil: "Básico",
  medio: "Interm.",
  dificil: "Avanç.",
  superior: "Superior",
};

function emptyDifficultyCounts(): AssessmentDifficultyCounts {
  return { facil: 0, medio: 0, dificil: 0, superior: 0 };
}
function sumDifficultyCounts(c: AssessmentDifficultyCounts): number {
  return c.facil + c.medio + c.dificil + c.superior;
}

const QUALITY_RULE_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "evitar_repeticao", label: "Evitar repetição" },
  { id: "distratores_plausiveis", label: "Distratores plausíveis" },
  { id: "clareza_precisao", label: "Clareza e precisão" },
  { id: "contexto_especifico", label: "Contexto específico" },
  { id: "estrutura_vf", label: "Estrutura V/F" },
  { id: "estrutura_lacunas", label: "Estrutura Lacunas" },
];

function cleanAssessmentHeaderValue(value: string | undefined) {
  const cleaned = (value ?? "").replace(/^[-–—]+$/, "").trim();
  return cleaned === "—" ? "" : cleaned;
}

function expandedAssessmentQuestionCount(dist: AssessmentDistribution, formats: AssessmentFormats) {
  return ASSESSMENT_TYPES.reduce((acc, type) => {
    const quantity = dist[type.key] || 0;
    const expandsToFive =
      (type.key === "verdadeiro_falso" || type.key === "completar_lacunas" || type.key === "associacao") &&
      formats[type.key] === "multipla_escolha";
    return acc + quantity * (expandsToFive ? 5 : 1);
  }, 0);
}

const FORMATTABLE_TYPES: FormattableTypeKey[] = [
  "verdadeiro_falso",
  "completar_lacunas",
  "calculo",
  "associacao",
];

const ASSESSMENT_TYPES: Array<{ key: AssessmentTypeKey; label: string }> = [
  { key: "multipla_escolha", label: "Múltipla Escolha" },
  { key: "discursiva", label: "Discursiva" },
  { key: "verdadeiro_falso", label: "V/F (bloco de 5)" },
  { key: "completar_lacunas", label: "Completar Lacunas (bloco de 5)" },
  { key: "aplicacao_conceitos", label: "Aplicação de Conceitos" },
  { key: "comparacao_contraste", label: "Comparação e Contraste" },
  { key: "calculo", label: "Cálculo" },
  { key: "associacao", label: "Associação (bloco de 5)" },
];

const ZERO_ASSESSMENT_DIST: AssessmentDistribution = {
  multipla_escolha: 0,
  discursiva: 0,
  verdadeiro_falso: 0,
  completar_lacunas: 0,
  aplicacao_conceitos: 0,
  comparacao_contraste: 0,
  calculo: 0,
  associacao: 0,
};

const DEFAULT_ASSESSMENT_WEIGHTS: AssessmentDistribution = {
  multipla_escolha: 1,
  discursiva: 1,
  verdadeiro_falso: 1,
  completar_lacunas: 1,
  aplicacao_conceitos: 1,
  comparacao_contraste: 1,
  calculo: 1,
  associacao: 1,
};

function cleanApostilaOutlineTitle(value: string): string {
  return value
    .replace(/^[#\-\*•\s]+/, "")
    .replace(/^\d+(?:\.\d+)*[.)]?\s*/, "")
    .replace(/[*_`]+/g, "")
    .replace(/[•●◦・·]/g, "")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s*\/\s*(?=\/|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function lessonNumberFromTitle(value: string): string | null {
  return value.match(/\bAula\s*0*(\d+)\b/i)?.[1] ?? null;
}

function dedupeLessonTitles(themes: string[]): string[] {
  const byLesson = new Map<string, string>();
  const others: string[] = [];
  for (const raw of themes) {
    const theme = cleanApostilaOutlineTitle(raw);
    const lessonNumber = lessonNumberFromTitle(theme);
    const body = theme.replace(/^Aula\s*0*\d+\s*[-:–—.]?\s*/i, "").trim();
    const validBody = sanitizeExtractedConcept(body, null);
    if (!validBody) continue;
    if (!lessonNumber) {
      if (!others.some((item) => item.toLocaleLowerCase("pt-BR") === theme.toLocaleLowerCase("pt-BR"))) others.push(theme);
      continue;
    }
    const normalized = theme.replace(/^\d+(?:\.\d+)*[.)]?\s*/, "");
    const current = byLesson.get(lessonNumber);
    if (!current || normalized.length > current.length) byLesson.set(lessonNumber, normalized);
  }
  return [
    ...[...byLesson.entries()]
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, title]) => title),
    ...others,
  ];
}

function parseApostilaStructure(markdown: string): Array<{ module: string; themes: string[] }> {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const moduleRe = /^(?:#{1,6}\s*|[-*•]\s*)?(?:\*\*)?\s*(M[óo]dulo\s+\d+[^*\n]*)(?:\*\*)?\s*$/i;
  const themeRe = /^(?:#{1,6}\s*|[-*•]\s*)?(?:\*\*)?\s*((?:\d+(?:\.\d+)*[.)]?\s*)?(?:Aula\s+\d+|Tema\s*\d*|T[óo]pico\s*\d*)[^*\n]*)(?:\*\*)?\s*$/i;
  const result: Array<{ module: string; themes: string[] }> = [];
  let current: { module: string; themes: string[] } | null = null;
  const modulesByKey = new Map<string, { module: string; themes: string[] }>();
  for (const raw of lines) {
    const line = raw.trim();
    const mm = line.match(moduleRe);
    if (mm) {
      const t = cleanApostilaOutlineTitle(mm[1]);
      const moduleKey = t.toLowerCase();
      current = modulesByKey.get(moduleKey) ?? { module: t, themes: [] };
      if (!modulesByKey.has(moduleKey)) {
        modulesByKey.set(moduleKey, current);
        result.push(current);
      }
      continue;
    }
    const tm = line.match(themeRe);
    if (tm && current) {
      current.themes = dedupeLessonTitles([...current.themes, tm[1]]);
    }
  }
  return result.map((module) => ({ ...module, themes: dedupeLessonTitles(module.themes) }));
}

// Seções pedagógicas genéricas e cabeçalhos que NÃO são temas de aula.
// O professor quer apenas os tópicos sobre o tema dos módulos (as aulas), e não
// os subtítulos padronizados internos de cada aula (Contextualização, etc.).
const GENERIC_SECTION_RE =
  /^(apresenta[çc][ãa]o|refer[êe]ncias(?:\s+bibliogr[áa]ficas)?|sum[áa]rio|conclus[ãa]o|contextualiza[çc][ãa]o|fundamenta[çc][ãa]o\s+te[óo]rica|para\s+refletir|exemplos\s+aplicados|s[íi]ntese|curiosidades|conex[õo]es\s+com\s+outras\s+[áa]reas|desafios\s+atuais|defini[çc][ãa]o|hist[óo]rico(?:\s+e\s+evolu[çc][ãa]o)?|aplica[çc][õo]es|recursos\s+online(?:\s+e\s+v[íi]deos)?|artigos\s+cient[íi]ficos(?:\s+e\s+revis[õo]es)?|para\s+ir\s+al[ée]m|objetivos(?:\s+gerais(?:\s+e\s+espec[íi]ficos)?)?)\b/i;

function extractApostilaTopicSuggestions(markdown: string): string[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const topics: string[] = [];
  const seen = new Set<string>();
  const GENERIC = GENERIC_SECTION_RE;
  const add = (raw: string, fallbackText?: string) => {
    const prepared = raw.replace(/^[#\-*•\s]+/, "").replace(/[*_`]+/g, "").replace(/\s+/g, " ").trim();
    const topic = sanitizeExtractedConcept(prepared, fallbackText);
    const key = topic.toLocaleLowerCase("pt-BR");
    // Títulos muito curtos ou somente estruturais não viram cards; quando
    // possível, sanitizeExtractedConcept já tenta o subtítulo correspondente.
    if (topic.replace(/[^\p{L}\p{N}]/gu, "").length < 3 || topic.length > 200 || seen.has(key)) return;
    if (GENERIC.test(topic)) return;
    seen.add(key);
    topics.push(topic);
  };

  // O Sumário lista as aulas com títulos curtos/truncados; o corpo da apostila
  // traz o título completo de cada aula. Ignoramos a seção "Sumário" para não
  // capturar as versões incompletas.
  let inSumario = false;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const raw = lines[lineIndex];
    const line = raw.trim();
    const sectionHeading = line.match(/^#{1,6}\s+(.+)$/);
    if (sectionHeading) {
      const title = sectionHeading[1].replace(/[*_`]+/g, "").trim();
      inSumario = /^sum[áa]rio\b/i.test(title);
    }
    if (inSumario) continue;
    // Apenas entradas de aula/tema — cabeçalhos de seção genéricos ficam de fora.
    const heading = line.match(/^#{2,6}\s+((?:Aula|Tema|T[óo]pico)\s*\d*\b[^\n]*)$/i);
    if (heading) add(heading[1], lines[lineIndex + 1]);
    const boldTopic = line.match(/^\*\*\s*((?:Aula|Tema|T[óo]pico)\s*\d*[^*\n]{6,})\*\*/i);
    if (boldTopic) add(boldTopic[1], lines[lineIndex + 1]);
    const listedTopic = line.match(/^(?:[-*•]\s*)?((?:Aula|Tema|T[óo]pico)\s*\d*\s*[:-][^\n]{6,})$/i);
    if (listedTopic) add(listedTopic[1], lines[lineIndex + 1]);
  }
  // Deduplica por número de aula, mantendo o título mais completo (mais longo).
  // Assim, quando a mesma aula aparece com títulos diferentes (ex.: cópia curta
  // vs. completa), fica apenas uma entrada — a descrita na apostila.
  const byLesson = new Map<string, string>();
  const others: string[] = [];
  for (const topic of topics) {
    const num = topic.match(/^Aula\s*0*(\d+)/i)?.[1];
    if (!num) {
      others.push(topic);
      continue;
    }
    const current = byLesson.get(num);
    if (!current || topic.length > current.length) byLesson.set(num, topic);
  }
  const dedupedLessons = [...byLesson.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, v]) => v);
  return [...dedupedLessons, ...others].slice(0, 40);
}

function getTopicSuggestionsForModules(
  structure: Array<{ module: string; themes: string[] }>,
  selectedModules: string[],
  markdown: string,
): string[] {
  const moduleSet = new Set(selectedModules);
  const selectedStructure = structure.length > 0
    ? structure.filter((module) => moduleSet.size === 0 || moduleSet.has(module.module))
    : [];
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const module of selectedStructure) {
    for (const topic of dedupeLessonTitles(module.themes)) {
      if (!/^Aula\s+\d+/i.test(topic)) continue;
      const key = topic.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(topic);
    }
  }
  return deduped.length > 0 ? deduped.slice(0, 40) : extractApostilaTopicSuggestions(markdown);
}

// Extract topic suggestions scoped to a single lesson section of an apostila.
// Finds the lesson heading and collects sub-topics until the next lesson/module heading.
function extractTopicSuggestionsForLesson(markdown: string, lessonTitle: string): string[] {
  if (!lessonTitle || lessonTitle === "__custom__") return [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const norm = (s: string) =>
    s
      .replace(/^[#\-*•\s]+/, "")
      .replace(/[*_`]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  // A line that ends the current lesson section: another Aula/Módulo line, or any
  // top-level (H1/H2) heading such as "## Avaliações e Trabalhos" / "## Referências".
  const isSectionBoundary = (line: string) =>
    /^(?:#{1,6}\s*|[-*•]\s*)?\*{0,2}\s*(?:Aula\s+\d+|M[óo]dulo\s+\d+)/i.test(line.trim()) ||
    /^#{1,2}\s+\S/.test(line.trim());
  // A line that could be the lesson section heading we're looking for.
  const isLessonLine = (line: string) =>
    /^(?:#{1,6}\s*|[-*•]\s*)?\*{0,2}\s*Aula\s+\d+/i.test(line.trim());

  const target = norm(lessonTitle);
  const num = lessonTitle.match(/Aula\s+(\d+)/i)?.[1];
  const numRe = num ? new RegExp(`\\bAula\\s+${num}\\b`, "i") : null;

  // Collect every line that matches this lesson. The Sumário (table of contents)
  // lists lessons too, so there can be several matches — we try each and keep the
  // first one that actually yields content topics.
  const candidates: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!isLessonLine(line)) continue;
    if (norm(line) === target || (numRe && numRe.test(line))) candidates.push(i);
  }
  if (candidates.length === 0) return [];

  const collectFrom = (start: number): string[] => {
    const topics: string[] = [];
    const seen = new Set<string>();
    const add = (raw: string, fallbackText?: string) => {
      const prepared = raw
        .replace(/^[#\-*•\s]+/, "")
        .replace(/^\d+[.)]\s*/, "") // remove numeração inicial ("1. ", "2) ")
        .replace(/[*_`]+/g, "")
        .replace(/\s*:\s*$/, "") // remove dois-pontos ao final
        .replace(/\s+/g, " ")
        .trim();
      const topic = sanitizeExtractedConcept(prepared, fallbackText);
      const key = topic.toLocaleLowerCase("pt-BR");
      if (topic.replace(/[^\p{L}\p{N}]/gu, "").length < 3 || topic.length > 110 || seen.has(key)) return;
      if (GENERIC_SECTION_RE.test(topic)) return;
      if (/^(exemplo\s*\d+|sugest[ãa]o\b|recurso\s+visual)/i.test(topic)) return;
      seen.add(key);
      topics.push(topic);
    };

    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (isSectionBoundary(line)) break; // reached the next lesson/module/section
      const heading = line.match(/^#{2,6}\s+(.+)$/);
      if (heading) add(heading[1]);
      // Subtópicos em negrito ocupando a linha inteira (ex.: "**1. Preparo da
      // Tintura-Mãe (TM):**") são os temas específicos reais da aula.
      const boldLine = line.match(/^\*\*\s*(.+?)\s*\*\*\s*:?\s*$/);
      if (boldLine) add(boldLine[1]);
      // Conceito em negrito iniciando a linha, seguido de explicação
      // (ex.: "**Preparo da Tintura-Mãe:** consiste em...") — o tema é a
      // parte em negrito. Comum em apostilas de outras disciplinas/módulos.
      const boldLead = line.match(/^(?:[-*•]\s*|\d+[.)]\s*)?\*\*\s*(.+?)\s*\*\*\s*[:.–—-]/);
      if (boldLead) add(boldLead[1]);
      // Itens de lista com rótulo em negrito no início (ex.: "- **Conceito**: ...").
      const listBold = line.match(/^[-*•]\s*\*\*\s*(.+?)\s*\*\*/);
      if (listBold) add(listBold[1]);
      const listedTopic = line.match(/^(?:[-*•]\s*)?((?:Tema|T[óo]pico)\s*\d*\s*[:-][^\n]{6,})$/i);
      if (listedTopic) add(listedTopic[1]);
    }
    return topics.slice(0, 40);
  };

  for (const start of candidates) {
    const topics = collectFrom(start);
    if (topics.length > 0) return topics;
  }
  return [];
}

function parseApostilaHeader(markdown: string): Partial<AssessmentHeader> {
  const extract = (patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const match = markdown.match(pattern);
      const value = cleanAssessmentHeaderValue(match?.[1]);
      if (value) return value.replace(/[*_`#]+/g, "").trim();
    }
    return "";
  };
  return {
    discipline: extract([/^#{1,6}\s*Apostila\s*[—-]\s*([^\n]+)/im, /^#{1,6}\s*Apostila[^:]*:\s*([^\n]+)/im, /^#{1,6}\s*(?:Apostila\s*[—-]\s*)?([^\n]*Disciplina[^\n]*)/im, /\*\*Disciplina\s*:\*\*\s*([^\n]+)/i, /\*\*Disciplina\*\*\s*:\s*([^\n]+)/i, /^Disciplina\s*:\s*([^\n]+)/im]),
    professor: extract([/\*\*Professor(?:\(a\))?\s*:\*\*\s*([^\n]+)/i, /\*\*Professor(?:\(a\))?\*\*\s*:\s*([^\n]+)/i, /^Professor(?:\(a\))?\s*:\s*([^\n]+)/im]),
  };
}

function AssessmentCreatorDialog({
  disciplineId,
  onClose,
  onDone,
  kind = "avaliacao",
}: {
  disciplineId: string;
  onClose: () => void;
  onDone: (id: string) => void;
  kind?: "avaliacao" | "exercicio";
}) {
  const isExercicio = kind === "exercicio";
  const materialTitle = isExercicio ? "Exercícios" : "Avaliação";
  const materialTitleLower = isExercicio ? "exercícios" : "avaliação";
  const [apostilas, setApostilas] = useState<ApostilaOption[]>([]);
  const [header, setHeader] = useState<AssessmentHeader>({ discipline: "", professor: "" });
  const [headerTemplateId, setHeaderTemplateId] = useState<string>("none");
  const [headerTemplates, setHeaderTemplates] = useState<Array<{ id: string; name: string }>>([]);
  // Etapa interativa de revisão: quando a geração sinaliza questões
  // problemáticas, abrimos a tela de correção antes de liberar os PDFs.
  const [reviewAssessmentId, setReviewAssessmentId] = useState<string | null>(null);

  /** Baixa os 2 PDFs (aluno + gabarito do professor). */
  const downloadAssessmentPdfs = async (assessmentId: string) => {
    const downloadPdf = (resp: { filename: string; base64: string }) => {
      const bin = atob(resp.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = resp.filename;
      a.rel = "noopener";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1500);
    };
    const [studentPdf, teacherPdf] = await Promise.all([
      exportAssessmentPDF({ data: { id: assessmentId, block: "student" } }),
      exportAssessmentPDF({ data: { id: assessmentId, block: "teacher" } }),
    ]);
    downloadPdf(studentPdf as { filename: string; base64: string });
    setTimeout(() => downloadPdf(teacherPdf as { filename: string; base64: string }), 800);
    toast.success(
      "Avaliação gerada — 2 PDFs baixados: (1) Aluno: questões + folhas de resposta com QR; (2) Gabarito exclusivo do professor.",
    );
  };

  useEffect(() => {
    if (isExercicio) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await listAssessmentHeaderTemplates();
        if (!cancelled) {
          setHeaderTemplates((res.items ?? []).map((t) => ({ id: t.id, name: t.name })));
        }
      } catch {
        if (!cancelled) setHeaderTemplates([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isExercicio]);
  const [loadingLists, setLoadingLists] = useState(true);
  const [selectedApostilaId, setSelectedApostilaId] = useState<string>("");
  const [apostilaMarkdown, setApostilaMarkdown] = useState<string>("");
  const [structure, setStructure] = useState<Array<{ module: string; themes: string[] }>>([]);
  const [loadingStructure, setLoadingStructure] = useState(false);
  const [selectedModules, setSelectedModules] = useState<string[]>([]);
  const [selectedThemes, setSelectedThemes] = useState<string[]>([]);
  const [topicSuggestions, setTopicSuggestions] = useState<string[]>([]);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [assessmentTitle, setAssessmentTitle] = useState("");
  const [customTopics, setCustomTopics] = useState("");
  const [difficultyLevel, setDifficultyLevel] = useState<AssessmentDifficulty>("superior");
  const [difficultyByType, setDifficultyByType] = useState<AssessmentDifficultyByType>(() => ({
    multipla_escolha: emptyDifficultyCounts(),
    discursiva: emptyDifficultyCounts(),
    verdadeiro_falso: emptyDifficultyCounts(),
    completar_lacunas: emptyDifficultyCounts(),
    aplicacao_conceitos: emptyDifficultyCounts(),
    comparacao_contraste: emptyDifficultyCounts(),
    calculo: emptyDifficultyCounts(),
    associacao: emptyDifficultyCounts(),
  }));
  const [qualityRules, setQualityRules] = useState<string[]>(QUALITY_RULE_OPTIONS.map((rule) => rule.id));
  const [audience, setAudience] = useState("Alunos da disciplina");
  const [total, setTotal] = useState<number>(10);
  const [numVersions, setNumVersions] = useState<number>(1);
  const [maxScore, setMaxScore] = useState<number>(10);
  const [shuffleItems, setShuffleItems] = useState<boolean>(true);
  // Número de alternativas por questão de múltipla escolha (inclui blocos de
  // V/F e Completar Lacunas quando apresentados em múltipla escolha).
  const [optionCount, setOptionCount] = useState<3 | 4 | 5>(5);
  const [weightMode, setWeightMode] = useState<"igual" | "personalizado">("igual");
  const [questionWeights, setQuestionWeights] = useState<AssessmentDistribution>(DEFAULT_ASSESSMENT_WEIGHTS);
  const [studentCount, setStudentCount] = useState<number | null>(null);
  const [diaryColumns, setDiaryColumns] = useState<Array<{ id: string; name: string; weight: number; max_score: number }>>([]);
  const [selectedDiaryColumnId, setSelectedDiaryColumnId] = useState<string>("");
  const [layoutMode, setLayoutMode] = useState<"uma_coluna" | "duas_colunas" | "misto">("uma_coluna");
  const [layoutManual, setLayoutManual] = useState<boolean>(false);
  // Modalidade da avaliação: regular (turma toda), segunda chamada (alunos específicos)
  // ou recuperação (alunos abaixo da média no diário).
  const [examKind, setExamKind] = useState<"regular" | "second_call" | "recovery">("regular");
  const [targetStudentIds, setTargetStudentIds] = useState<string[]>([]);
  const [allStudents, setAllStudents] = useState<Array<{ id: string; name: string; enrollment_number: string | null }>>([]);
  const [recoveryIds, setRecoveryIds] = useState<string[]>([]);
  const [studentSearch, setStudentSearch] = useState("");
  const [assessmentDate, setAssessmentDate] = useState<string>(
    () => new Date().toISOString().slice(0, 10),
  );
  const [dist, setDist] = useState<AssessmentDistribution>({
    ...ZERO_ASSESSMENT_DIST,
    multipla_escolha: 5,
    discursiva: 2,
    verdadeiro_falso: 1,
    completar_lacunas: 1,
    aplicacao_conceitos: 1,
  });
  const [formats, setFormats] = useState<AssessmentFormats>({
    verdadeiro_falso: "gabarito_direto",
    completar_lacunas: "gabarito_direto",
    calculo: "gabarito_direto",
    associacao: "gabarito_direto",
  });
  const [loading, setLoading] = useState(false);

  const distSum = useMemo(
    () => ASSESSMENT_TYPES.reduce((acc, t) => acc + (dist[t.key] || 0), 0),
    [dist],
  );
  const expandedTotal = useMemo(() => expandedAssessmentQuestionCount(dist, formats), [dist, formats]);
  const customWeightTotal = useMemo(
    () => ASSESSMENT_TYPES.reduce((acc, type) => acc + (dist[type.key] || 0) * (questionWeights[type.key] || 0), 0),
    [dist, questionWeights],
  );
  const perQuestionWeight = total > 0 ? maxScore / total : 0;
  const effectiveWeightTotal = weightMode === "igual" ? perQuestionWeight * total : customWeightTotal;
  const weightSumMatches = total === 0 || Math.abs(effectiveWeightTotal - maxScore) < 0.01;


  // Sugestão automática de layout baseada na distribuição/formatos.
  const suggestedLayout = useMemo<"uma_coluna" | "duas_colunas" | "misto">(() => {
    const isMC = (key: FormattableTypeKey) => formats[key] === "multipla_escolha";
    const oneColumnCount =
      (dist.discursiva || 0) +
      (isMC("completar_lacunas") ? 0 : dist.completar_lacunas || 0) +
      (isMC("verdadeiro_falso") ? 0 : dist.verdadeiro_falso || 0) +
      (isMC("associacao") ? 0 : dist.associacao || 0) +
      (isMC("calculo") ? 0 : dist.calculo || 0) +
      (dist.comparacao_contraste || 0);
    const twoColumnCount =
      (dist.multipla_escolha || 0) +
      (dist.aplicacao_conceitos || 0) +
      (isMC("verdadeiro_falso") ? dist.verdadeiro_falso || 0 : 0) +
      (isMC("completar_lacunas") ? dist.completar_lacunas || 0 : 0) +
      (isMC("associacao") ? dist.associacao || 0 : 0) +
      (isMC("calculo") ? dist.calculo || 0 : 0);
    if (oneColumnCount === 0 && twoColumnCount > 0) return "duas_colunas";
    if (twoColumnCount === 0 && oneColumnCount > 0) return "uma_coluna";
    if (twoColumnCount > 0 && oneColumnCount > 0) return "misto";
    return "uma_coluna";
  }, [dist, formats]);

  useEffect(() => {
    if (!layoutManual) setLayoutMode(suggestedLayout);
  }, [suggestedLayout, layoutManual]);

  const availableThemes = useMemo(() => {
    const set = new Set(selectedModules);
    return structure
      .filter((m) => set.has(m.module))
      .flatMap((m) => m.themes.map((t) => ({ module: m.module, theme: t })));
  }, [structure, selectedModules]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headerRes = await getAssessmentHeader({ data: { discipline_id: disciplineId } });
        if (!cancelled) {
          const h = headerRes as AssessmentHeader;
          setHeader({
            discipline: cleanAssessmentHeaderValue(h.discipline),
            professor: cleanAssessmentHeaderValue(h.professor),
          });
        }
        const res = await listAIGenerations({
          data: { discipline_id: disciplineId, tool: "apostila", limit: 50 },
        });
        const list = onlyTool(res?.items, "apostila");
        if (!cancelled)
          setApostilas(list.map((a) => ({ id: a.id, title: a.title, created_at: a.created_at })));
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Erro ao carregar apostilas");
      } finally {
        if (!cancelled) setLoadingLists(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [disciplineId]);

  useEffect(() => {
    if (!selectedApostilaId) {
      setStructure([]);
      setSelectedModules([]);
      setSelectedThemes([]);
      setTopicSuggestions([]);
      setSelectedTopics([]);
      setApostilaMarkdown("");
      return;
    }
    let cancelled = false;
    setLoadingStructure(true);
    (async () => {
      try {
        const res = await getAIGeneration({ data: { id: selectedApostilaId } });
        const md =
          typeof res?.result === "string" ? res.result : JSON.stringify(res?.result ?? "", null, 2);
        const s = parseApostilaStructure(md);
        const defaultModules = s.length > 0 ? s.map((m) => m.module) : ["Apostila completa"];
        const suggestedTopics = getTopicSuggestionsForModules(s, defaultModules, md);
        const apostilaHeader = parseApostilaHeader(md);
        if (!cancelled) {
          setApostilaMarkdown(md);
          setStructure(s);
          setSelectedModules(defaultModules);
          setSelectedThemes([]);
          setTopicSuggestions(suggestedTopics);
          setSelectedTopics(suggestedTopics);
          setHeader((prev) => ({
            discipline: cleanAssessmentHeaderValue(apostilaHeader.discipline) || prev.discipline,
            professor: prev.professor || cleanAssessmentHeaderValue(apostilaHeader.professor),
          }));
        }
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Erro ao ler apostila");
      } finally {
        if (!cancelled) setLoadingStructure(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedApostilaId]);

  useEffect(() => {
    const allowed = new Set(availableThemes.map((t) => t.theme));
    setSelectedThemes((prev) => prev.filter((t) => allowed.has(t)));
  }, [availableThemes]);

  useEffect(() => {
    if (!apostilaMarkdown || loadingStructure) return;
    const suggestedTopics = getTopicSuggestionsForModules(structure, selectedModules, apostilaMarkdown);
    setTopicSuggestions(suggestedTopics);
    setSelectedTopics((prev) => {
      const valid = prev.filter((topic) => suggestedTopics.includes(topic));
      return valid.length > 0 ? valid : suggestedTopics;
    });
  }, [apostilaMarkdown, structure, selectedModules, loadingStructure]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { count } = await supabase
          .from("discipline_students")
          .select("student_id", { count: "exact", head: true })
          .eq("discipline_id", disciplineId);
        if (!cancelled) setStudentCount(count ?? 0);
      } catch {
        if (!cancelled) setStudentCount(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [disciplineId]);


  // Carrega as colunas do diário (avaliações cadastradas em grade_structures).
  useEffect(() => {
    if (isExercicio) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await listAssessmentTargets({ data: { discipline_id: disciplineId } });
        if (cancelled) return;
        setAllStudents((r?.students ?? []) as Array<{ id: string; name: string; enrollment_number: string | null }>);
        setRecoveryIds((r?.recovery_student_ids ?? []) as string[]);
      } catch {
        if (!cancelled) {
          setAllStudents([]);
          setRecoveryIds([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [disciplineId, isExercicio]);

  useEffect(() => {
    if (examKind === "regular") setTargetStudentIds([]);
    else if (examKind === "recovery") setTargetStudentIds(recoveryIds);
    else if (examKind === "second_call") setTargetStudentIds([]);
  }, [examKind, recoveryIds]);

  const toggleTargetStudent = (id: string) => {
    setTargetStudentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from("grade_structures")
          .select("assessments")
          .eq("discipline_id", disciplineId)
          .maybeSingle();
        const arr = Array.isArray(data?.assessments) ? data!.assessments : [];
        const cols: Array<{ id: string; name: string; weight: number; max_score: number }> = [];
        for (const raw of arr) {
          if (!raw || typeof raw !== "object") continue;
          const a = raw as { id?: unknown; name?: unknown; weight?: unknown; max_score?: unknown; sub_items?: unknown };
          if (typeof a.id !== "string") continue;
          const subs = Array.isArray(a.sub_items) ? (a.sub_items as Array<{ id?: unknown; name?: unknown }>) : [];
          const validSubs = subs.filter((s) => s && typeof s.id === "string" && typeof s.name === "string") as Array<{ id: string; name: string }>;
          if (validSubs.length > 0) {
            for (const sub of validSubs) {
              cols.push({
                id: `${a.id}#${sub.id}`,
                name: `${a.name as string} — ${sub.name}`,
                weight: a.weight as number,
                max_score: a.max_score as number,
              });
            }
          } else {
            cols.push({
              id: a.id,
              name: a.name as string,
              weight: a.weight as number,
              max_score: a.max_score as number,
            });
          }
        }
        if (!cancelled) setDiaryColumns(cols);
      } catch {
        if (!cancelled) setDiaryColumns([]);
      }
    })();
    return () => { cancelled = true; };
  }, [disciplineId]);

  const toggle = (arr: string[], value: string): string[] =>
    arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];

  const submit = async () => {
    if (!selectedApostilaId) return toast.error("Selecione uma Apostila");
    if (!assessmentTitle.trim()) return toast.error("Informe o Tema da Avaliação");
    if (assessmentTitle.trim().length > 500)
      return toast.error("O tema não pode exceder 500 caracteres");
    if (customTopics.length > 1000)
      return toast.error("Os tópicos não podem exceder 1.000 caracteres");
    if (selectedModules.length === 0 && structure.length > 0) return toast.error("Selecione ao menos um Módulo");
    if (audience.trim().length < 2) return toast.error("Informe o Público-alvo");
    if (total < 1) return toast.error("Informe o Número Total de Questões");
    if (!isExercicio && !weightSumMatches)
      return toast.error("A soma dos pesos deve corresponder à Nota Máxima da Avaliação.");
    if (distSum !== total)
      return toast.error(
        `A soma das quantidades por tipo (${distSum}) deve ser igual ao total (${total}).`,
      );
    if (!isExercicio && examKind !== "regular" && targetStudentIds.length === 0) {
      return toast.error(
        examKind === "recovery"
          ? "Selecione ao menos um aluno em recuperação."
          : "Selecione ao menos um aluno para a segunda chamada.",
      );
    }
    if (!isExercicio && !selectedDiaryColumnId) {
      return toast.error("Selecione a Coluna do Diário para lançamento da nota.");
    }
    if (!isExercicio && !assessmentDate) {
      return toast.error("Informe a Data da Avaliação.");
    }
    setLoading(true);
    try {
      // ---- AVALIAÇÃO: caminho estruturado (3 blocos com QR + gabarito do professor) ----
      if (!isExercicio) {
        const isMC = (f: "multipla_escolha" | "gabarito_direto") => f === "multipla_escolha";
        const trueFalseAsMC = isMC(formats.verdadeiro_falso);
        const fillBlankAsMC = isMC(formats.completar_lacunas);
        const counts = {
          multiple_choice:
            (dist.multipla_escolha || 0) +
            (dist.aplicacao_conceitos || 0) +
            (dist.comparacao_contraste || 0) +
            (trueFalseAsMC ? dist.verdadeiro_falso || 0 : 0) +
            (fillBlankAsMC ? dist.completar_lacunas || 0 : 0) +
            (isMC(formats.calculo) ? dist.calculo || 0 : 0) +
            (isMC(formats.associacao) ? dist.associacao || 0 : 0),
          true_false: trueFalseAsMC ? 0 : dist.verdadeiro_falso || 0,
          fill_blank:
            (fillBlankAsMC ? 0 : dist.completar_lacunas || 0) +
            (isMC(formats.associacao) ? 0 : dist.associacao || 0),
          essay:
            (dist.discursiva || 0) + (isMC(formats.calculo) ? 0 : dist.calculo || 0),
        };
        const totalMapped =
          counts.multiple_choice + counts.true_false + counts.fill_blank + counts.essay;
        if (totalMapped === 0) {
          throw new Error("Defina ao menos uma questão.");
        }
        const layoutMap = {
          uma_coluna: "one_column" as const,
          duas_colunas: "two_columns" as const,
          misto: "mixed" as const,
        };
        const moduleLessons = [
          ...selectedModules.map(sanitizeConceptTopic).filter(Boolean),
          ...selectedThemes.map(sanitizeConceptTopic).filter(Boolean),
        ].join(" | ").slice(0, 2000) || "Apostila completa";

        const customTopicList = customTopics
          .split(/[\n;]+/)
          .map((topic) => sanitizeConceptTopic(topic.trim()))
          .filter(Boolean);
        const topics = Array.from(
          new Set([
            ...selectedThemes.map(sanitizeConceptTopic).filter(Boolean),
            ...selectedTopics.map(sanitizeConceptTopic).filter(Boolean),
            ...customTopicList,
          ]),
        ).slice(0, 40);

        const formatInstructions = [
          `Público-alvo: ${audience.trim()}. Nível esperado: ${DIFFICULTY_OPTIONS.find((d) => d.value === difficultyLevel)?.label ?? difficultyLevel}.`,
          "Não gerar enunciados genéricos como 'A leitura do problema exige identificar', 'Em uma situação aplicada envolvendo tipos' ou 'caso avaliativo'. Cada enunciado deve citar termos reais da disciplina e avaliar conhecimento específico.",
          dist.verdadeiro_falso > 0
            ? trueFalseAsMC
              ? `Gerar EXATAMENTE ${dist.verdadeiro_falso} bloco(s) de Verdadeiro/Falso em formato Múltipla Escolha: qtype="multiple_choice", com 5 afirmativas I-V no enunciado e ${optionCount} alternativas A-${"ABCDE"[optionCount - 1]} contendo combinações de V/F; não gerar qtype="true_false" para estes blocos.`
              : `Gerar EXATAMENTE ${dist.verdadeiro_falso} questão(ões) de Verdadeiro/Falso como qtype="true_false", sem alternativas, com uma afirmação única e resposta booleana.`
            : null,
          dist.completar_lacunas > 0
            ? fillBlankAsMC
              ? `Gerar EXATAMENTE ${dist.completar_lacunas} bloco(s) de Completar Lacunas em formato Múltipla Escolha: qtype="multiple_choice", com lacunas "_____" no enunciado e ${optionCount} alternativas A-${"ABCDE"[optionCount - 1]} com sequências de preenchimento; não gerar qtype="fill_blank" para estes blocos.`
              : `Gerar EXATAMENTE ${dist.completar_lacunas} questão(ões) de Completar Lacunas como qtype="fill_blank", sem alternativas, com marcador "_____" e resposta esperada em array.`
            : null,
          formats.associacao === "multipla_escolha" && dist.associacao > 0
            ? `Gerar ${dist.associacao} bloco(s) de Associação no formato de múltipla escolha, com 5 itens para relacionar e ${optionCount} alternativas A-${"ABCDE"[optionCount - 1]} com combinações de associação.`
            : null,
        ].filter(Boolean).join("\n");
        const title = assessmentTitle.trim().slice(0, 500);

        const gen = await generateStructuredAssessment({
          data: {
            discipline_id: disciplineId,
            apostila_id: selectedApostilaId,
            title,
            module_lessons: moduleLessons,
            counts,
            max_score: maxScore,
            version_count: Math.max(1, Math.min(4, numVersions)),
            option_count: optionCount,
            copies_per_version: 1,
            shuffle_questions: shuffleItems,
            multiple_choice_subtypes: {
              standard:
                (dist.multipla_escolha || 0) +
                (dist.aplicacao_conceitos || 0) +
                (dist.comparacao_contraste || 0) +
                (isMC(formats.calculo) ? dist.calculo || 0 : 0) +
                (isMC(formats.associacao) ? dist.associacao || 0 : 0),
              true_false_block: trueFalseAsMC ? dist.verdadeiro_falso || 0 : 0,
              fill_blank_block: fillBlankAsMC ? dist.completar_lacunas || 0 : 0,
            },
            header_overrides: {
              institution: null,
              discipline: header.discipline.trim() || null,
              professor: header.professor.trim() || null,
            },
            header_template_id: headerTemplateId !== "none" ? headerTemplateId : null,
            layout: layoutMap[layoutMode],
            diary_assessment_id: selectedDiaryColumnId || null,
            rigor: "balanced",
            assessment_date: assessmentDate || null,
            format_instructions: formatInstructions || null,
            topics,
            quality_rules: qualityRules,
            difficulty_level: difficultyLevel,
            difficulty_by_type: {
              // Agrega contagens por dificuldade nos 4 buckets do backend.
              // Os tipos "extras" (aplicação, comparação, cálculo, associação)
              // seguem o pipeline de múltipla escolha.
              multiple_choice: (["multipla_escolha","aplicacao_conceitos","comparacao_contraste","calculo","associacao"] as AssessmentTypeKey[])
                .reduce<AssessmentDifficultyCounts>((acc, k) => {
                  const c = difficultyByType[k];
                  acc.facil += c.facil; acc.medio += c.medio; acc.dificil += c.dificil; acc.superior += c.superior;
                  return acc;
                }, emptyDifficultyCounts()),
              true_false: { ...difficultyByType.verdadeiro_falso },
              fill_blank: { ...difficultyByType.completar_lacunas },
              essay: { ...difficultyByType.discursiva },
            },
            layout_template: layoutMode === "duas_colunas" ? "two_column" : layoutMode === "misto" ? "exam_board" : "classic",
            kind: examKind,
            target_student_ids: examKind === "regular" ? null : targetStudentIds,
          },
        });
        const assessmentId = (gen as { id?: string })?.id;
        if (!assessmentId) throw new Error("Falha ao criar avaliação");
        const alignWarns =
          (gen as { alignment_warnings?: Array<{ version: string; position: number }> })?.alignment_warnings ?? [];
        if (alignWarns.length > 0) {
          toast.warning(
            `${alignWarns.length} questão(ões) podem estar desalinhadas com a apostila (ex.: versão ${alignWarns[0].version}, questão ${alignWarns[0].position}). Revise antes de aplicar.`,
            { duration: 9000 },
          );
        }
        // Auditoria de conceito central: placeholders genéricos substituídos e
        // questões que exigem revisão manual do professor.
        const audits =
          (gen as {
            question_audits?: Array<{
              version: string;
              position: number;
              status: "ok" | "ajustado" | "revisar" | "nivel";
              message: string | null;
              concept_options?: string[];
              declared_level?: string | null;
              detected_level?: string | null;
              suggested_prompt?: string | null;
            }>;
          })?.question_audits ?? [];
        const fixed = audits.filter((a) => a.status === "ajustado" && !String(a.message ?? "").startsWith("Ajuste automático"));
        const review = audits.filter((a) => a.status === "revisar");
        const levelIssues = audits.filter((a) => a.status === "nivel");
        if (fixed.length > 0) {
          toast.success(
            `${fixed.length} enunciado(s) tiveram termos genéricos substituídos pelo conceito central da apostila (ex.: ${fixed[0].message ?? ""}).`,
            { duration: 9000 },
          );
        }
        if (review.length > 0) {
          const first = review[0];
          const opts = (first.concept_options ?? []).slice(0, 3).join(", ");
          toast.warning(
            `${review.length} questão(ões) precisam de revisão manual — versão ${first.version}, questão ${first.position}: ${first.message ?? "conceito central ambíguo."}${opts ? ` Conceitos possíveis: ${opts}.` : ""}`,
            { duration: 12000 },
          );
        }
        // Validação do nível de dificuldade: questões cujo nível real não
        // corresponde ao nível declarado NÃO são liberadas automaticamente.
        if (levelIssues.length > 0) {
          const f = levelIssues[0];
          toast.warning(
            `${levelIssues.length} questão(ões) requerem ajuste de nível ou simplificação — versão ${f.version}, questão ${f.position}: nível real ${f.detected_level ?? "superior"} × nível declarado ${f.declared_level ?? "—"}.` +
              (f.suggested_prompt ? ` Sugestão: "${f.suggested_prompt}"` : ""),
            { duration: 14000 },
          );
        }

        // Questões sinalizadas: abre a etapa interativa de correção
        // (corrigir automaticamente / editar / manter) antes dos PDFs.
        if (review.length > 0 || levelIssues.length > 0) {
          toast.info("Abrindo a tela de revisão: corrija automaticamente, edite ou mantenha cada questão sinalizada para liberar os PDFs.");
          onDone(assessmentId);
          setReviewAssessmentId(assessmentId);
          setLoading(false);
          return;
        }

        await downloadAssessmentPdfs(assessmentId);
        onClose();
        return;
      }

      // ---- EXERCÍCIOS: mantém o fluxo de markdown atual ----
      const res = await generateAssessmentFromApostila({
        data: {
          discipline_id: disciplineId,
          kind,
          apostila_id: selectedApostilaId,
          modules: selectedModules.map(sanitizeConceptTopic).filter(Boolean),
          themes: selectedThemes.map(sanitizeConceptTopic).filter(Boolean),
          audience: audience.trim(),

          total_questions: total,
          distribution: dist,
          formats,
          num_versions: numVersions,
          option_count: optionCount,
          header: {
            discipline: header.discipline,
            professor: header.professor,
          },
        },
      });
      if (!hasGeneratedContentId(res)) throw new Error("Resposta inválida");
      toast.success(`${materialTitle} ${isExercicio ? "gerados" : "gerada"}`);
      onDone(res.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Erro ao gerar ${materialTitleLower}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <AILoadingOverlay open={loading} onCancel={() => setLoading(false)} />
      {reviewAssessmentId && (
        <AssessmentReviewDialog
          open
          assessmentId={reviewAssessmentId}
          onClose={async () => {
            const id = reviewAssessmentId;
            setReviewAssessmentId(null);
            try {
              await downloadAssessmentPdfs(id);
              onClose();
            } catch (e) {
              toast.error(
                e instanceof Error
                  ? e.message
                  : "Há questões marcadas como problemáticas. Escolha corrigir, editar ou manter conscientemente antes de gerar o PDF.",
              );
            }
          }}
        />
      )}
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileQuestion className="h-4 w-4 text-primary" /> {isExercicio ? "Criador de Exercícios" : "Criador de Avaliações"}
            </DialogTitle>
            <DialogDescription>
              Selecione a apostila, os módulos e temas, defina o público-alvo, o total de questões e
              a distribuição por tipo.{" "}
              {isExercicio
                ? "Os exercícios são gerados em Markdown pronto para download em DOC/DOCX."
                : "Serão gerados DOIS PDFs prontos para impressão: (1) Aluno — folhas de questões por versão + folha de resposta personalizada por aluno com QR Code único; (2) Gabarito — folha de gabarito por versão, EXCLUSIVA do professor."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="assessment-theme">Tema da Avaliação</Label>
                <span className="text-xs text-muted-foreground">
                  {assessmentTitle.length}/500
                </span>
              </div>
              <Input
                id="assessment-theme"
                value={assessmentTitle}
                maxLength={500}
                onChange={(event) => setAssessmentTitle(event.target.value)}
                placeholder="Ex.: Avaliação bimestral — Sistema cardiovascular"
              />
            </div>

            <div className="rounded-md border p-3 space-y-3">
              <Label>Cabeçalho {isExercicio ? "dos Exercícios" : "da Avaliação"}</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Disciplina</Label>
                  <Input
                    value={header.discipline}
                    onChange={(e) => setHeader((prev) => ({ ...prev, discipline: e.target.value }))}
                    placeholder="Digite a disciplina"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Professor</Label>
                  <Input
                    value={header.professor}
                    onChange={(e) => setHeader((prev) => ({ ...prev, professor: e.target.value }))}
                    placeholder="Digite o professor"
                  />
                </div>
              </div>
              {!isExercicio && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Modelo de cabeçalho institucional</Label>
                  <Select value={headerTemplateId} onValueChange={setHeaderTemplateId}>
                    <SelectTrigger className="max-w-[360px]">
                      <SelectValue placeholder="Padrão da plataforma" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Padrão da plataforma</SelectItem>
                      {headerTemplates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Aplica o cabeçalho institucional (faixa com logo, disciplina/avaliação, dados do
                    aluno e orientações) nas folhas de questões e de respostas. Crie ou edite modelos
                    em Identidade Visual.
                  </p>
                </div>
              )}
              {!isExercicio && (
                <div className="space-y-1.5">
                  <Label className="text-xs" htmlFor="ass-date">
                    Data da Avaliação <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="ass-date"
                    type="date"
                    value={assessmentDate}
                    onChange={(e) => setAssessmentDate(e.target.value)}
                    className="max-w-[220px]"
                  />
                  <p className="text-xs text-muted-foreground">
                    Aparecerá no cabeçalho de todas as folhas (questões, respostas e gabarito).
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>
                Apostila <span className="text-destructive">*</span>
              </Label>
              {loadingLists ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
                </div>
              ) : apostilas.length === 0 ? (
                <p className="text-sm text-muted-foreground border-2 border-dashed rounded-lg p-3">
                  Nenhuma Apostila encontrada nesta disciplina. Gere uma Apostila primeiro pelo
                  "Criador de Apostila".
                </p>
              ) : (
                <select
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={selectedApostilaId}
                  onChange={(e) => setSelectedApostilaId(e.target.value)}
                >
                  <option value="">Selecione uma apostila...</option>
                  {apostilas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title} — {new Date(a.created_at).toLocaleDateString("pt-BR")}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {selectedApostilaId && (
              <div className="space-y-2 rounded-md border p-3">
                <Label>
                  Módulo(s) d{isExercicio ? "os Exercícios" : "a Avaliação"} <span className="text-destructive">*</span>
                </Label>
                {loadingStructure ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Lendo módulos da apostila...
                  </div>
                ) : structure.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nenhum módulo detectado. A IA usará a apostila inteira como base.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-44 overflow-y-auto">
                    {structure.map((m) => (
                      <label
                        key={m.module}
                        className="flex items-start gap-2 text-sm cursor-pointer rounded hover:bg-muted/40 p-1"
                      >
                        <Checkbox
                          checked={selectedModules.includes(m.module)}
                          onCheckedChange={() =>
                            setSelectedModules((prev) => toggle(prev, m.module))
                          }
                        />
                        <span>{m.module}</span>
                      </label>
                    ))}
                  </div>
                )}
                {!isExercicio && (
                  <div className="space-y-2 pt-2 border-t">
                    <Label className="text-xs">Tópicos de Conteúdo</Label>
                    {topicSuggestions.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Nenhum tópico automático detectado nesta apostila.</p>
                    ) : (
                      <>
                        <p className="text-[11px] text-muted-foreground">
                          Todas as aulas dos módulos selecionados vêm marcadas. Desmarque as que não deseja incluir.
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-44 overflow-y-auto">
                          {topicSuggestions.map((topic) => (
                            <label key={topic} className="flex items-start gap-2 text-sm cursor-pointer rounded hover:bg-muted/40 p-1">
                              <Checkbox
                                checked={selectedTopics.includes(topic)}
                                onCheckedChange={() => setSelectedTopics((prev) => toggle(prev, topic))}
                              />
                              <span>{topic}</span>
                            </label>
                          ))}
                        </div>
                      </>
                    )}
                    <Textarea
                      value={customTopics}
                      onChange={(e) => setCustomTopics(e.target.value)}
                      maxLength={1000}
                      placeholder="Tópicos adicionais, um por linha. Ex.: Etanercepte e TNF-alfa; biofármacos recombinantes; vacinas de mRNA"
                      rows={3}
                    />
                    <div className="text-right text-xs text-muted-foreground">
                      {customTopics.length}/1.000
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="ass-total">
                Número Total de Questões <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ass-total"
                type="number"
                min={1}
                max={60}
                value={total}
                onChange={(e) => setTotal(Math.max(0, Math.min(60, Number(e.target.value) || 0)))}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ass-option-count">Número de alternativas por questão</Label>
              <select
                id="ass-option-count"
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={optionCount}
                onChange={(e) => setOptionCount(Number(e.target.value) as 3 | 4 | 5)}
              >
                <option value={3}>3 alternativas (A–C)</option>
                <option value={4}>4 alternativas (A–D)</option>
                <option value={5}>5 alternativas (A–E)</option>
              </select>
              <p className="text-xs text-muted-foreground">
                Vale para múltipla escolha e também para os blocos de Verdadeiro/Falso e Completar
                Lacunas quando apresentados em múltipla escolha.
              </p>
            </div>

            {!isExercicio && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="ass-versions">
                    Número de Versões da Avaliação
                  </Label>
                  <Input
                    id="ass-versions"
                    type="number"
                    min={1}
                    max={4}
                    value={numVersions}
                    onChange={(e) =>
                      setNumVersions(Math.max(1, Math.min(4, Number(e.target.value) || 1)))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Até 4 versões diferentes da mesma avaliação (mesmo tema e estrutura, questões distintas).
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="ass-weight-mode">Peso por Questão</Label>
                  <select
                    id="ass-weight-mode"
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={weightMode}
                    onChange={(e) => setWeightMode(e.target.value as typeof weightMode)}
                  >
                    <option value="igual">Igual para todas as questões</option>
                    <option value="personalizado">Personalizado por tipo</option>
                  </select>
                  {weightMode === "personalizado" && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
                      {ASSESSMENT_TYPES.map((type) => (
                        <div key={`weight-${type.key}`} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                          <span className="text-sm">{type.label}</span>
                          <Input
                            type="number"
                            min={0}
                            step="0.1"
                            className="w-24 h-8"
                            value={questionWeights[type.key]}
                            onChange={(e) =>
                              setQuestionWeights((prev) => ({
                                ...prev,
                                [type.key]: Math.max(0, Number(e.target.value) || 0),
                              }))
                            }
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  <p className={`text-xs ${weightSumMatches ? "text-muted-foreground" : "text-destructive"}`}>
                    {weightMode === "igual"
                      ? `Cada questão valerá ${perQuestionWeight.toFixed(2)} ponto(s). Soma = ${effectiveWeightTotal.toFixed(2)} / ${maxScore.toFixed(2)}.`
                      : `Soma dos pesos por tipo = ${effectiveWeightTotal.toFixed(2)} / ${maxScore.toFixed(2)}.`}
                    {!weightSumMatches && " A soma dos pesos deve corresponder à Nota Máxima da Avaliação."}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="ass-max-score">Nota Máxima da Avaliação</Label>
                  <Input
                    id="ass-max-score"
                    type="number"
                    min={0}
                    step="0.1"
                    value={maxScore}
                    onChange={(e) => setMaxScore(Math.max(0, Number(e.target.value) || 0))}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="ass-diary-column">
                    Coluna do Diário para Lançamento da Nota <span className="text-destructive">*</span>
                  </Label>
                  <select
                    id="ass-diary-column"
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={selectedDiaryColumnId}
                    onChange={(e) => setSelectedDiaryColumnId(e.target.value)}
                  >
                    <option value="">Selecione uma coluna do diário...</option>
                    {diaryColumns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} (peso {c.weight} · máx {c.max_score})
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    {diaryColumns.length === 0
                      ? "Nenhuma coluna cadastrada. Configure as avaliações em Notas & Diário."
                      : "A nota desta avaliação será lançada nessa coluna após a correção (vinculada ao QR Code)."}
                  </p>
                </div>

                <div className="rounded-md border bg-muted/20 p-3 space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="ass-kind">Modalidade da Prova</Label>
                    <select
                      id="ass-kind"
                      className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                      value={examKind}
                      onChange={(e) => setExamKind(e.target.value as "regular" | "second_call" | "recovery")}
                    >
                      <option value="regular">Regular — toda a turma</option>
                      <option value="second_call">Segunda chamada — alunos específicos</option>
                      <option value="recovery">Recuperação — alunos em recuperação</option>
                    </select>
                    <p className="text-xs text-muted-foreground">
                      {examKind === "regular"
                        ? "A prova será distribuída para todos os alunos matriculados."
                        : examKind === "second_call"
                          ? "Pesquise e selecione os alunos que farão a prova de segunda chamada (aqueles que faltaram no dia da avaliação)."
                          : "Os alunos com média abaixo da aprovação no diário já aparecem selecionados. Você pode ajustar manualmente."}
                    </p>
                  </div>

                  {examKind !== "regular" && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Label className="text-xs">
                          {examKind === "recovery" ? "Alunos em recuperação" : "Alunos"} —{" "}
                          <span className="text-muted-foreground">{targetStudentIds.length} selecionado(s)</span>
                        </Label>
                        {examKind === "recovery" && recoveryIds.length > 0 && (
                          <button
                            type="button"
                            className="text-xs text-primary hover:underline"
                            onClick={() => setTargetStudentIds(recoveryIds)}
                          >
                            Restaurar lista de recuperação
                          </button>
                        )}
                      </div>
                      <Input
                        value={studentSearch}
                        onChange={(e) => setStudentSearch(e.target.value)}
                        placeholder="Pesquisar por nome ou matrícula..."
                      />
                      <div className="max-h-52 overflow-y-auto rounded-md border bg-background divide-y">
                        {(() => {
                          const q = studentSearch.trim().toLowerCase();
                          const base = examKind === "recovery" && !q
                            ? allStudents.filter((s) => recoveryIds.includes(s.id) || targetStudentIds.includes(s.id))
                            : allStudents;
                          const list = q
                            ? base.filter((s) =>
                                s.name.toLowerCase().includes(q) ||
                                (s.enrollment_number ?? "").toLowerCase().includes(q))
                            : base;
                          if (list.length === 0) {
                            return (
                              <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                                {examKind === "recovery"
                                  ? "Nenhum aluno em recuperação no diário. Você ainda pode pesquisar e selecionar manualmente."
                                  : "Nenhum aluno encontrado."}
                              </div>
                            );
                          }
                          return list.map((s) => {
                            const checked = targetStudentIds.includes(s.id);
                            const inRecovery = recoveryIds.includes(s.id);
                            return (
                              <label key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40">
                                <Checkbox checked={checked} onCheckedChange={() => toggleTargetStudent(s.id)} />
                                <div className="min-w-0 flex-1">
                                  <div className="truncate">{s.name}</div>
                                  {s.enrollment_number && (
                                    <div className="text-[11px] text-muted-foreground">Matrícula {s.enrollment_number}</div>
                                  )}
                                </div>
                                {inRecovery && examKind === "second_call" && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">recuperação</span>
                                )}
                              </label>
                            );
                          });
                        })()}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Serão geradas folhas apenas para os alunos selecionados.
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex items-start justify-between gap-3 rounded-md border bg-muted/20 p-3">
                  <div className="space-y-0.5">
                    <Label htmlFor="ass-shuffle-items" className="text-sm">Embaralhar questões e itens</Label>
                    <p className="text-xs text-muted-foreground">
                      Reorganiza a ordem das questões e das alternativas dentro de cada versão para dificultar a cola.
                    </p>
                    <p className="text-xs text-muted-foreground pt-1">
                      {studentCount === null
                        ? "Verificando alunos cadastrados na turma..."
                        : studentCount === 0
                          ? "Nenhum aluno cadastrado na turma — nenhuma folha será gerada."
                          : `Serão geradas ${studentCount} folha(s) — uma por aluno matriculado — distribuídas de forma embaralhada entre as versões.`}
                    </p>
                  </div>
                  <Switch id="ass-shuffle-items" checked={shuffleItems} onCheckedChange={setShuffleItems} />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Distribuição por Tipo de Questão</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {ASSESSMENT_TYPES.map((t) => (
                  <div
                    key={t.key}
                    className="flex flex-col gap-2 border rounded-md px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm">{t.label}</span>
                      <Input
                        type="number"
                        min={0}
                        max={60}
                        className="w-20 h-8"
                        value={dist[t.key]}
                        onChange={(e) =>
                          setDist({
                            ...dist,
                            [t.key]: Math.max(0, Math.min(60, Number(e.target.value) || 0)),
                          })
                        }
                      />
                    </div>
                    {(FORMATTABLE_TYPES as string[]).includes(t.key) && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">Formato da resposta</span>
                        <select
                          className="h-8 rounded-md border bg-background px-2 text-xs"
                          value={formats[t.key as FormattableTypeKey]}
                          onChange={(e) =>
                            setFormats({
                              ...formats,
                              [t.key as FormattableTypeKey]: e.target.value as AnswerFormat,
                            })
                          }
                        >
                          <option value="gabarito_direto">Gabarito Direto</option>
                          <option value="multipla_escolha">Múltipla Escolha (5 alt.)</option>
                        </select>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <p
                className={`text-xs ${distSum === total ? "text-muted-foreground" : "text-destructive"}`}
              >
                Soma atual: {distSum} / {total}{" "}
                {distSum !== total && "— ajuste para igualar o total."}
              </p>
            </div>

            {!isExercicio && selectedApostilaId && (
              <div className="space-y-4 rounded-md border p-3">
                <div className="space-y-2">
                  <Label className="text-xs">Nível de Dificuldade</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { value: "facil", label: "Fácil" },
                      { value: "medio", label: "Médio" },
                      { value: "dificil", label: "Difícil" },
                    ] as const).map((option) => (
                      <Button
                        key={option.value}
                        type="button"
                        variant={difficultyLevel === option.value ? "default" : "outline"}
                        onClick={() => {
                          setDifficultyLevel(option.value);
                          setDifficultyByType((previous) => {
                            const next = { ...previous };
                            for (const type of ASSESSMENT_TYPES) {
                              next[type.key] = {
                                ...emptyDifficultyCounts(),
                                [option.value]: dist[type.key] || 0,
                              };
                            }
                            return next;
                          });
                        }}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Padrões de Qualidade das Questões</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {QUALITY_RULE_OPTIONS.map((rule) => (
                      <label key={rule.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={qualityRules.includes(rule.id)}
                          onCheckedChange={() => setQualityRules((prev) => toggle(prev, rule.id))}
                        />
                        <span>{rule.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Distribuição de Dificuldade por Tipo de Questão</Label>
                  <p className="text-[11px] text-muted-foreground">
                    Para cada tipo, defina quantas questões vão em cada dificuldade. A soma deve bater com a quantidade total do tipo.
                  </p>
                  <div className="grid grid-cols-1 gap-2">
                    {ASSESSMENT_TYPES.map((type) => {
                      const totalOfType = dist[type.key] || 0;
                      if (totalOfType === 0) return null;
                      const counts = difficultyByType[type.key];
                      const sum = sumDifficultyCounts(counts);
                      const mismatch = sum !== totalOfType;
                      return (
                        <div key={`diff-${type.key}`} className="rounded-md border px-3 py-2 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">{type.label}</span>
                            <span className={`text-[11px] tabular-nums ${mismatch ? "text-destructive" : "text-muted-foreground"}`}>
                              Soma: {sum} / {totalOfType}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {DIFFICULTY_LEVELS.map((lvl) => (
                              <label key={lvl} className="flex flex-col gap-1">
                                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                  {DIFFICULTY_SHORT_LABELS[lvl]}
                                </span>
                                <Input
                                  type="number"
                                  min={0}
                                  max={totalOfType}
                                  step={1}
                                  className="h-8 text-sm"
                                  value={counts[lvl]}
                                  onChange={(e) => {
                                    const v = Math.max(0, Math.min(totalOfType, parseInt(e.target.value || "0", 10) || 0));
                                    setDifficultyByType((prev) => ({
                                      ...prev,
                                      [type.key]: { ...prev[type.key], [lvl]: v },
                                    }));
                                  }}
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {!isExercicio && (
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Label>Layout das Folhas de Questões</Label>
                  <span className="text-[11px] rounded-full bg-primary/10 text-primary px-2 py-0.5">
                    Sugerido: {suggestedLayout === "uma_coluna" ? "Uma coluna" : suggestedLayout === "duas_colunas" ? "Duas colunas" : "Misto"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Confirme o layout sugerido automaticamente ou escolha manualmente. Formatos de múltipla escolha combinam com duas colunas; gabarito direto e dissertativas funcionam melhor em uma coluna. O layout misto aplica essas regras por tipo na mesma avaliação.
                </p>
                <RadioGroup
                  value={layoutMode}
                  onValueChange={(v) => { setLayoutManual(true); setLayoutMode(v as typeof layoutMode); }}
                  className="grid grid-cols-1 sm:grid-cols-3 gap-2"
                >
                  <label className="flex items-center gap-2 rounded-md border p-2 text-sm cursor-pointer hover:bg-muted/40">
                    <RadioGroupItem value="uma_coluna" id="layout-1" />
                    <span>Uma coluna</span>
                  </label>
                  <label className="flex items-center gap-2 rounded-md border p-2 text-sm cursor-pointer hover:bg-muted/40">
                    <RadioGroupItem value="duas_colunas" id="layout-2" />
                    <span>Duas colunas</span>
                  </label>
                  <label className="flex items-center gap-2 rounded-md border p-2 text-sm cursor-pointer hover:bg-muted/40">
                    <RadioGroupItem value="misto" id="layout-3" />
                    <span>Misto (por tipo)</span>
                  </label>
                </RadioGroup>
                {layoutManual && layoutMode !== suggestedLayout && (
                  <button
                    type="button"
                    onClick={() => { setLayoutManual(false); setLayoutMode(suggestedLayout); }}
                    className="text-xs text-primary underline"
                  >
                    Restaurar sugestão automática
                  </button>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              onClick={submit}
              disabled={
                loading ||
                loadingLists ||
                apostilas.length === 0 ||
                !selectedApostilaId ||
                selectedModules.length === 0 ||
                distSum !== total
              }
            >
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              Gerar {materialTitle}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}


function AIAssistantModuleContent({ disciplineId }: { disciplineId: string }) {
  const { profile } = useAuth();
  // Abas Chat/Criadores aparecem para todo perfil que não seja aluno.
  const isTeacher = profile?.profile_type !== "student";
  const [items, setItems] = useState<GenItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTool, setActiveTool] = useState<ToolKey | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [viewStartEdit, setViewStartEdit] = useState(false);
  const [dateForSlide, setDateForSlide] = useState<{ id: string; title: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  // Shared state for SimulSaude module integration with Lesson selection
  const [apostilas, setApostilas] = useState<ApostilaOption[]>([]);
  const [selectedApostilaId, setSelectedApostilaId] = useState<string>("");
  const [lessons, setLessons] = useState<string[]>([]);
  const [loadingLessons, setLoadingLessons] = useState(false);
  const [selectedLesson, setSelectedLesson] = useState<string>("");
  const [apostilaMarkdown, setApostilaMarkdown] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await listAIGenerations({
          data: { discipline_id: disciplineId, tool: "apostila", limit: 50 },
        });
        const list = onlyTool(res?.items, "apostila");
        if (!cancelled)
          setApostilas(sortItemsNumerically(list.map((a) => ({ id: a.id, title: a.title, created_at: a.created_at }))));
      } catch (e) {
        if (!cancelled) console.error("Erro ao carregar apostilas para o módulo prático", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [disciplineId]);

  useEffect(() => {
    if (!selectedApostilaId) {
      setLessons([]);
      setSelectedLesson("");
      setApostilaMarkdown("");
      return;
    }
    let cancelled = false;
    setLoadingLessons(true);
    (async () => {
      try {
        const res = await getAIGeneration({ data: { id: selectedApostilaId } });
        const md =
          typeof res?.result === "string" ? res.result : JSON.stringify(res?.result ?? "", null, 2);
        const found = extractLessonsFromApostila(md);
        if (!cancelled) {
          setLessons(found);
          setSelectedLesson(found[0] ?? "");
          setApostilaMarkdown(md);
        }
      } catch (e) {
        if (!cancelled) toast.error("Erro ao carregar conteúdo da apostila");
      } finally {
        if (!cancelled) setLoadingLessons(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedApostilaId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listAIGenerations({ data: { discipline_id: disciplineId } });
      const safeItems = Array.isArray(res?.items) ? res.items.filter(isGenItem) : [];
      setItems(safeItems);
    } catch (e) {
      setItems([]);
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setLoading(false);
    }
  }, [disciplineId]);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (id: string) => {
    if (
      !confirm(
        "Excluir esta geração? Se ela foi enviada aos alunos, a cópia correspondente (material/atividade/trabalho) também será removida da visão do aluno.",
      )
    )
      return;
    try {
      await deleteAIGeneration({ data: { id } });
      toast.success("Excluída");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  const removeMany = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    let failed = 0;
    for (const id of ids) {
      try {
        await deleteAIGeneration({ data: { id } });
      } catch {
        failed += 1;
      }
    }
    if (failed === 0) {
      toast.success(`${ids.length} geração(ões) excluída(s)`);
    } else {
      toast.error(`${failed} de ${ids.length} não puderam ser excluídas`);
    }
    clearSelection();
    load();
  };

  return (
    <div className="space-y-6">
      <div className="text-white">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-white" /> Assistente de IA
        </h2>
        <p className="text-sm opacity-80">
          Converse com o assistente ou use as ferramentas para gerar materiais didáticos.
        </p>
      </div>

      <Tabs defaultValue="chat" className="w-full">
        {isTeacher && (
          <TabsList className="bg-white/90 shadow-sm">
            <TabsTrigger value="chat">
              <MessageSquare className="h-4 w-4 mr-1.5" /> Chat
            </TabsTrigger>
            <TabsTrigger value="tools">
              <Sparkles className="h-4 w-4 mr-1.5" /> Criadores
            </TabsTrigger>
          </TabsList>
        )}
        <TabsContent value="chat" className={isTeacher ? "mt-4" : "mt-0"}>
          <ChatPanel disciplineId={disciplineId} isStudent={!isTeacher} />
        </TabsContent>
        <TabsContent value="tools" className="mt-4 space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {TOOLS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  onClick={() => setActiveTool(t.key)}
                  className="text-left rounded-xl border bg-card p-4 hover:scale-[1.02] transition-transform"
                  style={{ boxShadow: "var(--shadow-card)" }}
                >
                  <div
                    className="h-9 w-9 rounded-lg flex items-center justify-center text-white mb-2"
                    style={{ backgroundColor: `var(--color-card-${t.color})` }}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="font-medium text-sm">{t.label}</div>
                  <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                    {t.description}
                  </div>
                </button>
              );
            })}
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Gerações desta disciplina</h3>
              {!loading && items.length > 0 && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="select-all-geracoes"
                    checked={selectedIds.size === items.length && items.length > 0}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedIds(new Set(items.map((i) => i.id)));
                      } else {
                        clearSelection();
                      }
                    }}
                  />
                  <Label htmlFor="select-all-geracoes" className="text-xs text-muted-foreground cursor-pointer">
                    Selecionar tudo
                  </Label>
                </div>
              )}
            </div>
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted-foreground border-2 border-dashed rounded-xl py-6 text-center">
                Nenhuma geração ainda.
              </p>
            ) : (
              <div className="space-y-2">
                {items.map((g) => {
                  const tool = TOOLS.find((t) => t.key === g.tool);
                  return (
                    <div
                      key={g.id}
                      className="rounded-lg border bg-card p-3 flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Checkbox
                          checked={selectedIds.has(g.id)}
                          onCheckedChange={() => toggleSelected(g.id)}
                          aria-label={`Selecionar ${g.title}`}
                        />
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">{g.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {tool?.label ?? g.tool} · {new Date(g.created_at).toLocaleString("pt-BR")}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {g.tool === "slides" && (
                          <Button
                            size="sm"
                            variant="outline"
                            title="Adicionar ao calendário"
                            onClick={() => setDateForSlide({ id: g.id, title: g.title })}
                          >
                            <Plus className="h-4 w-4 mr-1" />
                            Calendário
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setViewStartEdit(false);
                            setViewing(g.id);
                          }}
                        >
                          Ver
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setViewStartEdit(true);
                            setViewing(g.id);
                          }}
                        >
                          <Pencil className="h-4 w-4 mr-1" />
                          Editar
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          onClick={() => remove(g.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <BulkDeleteBar
              count={selectedIds.size}
              itemLabel="geração"
              onClear={clearSelection}
              onConfirm={removeMany}
            />
          </div>
        </TabsContent>
      </Tabs>

      {activeTool &&
        (activeTool === "lesson_plan" ? (
          <LessonPlanDialog
            disciplineId={disciplineId}
            onClose={() => setActiveTool(null)}
            onDone={(id: string) => {
              setActiveTool(null);
              load();
              setViewing(id);
            }}
          />
        ) : activeTool === "apostila" ? (
          <ApostilaDialog
            disciplineId={disciplineId}
            onClose={() => setActiveTool(null)}
            onDone={(id: string) => {
              setActiveTool(null);
              load();
              setViewing(id);
            }}
          />
        ) : activeTool === "slides" ? (
          <SlidesDialog
            disciplineId={disciplineId}
            onClose={() => setActiveTool(null)}
            onDone={(id: string) => {
              setActiveTool(null);
              load();
              setViewing(id);
            }}
          />
        ) : activeTool === "exercise_list" ? (
          <ExerciseListDialog
            disciplineId={disciplineId}
            onClose={() => setActiveTool(null)}
            onDone={(id) => {
              setActiveTool(null);
              load();
              setViewing(id);
            }}
          />
        ) : activeTool === "simulsaude_creator" ? (
          <Dialog open={true} onOpenChange={(open) => !open && setActiveTool(null)}>
            <DialogContent className="max-w-4xl max-h-[95vh] overflow-y-auto">
              <DialogHeader className="mb-4">
                <DialogTitle className="flex items-center gap-2">
                  <Stethoscope className="h-5 w-5 text-primary" />
                  Gerador de Casos Clínicos (SimulSaúde)
                </DialogTitle>
                <DialogDescription>
                  Defina o tema, anamnese e condutas esperadas para criar um caso clínico realista.
                </DialogDescription>
              </DialogHeader>
              <ClinicalCaseGenerator 
                disciplineId={disciplineId}
                onPublished={() => {
                  setActiveTool(null);
                  toast.success("Caso clínico publicado! Redirecionando para o Módulo Prático...");
                  load();
                }}
              />
            </DialogContent>
          </Dialog>
        ) : (activeTool as string) === "simulsaude" ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Stethoscope className="h-6 w-6 text-primary" />
                Módulo Prático (SimulSaúde)
              </h2>
              <Button variant="ghost" onClick={() => setActiveTool(null)}>
                <X className="h-4 w-4 mr-1" /> Fechar Módulo
              </Button>
            </div>
            
            <div className="bg-muted/30 p-4 rounded-xl border border-dashed flex flex-col md:flex-row gap-4">
              <div className="flex-1 space-y-2">
                <Label className="text-xs uppercase text-muted-foreground font-bold">Apostila / Módulo Ativo</Label>
                <Select value={selectedApostilaId} onValueChange={setSelectedApostilaId}>
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Selecione a Apostila" />
                  </SelectTrigger>
                  <SelectContent>
                    {apostilas.map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 space-y-2">
                <Label className="text-xs uppercase text-muted-foreground font-bold">Aulas / Módulos Selecionados</Label>
                <div className="bg-background border rounded-lg p-2 max-h-[42px] overflow-hidden flex items-center justify-between">
                  <span className="text-sm truncate">
                    {selectedLesson || (lessons.length > 0 ? `${lessons.length} aulas selecionadas` : "Selecione o Módulo")}
                  </span>
                  <Badge variant="secondary" className="text-[10px]">
                    {lessons.length} aulas
                  </Badge>
                </div>
              </div>
            </div>

            <SimulSaudeModule 
              disciplineId={disciplineId} 
              isTeacher={true} 
              selectedApostilaId={selectedApostilaId}
              selectedLessons={lessons}
            />
          </div>
        ) : activeTool === "quiz" ? (
          <AssessmentCreatorDialog
            disciplineId={disciplineId}
            onClose={() => setActiveTool(null)}
            onDone={(id: string) => {
              setActiveTool(null);
              load();
              setViewing(id);
            }}
          />
        ) : activeTool === "activity_creator" ? (
          <ActivityWorkCreatorDialog
            disciplineId={disciplineId}
            onClose={() => setActiveTool(null)}
            onDone={() => {
              setActiveTool(null);
              load();
            }}
          />
        ) : activeTool === "case_study" ? (
          <CaseStudyDialog
            disciplineId={disciplineId}
            onClose={() => setActiveTool(null)}
            onDone={(id: string) => {
              setActiveTool(null);
              load();
              setViewing(id);
            }}
          />
        ) : activeTool === "activity_syllabus" ? (
          <SyllabusDialog
            disciplineId={disciplineId}
            onClose={() => setActiveTool(null)}
            onDone={(id: string) => {
              setActiveTool(null);
              load();
              setViewing(id);
            }}
          />
        ) : (
          <GenerateDialog
            tool={activeTool as ToolKey}
            disciplineId={disciplineId}
            onClose={() => setActiveTool(null)}
            onDone={(id) => {
              setActiveTool(null);
              load();
              setViewing(id);
            }}
          />
        ))}
      {viewing && (
        <ViewDialog
          id={viewing}
          startInEdit={viewStartEdit}
          onClose={() => {
            setViewing(null);
            setViewStartEdit(false);
            load();
          }}
        />
      )}
      {dateForSlide && (
        <SlideCalendarDateDialog
          disciplineId={disciplineId}
          title={dateForSlide.title}
          onClose={() => setDateForSlide(null)}
        />
      )}
    </div>
  );
}

type ChatMsg = { id: string; role: "user" | "assistant"; content: string };

function createChatMessage(role: ChatMsg["role"], content: string): ChatMsg {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { id: `${role}-${id}`, role, content };
}

function jsonToMarkdown(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const allPrimitive = value.every((v) => typeof v !== "object" || v === null);
    if (allPrimitive) return value.map((v) => `- ${jsonToMarkdown(v, depth + 1)}`).join("\n");
    return value.map((v) => jsonToMarkdown(v, depth + 1)).join("\n\n");
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const headerLevel = Math.min(depth + 2, 4);
    const hash = "#".repeat(headerLevel);
    const parts: string[] = [];
    const titleKey = ["title", "name", "heading", "label"].find((k) => typeof obj[k] === "string");
    if (titleKey) parts.push(`${hash} ${String(obj[titleKey])}`);
    for (const [k, v] of Object.entries(obj)) {
      if (k === titleKey) continue;
      if (v === null || v === undefined || v === "") continue;
      const label = k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      if (typeof v === "object") {
        parts.push(`**${label}:**\n\n${jsonToMarkdown(v, depth + 1)}`);
      } else {
        parts.push(`**${label}:** ${jsonToMarkdown(v, depth + 1)}`);
      }
    }
    return parts.join("\n\n");
  }
  return "";
}

function tryParseJson(text: string): unknown | null {
  const t = text.trim();
  // strip ```json fences
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1] : t;
  const candidates = [candidate];
  const objectStart = candidate.indexOf("{");
  const objectEnd = candidate.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.push(candidate.slice(objectStart, objectEnd + 1));
  }
  const arrayStart = candidate.indexOf("[");
  const arrayEnd = candidate.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    candidates.push(candidate.slice(arrayStart, arrayEnd + 1));
  }
  for (const item of candidates) {
    if (!(item.startsWith("{") || item.startsWith("[") || item.startsWith('"'))) continue;
    try {
      const parsed = JSON.parse(item);
      if (typeof parsed === "string") return tryParseJson(parsed) ?? parsed;
      return parsed;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function formatStageValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(formatStageValue).filter(Boolean).join("\n");
  if (isRecord(value)) return jsonToMarkdown(value);
  return value === null || value === undefined ? "" : String(value);
}

function LessonPlanMessage({ plan }: { plan: Record<string, unknown> }) {
  const stages = Array.isArray(plan.stages) ? plan.stages.filter(isRecord) : [];
  return (
    <div className="space-y-4">
      {typeof plan.title === "string" && plan.title.trim() && (
        <h2 className="text-lg font-semibold leading-snug">{plan.title}</h2>
      )}
      {stages.map((stage, index) => {
        const name =
          formatStageValue(stage.name || stage.moduleName || stage.title || stage.heading) ||
          `Etapa ${index + 1}`;
        const minutes =
          stage.minutes ??
          stage.duration_minutes ??
          stage.durationMinutes ??
          stage.duration ??
          null;
        const activities = formatStageValue(
          stage.activities || stage.activity || stage.description || stage.instructions,
        );
        return (
          <section
            key={`${name}-${index}`}
            className="rounded-lg border bg-background/60 p-3 space-y-2"
          >
            <div>
              <h3 className="font-semibold leading-snug">{name}</h3>
              {minutes !== null && minutes !== undefined && String(minutes).trim() && (
                <small className="text-muted-foreground">{String(minutes)} min</small>
              )}
            </div>
            {activities && <p className="whitespace-pre-line leading-relaxed">{activities}</p>}
          </section>
        );
      })}
    </div>
  );
}

function looksLikeRawJson(text: string): boolean {
  const t = text.trim();
  return (
    /^(?:\{|\[)/.test(t) ||
    /"(?:title|stages|objectives|activities|materials|assessment|duration_minutes|minutes)"\s*:/.test(
      t,
    )
  );
}

function stripRawJsonMarks(text: string): string {
  return text
    .replace(/[{}[\]"]/g, "")
    .replace(/^\s*,\s*/gm, "")
    .replace(/\n\s*,/g, "\n")
    .trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInlineMarkdown(value: string): string {
  return (
    escapeHtml(value)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      // Restore line break tags emitted by the AI inside table cells / paragraphs.
      .replace(/&lt;br\s*\/?&gt;/gi, "<br />")
  );
}

/**
 * Renderiza conteúdo de slides com layout de DUAS COLUNAS:
 * - Coluna Esquerda: Título, bullets, exemplo prático
 * - Coluna Direita: Apenas a imagem (imageUrl)
 * Este layout é usado para visualização no frontend.
 */
function renderSlidesTwoColumn(markdown: string): string {
  const lines = normalizeAIContent(markdown).replace(/\r\n/g, "\n").split("\n");
  const slides: string[] = [];
  let i = 0;
  let currentSlide: { title?: string; bullets: string[]; imageUrl?: string } | null = null;
  let currentSection = "";
  let isInList = false;

  const flushSlide = () => {
    if (!currentSlide) return;

    // Constrói HTML do slide
    const titleHtml = currentSlide.title
      ? `<h3 style="margin: 0 0 0.75rem; font-size: 1.1rem; color: #1e293b; border-bottom: 2px solid var(--primary); padding-bottom: 0.5rem;">${renderInlineMarkdown(currentSlide.title)}</h3>`
      : '';

    const bulletsHtml = currentSlide.bullets.length > 0
      ? `<ul style="margin: 0.5rem 0; padding-left: 1.25rem; display: flex; flex-direction: column; gap: 0.35rem;">${
          currentSlide.bullets.map(b => `<li style="font-size: 0.85rem; line-height: 1.5;">${renderInlineMarkdown(b)}</li>`).join('')
        }</ul>`
      : '';

    if (currentSlide.imageUrl) {
      // Layout de duas colunas com imagem (Gamma-style)
      slides.push(`<div class="slide-card"><div class="slide-content-col">${titleHtml}${bulletsHtml}</div><div class="slide-image-col"><img src="${escapeHtml(currentSlide.imageUrl)}" alt="Imagem ilustrativa" class="w-full h-full object-contain" loading="lazy" crossOrigin="anonymous" /></div></div>`);
    } else {
      // Sem imagem: ocupa toda a largura (layout elegante centralizado)
      slides.push(`<div class="slide-card no-image"><div class="slide-content-col">${titleHtml}${bulletsHtml}</div></div>`);
    }

    currentSlide = null;
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      if (isInList) {
        slides.push('</ul>');
        isInList = false;
      }
      i++;
      continue;
    }

    // Verifica se é divisor de seção
    const sectionMatch = trimmed.match(/^(?:SLIDE\s+\d+|---SLIDE---|M[OÓ]DULO\s*\d*|AULA\s*\d*|ENCERRAMENTO|COVER)\s*:?\s*/i);
    if (sectionMatch) {
      flushSlide();
      const sectionName = trimmed
        .replace(/^SLIDE\s+\d+\s*:\s*/i, '')
        .replace(/^---\s*/, '')
        .replace(/:$/, '')
        .trim();
      slides.push(`<div class="slide-section-title">${renderInlineMarkdown(sectionName || trimmed)}</div>`);
      i++;
      continue;
    }

    // Verifica se é uma imagem de slide - regex flexível para aceitar texto após URL
    const slideImage = trimmed.match(/^Imagem\s*:\s*(https?:\/\/\S+)/i);
    if (slideImage) {
      if (!currentSlide) currentSlide = { bullets: [] };
      currentSlide.imageUrl = slideImage[1].trim();
      i++;
      continue;
    }

    // Verifica se é título
    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushSlide();
      const title = heading[2].replace(/^\d+\s*[-–]\s*/, '');
      currentSlide = { bullets: [] };
      currentSlide.title = title;
      i++;
      continue;
    }

    // Verifica se é seção de conteúdo
    if (/^Conte[úu]do Principal\s*:?\s*$/i.test(trimmed)) {
      currentSection = "main";
      i++;
      continue;
    }
    if (/^Detalhes Adicionais\s*:?\s*$/i.test(trimmed)) {
      currentSection = "extra";
      i++;
      continue;
    }

    // Pula "Sugestão de Recurso Visual" e "Notas do Professor"
    if (/^Sugest[ãa]o de Recurso Visual\s*:/i.test(trimmed) || /^Notas do Professor\s*:/i.test(trimmed)) {
      i++;
      continue;
    }

    // Bullet point
    const bullet = trimmed.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      if (!currentSlide) currentSlide = { bullets: [] };
      if (!isInList) {
        slides.push('<ul style="margin: 0.5rem 0; padding-left: 1.25rem;">');
        isInList = true;
      }
      slides.push(`<li style="font-size: 0.85rem; line-height: 1.5;">${renderInlineMarkdown(bullet[1])}</li>`);
      currentSlide.bullets.push(bullet[1]);
      i++;
      continue;
    }

    // Fecha lista ao encontrar outro conteúdo
    if (isInList) {
      slides.push('</ul>');
      isInList = false;
    }

    // Parágrafo (inicia novo slide se necessário)
    if (!currentSlide || currentSlide.title || currentSlide.bullets.length > 0) {
      flushSlide();
      currentSlide = { bullets: [] };
    }
    if (currentSlide) {
      currentSlide.bullets.push(trimmed);
    }

    i++;
  }

  // Fecha lista e slide final
  if (isInList) {
    slides.push('</ul>');
  }
  flushSlide();

  return slides.join('\n');
}

function renderMarkdownHtml(markdown: string): string {
  // Detecta se é conteúdo de slides e usa renderização de duas colunas
  if (/^\s*SLIDE\s+\d+\s*:/im.test(markdown) || /^\s*M[OÓ]DULO\s+\d+\s*:/im.test(markdown)) {
    return renderSlidesTwoColumn(markdown);
  }

  const lines = normalizeAIContent(markdown).replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Standalone image (e.g. the document logo) — render as an <img>.
    const image = trimmed.match(/^!\[[^\]]*\]\(([^)]+)\)$/);
    if (image) {
      html.push(
        `<img src="${escapeHtml(image[1])}" alt="Logo" style="max-height:64px;width:auto;object-fit:contain" />`,
      );
      i += 1;
      continue;
    }

    // Slide images: "Imagem: https://..." format — render with larger size for slides.
    // crossOrigin="anonymous" is required for html2canvas/PDF export compatibility.
    // Uses object-contain to prevent distortion/flattening of the image.
    // Regex is flexible to handle various formats like "Imagem:", "Imagem :" or "Imagem : ".
    // Also accepts text after the URL (e.g., "Imagem: https://... (description)")
    const slideImage = trimmed.match(/^Imagem\s*:\s*(https?:\/\/\S+)/i);
    if (slideImage) {
      html.push(
        `<div class="my-4 rounded-lg overflow-hidden border bg-muted/20">
          <img src="${escapeHtml(slideImage[1])}" alt="Imagem ilustrativa do slide" class="w-full max-h-64 object-contain" loading="lazy" crossOrigin="anonymous" />
         </div>`,
      );
      i += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 6);
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (
      trimmed.startsWith("|") &&
      lines[i + 1]?.trim().match(/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/)
    ) {
      const headers = trimmed
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(
          lines[i]
            .trim()
            .split("|")
            .map((c) => c.trim())
            .filter(Boolean),
        );
        i += 1;
      }
      html.push(
        `<div class="overflow-x-auto"><table><thead><tr>${headers.map((h) => `<th>${renderInlineMarkdown(h)}</th>`).join("")}</tr></thead><tbody>${rows
          .map(
            (row) =>
              `<tr>${headers.map((_, idx) => `<td>${renderInlineMarkdown((row[idx] ?? "").replace(/(^|<br\s*\/?>)\s*[-*]\s+/gi, "$1• "))}</td>`).join("")}</tr>`,
          )
          .join("")}</tbody></table></div>`,
      );
      continue;
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      const items: string[] = [];
      while (i < lines.length) {
        const item = lines[i].trim().match(/^[-*]\s+(.+)$/);
        if (!item) break;
        items.push(`<li>${renderInlineMarkdown(item[1])}</li>`);
        i += 1;
      }
      html.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      const items: string[] = [];
      while (i < lines.length) {
        const item = lines[i].trim().match(/^\d+[.)]\s+(.+)$/);
        if (!item) break;
        items.push(`<li>${renderInlineMarkdown(item[1])}</li>`);
        i += 1;
      }
      html.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim()) {
      const next = lines[i].trim();
      if (/^(#{1,6})\s+/.test(next) || /^[-*]\s+/.test(next) || /^\d+[.)]\s+/.test(next)) break;
      paragraph.push(next);
      i += 1;
    }
    if (paragraph.length) html.push(`<p>${paragraph.map(renderInlineMarkdown).join("<br />")}</p>`);
    else i += 1;
  }

  return html.join("\n");
}

function htmlToPlainText(html: string): string {
  if (typeof document !== "undefined") {
    const container = document.createElement("div");
    container.innerHTML = html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|h[1-6]|li|tr|div)>/gi, "$&\n")
      .replace(/<\/(td|th)>/gi, "\t");
    const text = container.textContent || "";
    return text
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+\n/g, "\n")
      .trim();
  }
  return html.replace(/<[^>]+>/g, "");
}

function AssistantMessage({ content }: { content: string }) {
  let working = useMemo(() => normalizeAIContent(content).trim(), [content]);

  const parsed = tryParseJson(working);
  if (isRecord(parsed) && Array.isArray(parsed.stages)) {
    return <LessonPlanMessage plan={parsed} />;
  }
  if (isRecord(parsed)) {
    working = normalizeAIContent(parsed).trim();
  }
  const md =
    parsed !== null && !isRecord(parsed)
      ? jsonToMarkdown(parsed)
      : looksLikeRawJson(working)
        ? stripRawJsonMarks(working)
        : working;
  return (
    <div
      translate="no"
      className="prose prose-sm max-w-none dark:prose-invert prose-headings:mt-3 prose-headings:mb-1 prose-p:my-1 prose-ul:my-1 notranslate"
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: renderMarkdownHtml(md) }}
    />
  );
}

function ChatPanel({ disciplineId, isStudent = false }: { disciplineId: string; isStudent?: boolean }) {
  const { profile } = useAuth();
  const [disciplineName, setDisciplineName] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load persistence and discipline info
  useEffect(() => {
    const key = `chat_persist_${disciplineId}_${profile?.id || "anon"}`;
    const saved = localStorage.getItem(key);
    
    // Fetch discipline name
    supabase.from("disciplines").select("name").eq("id", disciplineId).maybeSingle().then(({ data }) => {
      if (data?.name) {
        setDisciplineName(data.name);
        
        if (saved) {
          try {
            setMessages(JSON.parse(saved));
          } catch (e) {
            console.error("Error loading chat history", e);
          }
        } else {
          setMessages([
            {
              id: "assistant-welcome",
              role: "assistant",
              content: isStudent 
                ? `Olá! Sou seu Tutor Virtual de ${data.name}. Como posso ajudar nos seus estudos hoje?`
                : "Olá! Sou seu assistente pedagógico desta disciplina. Posso ajudar com planos de aula, sugerir atividades, tirar dúvidas pedagógicas ou resumir o desempenho da turma. Como posso ajudar?",
            },
          ]);
        }
      }
    });
  }, [disciplineId, isStudent, profile?.id]);

  // Save persistence
  useEffect(() => {
    if (messages.length > 0) {
      const key = `chat_persist_${disciplineId}_${profile?.id || "anon"}`;
      localStorage.setItem(key, JSON.stringify(messages));
    }
  }, [messages, disciplineId, profile?.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const send = async (textOverride?: string) => {
    const text = textOverride || input.trim();
    if (!text || sending) return;
    
    const next: ChatMsg[] = [...messages, createChatMessage("user", text)];
    setMessages(next);
    setInput("");
    setSending(true);
    
    try {
      const TIMEOUT_MS = 60000;
      
      const res = await Promise.race<{ content: string }>([
        chatWithAssistant({
          data: {
            discipline_id: disciplineId,
            messages: next.map((m) => ({ role: m.role, content: m.content })),
            is_student_tutor: isStudent
          },
        }),
        new Promise<{ content: string }>((_, reject) =>
          setTimeout(
            () => reject(new Error("Não foi possível obter resposta. Tente novamente.")),
            TIMEOUT_MS,
          ),
        ),
      ]);
      
      setMessages((prev) => [
        ...prev,
        createChatMessage("assistant", normalizeAIContent(res.content || "(sem resposta)")),
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao conversar com o assistente";
      toast.error(msg);
      setMessages((prev) => [...prev, createChatMessage("assistant", `⚠️ ${msg}`)]);
    } finally {
      setSending(false);
    }
  };

  const suggestions = isStudent ? [
    "Explique o conceito principal do Módulo atual",
    "Me dê um exemplo prático ou caso clínico",
    "Resuma os pontos fundamentais da última aula"
  ] : [];

  return (
    <div
      className="rounded-xl border bg-card flex flex-col h-[70vh] notranslate overflow-hidden"
      translate="no"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      {/* Header */}
      <div className="bg-muted/50 p-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-teal-500/10 flex items-center justify-center border border-teal-500/20">
            <GraduationCap className="h-6 w-6 text-teal-600" />
          </div>
          <div>
            <div className="font-bold text-sm flex items-center gap-1.5">
              Tutor Virtual • {disciplineName || "Carregando..."}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                Online • Sincronizado com a Ementa
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Suggestions Chips */}
      {isStudent && messages.length <= 1 && (
        <div className="p-3 bg-muted/20 border-b flex gap-2 overflow-x-auto no-scrollbar">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="whitespace-nowrap px-3 py-1 rounded-full bg-background border text-xs font-medium hover:bg-accent transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 notranslate bg-muted/5"
        translate="no"
      >
        {messages.map((m) => (
          <div
            key={m.id}
            translate="no"
            className={`flex notranslate ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              translate="no"
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm notranslate shadow-sm relative group ${
                m.role === "user" 
                  ? "bg-primary text-primary-foreground rounded-tr-none" 
                  : "bg-card border border-border rounded-tl-none"
              }`}
            >
              {m.role === "assistant" && (
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(m.content);
                    toast.success("Resposta copiada!");
                  }}
                  className="absolute -right-10 top-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                >
                  <Copy className="h-4 w-4" />
                </button>
              )}
              {m.role === "user" ? (
                <div translate="no" className="whitespace-pre-wrap notranslate">
                  {m.content}
                </div>
              ) : (
                <div translate="no" className="notranslate leading-relaxed">
                  <AssistantMessage content={m.content} />
                </div>
              )}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
             <div className="bg-card border border-border rounded-2xl rounded-tl-none px-4 py-3 shadow-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="text-xs font-medium">Processando conhecimento...</span>
                </div>
             </div>
          </div>
        )}
      </div>
      
      <div className="p-4 bg-background border-t">
        <div className="flex gap-2 max-w-4xl mx-auto">
          <Input
            placeholder={isStudent ? "Tire sua dúvida sobre esta disciplina..." : "Pergunte algo sobre a disciplina..."}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            className="flex-1 py-6 px-4 bg-muted/30 focus-visible:ring-primary"
            disabled={sending}
          />
          <Button 
            onClick={() => send()} 
            disabled={sending || !input.trim()}
            className="h-auto px-6 shadow-md transition-all active:scale-95"
          >
            {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

function GenerateDialog({
  tool,
  disciplineId,
  onClose,
  onDone,
}: {
  tool: ToolKey;
  disciplineId: string;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const meta = TOOLS.find((t) => t.key === tool)!;
  const [prompt, setPrompt] = useState("");
  const [extra, setExtra] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!prompt.trim()) {
      toast.error("Descreva o que você quer gerar");
      return;
    }

    // Pedagogical Symmetry Check
    if (tool === "apostila") {
      const res = await listAIGenerations({ data: { discipline_id: disciplineId, tool: "lesson_plan", limit: 1 } });
      if (!res.items || res.items.length === 0) {
        toast.warning("Recomendamos criar ou selecionar o Plano de Aula deste módulo primeiro para garantir a sincronia dos conteúdos.");
      }
    }

    setLoading(true);
    try {
      const res = await generateAIContent({
        data: {
          tool,
          prompt: prompt.trim(),
          extra_context: extra.trim() || undefined,
          discipline_id: disciplineId,
        },
      });
      if (!hasGeneratedContentId(res)) throw new Error("Resposta inválida da geração");
      toast.success("Conteúdo gerado");
      onDone(res.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <AILoadingOverlay open={loading} onCancel={() => setLoading(false)} />
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> {meta.label}
            </DialogTitle>
            <DialogDescription>{meta.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>O que você quer gerar?</Label>
              <Textarea
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Ex: Plano de aula sobre fotossíntese para 1º ano do ensino médio, 50 minutos"
              />
            </div>
            <div>
              <Label>Contexto adicional (opcional)</Label>
              <Textarea
                rows={2}
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                placeholder="Nível dos alunos, abordagem pedagógica, restrições..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}{" "}
              Gerar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ============================================================================
 * Criador de Exercícios — UI dialog
 * ============================================================================ */

const EXERCISE_TYPES: Array<{ key: ExerciseTypeKey; label: string }> = [
  { key: "multipla_escolha", label: "Múltipla Escolha" },
  { key: "verdadeiro_falso", label: "Verdadeiro ou Falso" },
  { key: "completar_lacunas", label: "Completar Lacunas" },
];

type ExerciseTypeKey = "multipla_escolha" | "verdadeiro_falso" | "completar_lacunas";

type Distribution = Record<ExerciseTypeKey, number>;

const ZERO_DIST: Distribution = {
  multipla_escolha: 0,
  verdadeiro_falso: 0,
  completar_lacunas: 0,
};

type ExerciseDifficulty = "facil" | "medio" | "dificil" | "superior";
type ExerciseDifficultyCounts = Record<ExerciseDifficulty, number>;
type ExerciseDifficultyByType = Record<ExerciseTypeKey, ExerciseDifficultyCounts>;

function emptyExerciseDifficultyCounts(): ExerciseDifficultyCounts {
  return { facil: 0, medio: 0, dificil: 0, superior: 0 };
}
function sumExerciseDifficultyCounts(c: ExerciseDifficultyCounts): number {
  return c.facil + c.medio + c.dificil + c.superior;
}

/**
 * Distribute a total grade value across `count` questions so the parts sum
 * exactly to `total`. Each part is rounded to 2 decimals; any rounding
 * remainder is added to the last question.
 */
function distributePoints(total: number, count: number): number[] {
  if (count <= 0) return [];
  const safeTotal = Math.max(0.1, Number(total) || 0);
  const base = Math.max(0.01, Math.round((safeTotal / count) * 100) / 100);
  const points = Array.from({ length: count }, () => base);
  const diff = Math.round((safeTotal - base * count) * 100) / 100;
  points[count - 1] = Math.max(0.01, Math.round((points[count - 1] + diff) * 100) / 100);
  return points;
}

function extractLessonsFromApostila(markdown: string): string[] {
  const outlinePrefix = String.raw`(?:\d+(?:\.\d+)*[.)]?\s*)?`;
  const patterns = [
    // ## 1.3 Aula 3: ... / ## Aula 1: ...
    new RegExp(`^#{1,6}\s*(?:\*\*)?\s*(${outlinePrefix}Aula\s+\d+[^*\n]*)(?:\*\*)?\s*$`, "gim"),
    // **1.3 Aula 3: ...** / **Aula 1: ...**
    new RegExp(`^\s*\*\*\s*(${outlinePrefix}Aula\s+\d+[^*\n]*)\*\*\s*$`, "gim"),
    // - 1.3 Aula 3: ... (bare list/heading-less)
    new RegExp(`^[\s\-*•]*(${outlinePrefix}Aula\s+\d+\s*[:-][^\n]+)$`, "gim"),
  ];
  const lessons: string[] = [];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(markdown)) !== null) {
      lessons.push(m[1]);
    }
  }
  return dedupeLessonTitles(sanitizeTitleList(lessons));
}

function ExerciseListDialog({
  disciplineId,
  onClose,
  onDone,
}: {
  disciplineId: string;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const [apostilas, setApostilas] = useState<ApostilaOption[]>([]);
  const [loadingLists, setLoadingLists] = useState(true);
  const [selectedApostilaId, setSelectedApostilaId] = useState<string>("");
  const [lessons, setLessons] = useState<string[]>([]);
  const [loadingLessons, setLoadingLessons] = useState(false);
  const [selectedLesson, setSelectedLesson] = useState<string>("");
  const [customLesson, setCustomLesson] = useState<string>("");
  const [apostilaMarkdown, setApostilaMarkdown] = useState<string>("");
  const [total, setTotal] = useState<number>(6);
  const [totalPoints, setTotalPoints] = useState<number>(10);
  const [dist, setDist] = useState<Distribution>({
    ...ZERO_DIST,
    multipla_escolha: 4,
    verdadeiro_falso: 1,
    completar_lacunas: 1,
  });
  const [difficultyLevel, setDifficultyLevel] = useState<ExerciseDifficulty>("medio");
  const [difficultyByType, setDifficultyByType] = useState<ExerciseDifficultyByType>({
    multipla_escolha: { facil: 0, medio: 0, dificil: 0, superior: 0 },
    verdadeiro_falso: { facil: 0, medio: 0, dificil: 0, superior: 0 },
    completar_lacunas: { facil: 0, medio: 0, dificil: 0, superior: 0 },
  });
  const [topicSuggestions, setTopicSuggestions] = useState<string[]>([]);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [customTopics, setCustomTopics] = useState<string>("");
  // Padrão: TODAS as regras de qualidade marcadas — mesmo padrão do Criador de
  // Avaliações, para manter a consistência entre exercícios e avaliações.
  const [qualityRules, setQualityRules] = useState<string[]>(
    QUALITY_RULE_OPTIONS.map((rule) => rule.id),
  );
  const [shuffleQuestions, setShuffleQuestions] = useState<boolean>(true);
  const [shuffleOptions, setShuffleOptions] = useState<boolean>(true);
  const [loading, setLoading] = useState(false);

  const toggleList = (arr: string[], value: string) =>
    arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];

  const distSum = useMemo(
    () => EXERCISE_TYPES.reduce((acc, t) => acc + (dist[t.key] || 0), 0),
    [dist],
  );

  // Mantém a distribuição de dificuldade por tipo coerente com a distribuição
  // de quantidades: quando o total de um tipo muda, reajusta o excedente/
  // faltante no nível de dificuldade geral atual.
  useEffect(() => {
    setDifficultyByType((prev) => {
      const next = { ...prev } as ExerciseDifficultyByType;
      let changed = false;
      for (const t of EXERCISE_TYPES) {
        const target = dist[t.key] || 0;
        const cur = next[t.key];
        const sum = sumExerciseDifficultyCounts(cur);
        if (sum === target) continue;
        const diff = target - sum;
        const adjusted = { ...cur, [difficultyLevel]: Math.max(0, cur[difficultyLevel] + diff) };
        const newSum = sumExerciseDifficultyCounts(adjusted);
        if (newSum !== target) {
          // Fallback: força zerar tudo e colocar o total no nível geral.
          next[t.key] = { facil: 0, medio: 0, dificil: 0, superior: 0, [difficultyLevel]: target };
        } else {
          next[t.key] = adjusted;
        }
        changed = true;
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dist.multipla_escolha, dist.verdadeiro_falso, dist.completar_lacunas]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await listAIGenerations({
          data: { discipline_id: disciplineId, tool: "apostila", limit: 50 },
        });
        const list = onlyTool(res?.items, "apostila");
        if (!cancelled)
          setApostilas(list.map((a) => ({ id: a.id, title: a.title, created_at: a.created_at })));
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Erro ao carregar apostilas");
      } finally {
        if (!cancelled) setLoadingLists(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [disciplineId]);

  useEffect(() => {
    if (!selectedApostilaId) {
      setLessons([]);
      setSelectedLesson("");
      setApostilaMarkdown("");
      return;
    }
    let cancelled = false;
    setLoadingLessons(true);
    (async () => {
      try {
        const res = await getAIGeneration({ data: { id: selectedApostilaId } });
        const md =
          typeof res?.result === "string" ? res.result : JSON.stringify(res?.result ?? "", null, 2);
        const found = extractLessonsFromApostila(md);
        if (!cancelled) {
          setLessons(found);
          setSelectedLesson(found[0] ?? "");
          setApostilaMarkdown(md);
        }
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Erro ao ler apostila");
      } finally {
        if (!cancelled) setLoadingLessons(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedApostilaId]);

  // Recompute topic suggestions scoped to the selected lesson so the teacher only
  // sees topics belonging to the lesson chosen in the previous step.
  useEffect(() => {
    if (!apostilaMarkdown) {
      setTopicSuggestions([]);
      setSelectedTopics([]);
      return;
    }
    const lesson = selectedLesson === "__custom__" ? customLesson : selectedLesson;
    const scoped = extractTopicSuggestionsForLesson(apostilaMarkdown, lesson);
    const completeTopics = (scoped.length > 0 ? scoped : extractApostilaTopicSuggestions(apostilaMarkdown))
      .map((topic) => sanitizeExtractedConcept(topic, null))
      .filter(Boolean);
    setTopicSuggestions(Array.from(new Set(completeTopics)));
    setSelectedTopics([]);
  }, [apostilaMarkdown, selectedLesson, customLesson]);

  const submit = async () => {
    if (!selectedApostilaId) return toast.error("Selecione uma Apostila");
    const lesson = (selectedLesson === "__custom__" ? customLesson : selectedLesson).trim();
    if (lesson.length < 2) return toast.error("Informe a Aula Selecionada");
    if (total < 1) return toast.error("Informe o Número Total de Questões");
    if (distSum !== total)
      return toast.error(
        `A soma das quantidades por tipo (${distSum}) deve ser igual ao total (${total}).`,
      );
    for (const t of EXERCISE_TYPES) {
      const target = dist[t.key] || 0;
      if (target === 0) continue;
      const sum = sumExerciseDifficultyCounts(difficultyByType[t.key]);
      if (sum !== target) {
        return toast.error(
          `Em "${t.label}", a soma das dificuldades (${sum}) deve ser igual à quantidade do tipo (${target}).`,
        );
      }
    }
    setLoading(true);
    try {
      // The selected apostila corresponds to a single module (title like
      // "Apostila - Módulo 1: Tema"). Derive the module label so exercises can
      // be grouped by module in the list.
      const apostilaTitle = apostilas.find((a) => a.id === selectedApostilaId)?.title ?? "";
      const moduleLabel = apostilaTitle
        .replace(/^\s*apostila\s*[-–—:]\s*/i, "")
        .trim()
        .slice(0, 300);
      const res = await generateExerciseListFromApostila({
        data: {
          discipline_id: disciplineId,
          apostila_id: selectedApostilaId,
          lesson_title: lesson,
          module_label: moduleLabel || undefined,
          total_questions: total,
          total_points: totalPoints,
          distribution: dist,
          difficulty_level: difficultyLevel,
          difficulty_by_type: difficultyByType,
          // Quando o professor não restringe manualmente a lista, use todos os
          // conceitos detectados na aula. Cada item passa pelo extrator comum,
          // que preserva a nomenclatura técnica integral.
          topics: Array.from(
            new Set([
              ...(selectedTopics.length > 0 ? selectedTopics : topicSuggestions)
                .map((topic) => sanitizeExtractedConcept(topic, null))
                .filter(Boolean),
              ...customTopics
                .split(/[\n;]+/)
                .map((topic) => sanitizeExtractedConcept(topic.trim(), null))
                .filter(Boolean),
            ]),
          ).slice(0, 40).map(t => typeof t === 'string' ? t.substring(0, 190) : t), // FIX: Truncando no Frontend
          quality_rules: qualityRules,
          shuffle_questions: shuffleQuestions,
          shuffle_options: shuffleOptions
        }
      });
      if (!hasGeneratedContentId(res)) throw new Error("Resposta inválida da geração");
      toast.success("Lista de exercícios gerada!");
      onDone(res.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar exercícios");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Gerar Lista de Exercícios</DialogTitle>
          <DialogDescription>Crie exercícios com base no material da apostila.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Apostila Base</Label>
            <Select value={selectedApostilaId} onValueChange={setSelectedApostilaId}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {apostilas.map(a => <SelectItem key={a.id} value={a.id}>{a.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Tópicos Customizados (Opcional)</Label>
            <Textarea 
              value={customTopics} 
              onChange={e => setCustomTopics(e.target.value)} 
              placeholder="Um tópico por linha..." 
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={loading}>{loading ? "Gerando..." : "Gerar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Apostila dialog: select an existing Lesson Plan and add audience/objective.
// ============================================================================

interface LessonPlanOption {
  id: string;
  title: string;
  created_at: string;
}

function parsePlanModulesWithLessons(
  md: string,
): Array<{ module: string; lessons: string[] }> {
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
      if (t && !current.lessons.some((l) => l.toLowerCase() === t.toLowerCase())) {
        current.lessons.push(t);
      }
      continue;
    }
    const ar = line.match(aulaRowRe);
    if (ar) {
      const num = ar[1];
      let tema = (ar[2] ?? "").trim();
      if (!tema || /^-+$/.test(tema) || /^tema/i.test(tema)) continue;
      tema = tema.replace(/<br\s*\/?>/gi, " / ").replace(/\s+/g, " ");
      const lessonName = `Aula ${num}: ${tema}`;
      if (!current.lessons.some((l) => l.toLowerCase() === lessonName.toLowerCase())) {
        current.lessons.push(lessonName);
      }
    }
  }
  return result;
}

function ApostilaDialog({
  disciplineId,
  onClose,
  onDone,
}: {
  disciplineId: string;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const [plans, setPlans] = useState<LessonPlanOption[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  // Visual-resource suggestions are always included; the toggle was removed from the UI.
  const includeVisualSuggestions = true;
  const [planStructure, setPlanStructure] = useState<Array<{ module: string; lessons: string[] }>>(
    [],
  );
  const [selectedLessons, setSelectedLessons] = useState<Record<string, string[]>>({});
  const [moduleSelected, setModuleSelected] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loadingModules, setLoadingModules] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await listAIGenerations({
          data: { discipline_id: disciplineId, tool: "lesson_plan", limit: 50 },
        });
        const list = onlyTool(res?.items, "lesson_plan");
        if (!cancelled)
          setPlans(list.map((p) => ({ id: p.id, title: p.title, created_at: p.created_at })));
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Erro ao carregar planos");
      } finally {
        if (!cancelled) setLoadingPlans(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [disciplineId]);

  // When a plan is selected, fetch it and extract module titles.
  useEffect(() => {
    if (!selectedPlanId) {
      setPlanStructure([]);
      setSelectedLessons({});
      setModuleSelected({});
      setExpanded({});
      return;
    }
    let cancelled = false;
    setLoadingModules(true);
    (async () => {
      try {
        const res = await getAIGeneration({ data: { id: selectedPlanId } });
        const result = (res as { result?: unknown })?.result;
        const md = typeof result === "string" ? result : JSON.stringify(result ?? "");
        const structure = parsePlanModulesWithLessons(md);
        if (!cancelled) {
          setPlanStructure(structure);
          const lessonsState: Record<string, string[]> = {};
          const modState: Record<string, boolean> = {};
          const expState: Record<string, boolean> = {};
          for (const m of structure) {
            lessonsState[m.module] = [...m.lessons];
            modState[m.module] = true;
            expState[m.module] = true;
          }
          setSelectedLessons(lessonsState);
          setModuleSelected(modState);
          setExpanded(expState);
        }
      } catch {
        if (!cancelled) {
          setPlanStructure([]);
          setSelectedLessons({});
          setModuleSelected({});
          setExpanded({});
        }
      } finally {
        if (!cancelled) setLoadingModules(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPlanId]);

  const submit = async () => {
    if (!disciplineId) return toast.error("Abra o criador dentro de uma disciplina.");
    if (!selectedPlanId) return toast.error("Selecione um Plano de Aula");
    setLoading(true);
    try {
      // Build lesson-level selection. For modules without parsed lessons,
      // fall back to module-level inclusion via selected_modules.
      const lessonPayload: Array<{ module: string; lesson: string }> = [];
      const moduleOnly: string[] = [];
      for (const m of planStructure) {
        if (m.lessons.length === 0) {
          if (moduleSelected[m.module]) moduleOnly.push(m.module);
          continue;
        }
        const chosen = selectedLessons[m.module] ?? [];
        for (const l of chosen) lessonPayload.push({ module: m.module, lesson: l });
      }
      const totalLessons = planStructure.reduce((acc, m) => acc + m.lessons.length, 0);
      const allLessonsSelected =
        totalLessons > 0 && lessonPayload.length === totalLessons && moduleOnly.length === 0;
      if (totalLessons > 0 && lessonPayload.length === 0 && moduleOnly.length === 0) {
        toast.error("Selecione ao menos uma aula para gerar a apostila");
        setLoading(false);
        return;
      }
      const res = await generateApostila({
        data: {
          disciplineId,
          discipline_id: disciplineId,
          planId: selectedPlanId,
          lesson_plan_id: selectedPlanId,
          include_visual_suggestions: includeVisualSuggestions,
          selected_modules: moduleOnly.length ? moduleOnly : undefined,
          selected_lessons:
            lessonPayload.length && !allLessonsSelected ? lessonPayload : undefined,
        },
      });
      if (!hasGeneratedContentId(res)) throw new Error("Resposta inválida");
      toast.success("Apostila gerada");
      onDone(res.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar apostila");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <AILoadingOverlay open={loading} onCancel={() => setLoading(false)} />
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" /> Criador de Apostila
            </DialogTitle>
            <DialogDescription>
              Selecione um Plano de Aula existente desta disciplina. A IA inferirá automaticamente o
              público-alvo e o objetivo geral da apostila a partir do conteúdo do plano (ementa,
              nível de ensino, curso, semestre, módulos, aulas e objetivos de aprendizagem).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>
                Selecionar Plano de Aula Existente <span className="text-destructive">*</span>
              </Label>
              {loadingPlans ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando planos...
                </div>
              ) : plans.length === 0 ? (
                <p className="text-sm text-muted-foreground border-2 border-dashed rounded-lg p-3">
                  Nenhum Plano de Aula encontrado nesta disciplina. Gere um plano primeiro pelo
                  "Plano de aula" para depois criar uma apostila a partir dele.
                </p>
              ) : (
                <select
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={selectedPlanId}
                  onChange={(e) => setSelectedPlanId(e.target.value)}
                >
                  <option value="">Selecione um plano...</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} — {new Date(p.created_at).toLocaleDateString("pt-BR")}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {selectedPlanId && (
              <div className="space-y-2 rounded-md border p-3">
                <Label>Módulos e Aulas a Gerar</Label>
                <p className="text-xs text-muted-foreground">
                  Expanda cada módulo para escolher exatamente quais aulas devem compor a apostila.
                  Por padrão, todas as aulas estão marcadas.
                </p>
                {loadingModules ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Lendo módulos e aulas do plano...
                  </div>
                ) : planStructure.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nenhum módulo identificado neste plano — a apostila será gerada por completo.
                  </p>
                ) : (
                  <>
                    <div className="flex gap-2 text-xs">
                      <button
                        type="button"
                        className="underline text-primary"
                        onClick={() => {
                          const all: Record<string, string[]> = {};
                          const mod: Record<string, boolean> = {};
                          for (const m of planStructure) {
                            all[m.module] = [...m.lessons];
                            mod[m.module] = true;
                          }
                          setSelectedLessons(all);
                          setModuleSelected(mod);
                        }}
                      >
                        Todos
                      </button>
                      <span className="text-muted-foreground">·</span>
                      <button
                        type="button"
                        className="underline text-primary"
                        onClick={() => {
                          const empty: Record<string, string[]> = {};
                          const mod: Record<string, boolean> = {};
                          for (const m of planStructure) {
                            empty[m.module] = [];
                            mod[m.module] = false;
                          }
                          setSelectedLessons(empty);
                          setModuleSelected(mod);
                        }}
                      >
                        Nenhum
                      </button>
                    </div>
                    <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                      {planStructure.map((m) => {
                        const lessons = m.lessons;
                        const chosen = selectedLessons[m.module] ?? [];
                        const allChecked =
                          lessons.length > 0 && chosen.length === lessons.length;
                        const someChecked = chosen.length > 0 && !allChecked;
                        const moduleChecked =
                          lessons.length === 0
                            ? !!moduleSelected[m.module]
                            : allChecked;
                        const isOpen = expanded[m.module] ?? true;
                        return (
                          <div key={m.module} className="rounded-md border bg-background">
                            <div className="flex items-center gap-2 px-2 py-1.5">
                              <Checkbox
                                checked={someChecked ? "indeterminate" : moduleChecked}
                                onCheckedChange={(v) => {
                                  const next = v === true;
                                  setSelectedLessons((cur) => ({
                                    ...cur,
                                    [m.module]: next ? [...lessons] : [],
                                  }));
                                  setModuleSelected((cur) => ({ ...cur, [m.module]: next }));
                                }}
                              />
                              <button
                                type="button"
                                className="flex-1 text-left text-sm font-medium hover:underline"
                                onClick={() =>
                                  setExpanded((cur) => ({ ...cur, [m.module]: !isOpen }))
                                }
                                disabled={lessons.length === 0}
                              >
                                {m.module}
                                {lessons.length > 0 && (
                                  <span className="ml-2 text-xs text-muted-foreground">
                                    ({chosen.length}/{lessons.length} aulas)
                                  </span>
                                )}
                              </button>
                              {lessons.length > 0 && (
                                <span className="text-xs text-muted-foreground">
                                  {isOpen ? "▾" : "▸"}
                                </span>
                              )}
                            </div>
                            {isOpen && lessons.length > 0 && (
                              <div className="border-t px-3 py-2 space-y-1">
                                <label className="flex items-center gap-2 text-xs cursor-pointer text-muted-foreground">
                                  <Checkbox
                                    checked={allChecked}
                                    onCheckedChange={(v) => {
                                      const next = v === true;
                                      setSelectedLessons((cur) => ({
                                        ...cur,
                                        [m.module]: next ? [...lessons] : [],
                                      }));
                                      setModuleSelected((cur) => ({
                                        ...cur,
                                        [m.module]: next,
                                      }));
                                    }}
                                  />
                                  Selecionar todas as aulas
                                </label>
                                {lessons.map((lesson) => {
                                  const isChecked = chosen.includes(lesson);
                                  return (
                                    <label
                                      key={lesson}
                                      className="flex items-start gap-2 text-sm cursor-pointer"
                                    >
                                      <Checkbox
                                        checked={isChecked}
                                        onCheckedChange={(v) => {
                                          setSelectedLessons((cur) => {
                                            const curList = cur[m.module] ?? [];
                                            const nextList =
                                              v === true
                                                ? Array.from(new Set([...curList, lesson]))
                                                : curList.filter((x) => x !== lesson);
                                            return { ...cur, [m.module]: nextList };
                                          });
                                          setModuleSelected((cur) => ({
                                            ...cur,
                                            [m.module]:
                                              v === true ||
                                              (selectedLessons[m.module] ?? []).filter(
                                                (x) => x !== lesson,
                                              ).length > 0,
                                          }));
                                        }}
                                        className="mt-0.5"
                                      />
                                      <span>{lesson}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={loading || loadingPlans || plans.length === 0}>
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              Gerar Apostila
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface ApostilaOption {
  id: string;
  title: string;
  created_at: string;
}


function TemplateThumb({ templateKey }: { templateKey: SlideTemplateKey }) {
  const accent = "#4338CA";
  // A tiny wireframe preview of each layout style.
  if (templateKey === "moderno") {
    return (
      <span className="block h-10 w-full overflow-hidden rounded bg-[#0B2138]">
        <span className="flex h-full">
          <span className="w-1.5" style={{ backgroundColor: accent }} />
          <span className="flex-1 bg-[#F8FAFC] p-1.5">
            <span className="block h-1 w-2/3 rounded" style={{ backgroundColor: accent }} />
            <span className="mt-1 block h-0.5 w-full rounded bg-slate-300" />
            <span className="mt-1 block h-0.5 w-5/6 rounded bg-slate-300" />
          </span>
        </span>
      </span>
    );
  }
  if (templateKey === "classico") {
    return (
      <span className="block h-10 w-full overflow-hidden rounded bg-white ring-1 ring-inset ring-slate-200">
        <span className="flex h-full">
          <span className="w-2" style={{ backgroundColor: accent }} />
          <span className="flex-1 p-1.5">
            <span className="block h-1 w-1/2 rounded bg-slate-800" />
            <span className="mt-1 block h-0.5 w-full rounded bg-slate-300" />
            <span className="mt-1 block h-0.5 w-3/4 rounded bg-slate-300" />
          </span>
        </span>
      </span>
    );
  }
  if (templateKey === "escuro") {
    return (
      <span className="block h-10 w-full overflow-hidden rounded bg-[#0F172A] p-1.5">
        <span className="block h-1 w-2/3 rounded" style={{ backgroundColor: accent }} />
        <span className="mt-1 block h-0.5 w-full rounded bg-slate-500" />
        <span className="mt-1 block h-0.5 w-5/6 rounded bg-slate-500" />
      </span>
    );
  }
  // minimalista
  return (
    <span className="block h-10 w-full overflow-hidden rounded bg-white p-1.5 ring-1 ring-inset ring-slate-200">
      <span className="block h-1 w-1/2 rounded bg-slate-800" />
      <span className="mt-0.5 block h-0.5 w-6 rounded" style={{ backgroundColor: accent }} />
      <span className="mt-1.5 block h-0.5 w-full rounded bg-slate-200" />
      <span className="mt-1 block h-0.5 w-2/3 rounded bg-slate-200" />
    </span>
  );
}

function SlidesDialog({
  disciplineId,
  onClose,
  onDone,
}: {
  disciplineId: string;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const [apostilas, setApostilas] = useState<ApostilaOption[]>([]);
  const [loadingLists, setLoadingLists] = useState(true);
  const [selectedApostilaId, setSelectedApostilaId] = useState<string>("");
  const [scopeOptions, setScopeOptions] = useState<
    { value: string; label: string; type: "module" | "lesson" }[]
  >([]);
  const [loadingScope, setLoadingScope] = useState(false);
  const [selectedScope, setSelectedScope] = useState<string>("all");
  const [durationMinutes, setDurationMinutes] = useState<number>(50);
  const [maxSlides, setMaxSlides] = useState<number>(20);
  const [textAmount, setTextAmount] = useState<
    "minimo" | "conciso" | "detalhado" | "extenso"
  >("conciso");
  const [colorTheme, setColorTheme] = useState<SlideColorThemeKey>("variado");
  const [template, setTemplate] = useState<SlideTemplateKey>("moderno");
  const [lessonDate, setLessonDate] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [apostilaContent, setApostilaContent] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const aRes = await listAIGenerations({
          data: { discipline_id: disciplineId, tool: "apostila", limit: 50 },
        });
        const aList = onlyTool(aRes?.items, "apostila");
        if (!cancelled) {
          setApostilas(aList.map((a) => ({ id: a.id, title: a.title, created_at: a.created_at })));
        }
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Erro ao carregar dados");
      } finally {
        if (!cancelled) setLoadingLists(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [disciplineId]);

  // When an apostila is selected, read its content and extract the list of
  // Módulos and Aulas so the professor can generate slides for a subset.
  useEffect(() => {
    if (!selectedApostilaId) {
      setScopeOptions([]);
      setSelectedScope("all");
      setApostilaContent("");
      return;
    }
    let cancelled = false;
    setLoadingScope(true);
    (async () => {
      try {
        const res = await getAIGeneration({ data: { id: selectedApostilaId } });
        const result = (res as { result?: unknown })?.result;
        const md = typeof result === "string" ? result : JSON.stringify(result ?? "");
        if (!cancelled) setApostilaContent(md);
        const re = /^#{1,6}\s*((?:M[óo]dulo|Aula)\s+\d+[^\n]*)/gim;
        const seen = new Set<string>();
        const opts: { value: string; label: string; type: "module" | "lesson" }[] = [];
        for (const m of Array.from(md.matchAll(re))) {
          const raw = (m[1] ?? "").trim().replace(/\s+/g, " ").replace(/[*_]+$/g, "").trim();
          if (!raw || seen.has(raw)) continue;
          seen.add(raw);
          const type = /^m[óo]dulo/i.test(raw) ? "module" : "lesson";
          opts.push({ value: raw, label: raw, type });
        }
        // Dedupe lessons by number ("Aula 7"): a mesma aula pode aparecer no
        // bloco de objetivos (com bullets "•" / "/") e novamente como título
        // real da aula. Preferimos a versão sem bullets e mais curta (título).
        const byKey = new Map<string, { value: string; label: string; type: "module" | "lesson" }>();
        const finalOpts: { value: string; label: string; type: "module" | "lesson" }[] = [];
        for (const o of opts) {
          if (o.type === "module") {
            finalOpts.push(o);
            continue;
          }
          const key = (o.label.match(/aula\s*0*(\d+)/i)?.[1] ?? o.label).toLowerCase();
          const existing = byKey.get(key);
          const hasBullets = /[•·]|\s\/\s/.test(o.label);
          if (!existing) {
            byKey.set(key, o);
            finalOpts.push(o);
          } else {
            const existingHasBullets = /[•·]|\s\/\s/.test(existing.label);
            // Substitui se a nova é "melhor" (sem bullets quando a anterior tinha,
            // ou mais curta quando ambas são do mesmo tipo).
            const replace =
              (existingHasBullets && !hasBullets) ||
              (existingHasBullets === hasBullets && o.label.length < existing.label.length);
            if (replace) {
              const idx = finalOpts.indexOf(existing);
              if (idx >= 0) finalOpts[idx] = o;
              byKey.set(key, o);
            }
          }
        }
        if (!cancelled) setScopeOptions(finalOpts);
      } catch {
        if (!cancelled) {
          setScopeOptions([]);
          setApostilaContent("");
        }
      } finally {
        if (!cancelled) setLoadingScope(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedApostilaId]);

  const submit = async () => {
    if (!selectedApostilaId) return toast.error("Selecione uma Apostila");
    const dur = Math.max(15, Math.min(360, Math.round(durationMinutes || 0)));
    const n = Math.max(3, Math.min(60, Math.round(maxSlides || 0)));
    const scope = scopeOptions.find((o) => o.value === selectedScope);
    const selectedContent = scope
      ? apostilaContent.slice(Math.max(0, apostilaContent.toLowerCase().indexOf(scope.value.toLowerCase())), 18000)
      : apostilaContent.slice(0, 18000);
    const prompt = [
      scope ? `Criar slides para: ${scope.label}` : "Criar slides para a apostila completa",
      `Duração estimada: ${dur} minutos`,
      `Máximo de slides: ${n}`,
      "Conteúdo base da apostila:",
      selectedContent || apostilas.find((item) => item.id === selectedApostilaId)?.title || "Apostila selecionada",
    ].join("\n");
    setLoading(true);
    try {
      const res = await generateSlidesFromApostila({
        data: {
          prompt,
          discipline_id: disciplineId,
          disciplineId,
          apostila_id: selectedApostilaId,
          planId: selectedApostilaId,
          lessonId: scope && scope.type === "lesson" ? scope.value : "",
          duration_minutes: dur,
          max_slides: n,
          maxSlides: n,
          scope_type: scope ? scope.type : "all",
          scope_value: scope ? scope.value : undefined,
          text_amount: textAmount,
          textDensity: textAmount,
          color_theme: colorTheme,
          colorTheme,
          template,
        },
      });

      if (!hasGeneratedContentId(res)) throw new Error("Resposta inválida");
      if (lessonDate && scope && scope.type === "lesson") {
        try {
          await saveCalendarEvent({
            data: {
              discipline_id: disciplineId,
              title: scope.label,
              event_date: new Date(lessonDate).toISOString(),
              kind: "aula",
            },
          });
        } catch (err) {
          console.warn("Falha ao adicionar ao calendário", err);
        }
      }
      toast.success("Slides gerados");
      onDone(res.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar slides");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <AILoadingOverlay open={loading} onCancel={() => setLoading(false)} />
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Presentation className="h-4 w-4 text-primary" /> Criador de Slides
            </DialogTitle>
            <DialogDescription>
              Os slides são gerados a partir do conteúdo da Apostila. O Plano de Aula é usado apenas
              para a estrutura de módulos e aulas. Defina quantos slides deseja por aula.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>
                Selecionar Apostila Existente <span className="text-destructive">*</span>
              </Label>
              {loadingLists ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
                </div>
              ) : apostilas.length === 0 ? (
                <p className="text-sm text-muted-foreground border-2 border-dashed rounded-lg p-3">
                  Nenhuma Apostila encontrada nesta disciplina. Gere uma Apostila primeiro pelo
                  "Criador de Apostila" para depois criar os slides a partir dela.
                </p>
              ) : (
                <select
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={selectedApostilaId}
                  onChange={(e) => setSelectedApostilaId(e.target.value)}
                >
                  <option value="">Selecione uma apostila...</option>
                  {apostilas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title} — {new Date(a.created_at).toLocaleDateString("pt-BR")}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="slides-scope">Gerar Slides para a(s) Aula(s)</Label>
              {loadingScope ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Lendo módulos e aulas...
                </div>
              ) : (
                <select
                  id="slides-scope"
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm disabled:opacity-50"
                  value={selectedScope}
                  onChange={(e) => setSelectedScope(e.target.value)}
                  disabled={!selectedApostilaId}
                >
                  <option value="all">Todas as Aulas</option>
                  {scopeOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.type === "module" ? o.label : `\u2003${o.label}`}
                    </option>
                  ))}
                </select>
              )}
              <p className="text-xs text-muted-foreground">
                Escolha gerar slides para toda a apostila, um módulo específico ou apenas uma aula.
              </p>
            </div>

            {scopeOptions.find((o) => o.value === selectedScope)?.type === "lesson" && (
              <div className="space-y-1.5">
                <Label htmlFor="slides-lesson-date">Data e hora da aula (opcional)</Label>
                <Input
                  id="slides-lesson-date"
                  type="datetime-local"
                  value={lessonDate}
                  onChange={(e) => setLessonDate(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Se preenchida, a aula é adicionada ao Calendário da disciplina.
                </p>
              </div>
            )}

            <p className="rounded-md border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
              O <strong>Plano de Aula</strong> vinculado à Apostila é usado automaticamente apenas
              como referência de estrutura (módulos e aulas). O <strong>público-alvo</strong> é
              inferido automaticamente do Curso e Nível de Ensino da Apostila.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="slides-duration">Duração Estimada (min)</Label>
                <Input
                  id="slides-duration"
                  type="number"
                  min={15}
                  max={360}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">Ex.: 50, 100, 150.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="slides-max">Número Máximo de Slides</Label>
                <Input
                  id="slides-max"
                  type="number"
                  min={3}
                  max={60}
                  value={maxSlides}
                  onChange={(e) => setMaxSlides(Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Mínimo 3, máximo 60. A IA não excederá este valor.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Quantidade de texto por cartão</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                  [
                    { value: "minimo", label: "Mínimo", lines: 1 },
                    { value: "conciso", label: "Conciso", lines: 2 },
                    { value: "detalhado", label: "Detalhado", lines: 3 },
                    { value: "extenso", label: "Extenso", lines: 4 },
                  ] as const
                ).map((opt) => {
                  const active = textAmount === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setTextAmount(opt.value)}
                      aria-pressed={active}
                      className={`flex flex-col items-center gap-2 rounded-md border p-3 text-center transition-colors ${
                        active
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <span className="flex w-full flex-col items-center gap-1">
                        {Array.from({ length: opt.lines }).map((_, i) => (
                          <span
                            key={i}
                            className={`h-0.5 rounded-full ${active ? "bg-primary" : "bg-muted-foreground/40"}`}
                            style={{ width: `${70 - i * 8}%` }}
                          />
                        ))}
                      </span>
                      <span
                        className={`text-xs font-medium ${active ? "text-primary" : "text-foreground"}`}
                      >
                        {opt.label}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Controla o volume de texto em cada slide, do mais enxuto ao mais detalhado.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Modelo de slides</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(Object.values(SLIDE_TEMPLATES)).map((tpl) => {
                  const active = template === tpl.key;
                  return (
                    <button
                      key={tpl.key}
                      type="button"
                      onClick={() => setTemplate(tpl.key)}
                      aria-pressed={active}
                      title={tpl.description}
                      className={`flex flex-col gap-2 rounded-md border p-2.5 text-left transition-colors ${
                        active
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <TemplateThumb templateKey={tpl.key} />
                      <span
                        className={`text-xs font-medium ${active ? "text-primary" : "text-foreground"}`}
                      >
                        {tpl.label}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                {SLIDE_TEMPLATES[template].description}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Cor dos slides</Label>
              <div className="flex flex-wrap gap-2">
                {(Object.values(SLIDE_COLOR_THEMES)).map((th) => {
                  const active = colorTheme === th.key;
                  return (
                    <button
                      key={th.key}
                      type="button"
                      onClick={() => setColorTheme(th.key)}
                      aria-pressed={active}
                      title={th.label}
                      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                        active
                          ? "border-primary bg-primary/5 ring-1 ring-primary text-primary"
                          : "border-border hover:bg-muted/50 text-foreground"
                      }`}
                    >
                      {th.key === "variado" ? (
                        <span
                          className="h-4 w-4 rounded-full border"
                          style={{
                            backgroundImage:
                              "conic-gradient(#0F766E,#4338CA,#B45309,#9F1239,#047857,#6D28D9,#0369A1,#0F766E)",
                          }}
                        />
                      ) : (
                        <span
                          className="h-4 w-4 rounded-full border"
                          style={{ backgroundColor: th.swatch }}
                        />
                      )}
                      {th.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                "Variado" alterna a cor a cada módulo. As demais aplicam uma paleta única.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={loading || loadingLists || apostilas.length === 0}>
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              Gerar Slides
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}


// ============================================================================
// Advanced Lesson Plan dialog with full configuration form.
// ============================================================================

const WEEKDAY_OPTIONS = [
  { value: "mon", label: "Segunda" },
  { value: "tue", label: "Terça" },
  { value: "wed", label: "Quarta" },
  { value: "thu", label: "Quinta" },
  { value: "fri", label: "Sexta" },
  { value: "sat", label: "Sábado" },
] as const;


const QUESTION_TYPE_OPTIONS: { name: string; description: string }[] = [
  {
    name: "Múltipla Escolha",
    description:
      "Apresenta uma pergunta ou afirmação incompleta seguida de várias alternativas, das quais apenas uma (ou mais, dependendo do enunciado) é correta. Avalia reconhecimento e aplicação de conceitos.",
  },
  {
    name: "Discursivas",
    description:
      "Exigem que o aluno elabore uma resposta escrita, expondo raciocínio, argumentação e domínio do conteúdo de forma estruturada.",
  },
  {
    name: "Verdadeiro ou Falso",
    description:
      "O aluno deve julgar afirmações como verdadeiras ou falsas e justificar a resposta, demonstrando compreensão e capacidade crítica.",
  },
  {
    name: "Completar Lacunas",
    description:
      "Frases ou textos com espaços em branco que o aluno deve preencher com termos, conceitos ou dados corretos, avaliando memorização contextualizada.",
  },
  {
    name: "Aplicação de Conceitos",
    description:
      "Propõe situações-problema em que o aluno deve aplicar teorias e conceitos estudados para resolver casos reais ou hipotéticos.",
  },
  {
    name: "Comparação e Contraste",
    description:
      "Solicita ao aluno identificar semelhanças e diferenças entre conceitos, autores, fenômenos ou abordagens, estimulando análise crítica.",
  },
];

const TEACHING_AREA_OPTIONS = [
  "Ciências Exatas e da Terra",
  "Ciências Biológicas",
  "Engenharias",
  "Ciências da Saúde",
  "Ciências Agrárias",
  "Ciências Sociais Aplicadas",
  "Ciências Humanas",
  "Linguística, Letras e Artes",
  "Outros",
] as const;

const EDUCATION_LEVEL_OPTIONS = [
  "Ensino Médio",
  "Ensino Superior (Graduação)",
  "Ensino Superior (Pós-Graduação)",
  "Ensino Técnico",
  "Outro",
] as const;


export type LessonPlanModuleConfig = {
  hasLessons: boolean;
  lessons: number;
  hasCaseStudies: boolean;
  caseStudies: number;
  hasAcademicWork: boolean;
  academicWorkTypes: string[];
  hasClinicalCase: boolean;
  clinicalCaseTheme: string;
  hasExtraActivity: boolean;
  extraActivityTypes: string[];
  evaluations: number;
  evaluationType: string;
};

const MODULE_EVALUATION_TYPES = [
  "Prova Escrita",
  "Prova Prática",
  "Apresentação/Seminário",
  "Trabalho Escrito",
  "Avaliação Oral",
];

const MODULE_WORK_TYPE_PREDEFINED = "Trabalho Acadêmico com Tema Pré-definido pelo Professor";
const MODULE_WORK_TYPES = [
  "Trabalho de Conclusão de Curso (TCC)",
  "Artigo Científico",
  "Projeto de Caso (Trabalho)",
  "Resumo Expandido",
  "Relatório de Pesquisa",
  MODULE_WORK_TYPE_PREDEFINED,
];

/** Tipos de trabalho efetivamente marcados; nunca cai em "Artigo Científico" por padrão. */
const resolveWorkTypes = (cfg: LessonPlanModuleConfig): string[] =>
  cfg.academicWorkTypes.length ? cfg.academicWorkTypes : [MODULE_WORK_TYPE_PREDEFINED];

const MODULE_EXTRA_ACTIVITY_TYPES = [
  "Seminários",
  "Debates",
  "Visitas Técnicas",
  "Aulas práticas",
  "Workshops",
];

function makeModuleConfig(lessons: number): LessonPlanModuleConfig {
  return {
    hasLessons: lessons > 0,
    lessons,
    hasCaseStudies: false,
    caseStudies: 1,
    hasAcademicWork: false,
    academicWorkTypes: [],
    hasClinicalCase: false,
    clinicalCaseTheme: "",
    hasExtraActivity: false,
    extraActivityTypes: [],
    evaluations: 1,
    evaluationType: "Prova Escrita",
  };
}

const toggleInList = (list: string[], value: string): string[] =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];


function buildLessonPlanPrompt(params: {
  name: string;
  teacherName: string;
  teachingArea: string;
  educationLevel: string;
  course?: string;
  semester: number;
  syllabus: string;
  startDate: string;
  endDate: string;
  location: string;
  weekDays: string[];
  classesPerWeekday: Record<string, number>;
  duration: number;
  cargaHoraria: string;
  totalModules: number;
  topicsPerClass: number;
  moduleConfigs: LessonPlanModuleConfig[];
  questionTypesPerEval: Record<string, string[]>;
  hasAcademicWeek: boolean;
  academicWeekStart?: string;
  academicWeekEnd?: string;
  manualHolidays: string[];
}): string {
  const dayLabels = Object.fromEntries(WEEKDAY_OPTIONS.map((d) => [d.value, d.label]));
  const lines: string[] = [];

  lines.push(`# Pedido de Plano de Aula`);
  lines.push("");
  lines.push(`## Dados da Disciplina`);
  lines.push(`- Nome da disciplina: ${params.name}`);
  if (params.teacherName) lines.push(`- Professor(a): ${params.teacherName}`);
  lines.push(`- Área de ensino: ${params.teachingArea}`);
  lines.push(`- Nível de ensino: ${params.educationLevel}`);
  if (params.course) lines.push(`- Curso: ${params.course}`);
  lines.push(`- Semestre: ${params.semester}º`);
  lines.push(`- Carga horária: ${params.cargaHoraria || "Não informada"}`);
  lines.push(`- Localização: ${params.location || "Não informada"}`);
  lines.push("");
  lines.push(`## Ementa`);
  lines.push(params.syllabus);
  lines.push("");
  lines.push(`## Cronograma e Carga Horária`);
  lines.push(`- Período letivo: ${params.startDate} a ${params.endDate}`);
  lines.push(
    `- Dias de aula: ${params.weekDays.map((d) => dayLabels[d] || d).join(", ") || "Não informado"}`
  );
  params.weekDays.forEach((d) => {
    lines.push(
      `  - ${dayLabels[d] || d}: ${params.classesPerWeekday[d] ?? 1} aula(s) de ${params.duration} min`
    );
  });
  lines.push(`- Duração de cada aula: ${params.duration} minutos`);
  lines.push(`- Total de módulos: ${params.totalModules}`);
  lines.push(`- Temas por aula: ${params.topicsPerClass}`);
  lines.push("");
  lines.push(`## Configuração Individual de Cada Módulo (RESPEITAR RIGOROSAMENTE)`);
  let lessonCursor = 1;
  params.moduleConfigs.forEach((cfg, idx) => {
    const lessons = cfg.hasLessons ? cfg.lessons : 0;
    lines.push("");
    lines.push(`### Módulo ${idx + 1}`);
    if (lessons > 0) {
      lines.push(
        `- Aulas teóricas: ${lessons} (numeração contínua: Aula ${lessonCursor} a Aula ${lessonCursor + lessons - 1})`
      );
      lessonCursor += lessons;
    } else {
      const practicalParts = [
        cfg.hasCaseStudies ? `Estudo de Caso (${cfg.caseStudies})` : null,
        cfg.hasAcademicWork ? "Trabalho Acadêmico" : null,
        cfg.hasClinicalCase ? "Caso Clínico (SimulSaúde)" : null,
      ].filter(Boolean);
      lines.push(
        `- Aulas teóricas: 0 — MÓDULO PRÁTICO / PROJETO INTEGRADOR / AVALIATIVO. Marque "pratico": true, deixe "aulas" e "etapas" vazios e NÃO invente aulas teóricas. O título deve terminar com "(Módulo Prático / Projeto Integrador / Avaliativo)". Preencha "atividades_praticas" com uma entrada detalhada para cada atividade: ${practicalParts.length ? practicalParts.join(", ") : "conforme os itens marcados abaixo"}. A carga horária e a nota deste módulo vêm EXCLUSIVAMENTE dessas atividades.`
      );
    }
    lines.push(
      `- Estudos de Caso: ${cfg.hasCaseStudies ? `${cfg.caseStudies} caso(s), com temas específicos do módulo` : "não"}`
    );
    lines.push(
      `- Trabalho Acadêmico neste módulo: ${cfg.hasAcademicWork ? `sim — tipo(s)/formato(s) de documento (use EXATAMENTE este texto no campo "tipo"): ${resolveWorkTypes(cfg).join("; ")}` : "não"}`
    );

    if (cfg.hasClinicalCase) {
      lines.push(
        `- Caso Clínico (SimulSaúde): sim — tema: ${cfg.clinicalCaseTheme.trim() || "propor tema coerente com o conteúdo do módulo"}. Cite-o na coluna Atividades deste módulo e no Banco de Temas Sugeridos.`
      );
    } else {
      lines.push(`- Caso Clínico (SimulSaúde): não`);
    }
    lines.push(
      `- Atividades Extras/Complementares: ${
        cfg.hasExtraActivity
          ? `sim — gere UMA atividade para cada tipo marcado: ${(cfg.extraActivityTypes.length ? cfg.extraActivityTypes : ["Workshops"]).join("; ")} (eventos/dinâmicas, nunca repetir estudos de caso)`
          : "não"
      }`
    );
    lines.push(
      `- Avaliações: ${cfg.evaluations} — tipo: ${cfg.evaluationType || "Prova Escrita"}`
    );
    for (let e = 0; e < cfg.evaluations; e++) {
      const key = `${idx}-${e}`;
      const types = params.questionTypesPerEval[key] ?? [];
      lines.push(
        `  - Avaliação ${e + 1}: ${types.length ? types.join(", ") : "Tipos não especificados"}`
      );
    }
  });
  const workModules = params.moduleConfigs
    .map((cfg, idx) =>
      cfg.hasAcademicWork
        ? { idx: idx + 1, tipo: resolveWorkTypes(cfg).join(", ") }
        : null,
    )
    .filter((x): x is { idx: number; tipo: string } => !!x);
  if (workModules.length) {
    lines.push("");
    lines.push(`## Trabalho Acadêmico Semestral`);
    lines.push(`- Formato (copiar EXATAMENTE no campo "tipo" do trabalho): ${Array.from(new Set(workModules.map((w) => w.tipo))).join(", ")}`);
    lines.push(`- Módulo(s) de execução: ${workModules.map((w) => `Módulo ${w.idx}`).join(", ")}`);
  }
  const enabledCategories = {
    caseStudies: params.moduleConfigs.some((c) => c.hasCaseStudies),
    clinicalCases: params.moduleConfigs.some((c) => c.hasClinicalCase),
    academicWork: workModules.length > 0,
    extraActivities: params.moduleConfigs.some((c) => c.hasExtraActivity),
  };
  lines.push("");
  lines.push(`## Banco de Temas — categorias habilitadas`);
  lines.push(`- estudos_de_caso: ${enabledCategories.caseStudies ? "SIM (somente nos módulos com Estudos de Caso marcados, na quantidade indicada)" : "NÃO — retorne lista vazia"}`);
  lines.push(`- casos_clinicos: ${enabledCategories.clinicalCases ? "SIM (somente nos módulos com Caso Clínico marcado)" : "NÃO — retorne lista vazia"}`);
  lines.push(`- trabalho_academico: ${enabledCategories.academicWork ? "SIM" : "NÃO — retorne string vazia e omita avaliacoes_trabalhos.trabalho_academico"}`);
  lines.push(`- atividades_extras: ${enabledCategories.extraActivities ? "SIM (somente nos módulos com Atividade Extra marcada, no tipo indicado; nunca repita estudos de caso)" : "NÃO — retorne lista vazia"}`);
  if (params.hasAcademicWeek && params.academicWeekStart && params.academicWeekEnd) {
    lines.push("");
    lines.push(`## Semana Acadêmica`);
    lines.push(
      `- Período a ser desconsiderado no cronograma: ${params.academicWeekStart} a ${params.academicWeekEnd}`
    );
  }
  if (params.manualHolidays.length) {
    lines.push("");
    lines.push(`## Feriados Locais Adicionais`);
    params.manualHolidays.forEach((h) => lines.push(`- ${h}`));
  }
  const totalClasses = params.moduleConfigs.reduce(
    (sum, cfg) => sum + (cfg.hasLessons ? cfg.lessons : 0),
    0,
  );
  const todayBR = new Date().toLocaleDateString("pt-BR");
  lines.push("");
  lines.push(`## Regras Obrigatórias de Estrutura (NÃO VIOLAR)`);
  lines.push(
    `- Gere EXATAMENTE ${params.totalModules} módulo(s), com a quantidade de aulas definida individualmente em cada módulo acima, totalizando impreterivelmente ${totalClasses} aula(s) teórica(s).`
  );
  lines.push(
    `- Numere as aulas de forma contínua de 1 a ${totalClasses}, seguindo os intervalos indicados em cada módulo. Módulos com 0 aulas não recebem numeração de aula.`
  );
  lines.push(
    `- É PROIBIDO criar aulas, módulos ou encontros extras para "completar" a carga horária teórica. A quantidade configurada prevalece sobre qualquer cálculo de horas.`
  );
  lines.push(
    `- Todas as ${totalClasses} aulas devem ter datas estritamente dentro do período letivo de ${params.startDate} a ${params.endDate}. Nenhuma data pode ser anterior à data inicial nem posterior à data final. Se as datas disponíveis não couberem, concentre as aulas nos dias letivos válidos, mas NUNCA ultrapasse ${params.endDate}.`
  );
  lines.push(
    `- No rodapé/assinatura, use a data ${todayBR} (data de geração) ou a data inicial do período letivo. NUNCA use anos anteriores ou datas fictícias.`
  );
  lines.push("");
  lines.push(`## Instruções Gerais`);
  lines.push(
    `Elabore um plano de aula completo, cronogramado e didático, respeitando feriados nacionais brasileiros, a semana acadêmica (quando informada), as atividades extras e o trabalho acadêmico selecionados. Distribua os conteúdos da ementa ao longo dos módulos e aulas de forma equilibrada, indique objetivos, materiais, metodologia, avaliações e datas previstas.`
  );


  return lines.join("\n").trim();
}

function LessonPlanDialog({
  disciplineId,
  onClose,
  onDone,
}: {
  disciplineId: string;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const [loadingDiscipline, setLoadingDiscipline] = useState(true);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [teachingArea, setTeachingArea] = useState("");
  const [teachingAreaOther, setTeachingAreaOther] = useState("");
  const [educationLevel, setEducationLevel] = useState("");
  const [educationLevelOther, setEducationLevelOther] = useState("");
  const [course, setCourse] = useState("");
  const [semester, setSemester] = useState<string>("");
  const [syllabus, setSyllabus] = useState("");
  const [initialSyllabus, setInitialSyllabus] = useState("");
  const [syllabusFileName, setSyllabusFileName] = useState<string | null>(null);
  const [extractingSyllabus, setExtractingSyllabus] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [location, setLocation] = useState("");
  const [weekDays, setWeekDays] = useState<string[]>([]);
  const [classesPerWeekday, setClassesPerWeekday] = useState<Record<string, number>>({});
  const [duration, setDuration] = useState(50);
  const [cargaHoraria, setCargaHoraria] = useState("");
  const [totalModules, setTotalModules] = useState(4);
  const [classesPerModule, setClassesPerModule] = useState(4);
  const [topicsPerClass, setTopicsPerClass] = useState(1);
  const [moduleConfigs, setModuleConfigs] = useState<LessonPlanModuleConfig[]>(() =>
    Array.from({ length: 4 }, () => makeModuleConfig(4)),
  );
  const [suggestingThemeFor, setSuggestingThemeFor] = useState<number | null>(null);
  const [questionTypesPerEval, setQuestionTypesPerEval] = useState<Record<string, string[]>>({});
  const [hasAcademicWeek, setHasAcademicWeek] = useState(false);
  const [acStart, setAcStart] = useState("");
  const [acEnd, setAcEnd] = useState("");
  const [manualHolidays, setManualHolidays] = useState("");
  const syllabusFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("disciplines")
        .select("name,syllabus_text,syllabus_file_url,start_date,end_date,week_days,location")
        .eq("id", disciplineId)
        .maybeSingle();
      if (error) {
        console.error("[LessonPlanDialog] failed to load discipline", error);
      }
      if (cancelled) return;
      console.debug("[LessonPlanDialog] discipline data", data);
      if (data) {
        const storedSyllabus = (data.syllabus_text ?? "").toString();
        setName(data.name ?? "");
        setSyllabus(storedSyllabus);
        setInitialSyllabus(storedSyllabus);
        setStartDate(data.start_date ?? "");
        setEndDate(data.end_date ?? "");
        setWeekDays((data.week_days as string[] | null) ?? []);
        setLocation((data as { location?: string | null }).location ?? "");
      }
      setLoadingDiscipline(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [disciplineId]);

  const toggleDay = (d: string) => {
    setWeekDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
    setClassesPerWeekday((prev) => {
      const next = { ...prev };
      if (next[d] === undefined) next[d] = 1;
      return next;
    });
  };

  useEffect(() => {
    setModuleConfigs((prev) =>
      Array.from({ length: totalModules }, (_, i) => prev[i] ?? makeModuleConfig(classesPerModule)),
    );
  }, [totalModules, classesPerModule]);

  const updateModuleConfig = (index: number, patch: Partial<LessonPlanModuleConfig>) =>
    setModuleConfigs((prev) =>
      prev.map((cfg, i) => (i === index ? { ...cfg, ...patch } : cfg)),
    );

  const suggestClinicalTheme = async (index: number) => {
    setSuggestingThemeFor(index);
    try {
      const topic = `Caso clínico para o Módulo ${index + 1} da disciplina ${name || "informada"}${
        syllabus.trim() ? `. Ementa: ${syllabus.trim().slice(0, 600)}` : ""
      }`;
      const { title } = await suggestClinicalCaseTitle({ data: { topic } });
      const first = title;
      if (!first) {
        toast.error("Não foi possível sugerir um tema agora");
        return;
      }
      updateModuleConfig(index, { clinicalCaseTheme: first.slice(0, 200) });
      toast.success("Tema sugerido pela IA");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao sugerir tema");
    } finally {
      setSuggestingThemeFor(null);
    }
  };

  const handleSyllabusFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    const name = file.name.toLowerCase();
    const supported = name.endsWith(".txt") || name.endsWith(".pdf") || name.endsWith(".docx");
    if (!supported) {
      toast.error("Envie um arquivo .txt, .pdf com texto selecionável ou .docx");
      event.target.value = "";
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Arquivo deve ter no máximo 10 MB");
      event.target.value = "";
      return;
    }

    setSyllabusFileName(file.name);
    setExtractingSyllabus(true);
    try {
      const text = await extractSyllabusText(file);
      if (!text.trim()) {
        toast.error("Nenhum texto foi encontrado no arquivo");
        return;
      }
      setSyllabus((prev) =>
        (prev.trim() ? `${prev.trim()}\n\n${text.trim()}` : text.trim()).slice(0, 20000),
      );
      toast.success("Ementa adicionada ao campo de texto");
    } catch (e) {
      console.error("[LessonPlanDialog] syllabus file extraction failed", e);
      toast.error(e instanceof Error ? e.message : "Falha ao ler o arquivo da ementa");
    } finally {
      setExtractingSyllabus(false);
      event.target.value = "";
    }
  };

  const toggleQuestionType = (key: string, qt: string) => {
    setQuestionTypesPerEval((prev) => {
      const current = prev[key] ?? [];
      const next = current.includes(qt) ? current.filter((x) => x !== qt) : [...current, qt];
      return { ...prev, [key]: next };
    });
  };

  const submit = async () => {
    if (!name.trim()) return toast.error("Informe o nome da disciplina");
    if (!teachingArea) return toast.error("Selecione a Área de Ensino");
    if (teachingArea === "Outros" && !teachingAreaOther.trim())
      return toast.error("Especifique a Área de Ensino");
    if (!educationLevel) return toast.error("Selecione o Nível de Ensino");
    if (educationLevel === "Outro" && !educationLevelOther.trim())
      return toast.error("Especifique o Nível de Ensino");
    const requiresCourse =
      educationLevel === "Ensino Superior (Graduação)" ||
      educationLevel === "Ensino Superior (Pós-Graduação)";
    if (requiresCourse && !course.trim()) return toast.error("Informe o Curso");
    const semesterNum = Number(semester);
    if (!semester || !Number.isInteger(semesterNum) || semesterNum < 1 || semesterNum > 20)
      return toast.error("Informe um Semestre válido (1-20)");
    const trimmedSyllabus = syllabus.trim();
    if (!trimmedSyllabus || trimmedSyllabus.length < 10) return toast.error("Informe a ementa");
    if (!startDate || !endDate) return toast.error("Informe início e término do semestre");
    if (!location.trim()) return toast.error("Informe a localização (cidade/estado)");
    if (weekDays.length === 0) return toast.error("Selecione ao menos um dia da semana");
    if (hasAcademicWeek && (!acStart || !acEnd)) return toast.error("Informe a semana acadêmica");
    const isISODate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (!isISODate(startDate) || !isISODate(endDate))
      return toast.error("Datas do semestre inválidas (use AAAA-MM-DD com ano de 4 dígitos)");
    if (hasAcademicWeek && (!isISODate(acStart) || !isISODate(acEnd)))
      return toast.error("Datas da semana acadêmica inválidas (ano deve ter 4 dígitos)");

    setLoading(true);
    try {
      if (trimmedSyllabus !== initialSyllabus.trim()) {
        const { error: saveError } = await supabase
          .from("disciplines")
          .update({ syllabus_text: trimmedSyllabus })
          .eq("id", disciplineId);
        if (saveError) {
          console.error("[LessonPlanDialog] failed to persist manual syllabus", saveError);
          toast.warning("A ementa será usada neste plano, mas não foi salva na disciplina.");
        } else {
          setInitialSyllabus(trimmedSyllabus);
        }
      }

      const manual = manualHolidays
        .split(/[\n,;]/)
        .map((s) => s.trim())
        .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));

      const prompt = buildLessonPlanPrompt({
        name: name.trim(),
        teacherName: teacherName.trim(),
        teachingArea: teachingArea === "Outros" ? teachingAreaOther.trim() || teachingArea : teachingArea,
        educationLevel: educationLevel === "Outro" ? educationLevelOther.trim() || educationLevel : educationLevel,
        course: requiresCourse ? course.trim() : undefined,
        semester: semesterNum,
        syllabus: trimmedSyllabus,
        startDate,
        endDate,
        location: location.trim(),
        weekDays,
        classesPerWeekday,
        duration,
        cargaHoraria: cargaHoraria.trim(),
        totalModules,
        topicsPerClass,
        moduleConfigs: moduleConfigs.slice(0, totalModules),
        questionTypesPerEval,
        hasAcademicWeek,
        academicWeekStart: hasAcademicWeek ? acStart : undefined,
        academicWeekEnd: hasAcademicWeek ? acEnd : undefined,
        manualHolidays: manual,
      });

      const activeConfigs = moduleConfigs.slice(0, totalModules);
      const res = await generateLessonPlan({
        data: {
          discipline_id: disciplineId,
          prompt,
          clinicalThemes: activeConfigs
            .map((cfg, idx) => ({ module: idx + 1, theme: cfg.clinicalCaseTheme.trim() }))
            .filter((t) => t.theme.length > 0),
          themeBankConfig: {
            caseStudies: activeConfigs.some((c) => c.hasCaseStudies),
            clinicalCases: activeConfigs.some((c) => c.hasClinicalCase),
            academicWork: activeConfigs.some((c) => c.hasAcademicWork),
            extraActivities: activeConfigs.some((c) => c.hasExtraActivity),
            // Tipo(s) exatamente como marcados no formulário — gravados no PDF e no banco.
            academicWorkTypes: Array.from(
              new Set(activeConfigs.filter((c) => c.hasAcademicWork).flatMap((c) => resolveWorkTypes(c))),
            ),
            // Módulos sem aulas teóricas → "Módulo Prático / Projeto Integrador / Avaliativo".
            practicalModules: activeConfigs
              .map((c, idx) => (!c.hasLessons || c.lessons <= 0 ? idx + 1 : 0))
              .filter((n) => n > 0),
          },
        },
      });
      let parsed: unknown = res;
      if (typeof parsed === "string") {
        // Tolera JSON com cercas markdown ou espaços extras antes de desistir.
        const cleaned = (parsed as string)
          .replace(/^\s*```(?:json)?\s*/i, "")
          .replace(/```\s*$/g, "")
          .trim();
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          parsed = res;
        }
      }
      if (!hasGeneratedContentId(parsed)) {
        console.error("[LessonPlanDialog] resposta inesperada da geração", res);
        throw new Error("Não foi possível salvar o plano gerado. Tente novamente.");
      }
      const integration = (parsed as { integration?: { items?: number } | null }).integration;
      if (integration && (integration.items ?? 0) > 0) {
        toast.success(
          "Plano gerado e integrado com Atividades Extras e SimulClínica com sucesso!",
          { duration: 6000 },
        );
      } else {
        toast.success("Plano de Aula gerado com sucesso!");
      }
      onDone(parsed.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar plano de aula");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <AILoadingOverlay open={loading} onCancel={() => setLoading(false)} />
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" /> Plano de Aula Avançado
            </DialogTitle>
            <DialogDescription>
              Configure os detalhes para gerar um cronograma completo com cálculo automático de
              feriados nacionais.
            </DialogDescription>
          </DialogHeader>

          {loadingDiscipline ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Nome da Disciplina</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>
                    Nível de Ensino <span className="text-destructive">*</span>
                  </Label>
                  <select
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={educationLevel}
                    onChange={(e) => {
                      setEducationLevel(e.target.value);
                      const requires =
                        e.target.value === "Ensino Superior (Graduação)" ||
                        e.target.value === "Ensino Superior (Pós-Graduação)";
                      if (!requires) setCourse("");
                    }}
                  >
                    <option value="">Selecione...</option>
                    {EDUCATION_LEVEL_OPTIONS.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                  {educationLevel === "Outro" && (
                    <Input
                      value={educationLevelOther}
                      onChange={(e) => setEducationLevelOther(e.target.value)}
                      placeholder="Especifique o nível de ensino"
                    />
                  )}
                </div>
                {(educationLevel === "Ensino Superior (Graduação)" ||
                  educationLevel === "Ensino Superior (Pós-Graduação)") && (
                  <div className="space-y-1.5">
                    <Label>
                      Curso <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      value={course}
                      onChange={(e) => setCourse(e.target.value.slice(0, 200))}
                      placeholder="Ex.: Engenharia Civil, Medicina, Direito"
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>
                    Semestre <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={semester}
                    onChange={(e) => setSemester(e.target.value)}
                    placeholder="Ex.: 1"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Nome do Professor</Label>
                <Input
                  value={teacherName}
                  onChange={(e) => setTeacherName(e.target.value)}
                  placeholder="Ex.: Prof. Dr. João Silva"
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  Área de Ensino <span className="text-destructive">*</span>
                </Label>
                <select
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={teachingArea}
                  onChange={(e) => setTeachingArea(e.target.value)}
                >
                  <option value="">Selecione...</option>
                  {TEACHING_AREA_OPTIONS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
                {teachingArea === "Outros" && (
                  <Input
                    value={teachingAreaOther}
                    onChange={(e) => setTeachingAreaOther(e.target.value)}
                    placeholder="Especifique a área de ensino"
                  />
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Ementa da Disciplina</Label>
                <Textarea
                  rows={8}
                  value={syllabus}
                  onChange={(e) => setSyllabus(e.target.value.slice(0, 20000))}
                  maxLength={20000}
                  placeholder="Cole aqui a ementa em texto ou envie um arquivo .txt, .pdf com texto selecionável ou .docx."
                  className="min-h-44"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={syllabusFileInputRef}
                    type="file"
                    accept=".txt,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="hidden"
                    onChange={handleSyllabusFile}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => syllabusFileInputRef.current?.click()}
                    disabled={extractingSyllabus}
                  >
                    {extractingSyllabus ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4 mr-2" />
                    )}
                    {extractingSyllabus ? "Lendo arquivo" : "Adicionar arquivo"}
                  </Button>
                  {syllabusFileName && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <FileText className="h-3.5 w-3.5" />
                      {syllabusFileName}
                      <button
                        type="button"
                        className="hover:text-foreground"
                        aria-label="Limpar arquivo selecionado"
                        onClick={() => setSyllabusFileName(null)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {initialSyllabus.trim()
                    ? "Pré-preenchida com a ementa em texto cadastrada na disciplina. Edits aqui serão usados no plano e salvos para futuras gerações quando possível."
                    : "Nenhuma ementa cadastrada em texto na disciplina. Cole o conteúdo aqui ou envie um arquivo com texto selecionável."}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Início do Semestre</Label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Término do Semestre</Label>
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Localização (Cidade, Estado)</Label>
                <Input
                  placeholder="Ex.: São Paulo, SP"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Usado para contextualizar o plano. Feriados nacionais brasileiros são calculados
                  automaticamente.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Dias da Semana com Aula</Label>
                <div className="grid grid-cols-3 gap-2">
                  {WEEKDAY_OPTIONS.map((d) => (
                    <label key={d.value} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={weekDays.includes(d.value)}
                        onCheckedChange={() => toggleDay(d.value)}
                      />
                      {d.label}
                    </label>
                  ))}
                </div>
              </div>
              {weekDays.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Horário de Aulas Semanais</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {WEEKDAY_OPTIONS.filter((d) => weekDays.includes(d.value)).map((d) => (
                      <div key={d.value} className="flex items-center gap-2">
                        <span className="text-sm w-20">{d.label}:</span>
                        <Input
                          type="number"
                          min={1}
                          max={10}
                          value={classesPerWeekday[d.value] ?? 1}
                          onChange={(e) =>
                            setClassesPerWeekday((prev) => ({
                              ...prev,
                              [d.value]: Math.max(1, parseInt(e.target.value || "1", 10)),
                            }))
                          }
                          className="w-20"
                        />
                        <span className="text-xs text-muted-foreground">aulas</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Defina quantas aulas serão dadas em cada dia da semana selecionado.
                  </p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Duração da Aula (min)</Label>
                <Input
                  type="number"
                  min={15}
                  max={360}
                  value={duration}
                  onChange={(e) => setDuration(parseInt(e.target.value || "50", 10))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Carga Horária</Label>
                <Input
                  type="text"
                  placeholder="Ex.: 60h, 80h/semestre"
                  value={cargaHoraria}
                  onChange={(e) => setCargaHoraria(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Informe a carga horária da disciplina (ficará registrada no Plano de Aula).
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Total de Módulos</Label>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={totalModules}
                    onChange={(e) => setTotalModules(parseInt(e.target.value || "1", 10))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Aulas por Módulo (padrão)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={40}
                    value={classesPerModule}
                    onChange={(e) => setClassesPerModule(parseInt(e.target.value || "0", 10))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Temas por Aula</Label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={topicsPerClass}
                    onChange={(e) => setTopicsPerClass(parseInt(e.target.value || "1", 10))}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Configuração de cada módulo</Label>
                <p className="text-xs text-muted-foreground">
                  Cada módulo pode ter estrutura própria. Use 0 aulas teóricas para módulos
                  exclusivos de projeto/prática.
                </p>
                <div className="space-y-3">
                  {moduleConfigs.slice(0, totalModules).map((cfg, i) => (
                    <div key={i} className="rounded-lg border p-3 space-y-3">
                      <p className="text-sm font-semibold">Módulo {i + 1}</p>

                      <div className="flex flex-wrap items-center gap-3">
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <Checkbox
                            checked={cfg.hasLessons}
                            onCheckedChange={(v) =>
                              updateModuleConfig(i, {
                                hasLessons: !!v,
                                lessons: !!v ? Math.max(1, cfg.lessons || 1) : 0,
                              })
                            }
                          />
                          Aulas teóricas
                        </label>
                        {cfg.hasLessons && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-muted-foreground">Qtd.:</span>
                            <Input
                              type="number"
                              min={0}
                              max={40}
                              value={cfg.lessons}
                              onChange={(e) =>
                                updateModuleConfig(i, {
                                  lessons: Math.max(0, parseInt(e.target.value || "0", 10)),
                                })
                              }
                              className="w-20"
                            />
                          </div>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">
                          Recursos e Metodologias
                        </p>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                              <Checkbox
                                checked={cfg.hasCaseStudies}
                                onCheckedChange={(v) =>
                                  updateModuleConfig(i, { hasCaseStudies: !!v })
                                }
                              />
                              Estudos de Caso
                            </label>
                            {cfg.hasCaseStudies && (
                              <Input
                                type="number"
                                min={1}
                                max={10}
                                value={cfg.caseStudies}
                                onChange={(e) =>
                                  updateModuleConfig(i, {
                                    caseStudies: Math.max(1, parseInt(e.target.value || "1", 10)),
                                  })
                                }
                                className="h-8 w-16"
                                aria-label="Quantidade de estudos de caso"
                              />
                            )}
                          </div>
                          <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <Checkbox
                              checked={cfg.hasAcademicWork}
                              onCheckedChange={(v) =>
                                updateModuleConfig(i, { hasAcademicWork: !!v })
                              }
                            />
                            Trabalho Acadêmico
                          </label>
                          <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <Checkbox
                              checked={cfg.hasClinicalCase}
                              onCheckedChange={(v) =>
                                updateModuleConfig(i, { hasClinicalCase: !!v })
                              }
                            />
                            Caso Clínico (SimulSaúde)
                          </label>
                        </div>
                      </div>

                      <div className="space-y-2 rounded-md border bg-muted/30 p-2.5">
                        <p className="text-xs font-medium text-muted-foreground">
                          Tipos de Atividades e Trabalhos Acadêmicos
                        </p>

                        <div className="space-y-1.5">
                          <Label className="text-xs">
                            Atividades Extras / Complementares (Gerais)
                          </Label>
                          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                            {MODULE_EXTRA_ACTIVITY_TYPES.map((t) => (
                              <label
                                key={t}
                                className="flex items-center gap-2 text-sm cursor-pointer"
                              >
                                <Checkbox
                                  checked={cfg.extraActivityTypes.includes(t)}
                                  onCheckedChange={() => {
                                    const next = toggleInList(cfg.extraActivityTypes, t);
                                    updateModuleConfig(i, {
                                      extraActivityTypes: next,
                                      hasExtraActivity: next.length > 0,
                                    });
                                  }}
                                />
                                {t}
                              </label>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">
                            Trabalho Acadêmico — Tipos de Documentos
                          </Label>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                            {MODULE_WORK_TYPES.map((t) => (
                              <label
                                key={t}
                                className="flex items-center gap-2 text-sm cursor-pointer"
                              >
                                <Checkbox
                                  checked={cfg.academicWorkTypes.includes(t)}
                                  onCheckedChange={() => {
                                    const next = toggleInList(cfg.academicWorkTypes, t);
                                    updateModuleConfig(i, {
                                      academicWorkTypes: next,
                                      hasAcademicWork: next.length > 0,
                                    });
                                  }}
                                />
                                {t}
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>



                      {cfg.hasClinicalCase && (
                        <div className="space-y-1.5">
                          <Label className="text-xs">Tema do Caso Clínico (SimulSaúde)</Label>
                          <div className="flex items-center gap-2">
                            <Input
                              value={cfg.clinicalCaseTheme}
                              onChange={(e) =>
                                updateModuleConfig(i, {
                                  clinicalCaseTheme: e.target.value.slice(0, 200),
                                })
                              }
                              placeholder="Ex.: Insuficiência cardíaca descompensada"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              title="Sugerir tema com IA"
                              disabled={suggestingThemeFor === i}
                              onClick={() => suggestClinicalTheme(i)}
                            >
                              {suggestingThemeFor === i ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Wand2 className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">Avaliações:</span>
                          <select
                            className="h-9 rounded-md border bg-background px-2 text-sm"
                            value={cfg.evaluations}
                            onChange={(e) =>
                              updateModuleConfig(i, { evaluations: parseInt(e.target.value, 10) })
                            }
                          >
                            {[0, 1, 2, 3].map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </div>
                        {cfg.evaluations > 0 && (
                          <select
                            className="h-9 rounded-md border bg-background px-2 text-sm"
                            value={cfg.evaluationType}
                            onChange={(e) =>
                              updateModuleConfig(i, { evaluationType: e.target.value })
                            }
                          >
                            {MODULE_EVALUATION_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>

                      {cfg.evaluations > 0 && (
                        <div className="space-y-2">
                          {Array.from({ length: cfg.evaluations }, (_, eIdx) => {
                            const key = `${i}-${eIdx}`;
                            const selected = questionTypesPerEval[key] ?? [];
                            return (
                              <div key={key} className="rounded-md border p-2 space-y-1.5">
                                <p className="text-xs font-medium">
                                  Tipos de questões — Avaliação {eIdx + 1}
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                  {QUESTION_TYPE_OPTIONS.map((qt) => (
                                    <label
                                      key={qt.name}
                                      title={qt.description}
                                      className="flex items-start gap-2 text-sm cursor-pointer rounded p-1 hover:bg-muted"
                                    >
                                      <Checkbox
                                        checked={selected.includes(qt.name)}
                                        onCheckedChange={() => toggleQuestionType(key, qt.name)}
                                        className="mt-0.5"
                                      />
                                      <span className="leading-snug">{qt.name}</span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={hasAcademicWeek}
                    onCheckedChange={(v) => setHasAcademicWeek(!!v)}
                  />
                  Há Semana Acadêmica neste semestre
                </label>
                {hasAcademicWeek && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Início</Label>
                      <Input
                        type="date"
                        value={acStart}
                        onChange={(e) => setAcStart(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Fim</Label>
                      <Input type="date" value={acEnd} onChange={(e) => setAcEnd(e.target.value)} />
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Feriados locais adicionais (opcional)</Label>
                <Textarea
                  rows={2}
                  placeholder="AAAA-MM-DD, um por linha ou separados por vírgula"
                  value={manualHolidays}
                  onChange={(e) => setManualHolidays(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Feriados nacionais são calculados automaticamente. Adicione aqui feriados
                  estaduais/municipais.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={loading || loadingDiscipline}>
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              {loading ? "Gerando plano…" : "Gerar Plano"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}


function CaseStudyDialog({ disciplineId, onClose, onDone }: any) {
  return <GenerateDialog tool="case_study" disciplineId={disciplineId} onClose={onClose} onDone={onDone} />;
}

function SyllabusDialog({ disciplineId, onClose, onDone }: any) {
  return <GenerateDialog tool="activity_syllabus" disciplineId={disciplineId} onClose={onClose} onDone={onDone} />;
}

function ViewDialog({
  id,
  startInEdit = false,
  onClose,
}: {
  id: string;
  startInEdit?: boolean;
  onClose: () => void;
}) {
  const [content, setContent] = useState<{
    title: string;
    tool: string;
    result: unknown;
    disciplineId: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(startInEdit);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "pptx" | null>(null);
  const [dispatchOpen, setDispatchOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAIGeneration({ data: { id } })
      .then((res) => {
        if (cancelled) return;
        if (!isGenerationDetail(res)) throw new Error("Geração não encontrada");
        const detail = res as GenerationDetailResponse & { discipline_id?: string };
        const normalized = normalizeAIContent(detail.result);
        setContent({
          title: detail.title,
          tool: detail.tool,
          result: normalized,
          disciplineId: detail.discipline_id ?? null,
        });
        setEditContent(normalized);
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(error instanceof Error ? error.message : "Erro ao abrir o material");
        onClose();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, onClose]);

  const saveEdit = async () => {
    if (!content || !editContent.trim()) return;
    setSaving(true);
    try {
      const normalized = normalizeAIContent(editContent);
      await updateAIGenerationContent({ data: { id, content: normalized } });
      setContent({ ...content, result: normalized });
      setEditContent(normalized);
      setEditing(false);
      toast.success("Conteúdo atualizado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao salvar edição");
    } finally {
      setSaving(false);
    }
  };

  const download = async (kind: "pdf" | "pptx") => {
    setExporting(kind);
    try {
      const response =
        kind === "pdf"
          ? await exportGenerationPDF({ data: { id } })
          : await exportGenerationPPTX({ data: { id } });
      if (!isExportResponse(response)) throw new Error("Arquivo inválido para exportação");
      const binary = atob(response.base64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: response.mime }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = response.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao baixar o arquivo");
    } finally {
      setExporting(null);
    }
  };

  const supportsPPTX = content?.tool === "slides";
  const normalizedContent = content ? normalizeAIContent(content.result) : "";
  const hasUnsavedChanges = editContent !== normalizedContent;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 pb-4 pt-6">
          <DialogTitle>{content?.title || "Visualizar material"}</DialogTitle>
          <DialogDescription>
            {editing ? "Edite o conteúdo e salve antes de publicar ou baixar." : "Revise o material gerado antes de usar as ações abaixo."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {loading || !content ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : editing ? (
            <Textarea
              aria-label="Conteúdo do material"
              value={editContent}
              onChange={(event) => setEditContent(event.target.value)}
              className="min-h-[52vh] resize-y font-mono text-sm leading-relaxed"
            />
          ) : (
            <div className="rounded-md border bg-background p-5">
              <AssistantMessage content={normalizedContent} />
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 flex-row flex-wrap justify-end gap-2 border-t bg-muted/30 px-6 py-4 sm:space-x-0">
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          {editing ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setEditContent(normalizedContent);
                  setEditing(false);
                }}
                disabled={saving}
              >
                Cancelar edição
              </Button>
              <Button onClick={saveEdit} disabled={saving || !editContent.trim() || !hasUnsavedChanges}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                Salvar edição
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="mr-2 h-4 w-4" />
                Editar
              </Button>
              <Button
                onClick={() => setDispatchOpen(true)}
                disabled={!content?.disciplineId}
                title={content?.disciplineId ? "Enviar ou publicar este material para os alunos" : "Disciplina não identificada"}
              >
                <Send className="mr-2 h-4 w-4" />
                Enviar/Publicar para o aluno
              </Button>
              <Button variant="outline" onClick={() => download("pdf")} disabled={exporting !== null}>
                {exporting === "pdf" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
                Baixar em PDF
              </Button>
              {supportsPPTX && (
                <Button onClick={() => download("pptx")} disabled={exporting !== null}>
                  {exporting === "pptx" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Presentation className="mr-2 h-4 w-4" />}
                  Baixar em PPTX
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>

      {dispatchOpen && content?.disciplineId && (
        <DispatchToStudentDialog
          generationId={id}
          disciplineId={content.disciplineId}
          tool={content.tool}
          defaultTitle={content.title}
          contentMarkdown={normalizedContent}
          onClose={() => setDispatchOpen(false)}
        />
      )}
    </Dialog>
  );
}

function SlideCalendarDateDialog({
  disciplineId,
  title,
  onClose,
}: {
  disciplineId: string;
  title: string;
  onClose: () => void;
}) {
  const [date, setDate] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!date) {
      toast.error("Informe a data");
      return;
    }
    setSaving(true);
    try {
      await saveCalendarEvent({
        data: {
          discipline_id: disciplineId,
          title,
          event_date: new Date(date).toISOString(),
          kind: "aula",
        },
      });
      toast.success("Adicionado ao calendário");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar aula ao calendário</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="slide-cal-date">Data e hora</Label>
          <Input
            id="slide-cal-date"
            type="datetime-local"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
