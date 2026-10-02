import { useEffect, useState } from "react";
import { Loader2, ClipboardCheck, CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { listStudentAssessmentResults } from "@/backend/assessments.functions";
import { stripHardcodedCorrectLetter } from "@/lib/text-sanitize";

type QResult = {
  id: string;
  number: number;
  qtype: string;
  prompt: string;
  options: string[] | null;
  correct_answer: string | null;
  student_answer: string | null;
  explanation: string | null;
  score: { obtained: number; max: number; correct: boolean | null } | null;
  feedback: string | null;
};

type Result = {
  submission_id: string;
  assessment_id: string;
  title: string;
  module_name: string | null;
  max_score: number;
  total_score: number | null;
  posted_at: string | null;
  teacher_comment: string | null;
  final_feedback: string | null;
  questions: QResult[];
};

const TYPE_LABEL: Record<string, string> = {
  multiple_choice: "Múltipla escolha",
  true_false: "Verdadeiro/Falso",
  fill_blank: "Lacunas",
  essay: "Dissertativa",
};

function fmt(n: number | null | undefined) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toFixed(2).replace(".", ",");
}

function CorrectIcon({ correct }: { correct: boolean | null }) {
  if (correct === true) return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (correct === false) return <XCircle className="h-4 w-4 text-rose-600" />;
  return <MinusCircle className="h-4 w-4 text-muted-foreground" />;
}

export function StudentAssessmentsModule({ disciplineId }: { disciplineId: string }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Result[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await listStudentAssessmentResults({ data: { discipline_id: disciplineId } });
        if (!cancelled) setItems(r.items as Result[]);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao carregar avaliações");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [disciplineId]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-primary" />
          Avaliações
        </h2>
        <p className="text-sm text-muted-foreground">
          Suas avaliações corrigidas pelo(a) professor(a). A nota é lançada automaticamente no módulo Notas e aqui você vê o gabarito oficial ao lado das suas respostas.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhuma avaliação corrigida disponível ainda. Assim que o(a) professor(a) lançar a nota no diário, ela aparecerá aqui com o gabarito.
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((r) => {
            const open = openId === r.submission_id;
            return (
              <li key={r.submission_id} className="rounded-xl border bg-card" style={{ boxShadow: "var(--shadow-card)" }}>
                <div className="p-4 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium break-words">{r.title}</div>
                    {r.module_name && (
                      <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">Módulo: {r.module_name}</div>
                    )}
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {r.posted_at ? `Lançada em ${new Date(r.posted_at).toLocaleDateString("pt-BR")}` : "Corrigida"}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-2xl font-bold text-primary leading-none">
                      {fmt(r.total_score)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">de {fmt(r.max_score)}</div>
                    <Button
                      size="sm"
                      variant={open ? "secondary" : "outline"}
                      className="mt-2"
                      onClick={() => setOpenId(open ? null : r.submission_id)}
                    >
                      {open ? "Ocultar gabarito" : "Ver gabarito"}
                    </Button>
                  </div>
                </div>

                {open && (
                  <div className="border-t p-4 space-y-4">
                    {(r.teacher_comment || r.final_feedback) && (
                      <div className="rounded-md bg-primary/5 border border-primary/20 p-3 text-sm">
                        <div className="text-xs font-semibold uppercase tracking-wide text-primary mb-1">
                          Comentário do(a) professor(a)
                        </div>
                        <div className="whitespace-pre-wrap">
                          {r.final_feedback || r.teacher_comment}
                        </div>
                      </div>
                    )}

                    {r.questions.length === 0 ? (
                      <div className="text-sm text-muted-foreground">Sem questões registradas.</div>
                    ) : (
                      <ol className="space-y-3">
                        {r.questions.map((q) => {
                          const isEssay = q.qtype === "essay";
                          const isMC = q.qtype === "multiple_choice";
                          const studentNorm = (q.student_answer ?? "").trim();
                          const correctNorm = (q.correct_answer ?? "").trim();
                          const correct =
                            q.score?.correct ??
                            (studentNorm && correctNorm
                              ? studentNorm.toLowerCase() === correctNorm.toLowerCase()
                              : null);
                          return (
                            <li key={q.id} className="rounded-lg border p-3">
                              <div className="flex items-start gap-2">
                                <div className="mt-0.5"><CorrectIcon correct={correct} /></div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-semibold text-muted-foreground">
                                      Q{q.number} · {TYPE_LABEL[q.qtype] ?? q.qtype}
                                    </span>
                                    {q.score && (
                                      <span className="text-[11px] rounded-full bg-muted px-2 py-0.5">
                                        {fmt(q.score.obtained)} / {fmt(q.score.max)}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-sm mt-1 whitespace-pre-wrap">{q.prompt}</div>

                                  {isMC && q.options && q.options.length > 0 && (
                                    <ul className="mt-2 space-y-1 text-sm">
                                      {q.options.map((opt, i) => {
                                        const letter = "ABCDE"[i];
                                        const isCorrect = correctNorm.toUpperCase() === letter;
                                        const isStudent = studentNorm.toUpperCase() === letter;
                                        return (
                                          <li
                                            key={i}
                                            className={`rounded px-2 py-1 flex gap-2 ${
                                              isCorrect
                                                ? "bg-emerald-50 border border-emerald-200"
                                                : isStudent
                                                  ? "bg-rose-50 border border-rose-200"
                                                  : ""
                                            }`}
                                          >
                                            <span className="font-mono font-semibold">{letter})</span>
                                            <span className="flex-1">{opt}</span>
                                            {isCorrect && <span className="text-[10px] font-semibold text-emerald-700 uppercase">Correta</span>}
                                            {isStudent && !isCorrect && <span className="text-[10px] font-semibold text-rose-700 uppercase">Sua resposta</span>}
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  )}

                                  {!isMC && (
                                    <div className="grid gap-2 sm:grid-cols-2 mt-2 text-sm">
                                      <div className="rounded-md border p-2 bg-muted/30">
                                        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                                          Sua resposta
                                        </div>
                                        <div className={`whitespace-pre-wrap ${isEssay ? "" : "font-mono"}`}>
                                          {q.student_answer || <span className="text-muted-foreground italic">Em branco</span>}
                                        </div>
                                      </div>
                                      <div className="rounded-md border p-2 bg-emerald-50/60 border-emerald-200">
                                        <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 mb-1">
                                          Gabarito oficial
                                        </div>
                                        <div className={`whitespace-pre-wrap ${isEssay ? "" : "font-mono"}`}>
                                          {q.correct_answer || <span className="text-muted-foreground italic">—</span>}
                                        </div>
                                      </div>
                                    </div>
                                  )}

                                  {q.feedback && (
                                    <div className="mt-2 rounded-md bg-primary/5 border border-primary/15 p-2 text-xs">
                                      <span className="font-semibold text-primary">Feedback: </span>
                                      <span className="whitespace-pre-wrap">{q.feedback}</span>
                                    </div>
                                  )}
                                  {q.explanation && (
                                    <div className="mt-2 rounded-md border border-sky-200 bg-sky-50/60 p-2 text-xs text-sky-900">
                                      <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-700 mb-1">
                                        {correct ? "Por que esta resposta está correta" : "Explicação da resposta correta"}
                                      </div>
                                      <span className="whitespace-pre-wrap">{stripHardcodedCorrectLetter(q.explanation)}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}