import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Download,
  Sparkles,
  ShieldAlert,
  Library,
  BookOpen,
  FileCheck2,
  Send,
  ArrowLeft,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import {
  analyzeAIUsage,
  deleteSubmission,
  generateFeedbackDraft,
  getSubmissionDownloadUrl,
  listDiaryAssessments,
  listSubmissions,
  publishCorrection,
  saveCorrection,
  extractSubmissionText,
  suggestRubricScores,
  exportFeedbackPDF,
} from "@/backend/submissions.functions";
import { RubricLibraryDialog, type RubricSelection } from "./RubricLibraryDialog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { extractDiaryAssessmentOptions } from "@/lib/diary-assessments";

type Kind = "activity" | "work";
export type SubmissionReviewCriterion = { id: string; name: string; description?: string; weight: number; max_score: number };
type Crit = SubmissionReviewCriterion;
type RubricScore = { id: string; score: number; comment?: string };

export interface SubmissionReviewRow {
  id: string;
  student_id: string;
  student_name: string;
  enrollment_number: string | null;
  parent_id: string;
  parent_title: string;
  file_url: string;
  status: string;
  submitted_at: string;
  released_at: string | null;
  total_score: number | null;
  final_score: number | null;
  final_feedback: string | null;
  ai_feedback_draft: string | null;
  ai_usage_report: {
    score?: number;
    level?: string;
    indicators?: string[];
    summary?: string;
    content_summary?: string;
    key_points?: string[];
    evidence?: string[];
  } | null;
  rubric_snapshot: Crit[] | null;
  rubric_scores: RubricScore[] | null;
  diary_assessment_id: string | null;
  parent_diary_assessment_id: string | null;
}

type SubmissionRow = SubmissionReviewRow;

export interface ClinicalReviewAdapter {
  submissionText: string;
  onSuggest: () => Promise<{
    feedback: string;
    score: number;
    rubricScores: Array<{ id: string; name: string; max_score: number; score: number; comment?: string }>;
  }>;
  onPublish: (values: {
    score: number;
    feedback: string;
    diaryAssessmentId: string;
    rubricScores: RubricScore[];
  }) => Promise<void>;
  onDownloadSource: () => void;
  onDownloadFeedback: (values: { score: number; feedback: string }) => void;
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  submitted: { label: "Pendente", cls: "bg-blue-100 text-blue-700" },
  corrected: { label: "Em correção", cls: "bg-amber-100 text-amber-700" },
  released: { label: "Publicada", cls: "bg-green-100 text-green-700" },
  ai_corrected: { label: "Corrigida (IA)", cls: "bg-purple-100 text-purple-700" },
};

export function SubmissionsReviewPanel({
  disciplineId,
  kind,
   open,
   onClose,
   activityId,
   defaultRubric,
 }: {
   disciplineId: string;
   kind: Kind;
   open: boolean;
   onClose: () => void;
   activityId?: string;
   defaultRubric: Crit[];
 }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<SubmissionRow[]>([]);
  const [reviewing, setReviewing] = useState<SubmissionRow | null>(null);
  const [resetting, setResetting] = useState<SubmissionRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listSubmissions({ data: { discipline_id: disciplineId, kind, activity_id: activityId } });
      setItems(res.submissions as unknown as SubmissionRow[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao listar entregas");
    } finally {
      setLoading(false);
    }
  }, [disciplineId, kind]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Entregas — {kind === "activity" ? "Atividades Extras" : "Trabalhos Acadêmicos"}
            </DialogTitle>
            <DialogDescription>
              Baixe o arquivo do aluno, analise o uso de IA, aplique a rubrica, gere o feedback e
              publique a nota no diário.
            </DialogDescription>
          </DialogHeader>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Ainda não há entregas para este módulo.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase">
                  <tr>
                    <th className="text-left px-3 py-2">Aluno</th>
                    <th className="text-left px-3 py-2">
                      {kind === "activity" ? "Atividade" : "Trabalho"}
                    </th>
                    <th className="text-left px-3 py-2">Enviado em</th>
                    <th className="text-center px-3 py-2">Status</th>
                    <th className="text-center px-3 py-2">Nota</th>
                    <th className="text-right px-3 py-2">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((s) => {
                    const st = STATUS_LABELS[s.status] ?? {
                      label: s.status,
                      cls: "bg-muted",
                    };
                    return (
                      <tr key={s.id} className="border-t">
                        <td className="px-3 py-2">
                          <div>{s.student_name}</div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {s.enrollment_number ?? "—"}
                          </div>
                        </td>
                        <td className="px-3 py-2">{s.parent_title}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {new Date(s.submitted_at).toLocaleString("pt-BR")}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`text-[10px] px-2 py-0.5 rounded ${st.cls}`}>
                            {st.label}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center font-semibold">
                          {s.final_score ?? s.total_score ?? "—"}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <DownloadButton submissionId={s.id} kind={kind} />
                            <Button size="sm" onClick={() => setReviewing(s)}>
                              {s.status === "released" ? "Ver" : "Corrigir"}
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => setResetting(s)}
                            >
                              🔄 Permitir Reenvio
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {resetting && (
        <Dialog open onOpenChange={(o) => !o && setResetting(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Permitir Reenvio</DialogTitle>
              <DialogDescription>
                Tem certeza que deseja apagar a submissão de <strong>{resetting.student_name}</strong>?
                Isso removerá o arquivo atual e as notas, permitindo que o aluno faça um novo envio.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setResetting(null)}>
                Cancelar
              </Button>
              <Button 
                variant="destructive"
                onClick={async () => {
                  try {
                    await deleteSubmission({ data: { submission_id: resetting.id, kind } });
                    toast.success("Submissão removida. O aluno pode reenviar o trabalho.");
                    load();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Erro ao remover submissão");
                  } finally {
                    setResetting(null);
                  }
                }}
              >
                Sim, permitir reenvio
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {reviewing && (
        <CorrectionDialog
          submission={reviewing}
          disciplineId={disciplineId}
          kind={kind}
          defaultRubric={defaultRubric}
          onClose={() => setReviewing(null)}
          onChanged={() => {
            setReviewing(null);
            load();
          }}
        />
      )}
    </>
  );
}

function DownloadButton({ submissionId, kind }: { submissionId: string; kind: Kind }) {
  const [loading, setLoading] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={loading}
      onClick={async () => {
        try {
          setLoading(true);
          const { url } = await getSubmissionDownloadUrl({
            data: { submission_id: submissionId, kind },
          });
          window.open(url, "_blank", "noopener,noreferrer");
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Erro ao baixar");
        } finally {
          setLoading(false);
        }
      }}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Download className="h-3.5 w-3.5" />
      )}
      <span className="ml-1">Baixar PDF</span>
    </Button>
  );
}

/* ---------- Correction dialog (multi-step) ---------- */

export function CorrectionDialog({
  submission,
  disciplineId,
  kind,
  defaultRubric,
  onClose,
  onChanged,
  clinicalAdapter,
}: {
  submission: SubmissionRow;
  disciplineId: string;
  kind: Kind;
  defaultRubric: Crit[];
  onClose: () => void;
  onChanged: () => void;
  clinicalAdapter?: ClinicalReviewAdapter;
}) {
  const { profile } = useAuth();
  const teacherName = profile?.name ?? "Professor(a)";
  const [step, setStep] = useState<"ai" | "rubric" | "feedback" | "score" | "review">("ai");
  const [submissionText, setSubmissionText] = useState(clinicalAdapter?.submissionText ?? "");
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [aiReport, setAiReport] = useState<SubmissionRow["ai_usage_report"]>(
    submission.ai_usage_report ?? null,
  );
  // SimulSaúde: o resultado da IA fica em cache e é liberado etapa por etapa
  // (rubrica → feedback), nunca preenchendo a correção inteira de uma vez.
  const clinicalResultRef = useRef<Awaited<ReturnType<ClinicalReviewAdapter["onSuggest"]>> | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [rubric, setRubric] = useState<Crit[]>(
    submission.rubric_snapshot && submission.rubric_snapshot.length
      ? submission.rubric_snapshot
      : defaultRubric,
  );
  const [scores, setScores] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    (submission.rubric_scores ?? []).forEach((s) => {
      m[s.id] = s.score;
    });
    return m;
  });
  const [comments, setComments] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    (submission.rubric_scores ?? []).forEach((s) => {
      if (s.comment) m[s.id] = s.comment;
    });
    return m;
  });
  const [finalScore, setFinalScore] = useState<string>(
    submission.final_score != null ? String(submission.final_score) : "",
  );
  const [feedback, setFeedback] = useState<string>(
    submission.final_feedback ?? submission.ai_feedback_draft ?? "",
  );
  const [generating, setGenerating] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [aiFilledIds, setAiFilledIds] = useState<Set<string>>(new Set());
  const [diaryAssessments, setDiaryAssessments] = useState<
    Array<{ id: string; name: string; max_score: number }>
  >([]);
  const configuredDiaryAssessmentId =
    submission.parent_diary_assessment_id ?? submission.diary_assessment_id ?? "";
  const [diaryAssessmentId, setDiaryAssessmentId] = useState<string>(
    configuredDiaryAssessmentId,
  );
  const isReadonly = submission.status === "released";

  const rubricFilled = rubric.length > 0 && rubric.every((c) => {
    const sc = scores[c.id];
    return sc != null && !Number.isNaN(sc);
  });
  const feedbackReady = feedback.trim().length > 0;
  const scoreReady = (() => {
    const n = Number(finalScore);
    return finalScore !== "" && !Number.isNaN(n) && n >= 0;
  })();

  const canGoTo = (target: typeof step): boolean => {
    if (isReadonly) return true;
    if (target === "ai") return true;
    if (target === "rubric") return !!aiReport;
    if (target === "feedback") return !!aiReport && rubricFilled;
    if (target === "score") return !!aiReport && rubricFilled && feedbackReady;
    if (target === "review")
      return !!aiReport && rubricFilled && feedbackReady && scoreReady;
    return false;
  };

  const tryGoTo = (target: typeof step) => {
    if (!canGoTo(target)) {
      if (target === "rubric") toast.error("Conclua a análise de uso de IA (passo 1) primeiro.");
      else if (target === "feedback") toast.error("Preencha as notas de todos os critérios da rubrica antes de avançar.");
      else if (target === "score") toast.error("Gere ou escreva o feedback antes de avançar.");
      else if (target === "review") toast.error("Defina a nota final antes de revisar e publicar.");
      return;
    }
    setStep(target);
  };

  const handleSuggestWithRetry = async () => {
    try {
      await suggestRubric();
    } catch (e: any) {
      if (e.message?.includes("TIMEOUT") || e.message?.includes("Falha na IA")) {
        toast.error(
          <div className="flex flex-col gap-2">
            <span>Falha no processamento da IA ou tempo limite excedido.</span>
            <Button size="sm" variant="outline" onClick={handleSuggestWithRetry}>
              Tentar Analisar Novamente
            </Button>
          </div>,
          { duration: 10000 }
        );
      } else {
        toast.error(e instanceof Error ? e.message : "Erro ao sugerir notas");
      }
    }
  };

  useEffect(() => {
    listDiaryAssessments({ data: { discipline_id: disciplineId } })
      .then((res) => {
        const flat = extractDiaryAssessmentOptions(res);
        setDiaryAssessments(flat);
        setDiaryAssessmentId((current) => {
          const selected = current || configuredDiaryAssessmentId;
          if (selected && flat.some((option) => option.id === selected)) return selected;
          if (
            configuredDiaryAssessmentId &&
            flat.some((option) => option.id === configuredDiaryAssessmentId)
          ) {
            return configuredDiaryAssessmentId;
          }
          return "";
        });
      })
      .catch(() => setDiaryAssessments([]));
  }, [disciplineId, configuredDiaryAssessmentId]);

  // Nota final = soma das pontuações normalizadas (0–10) de cada critério
  // dividida pela quantidade de critérios (média aritmética simples).
  const computeWeighted = () => {
    const count = rubric.length;
    if (!count) return 0;
    const sum = rubric.reduce((acc, c) => {
      const sc = scores[c.id];
      if (sc == null || Number.isNaN(sc)) return acc;
      const normalized = (Number(sc) / (c.max_score || 10)) * 10;
      return acc + normalized;
    }, 0);
    return Number((sum / count).toFixed(2));
  };

  // Contribuição de cada critério para a nota final = nota normalizada / nº de critérios.
  const criterionContribution = (c: Crit) => {
    const count = rubric.length;
    const sc = scores[c.id];
    if (sc == null || Number.isNaN(sc) || !count) return 0;
    const normalized = (Number(sc) / (c.max_score || 10)) * 10;
    return Number((normalized / count).toFixed(2));
  };

  const suggestRubric = useCallback(
    async (onlyIds?: string[]) => {
      let text = submissionText.trim();
      if (!text) {
        try {
          setExtracting(true);
          const { text: extracted } = await extractSubmissionText({
            data: { submission_id: submission.id, kind },
          });
          text = (extracted ?? "").trim();
          if (!text) {
            toast.error("Não foi possível extrair texto do arquivo enviado.");
            return;
          }
          setSubmissionText(text);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Erro ao extrair texto do arquivo.");
          return;
        } finally {
          setExtracting(false);
        }
      }
      try {
        setSuggesting(true);
        if (clinicalAdapter) {
          const result = clinicalResultRef.current ?? (await clinicalAdapter.onSuggest());
          clinicalResultRef.current = result;
          const target = new Set(onlyIds ?? rubric.map((c) => c.id));
          setScores((prev) => {
            const next = { ...prev };
            result.rubricScores.forEach((item) => {
              if (target.has(item.id)) next[item.id] = item.score;
            });
            return next;
          });
          setComments((prev) => {
            const next = { ...prev };
            result.rubricScores.forEach((item) => {
              if (target.has(item.id)) next[item.id] = item.comment ?? "";
            });
            return next;
          });
          setAiFilledIds((prev) => new Set([...prev, ...result.rubricScores.filter((item) => target.has(item.id)).map((item) => item.id)]));
          return;
        }
        const res = await suggestRubricScores({
          data: {
            submission_id: submission.id,
            kind,
            submission_text: text,
            rubric,
          },
        });
        const target = new Set(onlyIds ?? rubric.map((c) => c.id));
        setScores((prev) => {
          const next = { ...prev };
          res.scores.forEach((s) => {
            if (target.has(s.id)) next[s.id] = s.score;
          });
          return next;
        });
        setComments((prev) => {
          const next = { ...prev };
          res.scores.forEach((s) => {
            if (target.has(s.id) && s.comment) next[s.id] = s.comment;
          });
          return next;
        });
        setAiFilledIds((prev) => {
          const next = new Set(prev);
          res.scores.forEach((s) => {
            if (target.has(s.id)) next.add(s.id);
          });
          return next;
        });
      } catch (e: any) {
        if (e.message?.includes("TIMEOUT") || e.message?.includes("Falha na IA")) {
          toast.error(
            <div className="flex flex-col gap-2">
              <span>Falha no processamento da IA ou tempo limite excedido.</span>
              <Button size="sm" variant="outline" onClick={handleSuggestWithRetry}>
                Tentar Analisar Novamente
              </Button>
            </div>,
            { duration: 10000 }
          );
        } else {
          toast.error(e instanceof Error ? e.message : "Erro ao sugerir notas");
        }
      } finally {
        setSuggesting(false);
      }
    },
    [submission.id, kind, submissionText, rubric, clinicalAdapter],
  );

  const runAnalysis = useCallback(
    async (textOverride?: string) => {
      const text = (textOverride ?? submissionText).trim();
      if (!text) {
        toast.error("Texto do arquivo indisponível para análise.");
        return;
      }
      try {
        setAnalyzing(true);
        if (clinicalAdapter) {
          const result = await clinicalAdapter.onSuggest();
          clinicalResultRef.current = result;
          setAiReport({
            score: 0,
            level: "baixo",
            indicators: [],
            summary: "Avaliação clínica gerada para revisão do professor.",
            content_summary: text,
            key_points: result.rubricScores.map((item) => item.name),
            evidence: [],
          });
          return;
        }
        const r = await analyzeAIUsage({
          data: { submission_id: submission.id, kind, submission_text: text },
        });
        setAiReport(r);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro na análise");
      } finally {
        setAnalyzing(false);
      }
    },
    [submissionText, submission.id, kind, clinicalAdapter],
  );

  const handleAnalysisWithRetry = async (textOverride?: string) => {
    try {
      await runAnalysis(textOverride);
    } catch (e: any) {
      if (e.message?.includes("TIMEOUT") || e.message?.includes("Falha na IA")) {
        toast.error(
          <div className="flex flex-col gap-2">
            <span>Falha na análise da IA ou tempo limite excedido.</span>
            <Button size="sm" variant="outline" onClick={() => handleAnalysisWithRetry(textOverride)}>
              Tentar Analisar Novamente
            </Button>
          </div>,
          { duration: 10000 }
        );
      } else {
        toast.error(e instanceof Error ? e.message : "Erro na análise");
      }
    }
  };

  // Auto-extract text from the uploaded file and auto-run AI analysis on open.
  useEffect(() => {
    if (isReadonly) return;
    if (aiReport) return;
    if (clinicalAdapter && submissionText.trim() && !analyzing) {
      handleAnalysisWithRetry(submissionText);
      return;
    }
    if (submissionText || extracting) return;
    let cancelled = false;
    (async () => {
      try {
        setExtracting(true);
        setExtractError(null);
        const { text } = await extractSubmissionText({
          data: { submission_id: submission.id, kind },
        });
        if (cancelled) return;
        const cleaned = (text ?? "").trim();
        if (!cleaned) {
          setExtractError("Não foi possível extrair texto do arquivo enviado.");
          return;
        }
        setSubmissionText(cleaned);
        await handleAnalysisWithRetry(cleaned);
      } catch (e: any) {
        if (!cancelled) {
          setExtractError(e instanceof Error ? e.message : "Falha ao ler arquivo");
        }
      } finally {
        if (!cancelled) setExtracting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [submission.id, kind, isReadonly]);

  // Auto-suggest rubric scores when entering step 2 (if no scores yet).
  useEffect(() => {
    if (isReadonly) return;
    if (step !== "rubric") return;
    if (!aiReport || !submissionText.trim()) return;
    if (suggesting) return;
    const anyFilled = rubric.some((c) => scores[c.id] != null && !Number.isNaN(scores[c.id]));
    if (anyFilled) return;
    suggestRubric();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, aiReport, submissionText]);

  // When entering step 4, default the final score to the rubric weighted average.
  useEffect(() => {
    if (isReadonly) return;
    if (step !== "score") return;
    if (finalScore !== "") return;
    const v = computeWeighted();
    if (v > 0) setFinalScore(String(v));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const generate = async () => {
    if (!submissionText.trim()) {
      toast.error("Cole o texto do trabalho do aluno (passo 1) para gerar o feedback.");
      return;
    }
    try {
      setGenerating(true);
      if (clinicalAdapter) {
        const result = clinicalResultRef.current ?? (await clinicalAdapter.onSuggest());
        clinicalResultRef.current = result;
        setFeedback(result.feedback);
        toast.success("Feedback gerado — revise e edite à vontade");
        return;
      }
      const r = await generateFeedbackDraft({
        data: {
          submission_id: submission.id,
          kind,
          submission_text: submissionText,
          rubric,
          rubric_scores: Object.entries(scores).map(([id, score]) => ({
            id,
            score,
            comment: comments[id],
          })),
          final_score: Number(finalScore || computeWeighted()),
        },
      });
      setFeedback(r.feedback);
      toast.success("Feedback gerado — revise e edite à vontade");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar feedback");
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateWithRetry = async () => {
    try {
      await generate();
    } catch (e: any) {
      if (e.message?.includes("TIMEOUT") || e.message?.includes("Falha na IA")) {
        toast.error(
          <div className="flex flex-col gap-2">
            <span>Falha ao gerar feedback da IA ou tempo limite excedido.</span>
            <Button size="sm" variant="outline" onClick={handleGenerateWithRetry}>
              Tentar Analisar Novamente
            </Button>
          </div>,
          { duration: 10000 }
        );
      } else {
        toast.error(e instanceof Error ? e.message : "Erro ao gerar feedback");
      }
    }
  };

  const handleSave = async () => {
    const score = Number(finalScore || computeWeighted());
    if (!feedback.trim()) {
      toast.error("Escreva ou gere o feedback antes de salvar.");
      return;
    }
    try {
      setSaving(true);
      if (clinicalAdapter) {
        toast.success("Correção mantida para revisão antes da publicação");
        return true;
      }
      await saveCorrection({
        data: {
          submission_id: submission.id,
          kind,
          rubric_snapshot: rubric,
          rubric_scores: Object.entries(scores).map(([id, sc]) => ({
            id,
            score: sc,
            comment: comments[id],
          })),
          final_score: score,
          final_feedback: signedFeedback(),
        },
      });
      toast.success("Correção salva (rascunho)");
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const signedFeedback = () => {
    const sig = `\n\n— ${teacherName}`;
    return feedback.trim().endsWith(teacherName) ? feedback : `${feedback}${sig}`;
  };

  const handlePublish = async () => {
    if (!diaryAssessmentId) {
      toast.error("Selecione o campo do diário onde a nota será lançada.");
      return;
    }
    const ok = await handleSave();
    if (!ok) return;
    try {
      setPublishing(true);
      if (clinicalAdapter) {
        await clinicalAdapter.onPublish({
          score: Number(finalScore || computeWeighted()),
          feedback: signedFeedback(),
          diaryAssessmentId,
          rubricScores: Object.entries(scores).map(([id, score]) => ({ id, score, comment: comments[id] })),
        });
        toast.success("Publicado no diário — aluno notificado");
        onChanged();
        return;
      }
      await publishCorrection({
        data: {
          submission_id: submission.id,
          kind,
          diary_assessment_id: diaryAssessmentId,
        },
      });
      toast.success("Publicado no diário — aluno notificado");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao publicar");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Corrigir — {submission.student_name}
              <span className="block text-sm font-normal text-muted-foreground">
                {submission.parent_title}
              </span>
            </DialogTitle>
          </DialogHeader>

          <div className="mb-3 flex gap-2">
            {clinicalAdapter ? (
              <Button size="sm" variant="outline" onClick={clinicalAdapter.onDownloadSource}>
                <Download className="h-3.5 w-3.5" />
                <span className="ml-1">Baixar PDF</span>
              </Button>
            ) : (
              <DownloadButton submissionId={submission.id} kind={kind} />
            )}
          </div>

          <Tabs value={step} onValueChange={(v) => tryGoTo(v as typeof step)}>
            <TabsList className="grid grid-cols-5 w-full">
              <TabsTrigger value="ai">1. IA</TabsTrigger>
              <TabsTrigger value="rubric" disabled={!canGoTo("rubric")}>2. Rubrica</TabsTrigger>
              <TabsTrigger value="feedback" disabled={!canGoTo("feedback")}>3. Feedback</TabsTrigger>
              <TabsTrigger value="score" disabled={!canGoTo("score")}>4. Nota</TabsTrigger>
              <TabsTrigger value="review" disabled={!canGoTo("review")}>5. Revisão</TabsTrigger>
            </TabsList>

            {/* STEP 1 — AI */}
            <TabsContent value="ai" className="space-y-3 mt-3">
              <div className="rounded-lg border bg-muted/30 p-3 text-xs flex items-start gap-2">
                <ShieldAlert className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
                <p>
                  A análise de uso de IA é <strong>informativa</strong> e não bloqueia, reprova ou
                  penaliza o aluno. O uso de IA como apoio é legítimo — só são sinalizados indícios
                  de cópia integral sem elaboração própria. A decisão final é sempre sua.
                </p>
              </div>
              {(extracting || analyzing) && !aiReport && (
                <div className="rounded-lg border bg-muted/20 p-4 flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <p className="text-sm">
                    {extracting
                      ? "Extraindo o conteúdo do arquivo enviado pelo aluno…"
                      : "Analisando o conteúdo automaticamente…"}
                  </p>
                </div>
              )}
              {extractError && !aiReport && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm space-y-2">
                  <p className="text-destructive">{extractError}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      setExtractError(null);
                      try {
                        setExtracting(true);
                        const { text } = await extractSubmissionText({
                          data: { submission_id: submission.id, kind },
                        });
                        const cleaned = (text ?? "").trim();
                        if (!cleaned) {
                          setExtractError("Arquivo sem texto extraível.");
                          return;
                        }
                        setSubmissionText(cleaned);
                        await runAnalysis(cleaned);
                      } catch (e) {
                        setExtractError(e instanceof Error ? e.message : "Erro ao extrair.");
                      } finally {
                        setExtracting(false);
                      }
                    }}
                  >
                    <Sparkles className="h-3.5 w-3.5 mr-1" /> Tentar novamente
                  </Button>
                </div>
              )}
              {aiReport && (
                <div className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xs uppercase text-muted-foreground">Nível:</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        aiReport.level === "alto"
                          ? "bg-red-100 text-red-700"
                          : aiReport.level === "medio"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-green-100 text-green-700"
                      }`}
                    >
                      {aiReport.level}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Score estimado: {aiReport.score}/100
                    </span>
                  </div>
                  {aiReport.summary && <p className="text-sm">{aiReport.summary}</p>}
                  {aiReport.indicators && aiReport.indicators.length > 0 && (
                    <ul className="text-xs list-disc pl-5 text-muted-foreground">
                      {aiReport.indicators.map((i, idx) => (
                        <li key={idx}>{i}</li>
                      ))}
                    </ul>
                  )}
                  {aiReport.evidence && aiReport.evidence.length > 0 && (
                    <div>
                      <div className="text-xs uppercase text-muted-foreground mt-2">Evidências</div>
                      <ul className="text-xs list-disc pl-5 text-muted-foreground">
                        {aiReport.evidence.map((i, idx) => (
                          <li key={idx}>{i}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {aiReport.content_summary && (
                    <div className="mt-2 rounded-md bg-background border p-2">
                      <div className="text-xs uppercase text-muted-foreground">Resumo do conteúdo do aluno</div>
                      <p className="text-sm mt-1">{aiReport.content_summary}</p>
                      {aiReport.key_points && aiReport.key_points.length > 0 && (
                        <>
                          <div className="text-xs uppercase text-muted-foreground mt-2">Principais pontos</div>
                          <ul className="text-sm list-disc pl-5">
                            {aiReport.key_points.map((p, idx) => (
                              <li key={idx}>{p}</li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  )}
                  {!isReadonly && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleAnalysisWithRetry()}
                      disabled={analyzing || !submissionText}
                    >
                      {analyzing ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5 mr-1" />
                      )}
                      Reanalisar
                    </Button>
                  )}
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  onClick={() => tryGoTo("rubric")}
                  disabled={!canGoTo("rubric")}
                >
                  Próximo: Rubrica →
                </Button>
              </div>
            </TabsContent>

            {/* STEP 2 — Rubric */}
            <TabsContent value="rubric" className="space-y-3 mt-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Notas e comentários são sugeridos pela IA com base no conteúdo do trabalho — edite à vontade.
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleSuggestWithRetry()}
                    disabled={suggesting || extracting || isReadonly || rubric.length === 0}
                  >
                    {suggesting ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5 mr-1" />
                    )}
                    Avaliar com IA
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowLibrary(true)}>
                    <Library className="h-3.5 w-3.5 mr-1" /> Biblioteca
                  </Button>
                </div>
              </div>
              {suggesting && (
                <div className="rounded-md border bg-muted/30 p-2 flex items-center gap-2 text-xs">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  A IA está avaliando o trabalho e preenchendo cada critério…
                </div>
              )}
              <div className="space-y-2">
                {rubric.map((c) => (
                  <div key={c.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">
                        {c.name}{" "}
                        <span className="text-xs text-muted-foreground">
                          (peso {c.weight}%, máx {c.max_score})
                        </span>
                      </div>
                      <Input
                        type="number"
                        min={0}
                        max={c.max_score}
                        step={0.1}
                        className="w-24"
                        value={scores[c.id] ?? ""}
                        onChange={(e) => {
                          setScores((p) => ({ ...p, [c.id]: Number(e.target.value) }));
                          setAiFilledIds((p) => {
                            const n = new Set(p);
                            n.delete(c.id);
                            return n;
                          });
                        }}
                        disabled={isReadonly}
                      />
                    </div>
                    {c.description && (
                      <p className="text-xs text-muted-foreground">{c.description}</p>
                    )}
                    <Textarea
                      rows={2}
                      placeholder="Comentário do critério (opcional)"
                      value={comments[c.id] ?? ""}
                      onChange={(e) => {
                        setComments((p) => ({ ...p, [c.id]: e.target.value }));
                      }}
                      disabled={isReadonly}
                    />
                    <div className="flex items-center justify-between">
                      {aiFilledIds.has(c.id) ? (
                        <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <Sparkles className="h-3 w-3 text-primary" />
                          Preenchido automaticamente pela IA. Você pode editar livremente.
                        </span>
                      ) : <span />}
                      {!isReadonly && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => suggestRubric([c.id])}
                          disabled={suggesting || extracting}
                        >
                          <Sparkles className="h-3 w-3 mr-1" /> Sugerir este
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <div>
                  Média simples calculada: <strong>{computeWeighted()}</strong> / 10
                </div>
                <div>
                  Fórmula: soma das notas dos critérios (normalizadas para 0–10) dividida pela
                  quantidade de critérios ({rubric.length}).
                </div>
              </div>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep("ai")}>
                  <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
                </Button>
                <Button
                  variant="outline"
                  onClick={() => tryGoTo("feedback")}
                  disabled={!canGoTo("feedback")}
                >
                  Próximo: Feedback →
                </Button>
              </div>
            </TabsContent>

            {/* STEP 3 — Feedback */}
            <TabsContent value="feedback" className="space-y-3 mt-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Gere um rascunho com IA (baseado na rubrica + análise) e edite livremente.
                </p>
                <Button size="sm" onClick={handleGenerateWithRetry} disabled={generating || isReadonly}>
                  {generating ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  Gerar com IA
                </Button>
              </div>
              <Textarea
                rows={14}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Escreva ou gere o feedback. Ao publicar, será assinado automaticamente com seu nome."
                disabled={isReadonly}
              />
              {feedback.trim() && (
                <div className="space-y-1">
                  <div className="text-xs uppercase text-muted-foreground">Pré-visualização</div>
                  <div className="prose prose-sm dark:prose-invert max-w-none border rounded p-3 bg-background">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{feedback}</ReactMarkdown>
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Assinatura: <strong>{teacherName}</strong>
              </p>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep("rubric")}>
                  <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
                </Button>
                <Button
                  variant="outline"
                  onClick={() => tryGoTo("score")}
                  disabled={!canGoTo("score")}
                >
                  Próximo: Nota →
                </Button>
              </div>
            </TabsContent>

            {/* STEP 4 — Score */}
            <TabsContent value="score" className="space-y-3 mt-3">
              <div className="rounded-lg border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase">
                    <tr>
                      <th className="text-left px-3 py-2">Critério</th>
                      <th className="text-center px-3 py-2">Nota</th>
                      <th className="text-center px-3 py-2">Máx</th>
                      <th className="text-center px-3 py-2">Peso</th>
                      <th className="text-right px-3 py-2">Contribuição (/10)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rubric.map((c) => (
                      <tr key={c.id} className="border-t">
                        <td className="px-3 py-2">{c.name}</td>
                        <td className="px-3 py-2 text-center">{scores[c.id] ?? "—"}</td>
                        <td className="px-3 py-2 text-center">{c.max_score}</td>
                        <td className="px-3 py-2 text-center">{c.weight}%</td>
                        <td className="px-3 py-2 text-right font-medium">
                          {criterionContribution(c)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t bg-muted/30">
                      <td className="px-3 py-2 font-semibold" colSpan={4}>
                        Nota calculada pela rubrica
                      </td>
                      <td className="px-3 py-2 text-right font-bold">{computeWeighted()} / 10</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div>
                <Label>Nota final (0–10) — editável</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    step={0.1}
                    value={finalScore}
                    onChange={(e) => setFinalScore(e.target.value)}
                    className="w-32"
                    disabled={isReadonly}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setFinalScore(String(computeWeighted()))}
                    disabled={isReadonly}
                  >
                    Usar média da rubrica ({computeWeighted()})
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  A nota é calculada automaticamente pela soma ponderada da rubrica. Você pode
                  ajustá-la manualmente se necessário.
                </p>
              </div>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep("feedback")}>
                  <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
                </Button>
                <Button
                  variant="outline"
                  onClick={() => tryGoTo("review")}
                  disabled={!canGoTo("review")}
                >
                  Próximo: Revisão →
                </Button>
              </div>
            </TabsContent>

            {/* STEP 5 — Review & Publish */}
            <TabsContent value="review" className="space-y-3 mt-3">
              <div className="rounded-lg border p-3 space-y-3 bg-muted/20">
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Análise de uso de IA</div>
                  {aiReport ? (
                    <p className="text-sm">
                      Nível <strong>{aiReport.level}</strong> ({aiReport.score}/100) —{" "}
                      {aiReport.summary}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Não realizada.</p>
                  )}
                </div>
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Rubrica aplicada</div>
                  <ul className="text-sm space-y-2 mt-1">
                    {rubric.map((c) => (
                      <li key={c.id} className="border rounded p-2 bg-background">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{c.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {scores[c.id] ?? "—"} / {c.max_score} · peso {c.weight}%
                          </span>
                        </div>
                        {comments[c.id] && (
                          <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
                            {comments[c.id]}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Nota final</div>
                  <p className="text-lg font-semibold">
                    {finalScore || computeWeighted()} / 10
                  </p>
                </div>
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Feedback (assinado)</div>
                  <div className="prose prose-sm dark:prose-invert max-w-none border rounded p-2 bg-background">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{signedFeedback()}</ReactMarkdown>
                  </div>
                </div>
                <div>
                  <Label>Lançar no campo do diário *</Label>
                  {diaryAssessments.length === 0 ? (
                    <p className="text-xs text-destructive mt-1">
                      A estrutura de notas da disciplina ainda não foi configurada. Configure no
                      módulo Notas antes de publicar.
                    </p>
                  ) : (
                    <Select value={diaryAssessmentId} onValueChange={setDiaryAssessmentId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o campo" />
                      </SelectTrigger>
                      <SelectContent>
                        {diaryAssessments.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name} (máx {a.max_score})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep("score")}>
                  <ArrowLeft className="h-4 w-4 mr-1" /> Voltar para ajustes
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => handleSave()}
                    disabled={saving || isReadonly}
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <FileCheck2 className="h-4 w-4 mr-2" />
                    )}
                    Salvar rascunho
                  </Button>
                  <Button
                    onClick={handlePublish}
                    disabled={publishing || isReadonly || !diaryAssessmentId}
                  >
                    {publishing ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4 mr-2" />
                    )}
                    Confirmar e publicar
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="flex justify-between items-center w-full">
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm"
                className="gap-2"
                disabled={!isReadonly}
                onClick={async () => {
                  try {
                    const t = toast.loading("Gerando relatório em PDF...");
                    if (clinicalAdapter) {
                      clinicalAdapter.onDownloadFeedback({
                        score: Number(finalScore || computeWeighted()),
                        feedback: signedFeedback(),
                      });
                      return;
                    }
                    const res = await exportFeedbackPDF({ data: { submission_id: submission.id, kind } });
                    const blob = new Blob([Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0))], { type: "application/pdf" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = res.filename;
                    a.click();
                    URL.revokeObjectURL(url);
                    toast.success("Feedback exportado com sucesso!", { id: t });
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Erro ao exportar PDF");
                  }
                }}
              >
                <FileText className="h-4 w-4" /> Baixar Feedback em PDF
              </Button>
            </div>
            <Button variant="ghost" onClick={onClose}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showLibrary && (
        <RubricLibraryDialog
          scope={kind === "activity" ? "activity" : "work"}
          onClose={() => setShowLibrary(false)}
          onSelect={(sel: RubricSelection) => {
            setRubric(sel.criteria);
            setShowLibrary(false);
          }}
        />
      )}
    </>
  );
}