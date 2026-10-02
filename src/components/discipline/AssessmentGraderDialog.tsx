import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, QrCode, ScanLine, CheckCircle2, Camera, CameraOff, RotateCcw, Sparkles, Send, ImagePlus, Save, X } from "lucide-react";
import { toast } from "sonner";
import {
  lookupAssignmentByToken,
  gradeObjectiveSubmission,
  listGraderQueue,
  gradeEssayWithAI,
  postAssessmentSubmissionToDiary,
  ocrEssayImage,
  saveEssayFeedback,
} from "@/backend/grader.functions";
import { ModalLancamentoNotaDiario } from "@/components/diary/ModalLancamentoNotaDiario";
import { OMRScannerPane } from "./OMRScannerPane";
import type { OMRLayout } from "@/lib/omr";

type Question = {
  id: string;
  position: number;
  qtype: "multiple_choice" | "true_false" | "fill_blank" | "essay";
  prompt: string;
  options: string[] | null;
  weight: number;
};

type Lookup = Awaited<ReturnType<typeof lookupAssignmentByToken>>;

type GraderProps = {
  open: boolean;
  onClose: () => void;
  assessmentId: string;
  assessmentTitle: string;
  disciplineId?: string;
  diaryAssessmentId?: string | null;
};

export function AssessmentGraderDialog({ open, onClose, assessmentId, assessmentTitle, disciplineId, diaryAssessmentId }: GraderProps) {
  const [tab, setTab] = useState<"scan" | "manual" | "queue">("scan");
  const [manualToken, setManualToken] = useState("");
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [loading, setLoading] = useState(false);

  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [comment, setComment] = useState("");
  const [result, setResult] = useState<Awaited<ReturnType<typeof gradeObjectiveSubmission>> | null>(null);
  const [essayTexts, setEssayTexts] = useState<Record<string, string>>({});
  const [essayResults, setEssayResults] = useState<Record<string, { score: number; max: number; feedback: string }>>({});
  const [essayFeedbackEdits, setEssayFeedbackEdits] = useState<Record<string, string>>({});
  const [essayImages, setEssayImages] = useState<Record<string, string>>({});
  const [ocrBusyId, setOcrBusyId] = useState<string | null>(null);
  const [savingFbId, setSavingFbId] = useState<string | null>(null);
  const [aiBusyId, setAiBusyId] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [gradePosted, setGradePosted] = useState(false);
  const [releaseModal, setReleaseModal] = useState<{ open: boolean; score: number } | null>(null);

  const [queue, setQueue] = useState<Awaited<ReturnType<typeof listGraderQueue>>["items"]>([]);
  const [omrMode, setOmrMode] = useState(false);

  const reset = () => {
    setLookup(null);
    setAnswers({});
    setComment("");
    setResult(null);
    setManualToken("");
    setEssayTexts({});
    setEssayResults({});
    setEssayFeedbackEdits({});
    setEssayImages({});
    setOmrMode(false);
    setGradePosted(false);
  };

  useEffect(() => {
    if (!open) reset();
  }, [open]);

  const refreshQueue = async () => {
    try {
      const r = await listGraderQueue({ data: { assessment_id: assessmentId } });
      setQueue(r.items);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };
  useEffect(() => {
    if (open && tab === "queue") refreshQueue();
  }, [open, tab, assessmentId]);

  const handleToken = async (token: string) => {
    const t = token.trim();
    if (!t) return;
    setLoading(true);
    try {
      const r = await lookupAssignmentByToken({ data: { token: t } });
      if (r.assessment.id !== assessmentId) {
        toast.error("Este QR pertence a outra avaliação.");
      } else {
        const hasOMRLayout = !!(r.assignment as { bubble_layout?: OMRLayout | null }).bubble_layout;
        setLookup(r);
        // Pre-populate with existing submission if available
        const existing = (r.submission?.objective_answers as Record<string, string | string[]> | undefined) ?? {};
        setAnswers(existing);
        setComment(r.submission?.teacher_comment ?? "");
        setResult(null);
        setEssayTexts({});
        setEssayResults({});
        setOmrMode(hasOMRLayout && (!r.submission?.status || r.submission.status === "pending"));
        const status = r.submission?.status;
        setGradePosted(status === "posted");
        if (status === "posted") {
          toast.info(
            `Este QR já foi corrigido e a nota de ${r.student?.name ?? "—"} já foi lançada.`,
          );
        } else if (status === "confirmed" || status === "awaiting_review" || status === "graded_objective") {
          toast.info(
            `Este QR já foi lido anteriormente. Correção em andamento para ${r.student?.name ?? "—"}.`,
          );
        } else {
          toast.success(`Aluno(a): ${r.student?.name ?? "—"} · Versão ${r.version.version_label}`);
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "QR não reconhecido");
    } finally {
      setLoading(false);
    }
  };

  const submitGrade = async () => {
    if (!lookup) return;
    setLoading(true);
    try {
      const r = await gradeObjectiveSubmission({
        data: {
          assignment_id: lookup.assignment.id,
          objective_answers: answers as Record<string, string | string[] | boolean>,
          teacher_comment: comment.trim() || null,
        },
      });
      setResult(r);
      toast.success(`Nota objetiva: ${r.total_score.toFixed(2)} / ${r.max_score.toFixed(2)}`);
      refreshQueue();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao corrigir");
    } finally {
      setLoading(false);
    }
  };

  const handleOMRConfirm = async (omrAnswers: Record<string, string | null>) => {
    const merged: Record<string, string | string[]> = { ...answers } as Record<string, string | string[]>;
    for (const [qid, val] of Object.entries(omrAnswers)) {
      if (val != null) merged[qid] = val;
    }
    setAnswers(merged);
    setOmrMode(false);
    // Auto-submit using the OMR-detected answers.
    setLoading(true);
    try {
      const r = await gradeObjectiveSubmission({
        data: {
          assignment_id: lookup!.assignment.id,
          objective_answers: merged as Record<string, string | string[] | boolean>,
          teacher_comment: comment.trim() || null,
        },
      });
      setResult(r);
      toast.success(`Nota objetiva: ${r.total_score.toFixed(2)} / ${r.max_score.toFixed(2)}`);
      refreshQueue();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao corrigir");
    } finally {
      setLoading(false);
    }
  };

  const posted = gradePosted || lookup?.submission?.status === "posted";
  const bubbleLayout = (lookup?.assignment as { bubble_layout?: OMRLayout | null } | undefined)?.bubble_layout ?? null;

  const runEssayAI = async (questionId: string) => {
    if (!lookup) return;
    const text = (essayTexts[questionId] ?? "").trim();
    if (!text) { toast.error("Capture a foto da resposta para transcrição automática."); return; }
    setAiBusyId(questionId);
    try {
      const r = await gradeEssayWithAI({
        data: { assignment_id: lookup.assignment.id, question_id: questionId, student_answer: text },
      });
      setEssayResults((s) => ({ ...s, [questionId]: { score: r.score, max: r.max, feedback: r.feedback } }));
      setEssayFeedbackEdits((s) => ({ ...s, [questionId]: r.feedback }));
      toast.success(`Dissertativa pontuada: ${r.score.toFixed(2)} / ${r.max.toFixed(2)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na IA");
    } finally {
      setAiBusyId(null);
    }
  };

  const handleCaptureEssayImage = async (questionId: string, file: File) => {
    if (!lookup) return;
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Imagem muito grande (máx. 8 MB).");
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Falha ao ler imagem."));
      reader.readAsDataURL(file);
    });
    setEssayImages((s) => ({ ...s, [questionId]: dataUrl }));
    setOcrBusyId(questionId);
    try {
      const r = await ocrEssayImage({
        data: { assignment_id: lookup.assignment.id, question_id: questionId, image_data_url: dataUrl },
      });
      setEssayTexts((s) => ({ ...s, [questionId]: r.text }));
      toast.success("Texto transcrito pela IA. Revise se necessário.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no OCR");
    } finally {
      setOcrBusyId(null);
    }
  };

  const saveFeedback = async (questionId: string) => {
    if (!lookup) return;
    const fb = essayFeedbackEdits[questionId] ?? "";
    setSavingFbId(questionId);
    try {
      await saveEssayFeedback({
        data: { assignment_id: lookup.assignment.id, question_id: questionId, feedback: fb },
      });
      toast.success("Feedback salvo.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar feedback");
    } finally {
      setSavingFbId(null);
    }
  };

  const postToDiary = async () => {
    if (!lookup || !result) return;
    setReleaseModal({ open: true, score: result.total_score });
  };

  const handleGradeReleased = async () => {
    if (!lookup) return;
    setPosting(true);
    try {
      await postAssessmentSubmissionToDiary({ data: { assignment_id: lookup.assignment.id } });
      setGradePosted(true);
      setLookup((prev) =>
        prev
          ? {
              ...prev,
              submission: prev.submission
                ? { ...prev.submission, status: "posted" as const }
                : prev.submission,
            }
          : prev,
      );
      toast.success(`Correção finalizada no sistema.`);
      refreshQueue();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao atualizar status");
    } finally {
      setPosting(false);
    }
  };

  const orderedQuestions: Question[] = (() => {
    if (!lookup) return [];
    const order = (Array.isArray(lookup.version.question_order) ? lookup.version.question_order : []) as string[];
    const map = new Map((lookup.questions as Question[]).map((q) => [q.id, q]));
    return order.length
      ? (order.map((id) => map.get(id)).filter(Boolean) as Question[])
      : (lookup.questions as Question[]);
  })();

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl w-[100vw] sm:w-[95vw] h-[100dvh] sm:h-auto max-h-[100dvh] sm:max-h-[95vh] overflow-y-auto p-4 sm:p-6 rounded-none sm:rounded-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-5 w-5 text-primary" />
            Corretor — {assessmentTitle}
          </DialogTitle>
          <DialogDescription>
            Leia o QR Code da folha de respostas, escaneie o gabarito preenchido COMPLETAMENTE com caneta preta ou azul e revise as alternativas detectadas automaticamente.
          </DialogDescription>
        </DialogHeader>

        {!lookup ? (
          <div className="space-y-4">
            <div className="flex gap-2 border-b">
              <TabBtn active={tab === "scan"} onClick={() => setTab("scan")}>Escanear câmera</TabBtn>
              <TabBtn active={tab === "manual"} onClick={() => setTab("manual")}>Token manual</TabBtn>
              <TabBtn active={tab === "queue"} onClick={() => setTab("queue")}>Fila</TabBtn>
            </div>

            {tab === "scan" && <ScannerPane onToken={handleToken} loading={loading} />}
            {tab === "manual" && (
              <div className="space-y-3">
                <Label>Cole/digite o token do QR</Label>
                <div className="flex gap-2">
                  <Input value={manualToken} onChange={(e) => setManualToken(e.target.value)} placeholder="ex.: 9f3c1a..." />
                  <Button onClick={() => handleToken(manualToken)} disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            )}
            {tab === "queue" && (
              <div className="space-y-2 max-h-[55vh] overflow-auto">
                {queue.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhuma folha gerada ainda.</div>
                ) : (
                  queue.map((row) => (
                    <div key={row.assignment_id} className="rounded-lg border p-3 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{row.student_name}</div>
                        <div className="text-xs text-muted-foreground">Versão {row.version_label} · Cópia {row.copy_index}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusPill status={row.status} score={row.total_score} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border bg-muted/40 p-3">
              <div className="text-sm font-medium">{lookup.student?.name ?? "Aluno(a)"}</div>
              <div className="text-xs text-muted-foreground">
                Versão {lookup.version.version_label} · Cópia {lookup.assignment.copy_index}
              </div>
            </div>

            {bubbleLayout && !omrMode && !result && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium flex items-center gap-2">
                    <Camera className="h-4 w-4 text-primary" /> Leitura óptica disponível
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Use a câmera para detectar automaticamente as alternativas preenchidas COMPLETAMENTE com caneta preta ou azul antes de corrigir.
                  </div>
                </div>
                <Button size="sm" onClick={() => setOmrMode(true)}>
                  <ScanLine className="h-4 w-4 mr-2" /> Escanear gabarito
                </Button>
              </div>
            )}

            {omrMode && bubbleLayout && (
              <div className="rounded-xl border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium flex items-center gap-2">
                    <Camera className="h-4 w-4 text-primary" /> Escaneando folha de respostas
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setOmrMode(false)}>
                    <CameraOff className="h-4 w-4 mr-1" /> Cancelar
                  </Button>
                </div>
                <OMRScannerPane
                  layout={bubbleLayout}
                  onConfirm={handleOMRConfirm}
                  submitting={loading}
                />
              </div>
            )}

            <div className="space-y-3">
              {orderedQuestions.map((q, idx) => {
                const label = `${idx + 1}. (${Number(q.weight).toFixed(2).replace(".", ",")} pt)`;
                const val = answers[q.id];
                const isObjective = q.qtype === "multiple_choice" || q.qtype === "true_false";
                const omrHandlesThis = !!bubbleLayout && isObjective;
                return (
                  <div key={q.id} className="rounded-lg border p-3 space-y-2">
                    <div className="text-sm font-medium">{label} {q.prompt}</div>
                    {omrHandlesThis && !result && (
                      <div className="text-xs text-muted-foreground italic">
                        Marcação detectada automaticamente pela leitura óptica do gabarito.
                        {typeof val === "string" && (
                          <span className="ml-2 font-medium text-foreground">Resposta lida: {val}</span>
                        )}
                      </div>
                    )}
                    {q.qtype === "multiple_choice" && !omrHandlesThis && (
                      <RadioGroup
                        value={typeof val === "string" ? val : ""}
                        onValueChange={(v) => setAnswers((s) => ({ ...s, [q.id]: v }))}
                        className="grid grid-cols-5 gap-2"
                      >
                        {(["A", "B", "C", "D", "E"]).slice(0, q.options?.length ?? 5).map((L) => (
                          <label key={L} className="flex items-center gap-1 text-sm">
                            <RadioGroupItem value={L} id={`${q.id}-${L}`} />
                            <span>{L}</span>
                          </label>
                        ))}
                      </RadioGroup>
                    )}
                    {q.qtype === "true_false" && !omrHandlesThis && (
                      <RadioGroup
                        value={typeof val === "string" ? val : ""}
                        onValueChange={(v) => setAnswers((s) => ({ ...s, [q.id]: v }))}
                        className="flex gap-4"
                      >
                        <label className="flex items-center gap-1 text-sm">
                          <RadioGroupItem value="V" id={`${q.id}-V`} /> Verdadeiro
                        </label>
                        <label className="flex items-center gap-1 text-sm">
                          <RadioGroupItem value="F" id={`${q.id}-F`} /> Falso
                        </label>
                      </RadioGroup>
                    )}
                    {q.qtype === "fill_blank" && (
                      <Input
                        placeholder="Resposta do aluno (use | para múltiplas lacunas)"
                        value={Array.isArray(val) ? val.join(" | ") : (val ?? "")}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const parts = raw.includes("|") ? raw.split("|").map((s) => s.trim()) : raw;
                          setAnswers((s) => ({ ...s, [q.id]: parts }));
                        }}
                      />
                    )}
                    {q.qtype === "essay" && (
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="inline-flex">
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handleCaptureEssayImage(q.id, f);
                                e.target.value = "";
                              }}
                            />
                            <Button asChild size="sm" variant="secondary" disabled={ocrBusyId === q.id}>
                              <span>
                                {ocrBusyId === q.id
                                  ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                  : <Camera className="h-3 w-3 mr-1" />}
                                Fotografar resposta
                              </span>
                            </Button>
                          </label>
                          <label className="inline-flex">
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handleCaptureEssayImage(q.id, f);
                                e.target.value = "";
                              }}
                            />
                            <Button asChild size="sm" variant="ghost" disabled={ocrBusyId === q.id}>
                              <span>
                                <ImagePlus className="h-3 w-3 mr-1" /> Enviar imagem
                              </span>
                            </Button>
                          </label>
                          {essayImages[q.id] && (
                            <button
                              type="button"
                              className="text-xs text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"
                              onClick={() => setEssayImages((s) => { const n = { ...s }; delete n[q.id]; return n; })}
                            >
                              <X className="h-3 w-3" /> remover foto
                            </button>
                          )}
                        </div>
                        {essayImages[q.id] && (
                          <img src={essayImages[q.id]} alt="Foto da resposta" className="max-h-48 rounded border" />
                        )}
                        <div>
                          <Label className="text-xs text-muted-foreground">Texto transcrito (editável)</Label>
                          <Textarea
                            rows={4}
                            placeholder="Use 'Fotografar resposta' para transcrever automaticamente via OCR. Você pode revisar o texto antes de corrigir com a IA."
                            value={essayTexts[q.id] ?? ""}
                            onChange={(e) => setEssayTexts((s) => ({ ...s, [q.id]: e.target.value }))}
                          />
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <Button size="sm" variant="secondary" onClick={() => runEssayAI(q.id)} disabled={aiBusyId === q.id}>
                            {aiBusyId === q.id ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
                            Corrigir com IA
                          </Button>
                          {essayResults[q.id] && (
                            <span className="text-xs font-medium text-primary">
                              {essayResults[q.id].score.toFixed(2)} / {essayResults[q.id].max.toFixed(2)}
                            </span>
                          )}
                        </div>
                        {essayResults[q.id] && (
                          <div className="space-y-1">
                            <Label className="text-xs">Feedback Gerado pela IA</Label>
                            <Textarea
                              rows={5}
                              value={essayFeedbackEdits[q.id] ?? essayResults[q.id].feedback}
                              onChange={(e) => setEssayFeedbackEdits((s) => ({ ...s, [q.id]: e.target.value }))}
                              placeholder="Feedback que será apresentado ao aluno. Você pode editar livremente."
                            />
                            <div className="flex justify-end">
                              <Button size="sm" variant="outline" onClick={() => saveFeedback(q.id)} disabled={savingFbId === q.id}>
                                {savingFbId === q.id ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                                Salvar feedback
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {result?.per_question?.[q.id] && (
                      <div className={`text-xs font-medium ${result.per_question[q.id].correct === true ? "text-green-600" : result.per_question[q.id].correct === false ? "text-destructive" : "text-muted-foreground"}`}>
                        {result.per_question[q.id].correct === null
                          ? "Aguardando correção da dissertativa"
                          : result.per_question[q.id].correct
                            ? `✓ Correta — ${result.per_question[q.id].obtained.toFixed(2)} pt`
                            : `✗ Incorreta — 0,00 / ${result.per_question[q.id].max.toFixed(2)} pt`}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div>
              <Label>Comentário do(a) professor(a) (opcional)</Label>
              <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
            </div>

            {result && (
              <div className="rounded-xl bg-primary/10 border border-primary/30 p-4 flex items-center gap-3">
                <CheckCircle2 className="h-6 w-6 text-primary" />
                <div>
                  <div className="text-sm">Nota objetiva apurada</div>
                  <div className="text-2xl font-bold">{result.total_score.toFixed(2)} <span className="text-sm font-normal text-muted-foreground">/ {result.max_score.toFixed(2)}</span></div>
                  {result.pending_essay && (
                    <div className="text-xs text-muted-foreground mt-1">Existem dissertativas pendentes; a nota final será composta após a Entrega 4.</div>
                  )}
                </div>
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={reset} disabled={loading}>
                <RotateCcw className="h-4 w-4 mr-2" /> Próxima folha
              </Button>
              {(!bubbleLayout || result) && (
                <Button onClick={submitGrade} disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                  Corrigir objetivas
                </Button>
              )}
              {posted ? (
                <Button disabled variant="default" className="bg-blue-600 text-white hover:bg-blue-600">
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Nota Lançada
                </Button>
              ) : (
                <Button onClick={postToDiary} disabled={posting || !result} variant="default">
                  {posting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                  Lançar no diário
                </Button>
              )}
            </DialogFooter>
          </div>
        )}

        {releaseModal && lookup && (
          <ModalLancamentoNotaDiario
            open={releaseModal.open}
            onClose={() => setReleaseModal(null)}
            disciplineId={disciplineId ?? ""}
            defaultColumnId={diaryAssessmentId ?? null}
            studentId={lookup.student?.id || ""}
            studentName={lookup.student?.name || ""}
            obtainedScore={releaseModal.score}
            maxScore={result?.max_score || 10}
            activityRef={{
              id: lookup.assignment.id,
              type: "assessment",
              title: assessmentTitle
            }}
            onSuccess={handleGradeReleased}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${active ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}

function StatusPill({ status, score }: { status: string; score: number | null }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "Pendente", cls: "bg-muted text-muted-foreground" },
    graded_objective: { label: `Objetivas: ${score?.toFixed(2) ?? "—"}`, cls: "bg-green-500/15 text-green-700" },
    awaiting_review: { label: `Aguarda dissertativa (${score?.toFixed(2) ?? "—"})`, cls: "bg-amber-500/15 text-amber-700" },
    confirmed: { label: `Confirmada (${score?.toFixed(2) ?? "—"})`, cls: "bg-blue-500/15 text-blue-700" },
    posted: { label: `Lançada (${score?.toFixed(2) ?? "—"})`, cls: "bg-primary/15 text-primary" },
  };
  const m = map[status] ?? map.pending;
  return <span className={`px-2 py-1 rounded-full text-xs font-medium ${m.cls}`}>{m.label}</span>;
}

/* --------- Scanner pane (BarcodeDetector + camera; manual fallback) ---------- */
function ScannerPane({ onToken, loading }: { onToken: (t: string) => void; loading: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<unknown>(null);
  const rafRef = useRef<number | null>(null);
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);
  const lastTokenRef = useRef<string>("");

  const stop = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setActive(false);
  };

  const start = async () => {
    try {
      const BD = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => { detect: (src: CanvasImageSource) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
      if (!BD) { setSupported(false); return; }
      const detector = new BD({ formats: ["qr_code"] });
      detectorRef.current = detector;
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setActive(true);
      setSupported(true);
      const tick = async () => {
        if (!videoRef.current || !detectorRef.current) return;
        try {
          const res = await (detectorRef.current as { detect: (s: CanvasImageSource) => Promise<Array<{ rawValue: string }>> }).detect(videoRef.current);
          if (res?.length) {
            const code = res[0].rawValue;
            if (code && code !== lastTokenRef.current) {
              lastTokenRef.current = code;
              stop();
              onToken(code);
              return;
            }
          }
        } catch { /* ignore */ }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      setSupported(false);
      toast.error("Não foi possível acessar a câmera. Use a aba 'Token manual'.");
      console.error(e);
    }
  };

  useEffect(() => () => stop(), []);

  return (
    <div className="space-y-3">
      <div className="aspect-video bg-black/90 rounded-xl overflow-hidden relative">
        <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
        {!active && (
          <div className="absolute inset-0 flex items-center justify-center text-white/80 text-sm">
            <Camera className="h-6 w-6 mr-2" /> Câmera desligada
          </div>
        )}
      </div>
      <div className="flex gap-2 justify-center">
        {!active ? (
          <Button onClick={start} disabled={loading}>
            <Camera className="h-4 w-4 mr-2" /> Iniciar câmera
          </Button>
        ) : (
          <Button variant="outline" onClick={stop}>
            <CameraOff className="h-4 w-4 mr-2" /> Parar
          </Button>
        )}
      </div>
      {supported === false && (
        <div className="text-xs text-muted-foreground text-center">
          Seu navegador não tem suporte nativo a leitor de QR. Use a aba <strong>Token manual</strong>.
        </div>
      )}
    </div>
  );
}