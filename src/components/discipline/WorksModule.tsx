import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import {
  saveAcademicWork,
  deleteAcademicWork,
  submitAcademicWork,
  releaseWorkFeedback,
  exportAcademicWorkPDF,
  getWorkTutorGuidance,
} from "@/backend/works.functions";
import {
  listAIGenerations,
  getAIGeneration,
  generateActivitySyllabusFromPlan,
} from "@/backend/ai-assistant.functions";
import { saveCalendarEvent } from "@/backend/calendar.functions";
import { getLessonPlanItems, type LessonPlanItem } from "@/backend/lesson-plan-themes.functions";
import { sanitizeListTitle } from "@/lib/text-sanitize";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkDeleteBar } from "@/components/BulkDeleteBar";
import { formatBRDate } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  Loader2,
  Plus,
  Trash2,
  GraduationCap,
  ExternalLink,
  BookCheck,
  BookOpen,
  Library,
  Sparkles,
  FileText,
  Download,
  Clock,
  CalendarClock,
  Users,
  Send,
  X,
  ClipboardList,
  ChevronDown,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { toast } from "sonner";
import { WORK_RUBRICS, WORK_SUBTYPE_LABELS, templateToRubric } from "@/lib/rubric-library";
import { RubricLibraryDialog, type RubricSelection } from "./RubricLibraryDialog";
import { SubmissionsReviewPanel } from "./SubmissionReviewDialog";
import { WorkSubmissionAssistant } from "./WorkSubmissionAssistant";
import { ActivityDeadlineBadges } from "./ActivityDeadlineBadges";
import { getDisciplineHeader } from "@/backend/disciplines.functions";
import { listDiaryAssessments } from "@/backend/submissions.functions";
import { getGroupContext } from "@/backend/groups.functions";
import { GroupPanel } from "./GroupPanel";
import { parseDocumentHeader, stripDocumentHeaderMetadata, withDocumentHeaderMetadata, stripLeadingStandardHeader, markdownToPlainText, extractStandardHeaderDocLine } from "@/lib/document-header";
import { extractDiaryAssessmentOptions } from "@/lib/diary-assessments";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Heading from "@tiptap/extension-heading";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import BulletList from "@tiptap/extension-bullet-list";
import OrderedList from "@tiptap/extension-ordered-list";
import ListItem from "@tiptap/extension-list-item";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { 
  Quote, 
  MessageSquare, 
  Save, 
  CheckCircle2, 
  ChevronRight, 
  FileDown,
  AlignLeft,
  AlignCenter,
  AlignJustify,
  Bold as BoldIcon,
  Italic as ItalicIcon,
} from "lucide-react";

function TextAlignLeft(props: any) { return <AlignLeft {...props} />; }
function TextAlignCenter(props: any) { return <AlignCenter {...props} />; }
function TextAlignJustify(props: any) { return <AlignJustify {...props} />; }

function MarkdownView({ children }: { children: string }) {
  const text = (children ?? "").replace(/\\n/g, "\n").replace(/\\r\\n/g, "\n");
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none [&_h1]:mt-2 [&_h1]:mb-3 [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:mt-3 [&_h3]:mb-1.5 [&_p]:my-2 [&_p]:leading-relaxed [&_ul]:my-2 [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:pl-5 [&_li]:my-1 [&_blockquote]:border-l-4 [&_blockquote]:border-primary/40 [&_blockquote]:pl-3 [&_blockquote]:italic [&_strong]:font-semibold">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

function downloadBase64(filename: string, mime: string, base64: string) {
  const t = toast.loading("Preparando download...");
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  
  setTimeout(() => {
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("Download iniciado!", { id: t });
  }, 300);
}


const formatAcademicDateTime = (iso?: string | null) => {
  if (!iso) return null;
  return formatBRDate(iso) + " às 23:59";
};

function DueCountdown({ dueAt, allowLate, penaltyPerDay }: { dueAt: string; allowLate?: boolean; penaltyPerDay?: number | null }) {
  return (
    <ActivityDeadlineBadges
      dueDate={dueAt}
      allowLate={allowLate}
      penaltyPerDay={penaltyPerDay}
    />
  );
}

function formatPenaltyValue(v: number): string {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function LatePenaltyNote({
  allowLate,
  penaltyPerDay,
}: {
  allowLate?: boolean;
  penaltyPerDay?: number | null;
}) {
  if (!allowLate) {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
        <Clock className="h-3 w-3" /> Não são aceitas entregas após o prazo
      </span>
    );
  }
  if (penaltyPerDay && penaltyPerDay > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
        <Clock className="h-3 w-3" /> Entrega após o prazo: −{formatPenaltyValue(penaltyPerDay)}
        {" "}por dia de atraso
      </span>
    );
  }
  return null;
}

/**
 * Alerta vermelho exibido na tela de feedback do aluno quando a entrega ocorreu
 * depois do prazo: mostra o prazo, a data do envio, os dias de atraso e o
 * desconto aplicado (0,5 ponto por dia quando o professor não configurou outro valor).
 */
function LatePenaltyAlert({
  submittedAt,
  dueAt,
  allowLate,
  penaltyPerDay,
}: {
  submittedAt?: string | null;
  dueAt?: string | null;
  allowLate?: boolean | null;
  penaltyPerDay?: number | null;
}) {
  const info = useMemo(() => {
    if (!submittedAt || !dueAt) return null;
    const due = new Date(dueAt);
    const submitted = new Date(submittedAt);
    if (Number.isNaN(due.getTime()) || Number.isNaN(submitted.getTime())) return null;
    const diff = submitted.getTime() - due.getTime();
    if (diff <= 0) return null;
    const lateDays = Math.ceil(diff / 86_400_000);
    const perDay = penaltyPerDay && penaltyPerDay > 0 ? Number(penaltyPerDay) : 0.5;
    return {
      due,
      submitted,
      lateDays,
      perDay,
      discount: Number((perDay * lateDays).toFixed(2)),
    };
  }, [submittedAt, dueAt, penaltyPerDay]);

  if (!info) return null;

  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 space-y-1 text-destructive">
      <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide">
        <AlertTriangle className="h-3.5 w-3.5" /> Entrega em atraso — penalidade aplicada
      </div>
      <ul className="text-[11px] leading-relaxed list-disc pl-4 space-y-0.5">
        <li>Prazo: {info.due.toLocaleString("pt-BR")}</li>
        <li>Entregue em: {info.submitted.toLocaleString("pt-BR")}</li>
        <li>Dias de atraso: {info.lateDays}</li>
        <li>
          Desconto: −{formatPenaltyValue(info.perDay)} por dia de atraso (total −
          {formatPenaltyValue(info.discount)} ponto(s))
        </li>
      </ul>
      {allowLate === false && (
        <p className="text-[11px] font-medium">
          Esta atividade não aceita entregas fora do prazo — confirme com o professor(a).
        </p>
      )}
    </div>
  );
}

function cleanWorkInstructions(markdown?: string | null) {
  const withoutDueSection = (markdown ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/(^|\n)#{1,6}\s*Prazo\s+de\s+Entrega[\s\S]*?(?=\n#{1,6}\s|$)/gi, "\n")
    .replace(/(^|\n)#{1,6}\s*Cronograma[\s\S]*?(?=\n#{1,6}\s|$)/gi, (section) =>
      /\b(etapa|fase|semana|parcial|rascunho|revis[aã]o|orienta[cç][aã]o|encontro)\b/i.test(section)
        ? section
        : "\n",
    )
    .replace(
      /(^|\n)\s*(?:Prazo\s+de\s+Entrega|Data\s+de\s+Entrega|A\s+definir\s+(?:a\s+)?data\s+de\s+entrega|Data\s+de\s+entrega\s+a\s+definir).*?(?=\n|$)/gi,
      "\n",
    );

  const withoutDuplicatedHeader = withoutDueSection
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (
        /^#{1,6}\s*(?:EMENTA|ASSUNTO)(?:\s+[—-])?\s*(TRABALHO\s+ACAD[EÊ]MICO)?\s*$/i.test(trimmed)
      )
        return false;
      if (/^(?:EMENTA|ASSUNTO)(?:\s+[—-])?\s*(TRABALHO\s+ACAD[EÊ]MICO)?\s*$/i.test(trimmed))
        return false;
      if (/^#{1,6}\s*(Cabe[cç]alho|Dados\b)/i.test(trimmed)) return false;
      if (
        /^(?:[-*•]\s*)?\*\*(Data\s+de\s+Envio|Curso|Disciplina|Professor(?:\(a\))?|Tema\s+do\s+Trabalho):\*\*/i.test(
          trimmed,
        )
      )
        return false;
      if (
        /^(?:[-*•]\s*)?(Data\s+de\s+Envio|Curso|Disciplina|Professor(?:\(a\))?|Tema\s+do\s+Trabalho):/i.test(
          trimmed,
        )
      )
        return false;
      return true;
    })
    .join("\n");

  const objectiveMatch = withoutDuplicatedHeader.match(
    /(^|\n)#{1,6}\s*Objetivos\s+de\s+Aprendizagem\b/i,
  );
  if (!objectiveMatch?.index) return withoutDuplicatedHeader.trim();

  const suffix = withoutDuplicatedHeader.slice(objectiveMatch.index).trimStart();
  return suffix.trim();
}

function ensureLearningObjectivesFirst(markdown: string) {
  const body = markdown.trim();
  if (!body) return "## Objetivos de Aprendizagem\n\nNão informados.";
  return /^#{1,6}\s*Objetivos\s+de\s+Aprendizagem\b/i.test(body)
    ? body
    : `## Objetivos de Aprendizagem\n\n${body}`;
}

/** Plain-text snippet for the card preview (no Markdown symbols). */
function workPreviewText(instructions: string | null | undefined): string {
  return markdownToPlainText(cleanWorkInstructions(stripLeadingStandardHeader(instructions)));
}

type Crit = { id: string; name: string; description?: string; weight: number; max_score: number };
type RubricScore = { id: string; score: number; comment?: string };

interface Work {
  id: string;
  title: string;
  instructions: string | null;
  subtype?: string;
  grading_formula?: "weighted_average" | "simple_average";
  due_at: string | null;
  status: "draft" | "published";
  rubric: Crit[];
  created_at?: string | null;
  delivery_type?: "individual" | "group";
  max_group_size?: number | null;
  allow_late?: boolean;
  late_penalty_per_day?: number | null;
  late_penalty_type?: "percentage" | "fixed";
  late_tolerance_date?: string | null;
  late_tolerance_time?: string | null;
  diary_assessment_id?: string | null;
}

const WORK_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "tcc", label: "Trabalho de Conclusão de Curso (TCC)" },
  { value: "artigo_cientifico", label: "Artigo Científico" },
  { value: "revisao_literatura", label: "Revisão de Literatura" },
  { value: "estudo_caso_academico", label: "Estudo de Caso" },
  { value: "projeto_intervencao", label: "Projeto de Intervenção" },
  { value: "relatorio_pesquisa", label: "Relatório de Pesquisa" },
  { value: "resumo_expandido", label: "Resumo Expandido" },
  { value: "poster_cientifico", label: "Pôster Científico" },
  { value: "tema_predefinido", label: "Trabalho Acadêmico" },
];
interface Sub {
  id: string;
  work_id: string;
  student_id: string;
  file_url: string;
  status: string;
  total_score: number | null;
  teacher_comment: string | null;
  rubric_scores: RubricScore[] | null;
  released_at: string | null;
  submitted_at: string | null;
}

function stableSuggestedRubric(subtype?: string): Crit[] {
  const template = WORK_RUBRICS[subtype ?? "tema_predefinido"] ?? WORK_RUBRICS.tema_predefinido;
  return template.criteria.map((cr, index) => ({ ...cr, id: `${template.key}-${index}` }));
}

function withVisibleRubric(work: Work): Work {
  return {
    ...work,
    subtype: work.subtype ?? "tema_predefinido",
    grading_formula: work.grading_formula ?? "weighted_average",
    rubric: work.rubric?.length ? work.rubric : stableSuggestedRubric(work.subtype),
  };
}

export function WorksModule({
  disciplineId,
  isTeacher,
}: {
  disciplineId: string;
  isTeacher: boolean;
}) {
  const { user } = useAuth();
  const [works, setWorks] = useState<Work[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Work | null>(null);
  const [creating, setCreating] = useState(false);
  const [reviewing, setReviewing] = useState<Work | null>(null);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState<Work | null>(null);
  const [managingGroup, setManagingGroup] = useState<Work | null>(null);
  const [viewingRubric, setViewingRubric] = useState<Work | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [viewingWork, setViewingWork] = useState<Work | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [planWork, setPlanWork] = useState<LessonPlanItem | null>(null);
  const [prefill, setPrefill] = useState<WorkPrefill | null>(null);
  const [elaborating, setElaborating] = useState<Work | null>(null);
  const realtimeChannel = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearSelected = () => setSelected(new Set());
  const bulkDelete = async () => {
    const ids = Array.from(selected);
    const results = await Promise.allSettled(ids.map((id) => deleteAcademicWork({ data: { id } })));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed === 0) toast.success(`${ids.length} trabalho(s) excluído(s)`);
    else toast.error(`${ids.length - failed} excluído(s), ${failed} falharam`);
    clearSelected();
    await load();
  };

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("academic_works")
      .select("*")
      .eq("discipline_id", disciplineId)
      .order("created_at", { ascending: false });
    setWorks(((data ?? []) as unknown as Work[]).map(withVisibleRubric));
    if (data?.length) {
      const { data: ss } = await supabase
        .from("academic_work_submissions")
        .select("*")
        .in(
          "work_id",
          data.map((w) => w.id),
        );
      setSubs((ss ?? []) as unknown as Sub[]);
    } else setSubs([]);
    setLoading(false);
    // Tema oficial do Trabalho Acadêmico definido no Plano de Aula ativo.
    try {
      const items = await getLessonPlanItems({ data: { disciplineId, kind: "academic_work" } });
      setPlanWork(items[0] ?? null);
    } catch {
      setPlanWork(null);
    }
  }, [disciplineId]);

  // Trabalho já criado a partir do plano (mesmo título)?
  const planWorkExists = !!planWork && works.some(
    (w) => sanitizeListTitle(w.title).trim().toLowerCase() === planWork.title.trim().toLowerCase(),
  );

  const createFromPlanWork = () => {
    if (!planWork) return;
    setPrefill({
      title: planWork.title,
      subtype: String(planWork.metadata?.subtype || "tema_predefinido"),
      instructions: planWork.description ?? "",
    });
    setCreating(true);
  };

  useEffect(() => {
    load();

    // Habilitar Realtime para notificações de novos trabalhos
    realtimeChannel.current = supabase
      .channel("academic_works_changes")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "academic_works",
          filter: `discipline_id=eq.${disciplineId}`,
        },
        (payload) => {
          if (payload.new.status === "published") {
            toast.info(`Novo trabalho publicado: ${payload.new.title}`, {
              icon: <GraduationCap className="h-4 w-4" />,
            });
            load();
          }
        }
      )
      .subscribe();

    return () => {
      if (realtimeChannel.current) {
        supabase.removeChannel(realtimeChannel.current);
      }
    };
  }, [load, disciplineId]);

  const mySub = (wid: string) => subs.find((s) => s.work_id === wid && s.student_id === user?.id);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-white">
          <h2 className="text-lg font-semibold">Trabalhos acadêmicos</h2>
          <p className="text-sm opacity-80">
            TCC, artigos, revisões, projetos e pôsteres — com rubrica sugerida
          </p>
        </div>
        {isTeacher && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowLibrary(true)}>
              <Library className="h-4 w-4 mr-2" /> Biblioteca de Rubricas
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4 mr-2" /> Criar Trabalho Acadêmico
            </Button>
          </div>
        )}
      </div>

      {!loading && planWork && (isTeacher || !planWorkExists) && (
        <div className="rounded-xl border-2 border-primary/25 bg-primary/5 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-primary">
              Tema oficial do Trabalho Acadêmico — Plano de Aula
            </p>
            <p className="font-semibold leading-snug break-words">{planWork.title}</p>
            {(planWork.metadata?.tipo || planWork.metadata?.objetivos) && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-3">
                {planWork.metadata?.tipo ? `${planWork.metadata.tipo}. ` : ""}
                {planWork.metadata?.objetivos ? `Objetivos: ${planWork.metadata.objetivos}` : ""}
              </p>
            )}
          </div>
          {isTeacher && !planWorkExists && (
            <Button size="sm" className="shrink-0" onClick={createFromPlanWork}>
              <Plus className="h-4 w-4 mr-1" /> Criar trabalho com este tema
            </Button>
          )}
          {isTeacher && planWorkExists && (
            <span className="text-xs font-medium text-primary/80 shrink-0">Trabalho vinculado ao plano ✓</span>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : works.length === 0 ? (
        <div className="border-2 border-dashed rounded-xl py-12 text-center">
          <GraduationCap className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhum trabalho.</p>
          {isTeacher && (
            <p className="text-xs text-muted-foreground mt-1">
              Crie novos trabalhos pelo Assistente de IA (card “Criar Atividade / Trabalho”).
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {works
            .filter((w) => isTeacher || w.status === "published")
            .map((w) => {
              const me = mySub(w.id);
              return (
                <div
                  key={w.id}
                  className="rounded-xl border bg-card p-4 relative group"
                  style={{ boxShadow: "var(--shadow-card)" }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      {isTeacher && (
                        <Checkbox
                          className="mt-1 shrink-0"
                          checked={selected.has(w.id)}
                          onCheckedChange={() => toggleSelected(w.id)}
                          aria-label="Selecionar trabalho"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                      <div className="font-medium">{w.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {w.subtype ? (WORK_SUBTYPE_LABELS[w.subtype] ?? w.subtype) : ""}
                      </div>
                      {(() => {
                        const tag = extractStandardHeaderDocLine(w.instructions);
                        return tag ? (
                          <div className="text-xs font-medium text-primary/80 mt-0.5">
                            {tag.value}
                          </div>
                        ) : null;
                      })()}
                      {w.due_at && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <DueCountdown
                            dueAt={w.due_at}
                            allowLate={w.allow_late}
                            penaltyPerDay={w.late_penalty_per_day}
                          />
                        </div>
                      )}
                      {w.instructions && (
                        <p className="text-sm mt-2 text-muted-foreground line-clamp-2">
                          {workPreviewText(w.instructions)}
                        </p>
                      )}
                      </div>
                    </div>
                    {isTeacher && (
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded ${w.status === "published" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}
                      >
                        {w.status === "published" ? "Publicado" : "Rascunho"}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {w.instructions && (
                      <Button size="sm" variant="ghost" onClick={() => setViewingWork(w)}>
                        <FileText className="h-3.5 w-3.5 mr-1" /> Ver enunciado
                      </Button>
                    )}
                    {w.rubric && w.rubric.length > 0 && (
                      <Button size="sm" variant="ghost" onClick={() => setViewingRubric(w)}>
                        <BookOpen className="h-3.5 w-3.5 mr-1" /> Ver rubrica
                      </Button>
                    )}
                    {isTeacher ? (
                      <>
                        {w.status !== "published" && (
                          <Button
                            size="sm"
                            className="bg-gradient-to-r from-primary to-primary/80"
                            onClick={() => setElaborating(w)}
                          >
                            <Sparkles className="h-3.5 w-3.5 mr-1" /> Elaborar Diretrizes / Ementa com IA
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => setEditing(w)}>
                          Editar
                        </Button>
                        {w.status !== "published" && (
                          <Button
                            size="sm"
                            onClick={async () => {
                              if (!w.diary_assessment_id) {
                                toast.error("Defina o campo do diário (Editar) antes de liberar.");
                                return;
                              }
                              try {
                                // Publica sem reescrever prazo/tolerância/configurações do trabalho.
                                const { publishAcademicWork } = await import("@/backend/works.functions");
                                await publishAcademicWork({ data: { work_id: w.id } });
                                toast.success("Liberado para os alunos");
                                load();
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : "Erro");
                              }
                            }}
                          >
                            Liberar para o aluno
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => setReviewing(w)}>
                          {subs.filter((s) => s.work_id === w.id && s.status !== 'released').length > 0 
                            ? `Submissões (${subs.filter((s) => s.work_id === w.id && s.status !== 'released').length})` 
                            : 'Ver Resultados'}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          onClick={async () => {
                            if (!confirm("Excluir trabalho?")) return;
                            await deleteAcademicWork({ data: { id: w.id } });
                            load();
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        {!me && (
                          <>
                            {w.delivery_type === "group" && (
                              <Button size="sm" variant="outline" onClick={() => setManagingGroup(w)}>
                                <Users className="h-4 w-4 mr-1" /> Grupo
                              </Button>
                            )}
                            <Button 
                              size="sm" 
                              onClick={() => setSubmitting(w)}
                            >
                              Fazer Trabalho
                            </Button>
                          </>
                        )}
                        {me && (
                          <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700">
                            {me.status === "released"
                              ? `Nota: ${me.total_score ?? "—"}`
                              : "Enviado"}
                          </span>
                        )}
                        {me?.released_at && (
                          <details className="text-xs w-full">
                            <summary className="cursor-pointer text-primary">
                              Ver feedback completo
                            </summary>
                            <div className="mt-2 p-2 bg-muted/50 rounded space-y-2">
                              <LatePenaltyAlert
                                submittedAt={me.submitted_at}
                                dueAt={w.due_at}
                                allowLate={w.allow_late}
                                penaltyPerDay={w.late_penalty_per_day}
                              />
                              {me.rubric_scores && me.rubric_scores.length > 0 && (
                                <div>
                                  <strong>Notas por critério:</strong>
                                  <ul className="mt-1 space-y-1">
                                    {me.rubric_scores.map((rs) => {
                                      const crit = w.rubric.find((c) => c.id === rs.id);
                                      return (
                                        <li key={rs.id}>
                                          <span className="font-medium">
                                            {crit?.name ?? rs.id}:
                                          </span>{" "}
                                          {rs.score}/10
                                          {rs.comment && (
                                            <em className="block text-muted-foreground">
                                              {rs.comment}
                                            </em>
                                          )}
                                        </li>
                                      );
                                    })}
                                  </ul>
                                </div>
                              )}
                              {me.teacher_comment && (
                                <div>
                                  <div className="text-xs uppercase text-muted-foreground mb-1">Professor</div>
                                  <MarkdownView>{me.teacher_comment}</MarkdownView>
                                </div>
                              )}
                            </div>
                          </details>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {(creating || editing) && (
        <WorkEditor
          disciplineId={disciplineId}
          work={editing ?? undefined}
          initial={editing ? undefined : prefill ?? undefined}
          planWork={planWork}
          onClose={() => {
            setCreating(false);
            setEditing(null);
            setPrefill(null);
          }}
          onDone={() => {
            setCreating(false);
            setEditing(null);
            setPrefill(null);
            load();
          }}
        />
      )}
      {reviewing && (
        <SubmissionsReviewPanel
          disciplineId={disciplineId}
          kind="work"
          open
          activityId={reviewing.id}
          defaultRubric={reviewing.rubric}
          onClose={() => {
            setReviewing(null);
            load();
          }}
        />
      )}
      {submitting && (
        <>
          {submitting.subtype && submitting.subtype !== "tema_predefinido" ? (
            <SubmitWorkDialog
              work={submitting}
              disciplineId={disciplineId}
              onClose={() => setSubmitting(null)}
              onDone={() => {
                setSubmitting(null);
                load();
              }}
            />
          ) : (
            <WorkSubmissionAssistant
              work={submitting}
              disciplineId={disciplineId}
              onClose={() => setSubmitting(null)}
              onDone={() => {
                setSubmitting(null);
                load();
              }}
            />
          )}
        </>
      )}
      {managingGroup && (
        <ManageGroupDialog
          work={managingGroup}
          disciplineId={disciplineId}
          onClose={() => setManagingGroup(null)}
        />
      )}
      {viewingRubric && (
        <WorkRubricViewer work={viewingRubric} onClose={() => setViewingRubric(null)} />
      )}
      {viewingWork && (
        <WorkViewerDialog
          work={viewingWork}
          disciplineId={disciplineId}
          onClose={() => setViewingWork(null)}
        />
      )}
      {elaborating && (
        <WorkGuidelinesDialog
          work={elaborating}
          disciplineId={disciplineId}
          onClose={() => setElaborating(null)}
          onSaved={() => {
            setElaborating(null);
            load();
          }}
        />
      )}
      {showLibrary && <RubricLibraryDialog scope="work" onClose={() => setShowLibrary(false)} />}
      {isTeacher && (
        <BulkDeleteBar count={selected.size} itemLabel="trabalho" onClear={clearSelected} onConfirm={bulkDelete} />
      )}
    </div>
  );
}

/**
 * "Elaborar Diretrizes / Ementa com IA": gera a estrutura acadêmica completa do
 * trabalho a partir do tema/objetivos existentes e salva no enunciado.
 */
function WorkGuidelinesDialog({
  work,
  disciplineId,
  onClose,
  onSaved,
}: {
  work: Work;
  disciplineId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [extraContext, setExtraContext] = useState("");
  const [content, setContent] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  const generate = async () => {
    setGenerating(true);
    try {
      const { generateWorkGuidelines } = await import("@/backend/works.functions");
      const res = await generateWorkGuidelines({
        data: { work_id: work.id, extra_context: extraContext.trim() || undefined },
      });
      setContent(res.guidelines);
      toast.success("Diretrizes elaboradas. Revise e salve no enunciado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao elaborar diretrizes");
    } finally {
      setGenerating(false);
    }
  };

  const save = async () => {
    if (!content.trim()) return;
    setSaving(true);
    try {
      // Atualiza somente o enunciado: prazo, tolerância, formato e cabeçalho são preservados no servidor.
      const { saveWorkGuidelines } = await import("@/backend/works.functions");
      await saveWorkGuidelines({ data: { work_id: work.id, instructions: content.trim() } });
      toast.success("Enunciado atualizado com as diretrizes.");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Elaborar Diretrizes / Ementa com IA
          </DialogTitle>
          <DialogDescription>
            Tema central: <span className="font-medium">{work.title}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Orientações adicionais (opcional)</Label>
            <Textarea
              rows={3}
              value={extraContext}
              onChange={(e) => setExtraContext(e.target.value)}
              placeholder="Ex.: exigir normas Vancouver e mínimo de 8 referências indexadas."
            />
          </div>
          <Button onClick={generate} disabled={generating}>
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Elaborando…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" /> {content ? "Gerar novamente" : "Elaborar com IA"}
              </>
            )}
          </Button>

          {content && (
            <>
              <div className="rounded-lg border bg-muted/30 p-4 prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </div>
              <div>
                <Label>Editar o texto antes de salvar</Label>
                <Textarea rows={10} value={content} onChange={(e) => setContent(e.target.value)} />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={!content.trim() || saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null} Salvar no enunciado
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function WorkViewerDialog({
  work,
  disciplineId,
  onClose,
}: {
  work: Work;
  disciplineId: string;
  onClose: () => void;
}) {
  const [header, setHeader] = useState<{
    institution_name: string | null;
    course_name: string | null;
    discipline_name: string;
    teacher_name: string | null;
  } | null>(null);
  const [downloading, setDownloading] = useState(false);
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const h = await getDisciplineHeader({ data: { discipline_id: disciplineId } });
        if (!cancel) setHeader(h);
      } catch {
        /* noop */
      }
    })();
    return () => {
      cancel = true;
    };
  }, [disciplineId]);
  const customHeader = parseDocumentHeader(work.instructions);
  const sentAt = formatAcademicDateTime(work.created_at);
  const dueAt = formatAcademicDateTime(work.due_at);
  const cleanedInstructions = ensureLearningObjectivesFirst(
    cleanWorkInstructions(stripDocumentHeaderMetadata(work.instructions)),
  );
  const handleDownloadPDF = async () => {
    setDownloading(true);
    try {
      const res = await exportAcademicWorkPDF({ data: { work_id: work.id } });
      downloadBase64(res.filename, res.mime, res.base64);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao baixar PDF");
    } finally {
      setDownloading(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>ASSUNTO TRABALHO ACADÊMICO</DialogTitle>
          <DialogDescription>Enunciado completo do trabalho</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="text-sm border rounded p-3 bg-muted/40 leading-relaxed space-y-1 flex-1">
            <div>
              <strong>Data de Envio:</strong> {sentAt ?? "Não informada"}
            </div>
            <div>
              <strong>Instituição:</strong> {customHeader?.institution_name ?? header?.institution_name ?? "Não informada"}
            </div>
            <div>
              <strong>Curso:</strong> {customHeader?.course_name ?? header?.course_name ?? "Não informado"}
            </div>
            <div>
              <strong>Disciplina:</strong> {customHeader?.discipline_name ?? header?.discipline_name ?? "Carregando..."}
            </div>
            <div>
              <strong>Professor:</strong> {customHeader?.teacher_name ?? header?.teacher_name ?? "Não informado"}
            </div>
            <div>
              <strong>Tema do Trabalho:</strong> {customHeader?.theme ?? work.title}
            </div>
          </div>
          <Button className="shrink-0" onClick={handleDownloadPDF} disabled={downloading}>
            {downloading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Baixar PDF
          </Button>
        </div>
        {dueAt && (
          <div className="text-sm border rounded p-3 bg-card">
            <strong>Prazo final:</strong> {dueAt}
          </div>
        )}
        <MarkdownView>{cleanedInstructions}</MarkdownView>
      </DialogContent>
    </Dialog>
  );
}

function WorkRubricViewer({ work, onClose }: { work: Work; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Rubrica de avaliação</DialogTitle>
          <DialogDescription>
            {work.title} — fórmula:{" "}
            {work.grading_formula === "simple_average" ? "média simples" : "média ponderada"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {work.rubric.map((c) => (
            <div key={c.id} className="border rounded p-3">
              <div className="flex items-center justify-between">
                <div className="font-medium text-sm">{c.name}</div>
                <div className="text-xs text-muted-foreground">
                  peso {c.weight}% · 0–{c.max_score}
                </div>
              </div>
              {c.description && (
                <p className="text-xs text-muted-foreground mt-1">{c.description}</p>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type WorkPrefill = { title?: string; subtype?: string; instructions?: string };

function WorkEditor({
  disciplineId,
  work,
  initial,
  planWork,
  onClose,
  onDone,
}: {
  disciplineId: string;
  work?: Work;
  initial?: WorkPrefill;
  planWork?: LessonPlanItem | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(work?.title ?? initial?.title ?? "");
  const [subtype, setSubtype] = useState<string>(work?.subtype ?? initial?.subtype ?? "tema_predefinido");
  const [instructions, setInstructions] = useState(
    work ? stripDocumentHeaderMetadata(work.instructions) : (initial?.instructions ?? ""),
  );
  const [formula, setFormula] = useState<"weighted_average" | "simple_average">(
    work?.grading_formula ?? "weighted_average",
  );
  const [rubric, setRubric] = useState<Crit[]>(
    work?.rubric && work.rubric.length > 0
      ? work.rubric
      : templateToRubric(
          WORK_RUBRICS[work?.subtype ?? initial?.subtype ?? "tema_predefinido"] ?? WORK_RUBRICS.tema_predefinido,
        ),
  );
  const [submitting, setSubmitting] = useState(false);
  const [showLib, setShowLib] = useState(false);
  const initialDue = work?.due_at ? new Date(work.due_at) : null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const [dueDate, setDueDate] = useState(
    initialDue
      ? `${initialDue.getFullYear()}-${pad(initialDue.getMonth() + 1)}-${pad(initialDue.getDate())}`
      : "",
  );
  const [dueTime, setDueTime] = useState(
    initialDue ? `${pad(initialDue.getHours())}:${pad(initialDue.getMinutes())}` : "23:59",
  );
  const [headerValues, setHeaderValues] = useState({
    institution_name: "",
    course_name: "",
    discipline_name: "",
    teacher_name: "",
    theme: work?.title ?? "",
  });
  const [showSyllabi, setShowSyllabi] = useState(false);
  const [syllabi, setSyllabi] = useState<Array<{ id: string; title: string }>>([]);
  const [loadingSyl, setLoadingSyl] = useState(false);
  const [deliveryType, setDeliveryType] = useState<"individual" | "group">(
    work?.delivery_type ?? "individual",
  );
  const [maxGroupSize, setMaxGroupSize] = useState<number>(work?.max_group_size ?? 2);
  const [allowLate, setAllowLate] = useState<boolean>(work?.allow_late ?? false);
  const [latePenalty, setLatePenalty] = useState<number>(work?.late_penalty_per_day ?? 0);
  const [latePenaltyType, setLatePenaltyType] = useState<"percentage" | "fixed">("percentage");
  const [lateToleranceDate, setLateToleranceDate] = useState("");
  const [lateToleranceTime, setLateToleranceTime] = useState("23:59");
  const [includeInCalendar, setIncludeInCalendar] = useState(true);
  const [diaryAssessmentId, setDiaryAssessmentId] = useState<string>(
    work?.diary_assessment_id ?? "",
  );
  const [diaryOptions, setDiaryOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [syllabusNotice, setSyllabusNotice] = useState(false);

  // AI Block State
  const [aiOpen, setAiOpen] = useState(false);
  const [plans, setPlans] = useState<any[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [suggestedThemes, setSuggestedThemes] = useState<any[]>([]);
  const [suggestedExtras, setSuggestedExtras] = useState<any[]>([]);
  const [catalogThemes, setCatalogThemes] = useState<any[]>([]);
  const [loadingModules, setLoadingModules] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState("");
  const [customTopic, setCustomTopic] = useState("");
  const [extra, setExtra] = useState("");
  const [generating, setGenerating] = useState(false);
  const [lastGenId, setLastGenId] = useState<string | null>(null);

  const loadPlans = useCallback(async () => {
    if (!disciplineId) {
      console.warn("[WorksModule] loadPlans aborted: disciplineId is missing");
      return;
    }
    setLoadingPlans(true);
    try {
      console.log("[WorksModule] Fetching materials for discipline:", disciplineId);
      const { data: mats, error } = await supabase
        .from("materials")
        .select("id, module_id, discipline_id, title, description, content, file_url, status, position, created_at")
        .eq("discipline_id", disciplineId)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });

      if (error) throw error;

      console.log("[WorksModule] Materials raw data:", mats);
      
      const list = (mats ?? []).map((p) => ({ 
        id: p.id, 
        title: p.title || "Sem título", 
        created_at: p.created_at,
        content: p.content
      }));

      console.log("[WorksModule] Setting plans state with:", list);
      setPlans(list);
    } catch (e) {
      console.error("[WorksModule] Error loading plans:", e);
      toast.error(e instanceof Error ? e.message : "Erro ao carregar planos de aula");
    } finally {
      setLoadingPlans(false);
    }
  }, [disciplineId]);

  // Carregar planos assim que o componente abrir
  useEffect(() => {
    loadPlans();
  }, [loadPlans]);


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
      } catch { /* noop */ }
    })();
    return () => { cancel = true; };
  }, [disciplineId]);

  useEffect(() => {
    if (work) return;
    let cancel = false;
    (async () => {
      const { data } = await supabase
        .from("disciplines")
        .select("syllabus_text")
        .eq("id", disciplineId)
        .maybeSingle();
      if (cancel) return;
      const text = data?.syllabus_text?.trim();
      if (text) {
        setInstructions((cur) => (cur.trim() ? cur : text));
        setSyllabusNotice(true);
      }
    })();
    return () => { cancel = true; };
  }, [work, disciplineId]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const custom = parseDocumentHeader(work?.instructions);
      try {
        const h = await getDisciplineHeader({ data: { discipline_id: disciplineId } });
        if (!cancel && h) setHeaderValues({
          institution_name: custom?.institution_name ?? h.institution_name ?? "",
          course_name: custom?.course_name ?? h.course_name ?? "",
          discipline_name: custom?.discipline_name ?? h.discipline_name ?? "",
          teacher_name: custom?.teacher_name ?? h.teacher_name ?? "",
          theme: custom?.theme ?? work?.title ?? "",
        });
      } catch {
        if (!cancel && custom) setHeaderValues({
          institution_name: custom.institution_name ?? "",
          course_name: custom.course_name ?? "",
          discipline_name: custom.discipline_name ?? "",
          teacher_name: custom.teacher_name ?? "",
          theme: custom.theme ?? work?.title ?? "",
        });
      }
    })();
    return () => { cancel = true; };
  }, [disciplineId, work?.instructions, work?.title]);


  const toggleAi = () => {
    const next = !aiOpen;
    setAiOpen(next);
    if (next && plans.length === 0) loadPlans();
  };

  useEffect(() => {
    if (!selectedPlanId) {
      setSuggestedThemes([]);
      setSuggestedExtras([]);
      setSelectedTopic("");
      setCustomTopic("");
      return;
    }
    
    const plan = plans.find(p => p.id === selectedPlanId);
    if (!plan) return;

    const md = plan.content || "";
    
    const extractThemes = (text: string) => {
      const lines = text.split("\n");
      const out: any[] = [];
      let inSection = false;
      for (const line of lines) {
        if (/Banco de Temas Sugeridos/i.test(line)) inSection = true;
        else if (/^#{1,4}\s+/i.test(line)) inSection = false;
        
        const m = line.match(/^\s*[-*•]?\s*\*\*\s*([^*:]+?)\s*:?\s*\*\*\s*:?\s*(.+?)\s*$/);
        if (inSection && m) out.push({ label: m[1].trim(), theme: m[2].trim() });
      }
      return out;
    };

    const parsedThemes = extractThemes(md);
    // O tema oficial sincronizado do Plano de Aula entra sempre em primeiro lugar.
    const themes = planWork?.title
      ? [
          { label: "Tema oficial do Plano de Aula", theme: planWork.title },
          ...parsedThemes.filter((t) => t.theme.trim().toLowerCase() !== planWork.title.trim().toLowerCase()),
        ]
      : parsedThemes;
    setSuggestedThemes(themes);
    const firstTopic = themes[0]?.theme ?? "__custom__";
    setSelectedTopic(firstTopic);
    setLoadingModules(false);
  }, [selectedPlanId, plans, planWork]);

  const generate = async () => {
    const topic = selectedTopic === "__custom__" || !selectedTopic ? customTopic.trim() : selectedTopic.trim();
    if (topic.length < 2) {
      toast.error("Informe o tema para a IA gerar o conteúdo");
      return;
    }
    if (!selectedPlanId) {
      toast.error("Selecione um Plano de Aula para gerar a ementa");
      return;
    }
    setGenerating(true);
    try {
      const plan = plans.find(p => p.id === selectedPlanId);
      if (!plan) {
        toast.error("Plano de aula não encontrado na lista.");
        setGenerating(false);
        return;
      }
      const planMd = plan.content || "";


      if (lastGenId) {
        // Best effort cleanup of previous generations
        const { error } = await supabase.from("ai_generations").delete().eq("id", lastGenId);
        if (error) console.error("Erro ao limpar geração anterior:", error);
      }

      const res = await generateActivitySyllabusFromPlan({
        data: {
          discipline_id: disciplineId,
          lesson_plan_id: selectedPlanId,
          module_topic: topic,
          kind: "work",
          subtype: subtype as any,
          extra_context: (extra.trim() ? `${extra.trim()}\n\nCONTEXTO DO PLANO SELECIONADO:\n${planMd}` : `CONTEXTO DO PLANO SELECIONADO:\n${planMd}`),
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
      
      const t = WORK_RUBRICS[subtype];
      if (t) setRubric(templateToRubric(t));

      setAiOpen(false);
      toast.success("Ementa gerada com sucesso");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar com IA");
    } finally {
      setGenerating(false);
    }
  };

  const openSyllabusPicker = async () => {
    setShowSyllabi(true);
    setLoadingSyl(true);
    try {
      const res = await listAIGenerations({
        data: { discipline_id: disciplineId, tool: "activity_syllabus", limit: 50 },
      });
      const items = Array.isArray(res?.items) ? res.items : [];
      setSyllabi(items.map((i) => ({ id: i.id, title: i.title })));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar ementas");
    } finally {
      setLoadingSyl(false);
    }
  };

  const attachSyllabus = async (id: string, title: string) => {
    try {
      const res = await getAIGeneration({ data: { id } });
      const md = typeof res?.result === "string" ? res.result : JSON.stringify(res?.result ?? "");
      const promptObj = (res as { prompt?: { kind?: string; subtype?: string } | null })?.prompt;
      setInstructions(md);
      setTitle((cur) => (cur.trim() ? cur : title));
      if (promptObj?.kind === "work" && promptObj.subtype && WORK_RUBRICS[promptObj.subtype]) {
        setSubtype(promptObj.subtype);
        setRubric(templateToRubric(WORK_RUBRICS[promptObj.subtype]));
      }
      toast.success("Ementa vinculada");
      setShowSyllabi(false);
    } catch (e) {
      console.error("[WorksModule] Erro na geração:", e);
      toast.error(e instanceof Error ? e.message : "Erro na geração");
    } finally {
      setGenerating(false);
    }
  };

  const onSubtypeChange = (val: string) => {
    setSubtype(val);
    const t = WORK_RUBRICS[val];
    if (t) setRubric(templateToRubric(t));
  };

  const applyTemplate = (key: string) => {
    const t = WORK_RUBRICS[key];
    if (!t) return;
    setRubric(templateToRubric(t));
    toast.success(`Rubrica de "${WORK_SUBTYPE_LABELS[key]}" aplicada`);
  };

  const submit = async (publish: boolean) => {
    if (!title.trim()) {
      toast.error("Informe o título");
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
    setSubmitting(true);
    try {
      const due_at = dueDate ? new Date(`${dueDate}T${dueTime || "23:59"}:00`).toISOString() : undefined;
      const isoLateTolerance = allowLate && lateToleranceDate ? new Date(`${lateToleranceDate}T${lateToleranceTime || "23:59"}:00`).toISOString() : undefined;

      if (publish && includeInCalendar && due_at) {
        await saveCalendarEvent({
          data: {
            discipline_id: disciplineId,
            title: `Trabalho: ${title.trim()}`,
            description: instructions.trim().slice(0, 500) || undefined,
            event_date: due_at,
            event_type: "work",
          },
        }).catch(() => null);
      }

      await saveAcademicWork({
        data: {
          id: work?.id,
          discipline_id: disciplineId,
          title: title.trim(),
          subtype: subtype as any,
          grading_formula: formula,
          instructions: withDocumentHeaderMetadata(instructions.trim(), { ...headerValues, theme: headerValues.theme || title.trim() }) || undefined,
          rubric,
          due_at,
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
      toast.success(publish ? "Trabalho publicado" : "Rascunho salvo");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setSubmitting(false);
    }
  };

  console.log("[WorksModule] Discipline ID:", disciplineId);
  console.log("[WorksModule] Plans in state:", plans);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{work ? "Editar" : "Novo"} trabalho acadêmico</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* AI Generation Accordion */}
          <Accordion type="single" collapsible className="w-full border rounded-lg px-3">
            <AccordionItem value="ai-gen" className="border-none">
              <AccordionTrigger className="py-2.5 text-sm font-medium hover:no-underline">
                <span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Gerar com IA (opcional)</span>
              </AccordionTrigger>
              <AccordionContent className="space-y-3 pt-1 pb-3">
                <div className="space-y-1.5">
                  <Label>Plano de Aula</Label>
                  <select 
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm" 
                    value={selectedPlanId} 
                    onChange={(e) => setSelectedPlanId(e.target.value)}
                  >
                    <option value="">— Selecione um plano —</option>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title} ({new Date(p.created_at).toLocaleDateString("pt-BR")})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Tema</Label>
                  <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={selectedTopic} onChange={(e) => setSelectedTopic(e.target.value)}>
                     {suggestedThemes.map((t, i) => <option key={i} value={t.theme}>{t.label}: {t.theme}</option>)}
                     <option value="__custom__">Outro tema…</option>
                  </select>
                </div>
                <Button type="button" onClick={generate} disabled={generating} className="w-full">
                  {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                  Gerar conteúdo com IA
                </Button>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
          <div>
            <Label>Título</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Tipo de trabalho</Label>
              <select className="border rounded px-2 py-1.5 text-sm w-full" value={subtype} onChange={(e) => onSubtypeChange(e.target.value)}>
                {WORK_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <Label>Lançar nota no diário</Label>
              <select className="border rounded px-2 py-1.5 text-sm w-full" value={diaryAssessmentId} onChange={(e) => setDiaryAssessmentId(e.target.value)}>
                <option value="">Selecione...</option>
                {diaryOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Data de entrega</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div>
              <Label>Horário Limite</Label>
              <Input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Instruções</Label>
            <Textarea rows={5} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          </div>
          <div className="space-y-2 rounded-md border p-3">
            <Label>Cabeçalho editável do documento</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Input placeholder="Instituição" value={headerValues.institution_name} onChange={(e) => setHeaderValues((p) => ({ ...p, institution_name: e.target.value }))} />
              <Input placeholder="Curso" value={headerValues.course_name} onChange={(e) => setHeaderValues((p) => ({ ...p, course_name: e.target.value }))} />
              <Input placeholder="Disciplina" value={headerValues.discipline_name} onChange={(e) => setHeaderValues((p) => ({ ...p, discipline_name: e.target.value }))} />
              <Input placeholder="Professor(a)" value={headerValues.teacher_name} onChange={(e) => setHeaderValues((p) => ({ ...p, teacher_name: e.target.value }))} />
              <Input className="sm:col-span-2" placeholder="Tema do trabalho" value={headerValues.theme} onChange={(e) => setHeaderValues((p) => ({ ...p, theme: e.target.value }))} />
            </div>
          </div>
          <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded inline-flex items-center gap-1">
            <BookCheck className="h-3.5 w-3.5" /> Configuração ABNT padrão (Times 12, espaço 1.5,
            margens 3-2-3-2)
          </div>
          <div className="space-y-4 p-4 bg-muted/30 rounded-lg border">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                  <Checkbox checked={allowLate} onCheckedChange={(v) => setAllowLate(v === true)} />
                  Aceitar entrega com atraso
                </label>
                <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                  <Checkbox checked={includeInCalendar} onCheckedChange={(v) => setIncludeInCalendar(v === true)} />
                  Integrar no Calendário
                </label>
              </div>

              {allowLate && (
                <div className="space-y-3 p-3 bg-white/50 rounded border animate-in fade-in slide-in-from-top-1">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-[10px] uppercase font-bold text-muted-foreground">Tipo de Desconto</Label>
                      <select className="w-full h-8 text-xs border rounded px-2" value={latePenaltyType} onChange={(e) => setLatePenaltyType(e.target.value as "percentage" | "fixed")}>
                        <option value="percentage">Percentual (%)</option>
                        <option value="fixed">Fixo (Pontos)</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[10px] uppercase font-bold text-muted-foreground">Valor por dia</Label>
                      <Input type="number" step="0.1" className="h-8 text-xs" value={latePenalty} onChange={(e) => setLatePenalty(Number(e.target.value))} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="space-y-2 rounded-md border p-3">
            <Label>Tipo de entrega</Label>
            <RadioGroup
              value={deliveryType}
              onValueChange={(v) => setDeliveryType(v as "individual" | "group")}
              className="flex gap-6"
            >
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <RadioGroupItem value="individual" /> Individual
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <RadioGroupItem value="group" /> Em grupo
              </label>
            </RadioGroup>
            {deliveryType === "group" && (
              <div>
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
          {/* Already in grid above for work creation, but keeping this simple selector if preferred or for edits */}
          {(!work || work.id) && (
            <div className="hidden">
              <Label>Lançar nota no diário</Label>
              <select className="border rounded px-2 py-1.5 text-sm w-full" value={diaryAssessmentId} onChange={(e) => setDiaryAssessmentId(e.target.value)}>
                <option value="">Selecione o campo de avaliação…</option>
                {diaryOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <Label>Fórmula da nota final</Label>
            <select
              className="border rounded px-2 py-1.5 text-sm w-full"
              value={formula}
              onChange={(e) => setFormula(e.target.value as "weighted_average" | "simple_average")}
            >
              <option value="weighted_average">Média ponderada</option>
              <option value="simple_average">Média simples</option>
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label>Rubrica</Label>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" type="button" onClick={() => setShowLib(true)}>
                  <Library className="h-3.5 w-3.5 mr-1" /> Biblioteca
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  onClick={() => applyTemplate(subtype)}
                >
                  Restaurar sugerida
                </Button>
              </div>
            </div>
            <div className="space-y-2 mt-2">
              {rubric.map((c, i) => (
                <div key={c.id} className="border rounded p-2 space-y-2">
                  <div className="flex gap-2">
                    <Input
                      value={c.name}
                      onChange={(e) =>
                        setRubric(
                          rubric.map((r, idx) => (idx === i ? { ...r, name: e.target.value } : r)),
                        )
                      }
                    />
                    <Input
                      type="number"
                      className="w-20"
                      value={c.weight}
                      onChange={(e) =>
                        setRubric(
                          rubric.map((r, idx) =>
                            idx === i ? { ...r, weight: Number(e.target.value) } : r,
                          ),
                        )
                      }
                      placeholder="Peso %"
                    />
                    <Input
                      type="number"
                      className="w-20"
                      value={c.max_score}
                      onChange={(e) =>
                        setRubric(
                          rubric.map((r, idx) =>
                            idx === i ? { ...r, max_score: Number(e.target.value) } : r,
                          ),
                        )
                      }
                      placeholder="Máx"
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive"
                      onClick={() => setRubric(rubric.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <Textarea
                    rows={2}
                    placeholder="Descrição"
                    value={c.description ?? ""}
                    onChange={(e) =>
                      setRubric(
                        rubric.map((r, idx) =>
                          idx === i ? { ...r, description: e.target.value } : r,
                        ),
                      )
                    }
                  />
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setRubric([
                    ...rubric,
                    { id: crypto.randomUUID(), name: "", weight: 0, max_score: 10 },
                  ])
                }
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Critério
              </Button>
              <p className="text-xs text-muted-foreground">
                Soma dos pesos: {rubric.reduce((s, c) => s + (c.weight || 0), 0)}%
              </p>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="outline" disabled={submitting} onClick={() => submit(false)}>
            Salvar rascunho
          </Button>
          <Button disabled={submitting} onClick={() => submit(true)}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Publicar
          </Button>
        </DialogFooter>
      </DialogContent>
      {showLib && (
        <RubricLibraryDialog
          scope="work"
          onClose={() => setShowLib(false)}
          onSelect={(sel: RubricSelection) => {
            setRubric(sel.criteria);
            setFormula(sel.grading_formula);
          }}
        />
      )}
      {showSyllabi && (
        <Dialog open onOpenChange={(o) => !o && setShowSyllabi(false)}>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Vincular Ementa da IA</DialogTitle>
              <DialogDescription>
                Selecione uma ementa gerada pelo Assistente para preencher as instruções e aplicar a
                rubrica correspondente.
              </DialogDescription>
            </DialogHeader>
            {loadingSyl ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando…
              </div>
            ) : syllabi.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                Nenhuma ementa gerada ainda. Use o Assistente de IA → Ementas para criar uma.
              </p>
            ) : (
              <div className="space-y-2">
                {syllabi.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => attachSyllabus(s.id, s.title)}
                    className="w-full text-left border rounded p-2 hover:bg-accent flex items-center gap-2"
                  >
                    <FileText className="h-4 w-4 text-primary" />
                    <span className="text-sm">{s.title}</span>
                  </button>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setShowSyllabi(false)}>
                Fechar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}

function SubmitWorkDialog({
  work,
  disciplineId,
  onClose,
  onDone,
}: {
  work: Work;
  disciplineId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("cover");
  const [submitting, setSubmitting] = useState(false);
  const [isTutorOpen, setIsTutorOpen] = useState(false);
  const [tutorGuidance, setTutorGuidance] = useState("");
  const [loadingTutor, setLoadingTutor] = useState(false);

  // Cover data
  const [coverTitle, setCoverTitle] = useState(work.title);
  const [coverSubtitle, setCoverSubtitle] = useState("");
  const [coverStudent, setCoverStudent] = useState(user?.user_metadata?.full_name || "");
  const [coverInstitution, setCoverInstitution] = useState("");
  const [coverYear, setCoverYear] = useState(new Date().getFullYear().toString());

  // Content data
  const [abstract, setAbstract] = useState("");

  const isGroup = work.delivery_type === "group";
  const [canSubmit, setCanSubmit] = useState(!isGroup);
  const [checking, setChecking] = useState(isGroup);
  const [statusMsg, setStatusMsg] = useState<string>("");

  useEffect(() => {
    if (!isGroup || !user) return;
    (async () => {
      try {
        const ctx = await getGroupContext({
          data: { discipline_id: disciplineId, activity_id: work.id, activity_kind: "work" },
        });
        if (!ctx.my_group) {
          setCanSubmit(false);
          setStatusMsg('Você ainda não faz parte de um grupo. Abra "Meu grupo" para criar ou entrar em um.');
        } else if (!ctx.is_leader) {
          setCanSubmit(false);
          setStatusMsg("Apenas o líder do grupo pode enviar o arquivo do trabalho.");
        } else {
          setCanSubmit(true);
          setStatusMsg("");
        }
      } catch {
        setCanSubmit(false);
        setStatusMsg("Não foi possível verificar seu grupo. Tente novamente.");
      } finally {
        setChecking(false);
      }
    })();
  }, [isGroup, user, disciplineId, work.id]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        bulletList: {
          HTMLAttributes: {
            class: "list-disc pl-5",
          },
        },
        orderedList: {
          HTMLAttributes: {
            class: "list-decimal pl-5",
          },
        },
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Heading.configure({ levels: [1, 2, 3] }),
      Bold,
      Italic,
      Underline,
      Link,
      BulletList,
      OrderedList,
      ListItem,
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none min-h-[400px] p-[2cm] text-justify bg-white shadow-sm",
        style: "font-family: 'Arial', 'Times New Roman', serif; font-size: 12pt; line-height: 1.5;",
      },
    },
  });

  const setLongQuote = () => {
    if (!editor) return;
    editor.chain().focus().toggleBlockquote().run();
    // Tiptap doesn't have a direct "long quote" command in starter kit,
    // so we use blockquote and style it in the editor's CSS.
  };

  const getTutorGuidance = async () => {
    if (!editor || loadingTutor) return;
    setLoadingTutor(true);
    setIsTutorOpen(true);
    try {
      const text = editor.getText();
      const guidance = await getWorkTutorGuidance({ data: { text } });
      setTutorGuidance(guidance);
    } catch (e) {
      toast.error("Erro ao obter orientação do tutor");
    } finally {
      setLoadingTutor(false);
    }
  };

  const generateAndSubmit = async () => {
    if (!editor || submitting || !user) return;
    setSubmitting(true);
    try {
      const element = document.createElement("div");
      element.style.width = "210mm";
      element.style.padding = "20mm";
      element.style.fontFamily = "Arial, sans-serif";
      // Cores explícitas e seguras: evita que html2canvas tente interpretar
      // funções de cor modernas (lab(), oklch(), color(display-p3 ...)).
      element.style.backgroundColor = "#ffffff";
      element.style.color = "#000000";
      element.style.borderColor = "#e5e7eb";



      element.innerHTML = `
        <div style="text-align: center; height: 250mm; display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <h1 style="font-size: 14pt; font-weight: bold; text-transform: uppercase;">${coverInstitution}</h1>
          </div>
          <div>
            <h2 style="font-size: 12pt; font-weight: bold;">${coverStudent}</h2>
            <div style="margin-top: 50mm;">
              <h1 style="font-size: 16pt; font-weight: bold; text-transform: uppercase;">${coverTitle}</h1>
              <h2 style="font-size: 12pt; margin-top: 5mm;">${coverSubtitle}</h2>
            </div>
          </div>
          <div style="margin-bottom: 20mm;">
            <p style="font-size: 12pt;">${coverYear}</p>
          </div>
        </div>

        <div style="page-break-before: always; padding-top: 20mm;">
          <h2 style="font-size: 12pt; font-weight: bold; text-align: center; text-transform: uppercase;">Resumo</h2>
          <div style="margin-top: 10mm; text-align: justify; line-height: 1.5; font-size: 12pt;">
            ${abstract.replace(/\n/g, "<br>")}
          </div>
        </div>

        <div style="page-break-before: always; padding-top: 20mm;">
          <h2 style="font-size: 12pt; font-weight: bold; text-align: center; text-transform: uppercase; margin-bottom: 10mm;">Desenvolvimento</h2>
          <div class="abnt-content" style="text-align: justify; line-height: 1.5; font-size: 12pt;">
            ${editor.getHTML()}
          </div>
        </div>
        <style>
          .abnt-content, .abnt-content * {
            color: #000000 !important;
            background-color: transparent !important;
            border-color: #e5e7eb !important;
          }
          .abnt-content blockquote {
            margin-left: 4cm;
            font-size: 10pt;
            line-height: 1;
            border: none;
            padding: 0;
            text-align: justify;
          }
        </style>
      `;

      const html2pdf = (await import("html2pdf.js")).default;
      const UNSUPPORTED_COLOR_RE = /\b(lab|lch|oklab|oklch|color)\(/i;
      const COLOR_PROPS = [
        "color", "background-color", "border-color", "border-top-color",
        "border-right-color", "border-bottom-color", "border-left-color",
        "outline-color", "text-decoration-color", "column-rule-color", "caret-color",
      ];
      const FALLBACKS: Record<string, string> = {
        color: "#000000",
        "background-color": "transparent",
      };
      const sanitizeColors = (root: HTMLElement) => {
        const nodes = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];
        for (const node of nodes) {
          const computed = node.ownerDocument?.defaultView?.getComputedStyle(node);
          for (const prop of COLOR_PROPS) {
            const inline = node.style.getPropertyValue(prop);
            const value = inline || computed?.getPropertyValue(prop) || "";
            if (UNSUPPORTED_COLOR_RE.test(value)) {
              node.style.setProperty(prop, FALLBACKS[prop] ?? "#e5e7eb", "important");
            }
          }
          const bgImage = node.style.backgroundImage || computed?.backgroundImage || "";
          if (UNSUPPORTED_COLOR_RE.test(bgImage)) node.style.setProperty("background-image", "none", "important");
          const shadow = node.style.boxShadow || computed?.boxShadow || "";
          if (UNSUPPORTED_COLOR_RE.test(shadow)) node.style.setProperty("box-shadow", "none", "important");
        }
      };

      const pdfBlob = await html2pdf()
        .from(element)
        .set({
          margin: 0,
          filename: `Trabalho_${work.title}.pdf`,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            backgroundColor: "#ffffff",
            onclone: (doc: Document) => {
              if (doc.body) {
                doc.body.style.setProperty("background-color", "#ffffff", "important");
                doc.body.style.setProperty("color", "#000000", "important");
                sanitizeColors(doc.body);
              }
            },
          },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        })
        .output("blob");

      const path = `${user.id}/${disciplineId}/${work.id}/${Date.now()}-trabalho.pdf`;
      const { error: upErr } = await supabase.storage
        .from("submissions")
        .upload(path, pdfBlob, { upsert: false, contentType: "application/pdf" });
      if (upErr) throw upErr;


      const { data: { user: authUser } } = await supabase.auth.getUser();
      await submitAcademicWork({
        data: {
          work_id: work.id,
          file_url: path,
          submission_text: editor.getText().substring(0, 1000),
        },
      });

      toast.success("Trabalho enviado com sucesso!");
      onDone();
    } catch (e) {
      toast.error("Erro ao gerar ou enviar PDF: " + (e instanceof Error ? e.message : "Erro desconhecido"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl h-[90vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-2">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-primary" />
              Assistente de Trabalho ABNT: {work.title}
            </DialogTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={getTutorGuidance} disabled={loadingTutor}>
                {loadingTutor ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                Tutor IA
              </Button>
              <Button variant="ghost" size="sm" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
            <div className="px-6 border-b">
              <TabsList className="bg-transparent h-auto p-0 gap-6">
                {["cover", "abstract", "content", "review"].map((tab) => (
                  <TabsTrigger
                    key={tab}
                    value={tab}
                    className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-2 text-xs uppercase tracking-wider font-semibold"
                  >
                    {tab === "cover" && "1. Capa/Folha de Rosto"}
                    {tab === "abstract" && "2. Resumo"}
                    {tab === "content" && "3. Desenvolvimento"}
                    {tab === "review" && "4. Finalizar"}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            <ScrollArea className="flex-1 p-6">
              <TabsContent value="cover" className="m-0 space-y-6 max-w-2xl mx-auto">
                <div className="space-y-4">
                  <div className="grid gap-2">
                    <Label>Instituição</Label>
                    <Input value={coverInstitution} onChange={(e) => setCoverInstitution(e.target.value)} placeholder="Nome da Instituição ou Curso" />
                  </div>
                  <div className="grid gap-2">
                    <Label>Autor(a)</Label>
                    <Input value={coverStudent} onChange={(e) => setCoverStudent(e.target.value)} placeholder="Seu nome completo" />
                  </div>
                  <div className="grid gap-2">
                    <Label>Título do Trabalho</Label>
                    <Input value={coverTitle} onChange={(e) => setCoverTitle(e.target.value)} placeholder="Título Principal" />
                  </div>
                  <div className="grid gap-2">
                    <Label>Subtítulo (opcional)</Label>
                    <Input value={coverSubtitle} onChange={(e) => setCoverSubtitle(e.target.value)} placeholder="Subtítulo ou tema específico" />
                  </div>
                  <div className="grid gap-2">
                    <Label>Ano</Label>
                    <Input value={coverYear} onChange={(e) => setCoverYear(e.target.value)} />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="abstract" className="m-0 max-w-3xl mx-auto">
                <div className="space-y-4">
                  <div className="bg-blue-50 p-4 rounded-lg flex gap-3 text-sm text-blue-700">
                    <MessageSquare className="h-5 w-5 shrink-0" />
                    <p>O resumo deve conter uma visão geral do seu trabalho em um único parágrafo, destacando objetivos, metodologia e conclusões.</p>
                  </div>
                  <Textarea
                    value={abstract}
                    onChange={(e) => setAbstract(e.target.value)}
                    placeholder="Escreva seu resumo aqui..."
                    className="min-h-[300px] text-base leading-relaxed"
                  />
                </div>
              </TabsContent>

              <TabsContent value="content" className="m-0 h-full flex flex-col gap-4">
                <div className="flex items-center justify-between bg-muted/50 p-2 rounded-md border">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => editor?.chain().focus().toggleBold().run()}
                      className={editor?.isActive("bold") ? "bg-accent" : ""}
                    >
                      <BoldIcon className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => editor?.chain().focus().toggleItalic().run()}
                      className={editor?.isActive("italic") ? "bg-accent" : ""}
                    >
                      <ItalicIcon className="h-4 w-4" />
                    </Button>
                    <div className="w-[1px] h-4 bg-border mx-1" />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => editor?.chain().focus().setTextAlign("left").run()}
                      className={editor?.isActive({ textAlign: "left" }) ? "bg-accent" : ""}
                    >
                      <TextAlignLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => editor?.chain().focus().setTextAlign("center").run()}
                      className={editor?.isActive({ textAlign: "center" }) ? "bg-accent" : ""}
                    >
                      <TextAlignCenter className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => editor?.chain().focus().setTextAlign("justify").run()}
                      className={editor?.isActive({ textAlign: "justify" }) ? "bg-accent" : ""}
                    >
                      <TextAlignJustify className="h-4 w-4" />
                    </Button>
                  </div>
                  <Button variant="secondary" size="sm" onClick={setLongQuote} className="gap-2">
                    <Quote className="h-4 w-4" />
                    Citação Longa (ABNT)
                  </Button>
                </div>

                <div className="flex-1 border rounded-md bg-white shadow-inner overflow-auto">
                  <EditorContent editor={editor} />
                </div>
              </TabsContent>

              <TabsContent value="review" className="m-0 max-w-2xl mx-auto py-10 text-center space-y-6">
                <div className="p-8 border-2 border-dashed rounded-xl bg-muted/30">
                  <CheckCircle2 className="h-12 w-12 text-primary mx-auto mb-4" />
                  <h3 className="text-xl font-bold">Tudo pronto para a entrega!</h3>
                  <p className="text-muted-foreground mt-2">Revisou seu trabalho? Ao clicar em "Entregar", geraremos um arquivo PDF formatado em ABNT e o enviaremos para o professor.</p>
                </div>

                {!canSubmit ? (
                  <div className="p-4 bg-destructive/10 text-destructive rounded-md text-sm">{statusMsg}</div>
                ) : (
                  <Button size="lg" className="w-full h-16 text-lg gap-3" onClick={generateAndSubmit} disabled={submitting}>
                    {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileDown className="h-5 w-5" />}
                    Entregar Trabalho Final
                  </Button>
                )}
              </TabsContent>
            </ScrollArea>
          </Tabs>
        </div>

        <DialogFooter className="p-4 border-t flex items-center justify-between">
          <Button variant="outline" onClick={() => {
             const tabs = ["cover", "abstract", "content", "review"];
             const idx = tabs.indexOf(activeTab);
             if (idx > 0) setActiveTab(tabs[idx-1]);
          }} disabled={activeTab === "cover"}>
            Anterior
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">Auto-salvamento ativo</span>
            <Button onClick={() => {
             const tabs = ["cover", "abstract", "content", "review"];
             const idx = tabs.indexOf(activeTab);
             if (idx < tabs.length - 1) setActiveTab(tabs[idx+1]);
            }} disabled={activeTab === "review"}>
              Próximo <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </DialogFooter>

        <Sheet open={isTutorOpen} onOpenChange={setIsTutorOpen}>
          <SheetContent side="right" className="w-[400px] sm:w-[540px] flex flex-col">
            <SheetHeader className="pb-4 border-b">
              <SheetTitle className="flex items-center gap-2">
                <GraduationCap className="h-5 w-5 text-primary" />
                Orientação do Tutor IA
              </SheetTitle>
              <SheetDescription>
                Dicas de formatação ABNT, coesão e melhorias sugeridas pela IA.
              </SheetDescription>
            </SheetHeader>
            <ScrollArea className="flex-1 mt-4 pr-4">
              <div className="text-sm leading-relaxed whitespace-pre-wrap">
                {loadingTutor ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="animate-pulse">Analisando seu texto...</p>
                  </div>
                ) : (
                  <div className="prose prose-sm dark:prose-invert">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{tutorGuidance}</ReactMarkdown>
                  </div>
                )}
              </div>
            </ScrollArea>
          </SheetContent>
        </Sheet>
      </DialogContent>
    </Dialog>
  );
}

function ManageGroupDialog({
  work,
  disciplineId,
  onClose,
}: {
  work: Work;
  disciplineId: string;
  onClose: () => void;
}) {
  const { user } = useAuth();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Meu grupo: {work.title}</DialogTitle>
          <DialogDescription>
            Crie ou entre em um grupo para este trabalho. O envio do arquivo é feito pelo líder no botão "Enviar trabalho".
          </DialogDescription>
        </DialogHeader>
        {user && (
          <GroupPanel
            disciplineId={disciplineId}
            activityId={work.id}
            activityKind="work"
            currentUserId={user.id}
            onCanSubmitChange={() => {}}
          />
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WorkGroupsDialog({
  work,
  onClose,
}: {
  work: Work;
  onClose: () => void;
}) {
  const [groups, setGroups] = useState<Array<{ id: string; leader_id: string; member_ids: string[] }>>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadGroups = async () => {
      setLoading(true);
      setError(null);
      const { data: groupRows, error: groupsError } = await supabase
        .from("activity_groups")
        .select("id, leader_id, member_ids")
        .eq("activity_id", work.id)
        .eq("activity_kind", "work")
        .order("created_at", { ascending: true });

      if (groupsError) {
        if (active) {
          setError(groupsError.message);
          setLoading(false);
        }
        return;
      }

      const normalizedGroups = ((groupRows ?? []) as Array<{
        id: string;
        leader_id: string;
        member_ids: string[] | null;
      }>).map((group) => ({
        id: group.id,
        leader_id: group.leader_id,
        member_ids: Array.from(new Set([group.leader_id, ...(group.member_ids ?? [])])),
      }));
      const memberIds = Array.from(new Set(normalizedGroups.flatMap((group) => group.member_ids)));
      const { data: profileRows, error: profilesError } = memberIds.length
        ? await supabase.from("profiles").select("id, name").in("id", memberIds)
        : { data: [], error: null };

      if (!active) return;
      if (profilesError) {
        setError(profilesError.message);
        setLoading(false);
        return;
      }

      setGroups(normalizedGroups);
      setProfiles(
        Object.fromEntries(
          ((profileRows ?? []) as Array<{ id: string; name: string | null }>).map((profile) => [
            profile.id,
            profile.name?.trim() || "Aluno sem nome",
          ]),
        ),
      );
      setLoading(false);
    };

    loadGroups();
    return () => {
      active = false;
    };
  }, [work.id]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Grupos: {work.title}
          </DialogTitle>
          <DialogDescription>
            Visualização dos grupos formados e dos respectivos alunos.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            Não foi possível carregar os grupos: {error}
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <Users className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nenhum grupo foi formado para este trabalho.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((group, index) => (
              <div key={group.id} className="rounded-lg border bg-card p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="font-semibold">Grupo {index + 1}</h3>
                  <span className="text-xs text-muted-foreground">
                    {group.member_ids.length} integrante(s)
                  </span>
                </div>
                <ul className="space-y-2">
                  {group.member_ids.map((memberId) => (
                    <li key={memberId} className="flex items-center gap-2 text-sm">
                      <span className="h-2 w-2 rounded-full bg-primary" />
                      <span>{profiles[memberId] ?? "Aluno sem nome"}</span>
                      {memberId === group.leader_id && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                          Líder
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WorkSubmissionsDialog({
  work,
  onClose,
  onChanged,
}: {
  work: Work;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<Array<Sub & { profiles: { name: string } | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [viewingGroups, setViewingGroups] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: ss } = await supabase
      .from("academic_work_submissions")
      .select("*")
      .eq("work_id", work.id);
    const ids = (ss ?? []).map((s) => s.student_id);
    const { data: profs } = ids.length
      ? await supabase.rpc("get_profiles_safe", { _ids: ids })
      : { data: [] };
    setItems(
      (ss ?? []).map((s) => ({
        ...(s as unknown as Sub),
        profiles: profs?.find((p) => p.id === s.student_id) ?? null,
      })),
    );
    setLoading(false);
  }, [work.id]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle>Submissões: {work.title}</DialogTitle>
              <DialogDescription>Consulte as entregas e avaliações deste trabalho.</DialogDescription>
            </div>
            <Button variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={() => setViewingGroups(true)}>
              <Users className="h-4 w-4" /> Ver Grupos
            </Button>
          </div>
        </DialogHeader>
        {loading ? (
          <Loader2 className="h-6 w-6 animate-spin mx-auto" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Sem submissões.</p>
        ) : (
          <div className="space-y-3">
            {items.map((s) => (
              <WorkRubricGradingRow
                key={s.id}
                sub={s}
                work={work}
                onChanged={() => {
                  load();
                  onChanged();
                }}
              />
            ))}
          </div>
        )}
      </DialogContent>
      {viewingGroups && <WorkGroupsDialog work={work} onClose={() => setViewingGroups(false)} />}
    </Dialog>
  );
}

function WorkRubricGradingRow({
  sub,
  work,
  onChanged,
}: {
  sub: Sub & { profiles: { name: string } | null };
  work: Work;
  onChanged: () => void;
}) {
  const [comment, setComment] = useState(sub.teacher_comment ?? "");
  const [scores, setScores] = useState<RubricScore[]>(
    work.rubric.map((c) => {
      const existing = sub.rubric_scores?.find((s) => s.id === c.id);
      return { id: c.id, score: existing?.score ?? 0, comment: existing?.comment ?? "" };
    }),
  );
  const [url, setUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.storage
      .from("submissions")
      .createSignedUrl(sub.file_url, 3600)
      .then(({ data }) => setUrl(data?.signedUrl ?? null));
  }, [sub.file_url]);

  const total = computeTotal(work, scores);

  const save = async (release: boolean) => {
    setSaving(true);
    try {
      await supabase
        .from("academic_work_submissions")
        .update({
          rubric_scores: scores,
          total_score: total,
          teacher_comment: comment || null,
          status: release ? "released" : "ai_corrected",
          released_at: release ? new Date().toISOString() : null,
        })
        .eq("id", sub.id);
      if (release) {
        await releaseWorkFeedback({
          data: { submission_id: sub.id, teacher_comment: comment || undefined },
        });
      }
      toast.success(release ? "Liberado" : "Avaliação salva");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{sub.profiles?.name ?? sub.student_id}</div>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary inline-flex items-center gap-1"
          >
            <ExternalLink className="h-3 w-3" /> Abrir
          </a>
        )}
      </div>
      <div className="space-y-2">
        {work.rubric.map((c, i) => (
          <div key={c.id} className="border rounded p-2 space-y-1">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">{c.name}</div>
              <div className="text-xs text-muted-foreground">peso {c.weight}%</div>
            </div>
            {c.description && <p className="text-xs text-muted-foreground">{c.description}</p>}
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={c.max_score}
                step={0.1}
                className="w-24"
                value={scores[i]?.score ?? 0}
                onChange={(e) =>
                  setScores(
                    scores.map((s, idx) =>
                      idx === i ? { ...s, score: Number(e.target.value) } : s,
                    ),
                  )
                }
              />
              <span className="text-xs text-muted-foreground">/ {c.max_score}</span>
              <Input
                className="flex-1"
                placeholder="Comentário (opcional)"
                value={scores[i]?.comment ?? ""}
                onChange={(e) =>
                  setScores(
                    scores.map((s, idx) => (idx === i ? { ...s, comment: e.target.value } : s)),
                  )
                }
              />
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between bg-muted/50 rounded p-2">
        <div className="text-sm">
          Nota final ({work.grading_formula === "simple_average" ? "média simples" : "ponderada"})
        </div>
        <div className="text-lg font-semibold">{total.toFixed(2)}</div>
      </div>
      <Textarea
        rows={2}
        placeholder="Comentário geral do professor"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={saving} onClick={() => save(false)}>
          Salvar avaliação
        </Button>
        <Button size="sm" disabled={saving} onClick={() => save(true)}>
          Liberar feedback
        </Button>
      </div>
    </div>
  );
}

function computeTotal(work: Work, scores: RubricScore[]): number {
  if (!work.rubric.length) return 0;
  if (work.grading_formula === "simple_average") {
    const normalized = work.rubric.map((c) => {
      const s = scores.find((x) => x.id === c.id)?.score ?? 0;
      return c.max_score > 0 ? (s / c.max_score) * 10 : 0;
    });
    return normalized.reduce((a, b) => a + b, 0) / normalized.length;
  }
  const totalWeight = work.rubric.reduce((s, c) => s + (c.weight || 0), 0) || 1;
  const sum = work.rubric.reduce((acc, c) => {
    const s = scores.find((x) => x.id === c.id)?.score ?? 0;
    const norm = c.max_score > 0 ? (s / c.max_score) * 10 : 0;
    return acc + norm * (c.weight || 0);
  }, 0);
  return sum / totalWeight;
}
