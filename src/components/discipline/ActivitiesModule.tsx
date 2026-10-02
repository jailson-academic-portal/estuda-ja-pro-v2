import { sanitizeListTitle, sanitizeTitleList } from "@/lib/text-sanitize";
import { useEffect, useState, useCallback } from "react";
import { formatBRDate } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import {
  saveActivity,
  deleteActivity,
  submitActivity,
  releaseActivityFeedback,
  exportActivityPDF,
  reorderActivities,
} from "@/backend/activities.functions";
import {
  listAIGenerations,
  getAIGeneration,
  generateCaseStudyFromPlan,
  generateActivitySyllabusFromPlan,
} from "@/backend/ai-assistant.functions";
import { getLessonPlanItems, type LessonPlanItem } from "@/backend/lesson-plan-themes.functions";
import { getDisciplineHeader } from "@/backend/disciplines.functions";
import { listDiaryAssessments } from "@/backend/submissions.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, ExternalLink, BookOpen, Library, FileText, Sparkles, Clock, CalendarClock, Download, Users, Pencil, Stethoscope, Send, ClipboardList, X, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";
import { BulkDeleteBar } from "@/components/BulkDeleteBar";
import { ACTIVITY_RUBRICS, ACTIVITY_SUBTYPE_LABELS, templateToRubric } from "@/lib/rubric-library";
import { RubricLibraryDialog, type RubricSelection } from "./RubricLibraryDialog";
import { SubmissionsReviewPanel } from "./SubmissionReviewDialog";
import { InlineSubmissionDialog } from "./InlineSubmissionDialog";
import { GroupPanel } from "./GroupPanel";
import { getGroupContext } from "@/backend/groups.functions";
import { parseDocumentHeader, stripDocumentHeaderMetadata, stripLeadingStandardHeader, withDocumentHeaderMetadata, normalizeActivitySyllabusLabels, markdownToPlainText, extractStandardHeaderDocLine } from "@/lib/document-header";
import { extractDiaryAssessmentOptions } from "@/lib/diary-assessments";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function MarkdownView({ children }: { children: string }) {
  const text = (children ?? "").replace(/\\n/g, "\n").replace(/\\r\\n/g, "\n");
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none [&_h1]:mt-2 [&_h1]:mb-3 [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:mt-3 [&_h3]:mb-1.5 [&_p]:my-2 [&_p]:leading-relaxed [&_ul]:my-2 [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:pl-5 [&_li]:my-1 [&_li]:leading-relaxed [&_blockquote]:border-l-4 [&_blockquote]:border-primary/40 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:px-3 [&_th]:py-2 [&_th]:bg-muted/50 [&_th]:text-left [&_td]:border [&_td]:px-3 [&_td]:py-2 [&_tr:nth-child(even)]:bg-muted/20 [&_strong]:font-semibold">
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


function looksLikeMarkdown(text: string | null | undefined): boolean {
  if (!text) return false;
  return /(^|\n)\s*(#{1,6}\s|\-\s|\*\s|\d+\.\s|>\s|\|.+\|)/.test(text) || /\*\*[^*]+\*\*/.test(text);
}

function formatDueAt(iso: string): string {
  return formatBRDate(iso) + " às 23:59";
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

function DueCountdown({ dueAt, compact }: { dueAt: string; compact?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const diff = new Date(dueAt).getTime() - now;
  const overdue = diff <= 0;
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}min`);
  const label = overdue ? `Atrasado há ${parts.join(" ")}` : `Faltam ${parts.join(" ")}`;
  const cls = overdue
    ? "bg-destructive/10 text-destructive border-destructive/30"
    : diff < 86_400_000
      ? "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-200"
      : "bg-primary/10 text-primary border-primary/30";
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${cls} ${compact ? "" : "text-xs"}`}>
      <Clock className="h-3 w-3" /> {label}
    </span>
  );
}

type Crit = { id: string; name: string; description?: string; weight: number; max_score: number };
type RubricScore = { id: string; score: number; comment?: string };

interface Activity {
  id: string;
  title: string;
  instructions: string | null;
  subtype: string;
  due_at: string | null;
  status: "draft" | "published";
  rubric: Crit[];
  grading_formula?: "weighted_average" | "simple_average";
  delivery_type?: "individual" | "group";
  max_group_size?: number | null;
  allow_late?: boolean;
  late_penalty_per_day?: number | null;
  diary_assessment_id?: string | null;
}

const ACTIVITY_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "redacao", label: "Redação" },
  { value: "seminario", label: "Seminário" },
  { value: "debate", label: "Debate" },
  { value: "case_study", label: "Estudo de Caso" },
  { value: "aula_pratica", label: "Aula Prática" },
  { value: "free_activity", label: "Outros" },
];
interface Submission {
  id: string;
  activity_id: string;
  student_id: string;
  file_url: string;
  status: string;
  total_score: number | null;
  teacher_comment: string | null;
  rubric_scores: RubricScore[] | null;
  released_at: string | null;
}

const FEMININE_ACTIVITY_SUBTYPES = new Set([
  "redacao", "visita_tecnica", "aula_pratica", "free_activity",
]);
// Tipos respondidos diretamente na tela (sem upload de PDF).
const INLINE_ANSWER_SUBTYPES = new Set([
  "case_study",
  "practical_report",
  "aula_pratica",
  "care_plan",
  "pharmaceutical_plan",
  "pharmacy_plan",
]);
function normalizeActivityBody(instructions: string | null | undefined, subtype: string): string {
  const label = ACTIVITY_SUBTYPE_LABELS[subtype] ?? "Atividade";
  const article = FEMININE_ACTIVITY_SUBTYPES.has(subtype) ? "da" : "do";
  return normalizeActivitySyllabusLabels(stripLeadingStandardHeader(instructions), label, article);
}

/** Plain-text snippet for the card preview (no Markdown symbols). */
function activityPreviewText(instructions: string | null | undefined, subtype: string): string {
  return markdownToPlainText(normalizeActivityBody(instructions, subtype));
}

function stableSuggestedRubric(subtype: string): Crit[] {
  const template = ACTIVITY_RUBRICS[subtype] ?? ACTIVITY_RUBRICS.free_activity;
  return template.criteria.map((cr, index) => ({ ...cr, id: `${template.key}-${index}` }));
}

function withVisibleRubric(activity: Activity): Activity {
  return {
    ...activity,
    grading_formula: activity.grading_formula ?? "weighted_average",
    rubric: activity.rubric?.length ? activity.rubric : stableSuggestedRubric(activity.subtype),
  };
}

export function ActivitiesModule({
  disciplineId,
  isTeacher,
}: {
  disciplineId: string;
  isTeacher: boolean;
}) {
  const { user } = useAuth();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [subs, setSubs] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Activity | null>(null);
  const [creating, setCreating] = useState(false);
  const [reviewing, setReviewing] = useState<Activity | null>(null);
  const [submitting, setSubmitting] = useState<Activity | null>(null);
  const [managingGroup, setManagingGroup] = useState<Activity | null>(null);
  const [viewingRubric, setViewingRubric] = useState<Activity | null>(null);
  const [viewingActivity, setViewingActivity] = useState<Activity | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [planItems, setPlanItems] = useState<LessonPlanItem[]>([]);
  const [planItemsOpen, setPlanItemsOpen] = useState(true);
  const [prefill, setPrefill] = useState<ActivityPrefill | null>(null);
  // Abre o editor já disparando a elaboração completa do conteúdo pela IA.
  const [autoElaborate, setAutoElaborate] = useState(false);


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
    const results = await Promise.allSettled(ids.map((id) => deleteActivity({ data: { id } })));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed === 0) toast.success(`${ids.length} atividade(s) excluída(s)`);
    else toast.error(`${ids.length - failed} excluída(s), ${failed} falharam`);
    clearSelected();
    await load();
  };

  // Move a atividade uma posição para cima/baixo e persiste a nova ordem.
  const moveActivity = async (id: string, dir: -1 | 1) => {
    const idx = activities.findIndex((a) => a.id === id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= activities.length) return;
    const next = [...activities];
    [next[idx], next[target]] = [next[target], next[idx]];
    setActivities(next);
    try {
      await reorderActivities({
        data: { discipline_id: disciplineId, ordered_ids: next.map((a) => a.id) },
      });
    } catch {
      toast.error("Não foi possível salvar a nova ordem");
      await load();
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    const { data: acts } = await supabase
      .from("activities")
      .select("*")
      .eq("discipline_id", disciplineId)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    setActivities(((acts ?? []) as unknown as Activity[]).map(withVisibleRubric));
    if (acts?.length) {
      const { data: ss } = await supabase
        .from("activity_submissions")
        .select("*")
        .in(
          "activity_id",
          acts.map((a) => a.id),
        );
      setSubs((ss ?? []) as unknown as Submission[]);
    } else setSubs([]);
    setLoading(false);
    // Sugestões vinculadas ao Plano de Aula ativo (estudos de caso e atividades extras).
    try {
      const items = await getLessonPlanItems({
        data: { disciplineId, kinds: ["case_study", "extra_activity"] },
      });
      setPlanItems(items);
    } catch {
      setPlanItems([]);
    }
  }, [disciplineId]);

  useEffect(() => {
    load();
  }, [load]);

  // Itens do plano que ainda não viraram atividade (comparação flexível por título, ignorando prefixos/pontuação).
  const pendingPlanItems = planItems.filter((it) => {
    const normalize = (s: string) => {
      return (s || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\w\s]/gi, "")
        .replace(/\s+/g, " ")
        .trim();
    };
    
    const t = normalize(it.title);
    if (!t) return false;

    return !activities.some((a) => {
      const aTitle = normalize(a.title);
      return aTitle === t || aTitle.includes(t) || t.includes(aTitle);
    });
  });

  const createFromPlanItem = (it: LessonPlanItem) => {
    const tipo = String(it.metadata?.tipo ?? "");
    const subtype = it.kind === "case_study" ? "case_study" : planTipoToSubtype(tipo);
    const modulo = it.module_title || (it.module_number ? `Módulo ${it.module_number}` : "");
    const lines = [
      it.description?.trim() || "",
      modulo ? `Vinculado ao Plano de Aula — ${modulo}.` : "Sugerido no Plano de Aula da disciplina.",
    ].filter(Boolean);
    setPrefill({ title: it.title, subtype, instructions: lines.join("\n\n") });
    setCreating(true);
  };

  const mySub = (aid: string) =>
    subs.find((s) => s.activity_id === aid && s.student_id === user?.id);

  const releaseToStudents = async (a: Activity) => {
    if (!a.diary_assessment_id) {
      toast.error("Defina o campo do diário (Editar) antes de liberar.");
      return;
    }
    try {
      await saveActivity({
        data: {
          id: a.id,
          discipline_id: disciplineId,
          title: a.title,
          subtype: a.subtype as never,
          instructions: a.instructions ?? undefined,
          rubric: a.rubric,
          grading_formula: a.grading_formula ?? "weighted_average",
          allow_attachments: true,
          max_attachments: 1,
          due_at: a.due_at ?? undefined,
          delivery_type: a.delivery_type ?? "individual",
          max_group_size: a.max_group_size ?? undefined,
          allow_late: a.allow_late ?? false,
          late_penalty_per_day: a.late_penalty_per_day ?? undefined,
          diary_assessment_id: a.diary_assessment_id ?? undefined,
          publish: true,
        },
      });
      toast.success("Liberada para os alunos");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-white">
          <h2 className="text-lg font-semibold">Atividades extras</h2>
          <p className="text-sm opacity-80">
            {activities.length} atividade(s) · redações, seminários, estudos de caso e mais
          </p>
        </div>
        {isTeacher && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowLibrary(true)}>
              <Library className="h-4 w-4 mr-2" /> Biblioteca de Rubricas
            </Button>
          </div>
        )}
      </div>

      {!loading && pendingPlanItems.length > 0 && (
        <div className="rounded-xl border-2 border-primary/25 bg-primary/5 p-4 space-y-3">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 text-left"
            onClick={() => setPlanItemsOpen((v) => !v)}
          >
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-primary">
                Previstas no Plano de Aula
              </p>
              <p className="text-sm text-muted-foreground">
                {pendingPlanItems.length} sugestão(ões) de estudo de caso e atividades extras vinculadas ao plano ativo
                {isTeacher ? " — crie a atividade com um clique." : "."}
              </p>
            </div>
            <Sparkles className="h-5 w-5 shrink-0 text-primary/70" />
          </button>
          {planItemsOpen && (
            <ul className="space-y-2">
              {pendingPlanItems.map((it) => {
                const tipo = it.kind === "case_study" ? "Estudo de caso" : String(it.metadata?.tipo || "Atividade extra");
                const modulo = it.module_title || (it.module_number ? `Módulo ${it.module_number}` : "");
                return (
                  <li
                    key={it.id}
                    className="flex flex-col gap-2 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-primary/80">
                        {tipo}
                        {modulo ? ` · ${modulo}` : ""}
                      </div>
                      <div className="font-medium leading-tight break-words">{it.title}</div>
                      {it.description && (
                        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{it.description}</div>
                      )}
                    </div>
                    {isTeacher && (
                      <Button size="sm" variant="outline" className="shrink-0" onClick={() => createFromPlanItem(it)}>
                        <Plus className="h-4 w-4 mr-1" /> Criar atividade
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : activities.length === 0 ? (
        <EmptyState
          message="Nenhuma atividade publicada ainda."
          hint={
            isTeacher
              ? "Crie novas atividades pelo Assistente de IA (card “Criar Atividade / Trabalho”). Elas aparecerão aqui para acompanhamento e correção."
              : "Volte em breve — seu(sua) professor(a) vai publicar atividades por aqui."
          }
        />
      ) : (
        <div className="space-y-2">
          {activities
            .filter((a) => isTeacher || a.status === "published")
            .map((a, displayIdx, visibleList) => {
              const me = mySub(a.id);
              return (
                <div
                  key={a.id}
                  className="rounded-xl border bg-card p-4"
                  style={{ boxShadow: "var(--shadow-card)" }}
                >
                  <div className="flex items-center justify-between gap-3 min-w-0">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      {isTeacher && (
                        <div className="flex flex-col shrink-0 -my-1">
                          <button
                            type="button"
                            className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:pointer-events-none"
                            onClick={() => moveActivity(a.id, -1)}
                            disabled={displayIdx === 0}
                            aria-label="Mover atividade para cima"
                            title="Mover para cima"
                          >
                            <ArrowUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:pointer-events-none"
                            onClick={() => moveActivity(a.id, 1)}
                            disabled={displayIdx === visibleList.length - 1}
                            aria-label="Mover atividade para baixo"
                            title="Mover para baixo"
                          >
                            <ArrowDown className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                      {isTeacher && (
                        <Checkbox
                          className="shrink-0"
                          checked={selected.has(a.id)}
                          onCheckedChange={() => toggleSelected(a.id)}
                          aria-label="Selecionar atividade"
                        />
                      )}
                      <div className="flex-1 min-w-0 break-words whitespace-normal">
                        <div className="font-medium break-words leading-tight">{sanitizeListTitle(a.title)}</div>
                        <div className="text-xs text-muted-foreground">
                          {ACTIVITY_SUBTYPE_LABELS[a.subtype] ?? a.subtype}
                        </div>
                        {(() => {
                          const tag = extractStandardHeaderDocLine(a.instructions);
                          return tag ? (
                            <div className="text-xs font-medium text-primary/80 mt-0.5">
                              {tag.value}
                            </div>
                          ) : null;
                        })()}
                        {a.due_at && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 text-[11px] font-medium">
                              <CalendarClock className="h-3 w-3" /> Entrega: {formatDueAt(a.due_at)}
                            </span>
                            <DueCountdown dueAt={a.due_at} />
                            <LatePenaltyNote allowLate={a.allow_late} penaltyPerDay={a.late_penalty_per_day} />
                          </div>
                        )}
                        {a.instructions && (
                          <p className="text-sm mt-2 text-muted-foreground break-words whitespace-normal leading-tight line-clamp-3">
                            {activityPreviewText(a.instructions, a.subtype)}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isTeacher && (
                        <span
                          className={`shrink-0 text-[10px] px-2 py-0.5 rounded ${a.status === "published" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}
                        >
                          {a.status === "published" ? "Publicada" : "Rascunho"}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {isTeacher ? (
                      <>
                        {a.instructions && (
                          <Button size="sm" variant="ghost" onClick={() => setViewingActivity(a)}>
                            <FileText className="h-3.5 w-3.5 mr-1" /> Ver enunciado
                          </Button>
                        )}
                        {a.rubric && a.rubric.length > 0 && (
                          <Button size="sm" variant="ghost" onClick={() => setViewingRubric(a)}>
                            <BookOpen className="h-3.5 w-3.5 mr-1" /> Ver rubrica
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-primary/40 text-primary hover:bg-primary/10"
                          title="Gera com a IA o enunciado completo (contexto, personagens, narrativa, dados, perguntas, conceitos e resultados) e abre para edição"
                          onClick={() => {
                            setAutoElaborate(true);
                            setEditing(a);
                          }}
                        >
                          <Sparkles className="h-3.5 w-3.5 mr-1" /> Elaborar com IA / Editar Conteúdo Completo
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditing(a)}>
                          Editar
                        </Button>
                        {a.status !== "published" && (
                          <Button size="sm" onClick={() => releaseToStudents(a)}>
                            Liberar para o aluno
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => setReviewing(a)}>
                          {subs.filter((s) => s.activity_id === a.id && s.status !== 'released').length > 0 
                            ? `Submissões (${subs.filter((s) => s.activity_id === a.id && s.status !== 'released').length})` 
                            : 'Ver Resultados'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/5 ml-auto"
                          onClick={async () => {
                            if (!confirm("Excluir atividade?")) return;
                            await deleteActivity({ data: { id: a.id } });
                            load();
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : (
                      <>
                        {!me && (
                          <>
                            {a.delivery_type === "group" && (
                              <Button size="sm" variant="outline" onClick={() => setManagingGroup(a)}>
                                <Users className="h-4 w-4 mr-1" /> Meu grupo
                              </Button>
                            )}
                            <Button 
                              size="sm" 
                              className="font-semibold"
                              onClick={() => setSubmitting(a)}
                            >
                              {a.subtype === "case_study" ? (
                                <>
                                  <Pencil className="h-3.5 w-3.5 mr-1.5" /> Resolver Estudo de Caso
                                </>
                              ) : a.subtype === "aula_pratica" ? (
                                <>
                                  <Stethoscope className="h-3.5 w-3.5 mr-1.5" /> Iniciar Atividade Prática
                                </>
                              ) : (
                                <>
                                  <Send className="h-3.5 w-3.5 mr-1.5" /> Enviar trabalho
                                </>
                              )}
                            </Button>
                          </>
                        )}
                        {a.instructions && (
                          <Button size="sm" variant="ghost" onClick={() => setViewingActivity(a)}>
                            <FileText className="h-3.5 w-3.5 mr-1" /> Ver enunciado
                          </Button>
                        )}
                        {me && (
                          <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700">
                            {me.status === "released"
                              ? `Nota: ${me.total_score ?? "—"}`
                              : "Enviada"}
                          </span>
                        )}
                        {me?.released_at && (
                          <details className="text-xs w-full">
                            <summary className="cursor-pointer text-primary">Ver feedback</summary>
                            <div className="mt-2 p-2 bg-muted/50 rounded space-y-2">
                              {me.rubric_scores && me.rubric_scores.length > 0 && (
                                <div>
                                  <strong>Notas por critério:</strong>
                                  <ul className="mt-1 space-y-1">
                                    {me.rubric_scores.map((rs) => {
                                      const crit = a.rubric.find((c) => c.id === rs.id);
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
        <ActivityEditor
          disciplineId={disciplineId}
          activity={editing ?? undefined}
          initial={editing ? undefined : prefill ?? undefined}
          autoElaborate={autoElaborate}
          onClose={() => {
            setCreating(false);
            setEditing(null);
            setPrefill(null);
            setAutoElaborate(false);
          }}
          onDone={() => {
            setCreating(false);
            setEditing(null);
            setPrefill(null);
            setAutoElaborate(false);
            load();
          }}
        />
      )}
      {reviewing && (
        <SubmissionsReviewPanel
          disciplineId={disciplineId}
          kind="activity"
          open
          activityId={reviewing.id}
          defaultRubric={reviewing.rubric}
          onClose={() => {
            setReviewing(null);
            load();
          }}
        />
      )}
      {submitting && !INLINE_ANSWER_SUBTYPES.has(submitting.subtype) && (
        <SubmitDialog
          activity={submitting}
          disciplineId={disciplineId}
          onClose={() => setSubmitting(null)}
          onDone={() => {
            setSubmitting(null);
            load();
          }}
        />
      )}
      {managingGroup && (
        <ManageActivityGroupDialog
          activity={managingGroup}
          disciplineId={disciplineId}
          onClose={() => setManagingGroup(null)}
        />
      )}
      {viewingRubric && (
        <RubricViewerDialog activity={viewingRubric} onClose={() => setViewingRubric(null)} />
      )}
      {viewingActivity && (
        <ActivityViewerDialog
          activity={viewingActivity}
          disciplineId={disciplineId}
          onClose={() => setViewingActivity(null)}
        />
      )}
      {showLibrary && (
        <RubricLibraryDialog scope="activity" onClose={() => setShowLibrary(false)} />
      )}
      {isTeacher && (
        <BulkDeleteBar count={selected.size} itemLabel="atividade" onClear={clearSelected} onConfirm={bulkDelete} />
      )}
      {submitting && INLINE_ANSWER_SUBTYPES.has(submitting.subtype) && (
        <InlineSubmissionDialog
          activity={submitting}
          onClose={() => setSubmitting(null)}
          onSuccess={load}
        />
      )}
    </div>
  );
}

function ActivityViewerDialog({
  activity,
  disciplineId,
  onClose,
}: {
  activity: Activity;
  disciplineId: string;
  onClose: () => void;
}) {
  const customHeader = parseDocumentHeader(activity.instructions);
  const displayedInstructions = normalizeActivityBody(activity.instructions, activity.subtype);
  const isMd = looksLikeMarkdown(displayedInstructions);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const handleDownloadPDF = async () => {
    setDownloadingPdf(true);
    try {
      const res = await exportActivityPDF({ data: { id: activity.id } });
      downloadBase64(res.filename, res.mime, res.base64);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao baixar PDF");
    } finally {
      setDownloadingPdf(false);
    }
  };
  const [header, setHeader] = useState<{
    institution_name: string | null;
    course_name: string | null;
    discipline_name: string;
    teacher_name: string | null;
  } | null>(null);
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const h = await getDisciplineHeader({ data: { discipline_id: disciplineId } });
        if (!cancel) setHeader(h);
      } catch { /* noop */ }
    })();
    return () => { cancel = true; };
  }, [disciplineId]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{activity.title}</DialogTitle>
          <DialogDescription>
            {ACTIVITY_SUBTYPE_LABELS[activity.subtype] ?? activity.subtype}
          </DialogDescription>
        </DialogHeader>
        {activity.due_at && (
          <div className="flex flex-wrap items-center gap-2 -mt-1">
            <span className="inline-flex items-center gap-1 rounded border bg-muted/40 px-2 py-1 text-xs font-medium">
              <CalendarClock className="h-3.5 w-3.5" /> Entrega até {formatDueAt(activity.due_at)}
            </span>
            <DueCountdown dueAt={activity.due_at} />
          </div>
        )}
        {header && (
          <div className="text-xs border rounded p-2 bg-muted/40 leading-relaxed">
            {(customHeader?.institution_name ?? header.institution_name) && <div><strong>Instituição:</strong> {customHeader?.institution_name ?? header.institution_name}</div>}
            {(customHeader?.course_name ?? header.course_name) && <div><strong>Curso:</strong> {customHeader?.course_name ?? header.course_name}</div>}
            <div><strong>Disciplina:</strong> {customHeader?.discipline_name ?? header.discipline_name}</div>
            {(customHeader?.teacher_name ?? header.teacher_name) && <div><strong>Professor(a):</strong> {customHeader?.teacher_name ?? header.teacher_name}</div>}
          </div>
        )}
        {isMd ? (
          <MarkdownView>{displayedInstructions}</MarkdownView>
        ) : (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{displayedInstructions}</p>
        )}
        <div className="flex justify-end pt-2">
          <Button size="sm" variant="outline" onClick={handleDownloadPDF} disabled={downloadingPdf}>
            {downloadingPdf ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
            Baixar PDF
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RubricViewerDialog({ activity, onClose }: { activity: Activity; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Rubrica de avaliação</DialogTitle>
          <DialogDescription>
            {activity.title} — fórmula:{" "}
            {activity.grading_formula === "simple_average" ? "média simples" : "média ponderada"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {activity.rubric.map((c) => (
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

type ActivityPrefill = { title?: string; subtype?: string; instructions?: string };

/** Converte o tipo textual do plano ("Seminário", "Visita Técnica"...) no subtipo da atividade. */
function planTipoToSubtype(tipo: string): string {
  const t = tipo.toLowerCase();
  if (/semin/.test(t)) return "seminario";
  if (/debate/.test(t)) return "debate";
  if (/visita/.test(t)) return "visita_tecnica";
  if (/pr[áa]tica/.test(t)) return "aula_pratica";
  if (/workshop|oficina/.test(t)) return "workshop";
  if (/reda[çc]/.test(t)) return "redacao";
  if (/relat[óo]rio/.test(t)) return "practical_report";
  if (/estudo de caso|caso/.test(t)) return "case_study";
  return "free_activity";
}

function ActivityEditor({
  disciplineId,
  activity,
  initial,
  autoElaborate = false,
  onClose,
  onDone,
}: {
  disciplineId: string;
  activity?: Activity;
  initial?: ActivityPrefill;
  /** Dispara a elaboração completa do conteúdo pela IA assim que o editor abre. */
  autoElaborate?: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(activity?.title ?? initial?.title ?? "");
  const [subtype, setSubtype] = useState<string>(activity?.subtype ?? initial?.subtype ?? "redacao");
  const [instructions, setInstructions] = useState(
    activity ? stripDocumentHeaderMetadata(activity.instructions) : (initial?.instructions ?? ""),
  );
  const [elaborating, setElaborating] = useState(false);

  /**
   * Elabora o enunciado COMPLETO com a IA. Estudos de caso usam o prompt
   * clínico/laboratorial especializado (7 seções: contexto, personagens,
   * narrativa, dados, perguntas, conceitos-chave e resultados); os demais
   * tipos usam a ementa estruturada de atividade. O texto atual (título +
   * instruções resumidas do plano) é enviado como contexto, nunca perdido.
   */
  const elaborateWithAI = useCallback(async () => {
    const topic = title.trim();
    if (topic.length < 2) {
      toast.error("Informe o título da atividade antes de elaborar com a IA");
      return;
    }
    setElaborating(true);
    const t = toast.loading("Elaborando conteúdo completo com a IA…");
    try {
      const currentText = stripLeadingStandardHeader(stripDocumentHeaderMetadata(instructions)).trim();
      const extra = currentText ? `Resumo/instruções atuais da atividade (expanda e detalhe): ${currentText.slice(0, 3000)}` : undefined;
      const res =
        subtype === "case_study"
          ? await generateCaseStudyFromPlan({
              data: { discipline_id: disciplineId, module_topic: topic, extra_context: extra },
            })
          : await generateActivitySyllabusFromPlan({
              data: { discipline_id: disciplineId, module_topic: topic, kind: "activity", subtype, extra_context: extra },
            });
      const genId = (res as { id?: string })?.id;
      if (!genId) throw new Error("Resposta inválida da geração");
      const detail = await getAIGeneration({ data: { id: genId } });
      const result = (detail as { result?: unknown })?.result;
      const md = typeof result === "string" ? result : JSON.stringify(result ?? "");
      if (!md.trim() || /^###\s*Erro na Geração/i.test(md.trim())) throw new Error("A IA não conseguiu elaborar o conteúdo. Tente novamente.");
      setInstructions(md);
      toast.success("Conteúdo completo elaborado — revise e salve", { id: t });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao elaborar com IA", { id: t });
    } finally {
      setElaborating(false);
    }
  }, [title, instructions, subtype, disciplineId]);

  // Botão "Elaborar com IA / Editar Conteúdo Completo" do card: gera ao abrir.
  useEffect(() => {
    if (!autoElaborate) return;
    void elaborateWithAI();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoElaborate]);
  const [formula, setFormula] = useState<"weighted_average" | "simple_average">(
    activity?.grading_formula ?? "weighted_average",
  );
  const [rubric, setRubric] = useState<Crit[]>(
    activity?.rubric && activity.rubric.length > 0
      ? activity.rubric
      : templateToRubric(
          ACTIVITY_RUBRICS[activity?.subtype ?? initial?.subtype ?? "redacao"] ?? ACTIVITY_RUBRICS.redacao,
        ),
  );
  const [submitting, setSubmitting] = useState(false);
  const [showLib, setShowLib] = useState(false);
  const initialDue = activity?.due_at ? new Date(activity.due_at) : null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const [dueDate, setDueDate] = useState(
    initialDue
      ? `${initialDue.getFullYear()}-${pad(initialDue.getMonth() + 1)}-${pad(initialDue.getDate())}`
      : "",
  );
  const [headerValues, setHeaderValues] = useState({
    institution_name: "",
    course_name: "",
    discipline_name: "",
    teacher_name: "",
  });
  const [showCaseStudies, setShowCaseStudies] = useState(false);
  const [caseStudies, setCaseStudies] = useState<Array<{ id: string; title: string }>>([]);
  const [loadingCS, setLoadingCS] = useState(false);
  const [showSyllabi, setShowSyllabi] = useState(false);
  const [syllabi, setSyllabi] = useState<Array<{ id: string; title: string }>>([]);
  const [loadingSyl, setLoadingSyl] = useState(false);
  const [deliveryType, setDeliveryType] = useState<"individual" | "group">(
    activity?.delivery_type ?? "individual",
  );
  const [maxGroupSize, setMaxGroupSize] = useState<number>(activity?.max_group_size ?? 2);
  const [allowLate, setAllowLate] = useState<boolean>(activity?.allow_late ?? false);
  const [latePenalty, setLatePenalty] = useState<number>(activity?.late_penalty_per_day ?? 0);
  const [diaryAssessmentId, setDiaryAssessmentId] = useState<string>(
    activity?.diary_assessment_id ?? "",
  );
  const [diaryOptions, setDiaryOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [syllabusNotice, setSyllabusNotice] = useState(false);

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

  // For new activities, prefill instructions from the discipline syllabus_text.
  useEffect(() => {
    if (activity) return;
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
  }, [activity, disciplineId]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const custom = parseDocumentHeader(activity?.instructions);
      try {
        const h = await getDisciplineHeader({ data: { discipline_id: disciplineId } });
        if (!cancel && h) setHeaderValues({
          institution_name: custom?.institution_name ?? h.institution_name ?? "",
          course_name: custom?.course_name ?? h.course_name ?? "",
          discipline_name: custom?.discipline_name ?? h.discipline_name ?? "",
          teacher_name: custom?.teacher_name ?? h.teacher_name ?? "",
        });
      } catch {
        if (!cancel && custom) setHeaderValues({
          institution_name: custom.institution_name ?? "",
          course_name: custom.course_name ?? "",
          discipline_name: custom.discipline_name ?? "",
          teacher_name: custom.teacher_name ?? "",
        });
      }
    })();
    return () => { cancel = true; };
  }, [activity?.instructions, disciplineId]);

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
      if (promptObj?.kind === "activity" && promptObj.subtype && ACTIVITY_RUBRICS[promptObj.subtype]) {
        setSubtype(promptObj.subtype);
        setRubric(templateToRubric(ACTIVITY_RUBRICS[promptObj.subtype]));
      }
      toast.success("Ementa vinculada");
      setShowSyllabi(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  const openCaseStudyPicker = async () => {
    setShowCaseStudies(true);
    setLoadingCS(true);
    try {
      const res = await listAIGenerations({
        data: { discipline_id: disciplineId, tool: "case_study", limit: 50 },
      });
      const items = Array.isArray(res?.items) ? res.items : [];
      setCaseStudies(items.map((i) => ({ id: i.id, title: i.title })));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar estudos de caso");
    } finally {
      setLoadingCS(false);
    }
  };

  const attachCaseStudy = async (id: string, title: string) => {
    try {
      const res = await getAIGeneration({ data: { id } });
      const md = typeof res?.result === "string" ? res.result : JSON.stringify(res?.result ?? "");
      setInstructions(md);
      if (!title) return;
      // Pre-fill title only if empty
      setTitle((cur) => (cur.trim() ? cur : title));
      // Switch subtype to case_study + apply rubric
      setSubtype("case_study");
      const t = ACTIVITY_RUBRICS.case_study;
      if (t) setRubric(templateToRubric(t));
      toast.success("Estudo de caso vinculado");
      setShowCaseStudies(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  const applyTemplate = (key: string) => {
    const t = ACTIVITY_RUBRICS[key];
    if (!t) return;
    setRubric(templateToRubric(t));
    toast.success(`Rubrica de "${ACTIVITY_SUBTYPE_LABELS[key]}" aplicada`);
  };

  const onSubtypeChange = (val: string) => {
    setSubtype(val);
    if (!activity) {
      // For new activities, auto-suggest rubric
      const t = ACTIVITY_RUBRICS[val];
      if (t) setRubric(templateToRubric(t));
    }
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
      const due_at = dueDate
        ? new Date(`${dueDate}T23:59:00`).toISOString()
        : undefined;
      await saveActivity({
        data: {
          id: activity?.id,
          discipline_id: disciplineId,
          title: title.trim(),
          subtype: subtype as never,
          instructions: withDocumentHeaderMetadata(instructions.trim(), headerValues) || undefined,
          rubric,
          grading_formula: formula,
          allow_attachments: true,
          max_attachments: 1,
          due_at,
          delivery_type: deliveryType,
          max_group_size: deliveryType === "group" ? maxGroupSize : undefined,
          allow_late: allowLate,
          late_penalty_per_day: allowLate ? latePenalty : undefined,
          // A interface pede PONTOS por dia de atraso (ex: 0,5 ponto), não percentual.
          late_penalty_type: "fixed",
          diary_assessment_id: diaryAssessmentId || undefined,
          publish,
        },
      });
      toast.success(publish ? "Atividade publicada" : "Rascunho salvo");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{activity ? "Editar" : "Nova"} atividade extra</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Título</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label>Tipo</Label>
            <select
              className="border rounded px-2 py-1.5 text-sm w-full"
              value={subtype}
              onChange={(e) => onSubtypeChange(e.target.value)}
            >
              {ACTIVITY_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              Ao mudar o tipo em uma nova atividade, a rubrica sugerida é aplicada automaticamente.
            </p>
          </div>
          <div>
            <Label>Data de entrega (horário padrão 23:59)</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div>
            <Label>Instruções</Label>
            <div className="mb-2 flex flex-wrap gap-2">
              <Button size="sm" type="button" onClick={() => void elaborateWithAI()} disabled={elaborating}>
                {elaborating ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5 mr-1" />
                )}
                {subtype === "case_study" ? "Elaborar Estudo de Caso completo com IA" : "Elaborar conteúdo completo com IA"}
              </Button>
              <Button size="sm" variant="outline" type="button" onClick={openSyllabusPicker} disabled={elaborating}>
                <Sparkles className="h-3.5 w-3.5 mr-1" /> Vincular Ementa da IA
              </Button>
              {subtype === "case_study" && (
                <Button size="sm" variant="outline" type="button" onClick={openCaseStudyPicker} disabled={elaborating}>
                  <Sparkles className="h-3.5 w-3.5 mr-1" /> Vincular Estudo de Caso da IA
                </Button>
              )}
            </div>
            {subtype === "case_study" && (
              <p className="mb-2 text-[11px] text-muted-foreground">
                O estudo de caso completo segue o padrão: contexto clínico/laboratorial, personagens, narrativa,
                tabela de dados, 4–5 perguntas discursivas, conceitos-chave e resultados de aprendizagem.
              </p>
            )}
            <Textarea
              rows={elaborating ? 5 : Math.min(18, Math.max(5, instructions.split("\n").length))}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              disabled={elaborating}
            />
            {syllabusNotice && (
              <p className="text-[11px] text-primary mt-1">
                Instruções geradas a partir da ementa — edite à vontade.
              </p>
            )}
            {looksLikeMarkdown(instructions) && (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-primary">Pré-visualizar (Markdown)</summary>
                <div className="mt-2 border rounded p-3 bg-muted/30">
                  <MarkdownView>{instructions}</MarkdownView>
                </div>
              </details>
            )}
          </div>
          <div className="space-y-2 rounded-md border p-3">
            <Label>Cabeçalho editável do documento</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Input placeholder="Instituição" value={headerValues.institution_name} onChange={(e) => setHeaderValues((p) => ({ ...p, institution_name: e.target.value }))} />
              <Input placeholder="Curso" value={headerValues.course_name} onChange={(e) => setHeaderValues((p) => ({ ...p, course_name: e.target.value }))} />
              <Input placeholder="Disciplina" value={headerValues.discipline_name} onChange={(e) => setHeaderValues((p) => ({ ...p, discipline_name: e.target.value }))} />
              <Input placeholder="Professor(a)" value={headerValues.teacher_name} onChange={(e) => setHeaderValues((p) => ({ ...p, teacher_name: e.target.value }))} />
            </div>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
              <Checkbox
                checked={allowLate}
                onCheckedChange={(v) => setAllowLate(v === true)}
              />
              Permitir envio após o prazo
            </label>
            {allowLate && (
              <div>
                <Label className="text-xs">Pontos descontados por dia de atraso (ex: 0.5)</Label>
                <Input
                  type="number"
                  step="0.1"
                  min={0}
                  value={latePenalty}
                  onChange={(e) => setLatePenalty(Number(e.target.value))}
                />
              </div>
            )}
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

          <div>
            <Label>Lançar nota no diário</Label>
            <select
              className="border rounded px-2 py-1.5 text-sm w-full"
              value={diaryAssessmentId}
              onChange={(e) => setDiaryAssessmentId(e.target.value)}
            >
              <option value="">Selecione o campo de avaliação…</option>
              {diaryOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            {diaryOptions.length === 0 && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Configure a estrutura de notas da disciplina para habilitar o lançamento no diário.
              </p>
            )}
          </div>

          <div>
            <Label>Fórmula da nota final</Label>
            <select
              className="border rounded px-2 py-1.5 text-sm w-full"
              value={formula}
              onChange={(e) => setFormula(e.target.value as "weighted_average" | "simple_average")}
            >
              <option value="weighted_average">
                Média ponderada (usa o peso de cada critério)
              </option>
              <option value="simple_average">
                Média simples (todos os critérios com mesmo peso)
              </option>
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label>Rubrica de avaliação</Label>
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
                  <div className="flex gap-2 items-center">
                    <Input
                      value={c.name}
                      onChange={(e) =>
                        setRubric(
                          rubric.map((r, idx) => (idx === i ? { ...r, name: e.target.value } : r)),
                        )
                      }
                      placeholder="Critério"
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
                    placeholder="Descrição do critério"
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
          scope="activity"
          onClose={() => setShowLib(false)}
          onSelect={(sel: RubricSelection) => {
            setRubric(sel.criteria);
            setFormula(sel.grading_formula);
          }}
        />
      )}
      {showCaseStudies && (
        <Dialog open onOpenChange={(o) => !o && setShowCaseStudies(false)}>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Estudos de Caso gerados pela IA</DialogTitle>
              <DialogDescription>
                Selecione um estudo de caso para vincular como enunciado desta atividade.
              </DialogDescription>
            </DialogHeader>
            {loadingCS ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : caseStudies.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Nenhum estudo de caso ainda. Gere pelo Assistente de IA &rarr; Estudo de caso.
              </p>
            ) : (
              <div className="space-y-2">
                {caseStudies.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => attachCaseStudy(c.id, c.title)}
                    className="w-full text-left rounded border p-3 hover:bg-accent transition"
                  >
                    <div className="text-sm font-medium">{sanitizeListTitle(c.title)}</div>
                  </button>
                ))}
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
      {showSyllabi && (
        <Dialog open onOpenChange={(o) => !o && setShowSyllabi(false)}>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Ementas geradas pela IA</DialogTitle>
              <DialogDescription>
                Selecione uma ementa para vincular como enunciado desta atividade. A rubrica
                correspondente será aplicada automaticamente.
              </DialogDescription>
            </DialogHeader>
            {loadingSyl ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : syllabi.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Nenhuma ementa ainda. Gere pelo Assistente de IA &rarr; Ementa de Atividade/Trabalho.
              </p>
            ) : (
              <div className="space-y-2">
                {syllabi.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => attachSyllabus(c.id, c.title)}
                    className="w-full text-left rounded border p-3 hover:bg-accent transition"
                  >
                    <div className="text-sm font-medium">{sanitizeListTitle(c.title)}</div>
                  </button>
                ))}
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}

function SubmitDialog({
  activity,
  disciplineId,
  onClose,
  onDone,
}: {
  activity: Activity;
  disciplineId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Tipos interativos (estudo de caso, aula prática, plano de cuidados etc.) são
  // atendidos EXCLUSIVAMENTE pelo InlineSubmissionDialog — este modal padrão só
  // trata envio de arquivo, evitando dois formatos concorrentes de submissão.
  const isInline = false as boolean;
  const [resolution, setResolution] = useState("");
  const [rationale, setRationale] = useState("");
  const inlineReady = resolution.trim().length >= 20 && rationale.trim().length >= 20;
  const isGroup = activity.delivery_type === "group";
  const [canSubmit, setCanSubmit] = useState(!isGroup);
  const [checking, setChecking] = useState(isGroup);
  const [statusMsg, setStatusMsg] = useState<string>("");
  useEffect(() => {
    if (!isGroup || !user) return;
    (async () => {
      try {
        const ctx = await getGroupContext({
          data: { discipline_id: disciplineId, activity_id: activity.id, activity_kind: "activity" },
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
  }, [isGroup, user, disciplineId, activity.id]);

  const submit = async () => {
    if (!user) return;
    if (isInline) {
      if (!inlineReady) {
        toast.error("Preencha a resolução e a justificativa técnica (mín. 20 caracteres cada)");
        return;
      }
    } else if (!file) {
      toast.error("Anexe um arquivo");
      return;
    }
    if (!isInline && file && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Apenas arquivos PDF são aceitos");
      return;
    }
    setSubmitting(true);
    try {
      // Storage RLS requires the first folder to be the student's auth.uid().
      let path: string;
      if (isInline) {
        // A resposta digitada é salva como .txt para passar pelo MESMO motor de
        // correção da IA (ementa, similaridade/plágio, desconto por atraso).
        const body = `# ${activity.title}\n\n## Resolução / Análise do Caso\n\n${resolution.trim()}\n\n## Justificativa Técnica\n\n${rationale.trim()}\n`;
        const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
        path = `${user.id}/${disciplineId}/${activity.id}/${Date.now()}-resposta.txt`;
        const { error: upErr } = await supabase.storage
          .from("submissions")
          .upload(path, blob, { upsert: false, contentType: "text/plain;charset=utf-8" });
        if (upErr) throw upErr;
      } else {
        path = `${user.id}/${disciplineId}/${activity.id}/${Date.now()}-${file!.name.replace(/[^\w.-]/g, "_")}`;
        const { error: upErr } = await supabase.storage
          .from("submissions")
          .upload(path, file!, { upsert: false });
        if (upErr) throw upErr;
      }
      const { data: { user: authUser } } = await supabase.auth.getUser();
      await submitActivity({ 
        data: { 
          activity_id: activity.id, 
          student_id: authUser?.id || user.id, // Injeta explicitamente o student_id
          file_url: path 
        } 
      });
      toast.success("Atividade enviada");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader className="border-b pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <ClipboardList className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-xl">Submeter: {activity.title}</DialogTitle>
              <DialogDescription>
                {activity.due_at && `Prazo final: ${formatBRDate(activity.due_at)} às 23:59`}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="py-4 space-y-6">
          <div className="bg-muted/30 rounded-lg p-4 border space-y-2">
            <h4 className="text-sm font-bold flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" /> Instruções do Professor
            </h4>
            <div className="text-sm text-foreground/80 leading-relaxed max-h-[150px] overflow-y-auto pr-2">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {activity.instructions || "Sem instruções adicionais."}
              </ReactMarkdown>
            </div>
          </div>

          {checking ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Verificando permissões de grupo...</p>
            </div>
          ) : canSubmit ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm font-bold">Resposta da Atividade</Label>
                <div className="border rounded-lg p-1 bg-background">
                  <Input
                    type="file"
                    accept="application/pdf,.pdf"
                    className="border-none shadow-none h-12 pt-2.5 cursor-pointer file:mr-4 file:py-1 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground italic px-1">
                  * Apenas arquivos PDF são aceitos para processamento automático e correção via IA.
                </p>
              </div>
            </div>
          ) : (
            <div className="p-6 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-3 text-destructive">
              <X className="h-5 w-5 shrink-0" />
              <p className="text-sm font-medium">{statusMsg}</p>
            </div>
          )}
        </div>

        <DialogFooter className="border-t pt-4 gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button 
            disabled={!file || submitting || !canSubmit} 
            onClick={submit}
            className="gap-2 min-w-[140px]"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Enviando...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" /> Submeter Atividade
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManageActivityGroupDialog({
  activity,
  disciplineId,
  onClose,
}: {
  activity: Activity;
  disciplineId: string;
  onClose: () => void;
}) {
  const { user } = useAuth();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Meu grupo: {activity.title}</DialogTitle>
          <DialogDescription>
            Crie ou entre em um grupo para esta atividade. O envio do arquivo é feito pelo líder no botão "Enviar trabalho".
          </DialogDescription>
        </DialogHeader>
        {user && (
          <GroupPanel
            disciplineId={disciplineId}
            activityId={activity.id}
            activityKind="activity"
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

function SubmissionsDialog({
  activity,
  onClose,
  onChanged,
}: {
  activity: Activity;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<
    Array<Submission & { profiles: { name: string; enrollment_number: string | null } | null }>
  >([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: ss } = await supabase
      .from("activity_submissions")
      .select("*")
      .eq("activity_id", activity.id);
    const ids = (ss ?? []).map((s) => s.student_id);
    const { data: profs } = ids.length
      ? await supabase.rpc("get_profiles_safe", { _ids: ids })
      : { data: [] };
    setItems(
      (ss ?? []).map((s) => ({
        ...(s as unknown as Submission),
        profiles: profs?.find((p) => p.id === s.student_id) ?? null,
      })),
    );
    setLoading(false);
  }, [activity.id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Submissões: {activity.title}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <Loader2 className="h-6 w-6 animate-spin mx-auto" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Sem submissões ainda.</p>
        ) : (
          <div className="space-y-3">
            {items.map((s) => (
              <RubricGradingRow
                key={s.id}
                sub={s}
                activity={activity}
                onChanged={() => {
                  load();
                  onChanged();
                }}
              />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RubricGradingRow({
  sub,
  activity,
  onChanged,
}: {
  sub: Submission & { profiles: { name: string; enrollment_number: string | null } | null };
  activity: Activity;
  onChanged: () => void;
}) {
  const [comment, setComment] = useState(sub.teacher_comment ?? "");
  const [scores, setScores] = useState<RubricScore[]>(
    activity.rubric.map((c) => {
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

  const total = computeTotal(activity, scores);

  const save = async (release: boolean) => {
    setSaving(true);
    try {
      await supabase
        .from("activity_submissions")
        .update({
          rubric_scores: scores,
          total_score: total,
          teacher_comment: comment || null,
          status: release ? "released" : "ai_corrected",
          released_at: release ? new Date().toISOString() : null,
        })
        .eq("id", sub.id);
      if (release) {
        await releaseActivityFeedback({
          data: { submission_id: sub.id, teacher_comment: comment || undefined },
        });
      }
      toast.success(release ? "Feedback liberado" : "Avaliação salva");
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
        <div>
          <div className="font-medium text-sm">{sub.profiles?.name ?? sub.student_id}</div>
          <div className="text-xs text-muted-foreground">
            {sub.profiles?.enrollment_number ?? "—"} · {sub.status}
          </div>
        </div>
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
        {activity.rubric.map((c, i) => (
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
                placeholder="Comentário do critério (opcional)"
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
          Nota final (
          {activity.grading_formula === "simple_average" ? "média simples" : "ponderada"})
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

function computeTotal(activity: Activity, scores: RubricScore[]): number {
  if (!activity.rubric.length) return 0;
  if (activity.grading_formula === "simple_average") {
    // Normalize each score to 0-10 then average
    const normalized = activity.rubric.map((c) => {
      const s = scores.find((x) => x.id === c.id)?.score ?? 0;
      return c.max_score > 0 ? (s / c.max_score) * 10 : 0;
    });
    return normalized.reduce((a, b) => a + b, 0) / normalized.length;
  }
  // weighted_average
  const totalWeight = activity.rubric.reduce((s, c) => s + (c.weight || 0), 0) || 1;
  const sum = activity.rubric.reduce((acc, c) => {
    const s = scores.find((x) => x.id === c.id)?.score ?? 0;
    const norm = c.max_score > 0 ? (s / c.max_score) * 10 : 0;
    return acc + norm * (c.weight || 0);
  }, 0);
  return sum / totalWeight;
}
