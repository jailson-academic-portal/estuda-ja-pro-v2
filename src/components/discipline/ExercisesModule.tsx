import { sanitizeListTitle, sanitizeTitleList } from "@/lib/text-sanitize";
import { sortItemsNumerically } from "@/lib/utils";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { saveExercise, deleteExercise, submitExercise, getStudentExerciseSubmission } from "@/backend/exercises.functions";
import { exportExercisePDF, exportExerciseDOCX } from "@/backend/exercises.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CheckCircle2, Loader2, Plus, Trash2, Dumbbell, XCircle, Download, FileText, ChevronDown } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkDeleteBar } from "@/components/BulkDeleteBar";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const romanBlockMarker = "(?:I|II|III|IV|V)";

function normalizeExerciseMarkdown(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(new RegExp(`\\s+(?=(?:[-*•]\\s*)?(?:\\*\\*)?${romanBlockMarker}[.)](?:\\*\\*)?\\s)`, "g"), "\n")
    .replace(new RegExp(`(^|\\n)\\s*(?:[-*•]\\s*)?(?:\\*\\*)?(${romanBlockMarker})[.)](?:\\*\\*)?\\s*`, "g"), "$1- **$2.** ")
    .trim();
}

function normalizeAnswer(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\*\*/g, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function stripOptionPrefix(value: string) {
  return value.replace(/^\s*[a-e]\s*[).:\-]\s*/i, "");
}

function answerCandidates(value: unknown, options?: string[] | null) {
  const candidates = new Set<string>();
  const add = (item: unknown) => {
    const base = normalizeAnswer(item);
    if (base) candidates.add(base);
    const stripped = normalizeAnswer(stripOptionPrefix(String(item ?? "")));
    if (stripped) candidates.add(stripped);
  };

  if (Array.isArray(value)) value.forEach(add);
  else add(value);

  const raw = String(value ?? "").trim();
  const letter = raw.match(/^([a-e])(?:[).:\-])?$/i)?.[1]?.toLowerCase();
  const numeric = /^\d+$/.test(raw) ? Number(raw) : typeof value === "number" ? value : NaN;
  const opts = Array.isArray(options) ? options : [];
  if (letter) add(opts[letter.charCodeAt(0) - 97]);
  if (Number.isFinite(numeric)) {
    add(opts[numeric]);
    add(opts[numeric - 1]);
  }
  return candidates;
}

function answersMatch(answer: unknown, correctAnswer: unknown, options?: string[] | null) {
  if (answer == null || correctAnswer == null) return false;
  const answerSet = answerCandidates(answer, options);
  const correctSet = answerCandidates(correctAnswer, options);
  return [...answerSet].some((candidate) => correctSet.has(candidate));
}

function correctAnswerText(correctAnswer: unknown, options?: string[] | null) {
  if (Array.isArray(correctAnswer)) return correctAnswer.join(", ");
  const raw = String(correctAnswer ?? "").trim();
  const opts = Array.isArray(options) ? options : [];
  const letter = raw.match(/^([a-e])(?:[).:\-])?$/i)?.[1]?.toLowerCase();
  const numeric = /^\d+$/.test(raw) ? Number(raw) : typeof correctAnswer === "number" ? correctAnswer : NaN;
  if (letter && opts[letter.charCodeAt(0) - 97]) return opts[letter.charCodeAt(0) - 97];
  if (Number.isFinite(numeric)) return opts[numeric] ?? opts[numeric - 1] ?? raw;
  return stripOptionPrefix(raw) || raw;
}

type ExerciseFeedbackItem = { qid: string; correct: boolean | null; points_awarded: number };

function parseFeedback(value: unknown) {
  if (!Array.isArray(value)) return null;
  const entries = value.flatMap((item): Array<[string, ExerciseFeedbackItem]> => {
    if (!item || typeof item !== "object" || !("qid" in item)) return [];
    const raw = item as { qid?: unknown; correct?: unknown; points_awarded?: unknown };
    if (typeof raw.qid !== "string") return [];
    return [[raw.qid, {
      qid: raw.qid,
      correct: typeof raw.correct === "boolean" ? raw.correct : null,
      points_awarded: Number(raw.points_awarded ?? 0),
    }]];
  });
  return entries.length ? Object.fromEntries(entries) : null;
}

function MD({ children }: { children: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-2 [&_ul]:pl-5 [&_li]:my-1 [&_li]:leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{normalizeExerciseMarkdown(children)}</ReactMarkdown>
    </div>
  );
}

function downloadBase64(filename: string, mime: string, base64: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function handleDownload(format: "pdf" | "docx", exerciseId: string) {
  try {
    const res = format === "pdf"
      ? await exportExercisePDF({ data: { exercise_id: exerciseId } })
      : await exportExerciseDOCX({ data: { exercise_id: exerciseId } });
    downloadBase64(res.filename, res.mime, res.base64);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Erro ao baixar");
  }
}

interface Exercise {
  id: string; title: string; topic: string | null; type: string; question_count: number;
  due_at: string | null; status: "draft" | "published";
  shuffle_questions?: boolean; shuffle_options?: boolean;
  module_label?: string | null;
}
interface Question {
  prompt: string;
  type: "multiple_choice" | "true_false" | "short_answer";
  options?: string[];
  correct_answer?: string | string[];
  explanation?: string;
  points: number;
}

// Color palette reused from the Materials module category tokens so exercise
// groups (one per Aula/tema) are visually separated by color.
const GROUP_PALETTE = [
  { bg: "bg-category-apostila-bg", text: "text-category-apostila-text", border: "border-category-apostila-border" },
  { bg: "bg-category-plano-bg", text: "text-category-plano-text", border: "border-category-plano-border" },
  { bg: "bg-category-aula-bg", text: "text-category-aula-text", border: "border-category-aula-border" },
  { bg: "bg-category-outros-bg", text: "text-category-outros-text", border: "border-category-outros-border" },
] as const;

const OTHERS_LABEL = "Outros exercícios";

/** Rótulo do módulo (nível 1): apostila do módulo escolhida na criação. */
function moduleKeyFor(e: Exercise) {
  const label = e.module_label?.trim();
  if (label && /m[óo]dulo/i.test(label)) return label;
  const found = `${e.module_label ?? ""} ${e.title ?? ""} ${e.topic ?? ""}`.match(
    /M[óo]dulo\s*\d+\s*[:\-–—]?\s*[^—|]*/i,
  );
  if (found) return found[0].replace(/\s+/g, " ").trim();
  if (label) return label;
  return OTHERS_LABEL;
}

/** Rótulo da aula (nível 2) dentro do módulo. */
function lessonKeyFor(e: Exercise) {
  const src = `${e.title ?? ""} ${e.topic ?? ""}`;
  const m = src.match(/Aula\s*(\d+)\s*[:\-–—]?\s*([^|]*)/i);
  if (m) {
    const tema = m[2].replace(/\s+/g, " ").trim();
    return `Aula ${Number(m[1]).toString().padStart(2, "0")}${tema ? ` — ${tema}` : ""}`;
  }
  return e.topic?.trim() || sanitizeListTitle(e.title) || OTHERS_LABEL;
}

// Extract a numeric module order from a label like "Módulo 2: Tema" so groups
// render in ascending order (Módulo 1, 2, 3 ...). Non-module groups sort last.
function moduleOrder(label: string) {
  const m = label.match(/m[óo]dulo\s*(\d+)/i);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

function lessonOrder(label: string) {
  const m = label.match(/aula\s*(\d+)/i);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

/** Normaliza para comparar títulos ignorando acentos, caixa e separadores. */
function normalizeLabel(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\d+/g, (n) => String(Number(n)))
    .replace(/[:\-–—|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Título exibido no cartão da lista. Quando o título salvo é igual ao
 * cabeçalho da aula (ex.: "Aula 04 — Técnicas..."), evita a duplicidade
 * mostrando um rótulo genérico.
 */
function rowTitleFor(e: Exercise, lessonLabel: string) {
  const title = sanitizeListTitle(e.title);
  const a = normalizeLabel(title);
  const b = normalizeLabel(lessonLabel);
  if (!a) return "Lista de exercícios";
  if (a === b || a.includes(b) || b.includes(a)) return "Lista de exercícios";
  return title;
}

type LessonGroup = { label: string; list: Exercise[] };
type ModuleGroup = {
  label: string;
  count: number;
  lessons: LessonGroup[];
  color: (typeof GROUP_PALETTE)[number];
};

/** Agrupa em dois níveis: Módulo (apostila) → Aula → listas de exercícios. */
function groupExercises(items: Exercise[]): ModuleGroup[] {
  const modules = new Map<string, Map<string, Exercise[]>>();
  for (const e of items) {
    const mKey = moduleKeyFor(e);
    const lKey = lessonKeyFor(e);
    const lessons = modules.get(mKey) ?? new Map<string, Exercise[]>();
    modules.set(mKey, lessons);
    const arr = lessons.get(lKey);
    if (arr) arr.push(e);
    else lessons.set(lKey, [e]);
  }

  return Array.from(modules.entries())
    .sort((a, b) => moduleOrder(a[0]) - moduleOrder(b[0]) || a[0].localeCompare(b[0], "pt-BR"))
    .map(([label, lessonMap], i) => {
      const lessons = Array.from(lessonMap.entries())
        .sort((a, b) => lessonOrder(a[0]) - lessonOrder(b[0]) || a[0].localeCompare(b[0], "pt-BR"))
        .map(([lessonLabel, list]) => ({
          label: lessonLabel,
          list: [...list].sort((a, b) => a.title.localeCompare(b.title, "pt-BR")),
        }));
      return {
        label,
        count: lessons.reduce((sum, l) => sum + l.list.length, 0),
        lessons,
        color: GROUP_PALETTE[i % GROUP_PALETTE.length],
      };
    });
}

export function ExercisesModule({ disciplineId, isTeacher }: { disciplineId: string; isTeacher: boolean }) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [solving, setSolving] = useState<Exercise | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

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
    const results = await Promise.allSettled(ids.map((id) => deleteExercise({ data: { id } })));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed === 0) toast.success(`${ids.length} lista(s) excluída(s)`);
    else toast.error(`${ids.length - failed} excluída(s), ${failed} falharam`);
    clearSelected();
    await load();
  };

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("exercises").select("*").eq("discipline_id", disciplineId).order("created_at", { ascending: true });
    setExercises(sortItemsNumerically((data ?? []) as Exercise[]));
    setLoading(false);
  }, [disciplineId]);

  useEffect(() => { load(); }, [load]);

  const visible = exercises.filter((e) => isTeacher || e.status === "published");
  const groups = groupExercises(visible);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-white">
          <h2 className="text-lg font-semibold">Exercícios</h2>
          <p className="text-sm opacity-80">{exercises.length} lista(s)</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : visible.length === 0 ? (
        <div className="border-2 border-dashed rounded-xl py-12 text-center">
          <Dumbbell className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhuma lista de exercícios.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <Collapsible key={group.label} defaultOpen className={`rounded-xl border ${group.color.border} overflow-hidden`}>
              <CollapsibleTrigger className={`w-full flex items-center justify-between gap-2 px-4 py-3 ${group.color.bg} ${group.color.text} [&[data-state=open]>svg]:rotate-180`}>
                <span className="flex items-center gap-2 font-semibold text-sm text-left">
                  <Dumbbell className="h-4 w-4 shrink-0" />
                  {group.label}
                  <span className="text-xs font-normal opacity-70">({group.count})</span>
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 transition-transform" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="space-y-2 p-3">
                  {group.lessons.map((lesson) => (
                    <Collapsible key={lesson.label} defaultOpen className="rounded-lg border bg-muted/30 overflow-hidden">
                      <CollapsibleTrigger className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left [&[data-state=open]>svg]:rotate-180">
                        <span className="flex items-center gap-2 text-sm font-medium min-w-0">
                          <span className="truncate">{lesson.label}</span>
                          <span className="text-xs font-normal text-muted-foreground shrink-0">({lesson.list.length})</span>
                        </span>
                        <ChevronDown className="h-4 w-4 shrink-0 transition-transform text-muted-foreground" />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="space-y-2 p-2">
                          {lesson.list.map((e) => (
                    <div key={e.id} className="rounded-lg border bg-card p-4 flex items-center justify-between gap-3 min-w-0" style={{ boxShadow: "var(--shadow-card)" }}>
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        {isTeacher && (
                          <Checkbox
                            className="shrink-0"
                            checked={selected.has(e.id)}
                            onCheckedChange={() => toggleSelected(e.id)}
                            aria-label="Selecionar lista"
                          />
                        )}
                        <div className="min-w-0 flex-1 break-words whitespace-normal">
                          <div className="font-medium break-words leading-tight">{rowTitleFor(e, lesson.label)}</div>
                          <div className="text-xs text-muted-foreground break-words whitespace-normal leading-tight">{e.question_count} questão(ões)</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {isTeacher && (
                          <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded ${e.status === "published" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
                            {e.status === "published" ? "Publicada" : "Rascunho"}
                          </span>
                        )}
                        {!isTeacher && e.status === "published" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => handleDownload("pdf", e.id)}>
                              <Download className="h-4 w-4 mr-1" /> PDF
                            </Button>
                            <Button size="sm" onClick={() => setSolving(e)}>Resolver</Button>
                          </>
                        )}
                        {isTeacher && (
                          <>
                            <Button size="icon" variant="ghost" className="h-8 w-8" title="Baixar PDF" onClick={() => handleDownload("pdf", e.id)}>
                              <Download className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8" title="Baixar DOCX (editável)" onClick={() => handleDownload("docx", e.id)}>
                              <FileText className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={async () => {
                              if (!confirm("Excluir lista?")) return;
                              await deleteExercise({ data: { id: e.id } }); load();
                            }}><Trash2 className="h-4 w-4" /></Button>
                          </>
                        )}
                      </div>
                    </div>
                          ))}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      )}

      {editorOpen && isTeacher && (
        <ExerciseEditor disciplineId={disciplineId} onClose={() => setEditorOpen(false)}
          onDone={() => { setEditorOpen(false); load(); }} />
      )}
      {solving && (
        <SolveDialog exercise={solving} onClose={() => setSolving(null)} />
      )}
      {isTeacher && (
        <BulkDeleteBar count={selected.size} itemLabel="lista" onClear={clearSelected} onConfirm={bulkDelete} />
      )}
    </div>
  );
}

function ExerciseEditor({ disciplineId, onClose, onDone }: {
  disciplineId: string; onClose: () => void; onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [moduleLabel, setModuleLabel] = useState("");
  const [questions, setQuestions] = useState<Question[]>([
    { prompt: "", type: "multiple_choice", options: ["", "", "", ""], correct_answer: "", points: 1 },
  ]);
  const [submitting, setSubmitting] = useState(false);

  const addQ = () => setQuestions([...questions, { prompt: "", type: "multiple_choice", options: ["", "", "", ""], correct_answer: "", points: 1 }]);
  const updateQ = (i: number, patch: Partial<Question>) => {
    setQuestions(questions.map((q, idx) => idx === i ? { ...q, ...patch } : q));
  };
  const removeQ = (i: number) => setQuestions(questions.filter((_, idx) => idx !== i));

  const submit = async (publish: boolean) => {
    if (!title.trim() || questions.some((q) => !q.prompt.trim())) { toast.error("Preencha título e enunciados"); return; }
    
    const safeTitle = title.trim().substring(0, 150);
    const safeTopic = topic.trim().substring(0, 190);
    const safeModuleLabel = moduleLabel.trim().substring(0, 150);

    setSubmitting(true);
    try {
      await saveExercise({ data: {
        discipline_id: disciplineId, 
        title: safeTitle,
        topic: safeTopic || undefined,
        module_label: safeModuleLabel || undefined,
        type: "multiple_choice",
        questions: questions.map((q) => ({ ...q, prompt: q.prompt.trim() })),
        publish,
      } });
      toast.success(publish ? "Lista publicada" : "Rascunho salvo");
      onDone();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
    finally { setSubmitting(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl w-[92vw] sm:w-full overflow-x-hidden max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova lista de exercícios</DialogTitle>
          <DialogDescription>Edite todas as questões antes de publicar.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Título</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
            <div><Label>Módulo (opcional)</Label><Input placeholder="Ex.: Módulo 1: Tema" value={moduleLabel} onChange={(e) => setModuleLabel(e.target.value)} /></div>
          </div>
          <div><Label>Tópico / Aula (opcional)</Label><Input placeholder="Ex.: Aula 1: Tema" value={topic} onChange={(e) => setTopic(e.target.value)} /></div>
          <div className="space-y-3">
            {questions.map((q, i) => (
              <div key={i} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Questão {i + 1}</span>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeQ(i)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <Textarea placeholder="Enunciado" value={q.prompt} onChange={(e) => updateQ(i, { prompt: e.target.value })} rows={2} />
                <div className="grid grid-cols-2 gap-2">
                  <select className="border rounded px-2 py-1 text-sm" value={q.type}
                    onChange={(e) => updateQ(i, { type: e.target.value as Question["type"], options: e.target.value === "multiple_choice" ? ["", "", "", ""] : undefined })}>
                    <option value="multiple_choice">Múltipla escolha</option>
                    <option value="true_false">Verdadeiro/Falso</option>
                    <option value="short_answer">Resposta curta</option>
                  </select>
                  <Input type="number" min={0.1} max={1} step={0.1} value={q.points}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      updateQ(i, { points: Number.isFinite(value) ? Math.min(1, Math.max(0.1, value)) : 0.1 });
                    }} placeholder="Pontos" />
                </div>
                {q.type === "multiple_choice" && (
                  <div className="space-y-1">
                    {(q.options ?? []).map((opt, oi) => (
                      <div key={oi} className="flex items-center gap-2">
                        <input type="radio" name={`correct-${i}`} checked={q.correct_answer === opt && opt !== ""}
                          onChange={() => updateQ(i, { correct_answer: opt })} />
                        <Input value={opt} placeholder={`Alternativa ${oi + 1}`}
                          onChange={(e) => {
                            const opts = [...(q.options ?? [])];
                            opts[oi] = e.target.value;
                            updateQ(i, { options: opts, correct_answer: q.correct_answer === q.options?.[oi] ? e.target.value : q.correct_answer });
                          }} />
                      </div>
                    ))}
                  </div>
                )}
                {q.type === "true_false" && (
                  <select className="border rounded px-2 py-1 text-sm" value={String(q.correct_answer ?? "")}
                    onChange={(e) => updateQ(i, { correct_answer: e.target.value })}>
                    <option value="">Selecione...</option>
                    <option value="true">Verdadeiro</option>
                    <option value="false">Falso</option>
                  </select>
                )}
                {q.type === "short_answer" && (
                  <Input placeholder="Resposta esperada (opcional)" value={String(q.correct_answer ?? "")}
                    onChange={(e) => updateQ(i, { correct_answer: e.target.value })} />
                )}
                <Textarea placeholder="Explicação (opcional)" value={q.explanation ?? ""}
                  onChange={(e) => updateQ(i, { explanation: e.target.value })} rows={2} />
              </div>
            ))}
            <Button variant="outline" onClick={addQ}><Plus className="h-4 w-4 mr-2" /> Adicionar questão</Button>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="outline" disabled={submitting} onClick={() => submit(false)}>Salvar rascunho</Button>
          <Button disabled={submitting} onClick={() => submit(true)}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Publicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SolveDialog({ exercise, onClose }: { exercise: Exercise; onClose: () => void }) {
  const { user } = useAuth();
  const [questions, setQuestions] = useState<Array<{ id: string; prompt: string; type: string; options: string[] | null; points: number; correct_answer: string | string[] | null }>>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ score: number; max_score: number } | null>(null);
  const [submittedAnswers, setSubmittedAnswers] = useState<Record<string, string> | null>(null);
  const [feedback, setFeedback] = useState<Record<string, { correct: boolean | null; points_awarded: number }> | null>(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number>(5);
  const [maxAttempts, setMaxAttempts] = useState<number>(5);
  const [attemptCount, setAttemptCount] = useState<number>(0);

  // Load the exercise questions and shuffle both the question order and the
  // options every time — so each attempt presents a fresh randomized layout.
  const loadShuffledQuestions = useCallback(async (): Promise<
    Array<{ id: string; prompt: string; type: string; options: string[] | null; points: number; correct_answer: string | string[] | null }>
  > => {
    const { data: qs } = await supabase.from("exercise_questions_student")
      .select("id, prompt, options, points").eq("exercise_id", exercise.id).order("position");
    const shuffleArr = <T,>(arr: T[]): T[] => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    let baseQuestions = (qs ?? []).map((q) => ({
      id: q.id as string, prompt: q.prompt as string, type: "auto",
      options: Array.isArray(q.options) && q.options.length > 1
        ? shuffleArr(q.options as string[])
        : (Array.isArray(q.options) ? (q.options as string[]) : null),
      points: Number(q.points),
      correct_answer: null as string | string[] | null,
    }));
    baseQuestions = shuffleArr(baseQuestions);
    return baseQuestions;
  }, [exercise.id]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const baseQuestions = await loadShuffledQuestions();
      setQuestions(baseQuestions);
      setLoading(false);
    })();

    // Check existing submission / attempts used.
    if (user) {
      getStudentExerciseSubmission({ data: { exercise_id: exercise.id } }).then((res) => {
        setMaxAttempts(res.max_attempts ?? 5);
        setAttemptCount(res.attempt_count ?? 0);
        setAttemptsRemaining(res.attempts_remaining ?? 5);
        const data = res.submission;
        if (data && data.score != null) {
          setResult({ score: Number(data.score), max_score: Number(data.max_score) });
          if (data.answers && typeof data.answers === "object") {
            setSubmittedAnswers(data.answers as Record<string, string>);
          }
          setFeedback(parseFeedback(data.feedback));
          const keys = res.answer_keys ?? {};
          if (Object.keys(keys).length) {
            setQuestions((curr) => curr.map((q) => ({ ...q, correct_answer: keys[q.id]?.correct_answer ?? null })));
          }
        }
      }).catch(() => {});
    }
  }, [exercise.id, user, loadShuffledQuestions]);

  // Start a fresh attempt: clears the previous result and re-shuffles.
  const retry = async () => {
    setLoading(true);
    setResult(null);
    setSubmittedAnswers(null);
    setFeedback(null);
    setAnswers({});
    const baseQuestions = await loadShuffledQuestions();
    setQuestions(baseQuestions);
    setLoading(false);
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const res = await submitExercise({ data: { exercise_id: exercise.id, answers } });
      setResult({ score: res.score, max_score: res.max_score });
      setSubmittedAnswers({ ...answers });
      setFeedback(parseFeedback((res as unknown as { feedback?: unknown }).feedback));
      const keys = (res as unknown as { answer_keys?: Record<string, { correct_answer: string | string[] | null }> }).answer_keys ?? {};
      setQuestions((curr) => curr.map((q) => ({ ...q, correct_answer: keys[q.id]?.correct_answer ?? null })));
      setAttemptCount(res.attempt_count ?? attemptCount + 1);
      setAttemptsRemaining(res.attempts_remaining ?? Math.max(0, attemptsRemaining - 1));
      toast.success("Respostas enviadas");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
    finally { setSubmitting(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col gap-3 p-4 sm:p-6">
        <DialogHeader className="shrink-0">
          <DialogTitle>{exercise.title}</DialogTitle>
          <DialogDescription className="space-y-0.5">
            {result && (
              <span className="block text-base font-semibold text-foreground">
                Pontuação total: {result.score} / {result.max_score}
              </span>
            )}
            <span className="block text-xs text-muted-foreground">
              Tentativa {Math.min(attemptCount + (result ? 0 : 1), maxAttempts)} de {maxAttempts}
              {" · "}
              {attemptsRemaining > 0
                ? `${attemptsRemaining} tentativa(s) restante(s)`
                : "sem tentativas restantes"}
              {" · as questões e alternativas são embaralhadas a cada tentativa"}
            </span>
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : questions.length === 0 ? (
          <div className="flex-1 min-h-[160px] flex flex-col items-center justify-center gap-3 text-center">
            <Dumbbell className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Não foi possível carregar as questões desta lista agora.
            </p>
            <Button variant="outline" size="sm" onClick={retry}>Recarregar questões</Button>
          </div>
        ) : (
          <div className="flex-1 min-h-0 space-y-4 overflow-y-auto pr-1">
            {questions.map((q, i) => {
              const studentAns = (submittedAnswers ?? answers)[q.id];
              const itemFeedback = feedback?.[q.id];
              const correct = result
                ? itemFeedback?.correct ?? (q.correct_answer == null || studentAns == null ? null : answersMatch(studentAns, q.correct_answer, q.options))
                : null;
              const awarded = itemFeedback?.points_awarded ?? (correct ? q.points : 0);
              const correctText = correctAnswerText(q.correct_answer, q.options);
              return (
                <div
                  key={q.id}
                  className={`border rounded-lg p-3 transition-colors ${
                    correct === true ? "border-[color:var(--success)] bg-[color-mix(in_oklab,var(--success)_12%,var(--card))]" :
                    correct === false ? "border-destructive bg-[color-mix(in_oklab,var(--destructive)_10%,var(--card))]" : "bg-card"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="text-sm font-medium flex-1">
                      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Questão {i + 1}</div>
                      <MD>{q.prompt}</MD>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 rounded-md border bg-background px-2 py-1">
                      {result
                        ? `${awarded} / ${q.points} pt`
                        : `${q.points} pt`}
                    </span>
                  </div>
                  {result && (
                    <div className={`mb-2 flex items-center gap-2 text-sm font-semibold ${correct ? "text-[color:var(--success)]" : "text-destructive"}`}>
                      {correct ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                      {correct ? "Resposta correta" : "Resposta incorreta"}
                    </div>
                  )}
                  {q.options && q.options.length > 0 ? (
                    <div className="space-y-1">
                      {q.options.map((opt, oi) => {
                        const isStudent = studentAns === opt;
                        const isCorrectOpt = !!result && answersMatch(opt, q.correct_answer, q.options);
                        return (
                          <label
                            key={oi}
                            className={`flex items-start gap-2 text-sm p-2 rounded border ${
                              isCorrectOpt ? "border-[color:var(--success)] bg-[color-mix(in_oklab,var(--success)_14%,var(--card))] font-medium" :
                              isStudent && correct === false ? "border-destructive bg-[color-mix(in_oklab,var(--destructive)_10%,var(--card))]" : "border-transparent"
                            }`}
                          >
                            <input type="radio" className="mt-1" disabled={!!result} checked={isStudent}
                              onChange={() => setAnswers({ ...answers, [q.id]: opt })} />
                            <div className="flex-1"><MD>{opt}</MD></div>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <Textarea disabled={!!result} value={answers[q.id] ?? ""}
                      onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} rows={2} />
                  )}
                  {result && correct === false && correctText && (
                    <div className="mt-2 text-xs text-green-700 dark:text-green-400">
                      ✓ Resposta correta: {correctText}
                    </div>
                  )}
                  {result && correct === true && (
                    <div className="mt-2 text-xs text-green-700 dark:text-green-400">
                      ✓ Você acertou!
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <DialogFooter className="shrink-0 border-t pt-3">
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
          {result && attemptsRemaining > 0 && (
            <Button variant="outline" disabled={loading || submitting} onClick={retry}>
              Tentar novamente ({attemptsRemaining})
            </Button>
          )}
          {!result && questions.length > 0 && (
            <Button disabled={submitting || loading} onClick={submit}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Enviar respostas
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
