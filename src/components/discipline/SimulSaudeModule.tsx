import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Stethoscope, ClipboardList, Send, Search, BrainCircuit, CheckCircle2, CalendarClock, BookOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { PEPInterface } from "@/components/simulsaude/PEPInterface";
import { ClinicalCaseGenerator } from "@/components/simulsaude/ClinicalCaseGenerator";
import type { PlannedClinicalCase } from "@/backend/simulsaude-cases.functions";
import { PatientChat } from "@/components/simulsaude/PatientChat";
import { ActivityDeadlineBadges } from "@/components/discipline/ActivityDeadlineBadges";
import { CorrectionDialog, type SubmissionReviewCriterion, type SubmissionReviewRow } from "./SubmissionReviewDialog";
import { ModalLancamentoNotaDiario } from "@/components/diary/ModalLancamentoNotaDiario";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Calendar, Clock, AlertTriangle, FileText, Trash2, Users, Download, Pencil, Loader2, Sparkles, RefreshCw } from "lucide-react";
import { format, differenceInDays, differenceInHours, differenceInMinutes, isAfter, isBefore } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Checkbox as UIFieldCheckbox } from "@/components/ui/checkbox";
import { BulkDeleteBar } from "@/components/BulkDeleteBar";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SimulSaudeModuleProps {
  disciplineId: string;
  isTeacher?: boolean;
  teacherId?: string;
  selectedApostilaId?: string;
  selectedLessons?: string[];
}

/**
 * Contador regressivo ao vivo do prazo de entrega do caso clínico.
 * Quando o prazo já passou e a penalidade por atraso está ativa, mostra também o
 * aviso vermelho com o desconto por dia de atraso (padrão 0,5 ponto/dia — o mesmo
 * valor assumido pelo backend em simulsaude-review.functions.ts).
 */
function CaseDeadlineCountdown({
  dueDate,
  allowLate,
  penaltyPerDay,
}: {
  dueDate: string;
  allowLate?: boolean | null;
  penaltyPerDay?: number | null;
}) {
  return (
    <ActivityDeadlineBadges
      dueDate={dueDate}
      allowLate={allowLate}
      penaltyPerDay={penaltyPerDay}
    />
  );
}

export const SimulSaudeModule: React.FC<SimulSaudeModuleProps> = ({ 
  disciplineId, 
  isTeacher, 
  teacherId,
  selectedApostilaId, 
  selectedLessons: propSelectedLessons = [] 
}) => {
  const { user } = useAuth();
  const [cases, setCases] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [selectedCase, setSelectedCase] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [clinicalAnswers, setClinicalAnswers] = useState<Record<number, string>>({});
  const [activeTab, setActiveTab] = useState("pep");
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [mySubs, setMySubs] = useState<any[]>([]);
  const [localApostilaId, setLocalApostilaId] = useState(selectedApostilaId || "");
  const [localLessons, setLocalLessons] = useState<string[]>(propSelectedLessons);
  const [diaryColumns, setDiaryColumns] = useState<{ id: string; name: string }[]>([]);
  const [loadingDiary, setLoadingDiary] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [releaseModal, setReleaseModal] = useState<{ open: boolean; subId: string; studentId: string; studentName: string; score: number } | null>(null);
  const [viewingCase, setViewingCase] = useState<any>(null);
  const [editingCase, setEditingCase] = useState<any>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [submissionsCase, setSubmissionsCase] = useState<any>(null);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [plannedCases, setPlannedCases] = useState<PlannedClinicalCase[]>([]);
  const [plannedSeed, setPlannedSeed] = useState<PlannedClinicalCase | null>(null);
  const [planItemsOpen, setPlanItemsOpen] = useState(true);

  const clinicalQuestions = Array.isArray(selectedCase?.decision_tree?.clinical_questions)
    ? selectedCase.decision_tree.clinical_questions
        .map((item: unknown) => {
          if (typeof item === "string") return item.trim();
          if (item && typeof item === "object" && "question" in item) {
            const question = (item as { question?: unknown }).question;
            return typeof question === "string" ? question.trim() : "";
          }
          return "";
        })
        .filter((question: string) => question.length > 0)
    : [];

  useEffect(() => {
    setClinicalAnswers({});
  }, [selectedCase?.id]);

  const handleDeletePlanned = async (id: string) => {
    if (!confirm("Remover este caso previsto no Plano de Aula?")) return;
    const { error } = await supabase.from("clinical_cases").delete().eq("id", id).eq("status", "draft");
    if (error) {
      toast.error("Não foi possível remover o caso previsto.");
      return;
    }
    setPlannedCases((prev) => prev.filter((c) => c.id !== id));
  };
  const [reviewModal, setReviewModal] = useState<{ open: boolean; sub: any; nonce?: number; reset?: boolean } | null>(null);
  const [manualDiaryColumn, setManualDiaryColumn] = useState<string>("");

  useEffect(() => {
    fetchData();
  }, [disciplineId, user]);

  const fetchData = async () => {
    setLoading(true);
    
    // Busca os casos vinculados a esta disciplina via server function para garantir acesso RLS (Security Definer)
    let listed: any[] = [];
    try {
      const { getClinicalCases } = await import("@/backend/simulsaude.functions");
      const casesData = await getClinicalCases({ data: { disciplineId } });
      listed = (casesData ?? []) as any[];

    } catch (err) {
      console.warn("[simulsaude] failed to load cases gracefully", err);
    }
    setCases(listed);

    // Casos previstos no Plano de Aula (rascunhos) — exclusivo do professor.
    if (isTeacher) {
      try {
        const { getPlannedClinicalCases } = await import("@/backend/simulsaude-cases.functions");
        setPlannedCases(await getPlannedClinicalCases({ data: { disciplineId } }));
      } catch {
        setPlannedCases([]);
      }
    } else {
      setPlannedCases([]);
    }

    try {
      if (isTeacher) {
        const ids = listed.map((c) => c.id);
        if (ids.length > 0) {
          const { data: subData } = await supabase
            .from("student_submissions" as any)
            .select("*, profiles(name)")
            .in("case_id", ids)
            .order("submitted_at", { ascending: false });
          setSubmissions(subData ?? []);
        } else {
          setSubmissions([]);
        }
      } else if (user) {
        const { data: mySub } = await supabase
          .from("student_submissions" as any)
          .select("*")
          .eq("student_id", user.id)
          .order('submitted_at', { ascending: false });
        setMySubs((mySub as any[]) ?? []);
        if (mySub && mySub.length > 0) setResult(mySub[0]);
      }
    } catch (err) {
      console.warn("[simulsaude] failed to load submissions gracefully");
    }
    setLoading(false);
  };

  useEffect(() => {
    async function loadColumns() {
      if (isTeacher) {
        setLoadingDiary(true);
        try {
          const { getDiaryColumns } = await import("@/backend/diary-release.functions");
          const columns = await getDiaryColumns({ data: { discipline_id: disciplineId } });
          setDiaryColumns(columns);
        } catch (err) {
          console.error("Error loading diary columns:", err);
        } finally {
          setLoadingDiary(false);
        }
      }
    }
    loadColumns();
  }, [disciplineId, isTeacher]);

  const handleSubmit = async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser || !selectedCase) return;
    if (clinicalQuestions.length === 0) {
      toast.error("Este caso ainda não possui perguntas dissertativas disponíveis.");
      return;
    }

    const responses = clinicalQuestions.map((question: string, index: number) => ({
      question,
      answer: clinicalAnswers[index]?.trim() ?? "",
    }));
    if (responses.some((response: { answer: string }) => response.answer.length === 0)) {
      toast.error("Responda todas as perguntas antes de enviar.");
      return;
    }

    const submissionText = responses
      .map((response: { question: string; answer: string }, index: number) =>
        `Questão ${index + 1}: ${response.question}\nResposta: ${response.answer}`,
      )
      .join("\n\n");

    if (mySubs.some((s) => s.case_id === selectedCase.id)) {
      toast.error("Você já enviou este caso clínico. Aguarde a correção do professor.");
      return;
    }
    
    setLoading(true);
    try {
      // Bloqueio de envio múltiplo: confere no banco antes de inserir.
      const { data: existing } = await supabase
        .from("student_submissions" as any)
        .select("id")
        .eq("case_id", selectedCase.id)
        .eq("student_id", authUser.id)
        .limit(1);
      if (existing && existing.length > 0) {
        toast.error("Você já enviou este caso clínico. Aguarde a correção do professor.");
        setHasSubmitted(true);
        fetchData();
        return;
      }
      // Garantir payload final completo para um único INSERT, respeitando as permissões de aluno (apenas INSERT)
      // O student_id deve ser injetado explicitamente para passar na política WITH CHECK (student_id = auth.uid())
      // Envio pelo servidor (valida a sessão do aluno) — evita recusa por permissão no navegador.
      let error: { code?: string; message: string } | null = null;
      try {
        const { submitCaseResolution } = await import("@/backend/simulsaude.functions");
        await submitCaseResolution({
          data: {
            caseId: selectedCase.id,
            studentId: authUser.id,
            answers: { responses, text: submissionText },
          },
        });
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        error = { code: e?.code ?? (/já enviou|23505|duplicate/i.test(msg) ? "23505" : undefined), message: msg };
      }

      if (error) {
        console.error("[simulsaude] Submission error details:", error);
        if ((error as any).code === "23505") {
          toast.error("Você já enviou este caso clínico. Aguarde a correção do professor.");
          setHasSubmitted(true);
          fetchData();
        } else {
          toast.error(`Erro ao enviar conduta: ${error.message}`);
        }
      } else {
        toast.success("Conduta enviada para avaliação do professor!");
        setHasSubmitted(true);
        // Atualiza os dados locais para refletir a nova submissão
        fetchData();
      }
    } catch (err) {
      console.error("[simulsaude] Unexpected submission error:", err);
      toast.error("Ocorreu um erro ao processar o envio.");
    } finally {
      setLoading(false);
    }
  };


  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const prepareReview = async (sub: any, targetColumnId: string, forceAI = false) => {
    setReviewingId(sub.id);
    try {
      // Correção 100% manual (igual a Atividades Extras): envio ainda não publicado abre em branco,
      // sem reaproveitar notas gravadas automaticamente em envios antigos.
      const alreadyReleased = ["released", "teacher_reviewed", "corrected"].includes(sub.status);
      let currentScore = alreadyReleased ? sub.score : null;
      let currentFeedback = alreadyReleased ? sub.feedback : "";
      
      // A IA nunca é chamada aqui: o assistente de 5 etapas (passo 1) dispara a análise.
      // "Nova avaliação com IA" reabre o assistente do zero, como rascunho editável.
      setManualDiaryColumn(targetColumnId);
      setReviewModal({
        open: true,
        nonce: Date.now(),
        reset: forceAI,
        sub: forceAI
          ? { ...sub, status: "ai_corrected", score: null, feedback: "", rubricScores: undefined }
          : { ...sub, score: currentScore, feedback: currentFeedback, rubricScores: undefined },
      });
      
    } catch (err: any) {
      console.error("Preparation error:", err);
      toast.error("Erro ao preparar revisão: " + err.message);
    } finally {
      setReviewingId(null);
    }
  };


  const handleDeleteSubmission = async (id: string) => {
    if (!confirm("Deseja realmente excluir este envio? O aluno poderá enviar novamente.")) return;
    try {
      // Mesmo fluxo de Atividades Extras: a exclusão passa pelo servidor (professor/admin),
      // removendo também a nota do diário, se já tiver sido publicada.
      const { cancelClinicalSubmission } = await import("@/backend/simulsaude-review.functions");
      await cancelClinicalSubmission({ data: { submissionId: id, disciplineId } });
      
      toast.success("Envio excluído com sucesso.");
      setSubmissions(prev => prev.filter(s => s.id !== id));
    } catch (err: any) {
      console.error("Delete error:", err);
      toast.error("Erro ao excluir envio: " + err.message);
    }
  };

  // Cancela o envio (e a nota do diário, se já publicada) para que o aluno possa reenviar.
  const handleCancelSubmission = async (sub: any) => {
    const published = ["released", "graded", "reviewed", "corrected", "teacher_reviewed"].includes(sub.status);
    const message = published
      ? `Cancelar o envio de ${sub.profiles?.name || "o aluno"}? A correção e a nota publicada no diário serão removidas e o aluno poderá reenviar.`
      : `Cancelar o envio de ${sub.profiles?.name || "o aluno"}? O aluno poderá reenviar o caso clínico.`;
    if (!confirm(message)) return;
    setReviewingId(sub.id);
    try {
      const { cancelClinicalSubmission } = await import("@/backend/simulsaude-review.functions");
      await cancelClinicalSubmission({ data: { submissionId: sub.id, disciplineId } });
      toast.success("Envio cancelado. O aluno já pode reenviar o caso clínico.");
      setSubmissions(prev => prev.filter(s => s.id !== sub.id));
      if (reviewModal?.sub?.id === sub.id) setReviewModal(null);
      fetchData();
    } catch (err: any) {
      console.error("Cancel error:", err);
      toast.error("Erro ao cancelar envio: " + err.message);
    } finally {
      setReviewingId(null);
    }
  };


  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (loading) return <div className="p-8 text-center">Carregando SimulSaúde...</div>;


  const saveCaseEdits = async () => {
    if (!editingCase) return;
    setSavingEdit(true);
    const { error } = await supabase
      .from("clinical_cases" as any)
      .update({
        title: editingCase.title,
        description: editingCase.description,
        due_date: editingCase.due_date,
        due_time: editingCase.due_time || '23:59:59',
        allow_late_submission: editingCase.allow_late_submission,
        late_penalty_per_day: editingCase.late_penalty_per_day ?? 0,
        late_tolerance_date: editingCase.late_tolerance_date || null,
        late_tolerance_time: editingCase.late_tolerance_time || '23:59:59',
        late_penalty_type: editingCase.late_penalty_type || 'percentage',
        patient_info: editingCase.patient_info ?? {},
      })
      .eq("id", editingCase.id);
    setSavingEdit(false);
    if (error) {
      toast.error("Erro ao salvar alterações.");
      return;
    }
    toast.success("Caso atualizado.");
    setEditingCase(null);
    fetchData();
  };

  const downloadCasePDF = (c: any) => {
    const t = toast.loading("Gerando PDF...", { duration: 5000 });
    const esc = (v: unknown) =>
      String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const list = (items: string[]) => items.map((i) => `<li>${esc(i)}</li>`).join("");
    const vitals = (c.patient_info?.vital_signs ?? []).map(
      (v: any) => `${v.parameter}: ${v.value} ${v.unit} (ref. ${v.reference}) — ${v.classification}`,
    );
    const exams = (c.investigation_data?.lab_exams ?? []).map(
      (e: any) => `${e.exam}: ${e.value} ${e.unit} (ref. ${e.reference})${e.classification ? ` — ${e.classification}` : ""}`,
    );
    const criteria = c.decision_tree?.evaluation_criteria ?? [];
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${esc(c.title)}</title>
<style>
  @media print {
    body { padding: 0; }
    .no-print { display: none; }
    table, blockquote, .avoid-break { break-inside: avoid; }
  }
  body{font-family:Arial,Helvetica,sans-serif;padding:32px;color:#111;line-height:1.5;max-width:210mm;margin:0 auto}
  h1{font-size:22px;margin:0 0 10px;text-transform:uppercase;border-bottom:2px solid #333;padding-bottom:10px}
  h2{font-size:14px;margin:20px 0 6px;text-transform:uppercase;color:#555;border-bottom:1px solid #eee}
  p,li{font-size:12px;margin-bottom:8px}
  ul{padding-left:18px}
  .metadata{display:grid;grid-template-cols:1fr 1fr;gap:10px;margin-bottom:20px;font-size:11px;background:#f9f9f9;padding:10px;border-radius:4px}
</style></head><body>
<h1>CASO CLÍNICO: ${esc(c.title)}</h1>
<div class="metadata">
  <div><strong>Disciplina:</strong> ${esc(disciplineId)}</div>
  <div><strong>Data:</strong> ${format(new Date(), "dd/MM/yyyy")}</div>
</div>
<p>${esc(c.description)}</p>
<h2>Identificação e Anamnese</h2>
<p>${esc(
      [
        c.patient_info?.name && `Paciente: ${c.patient_info.name}`,
        c.patient_info?.age && `Idade: ${c.patient_info.age}`,
        c.patient_info?.sex && `Sexo: ${c.patient_info.sex}`,
        c.patient_info?.occupation && `Ocupação: ${c.patient_info.occupation}`,
        c.patient_info?.chief_complaint && `Queixa principal: ${c.patient_info.chief_complaint}`,
        c.patient_info?.anamnesis,
        c.patient_info?.history,
      ]
        .filter(Boolean)
        .join(" • "),
    )}</p>
<div class="avoid-break">
${vitals.length ? `<h2>Sinais Vitais</h2><ul>${list(vitals)}</ul>` : ""}
</div>
<div class="avoid-break">
${exams.length ? `<h2>Exames Laboratoriais</h2><ul>${list(exams)}</ul>` : ""}
</div>
<div class="avoid-break">
${criteria.length ? `<h2>Critérios de Avaliação</h2><ul>${list(criteria)}</ul>` : ""}
</div>
<footer style="margin-top:40px;padding-top:10px;border-top:1px solid #eee;font-size:10px;color:#999;text-align:center">
  Documento gerado automaticamente pela plataforma EstudaJá.
</footer>
</body></html>`;
    const win = window.open("", "_blank");
    if (!win) {
      toast.error("Permita pop-ups para baixar o PDF.", { id: t });
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => {
      win.print();
      toast.success("PDF preparado para impressão!", { id: t });
    }, 500);
  };

  const downloadClinicalFeedbackPDF = (sub: any) => {
    const clinicalCase = cases.find((item) => item.id === sub.case_id);
    const popup = window.open("", "_blank");
    if (!popup) {
      toast.error("Permita pop-ups para baixar o PDF.");
      return;
    }
    const escapeHtml = (value: unknown) =>
      String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Feedback — ${escapeHtml(clinicalCase?.title)}</title></head><body><h1>Feedback da Simulação Clínica</h1><p><strong>Aluno:</strong> ${escapeHtml(sub.profiles?.name || "Aluno")}</p><p><strong>Caso:</strong> ${escapeHtml(clinicalCase?.title || "Caso clínico")}</p><p><strong>Nota:</strong> ${escapeHtml(sub.score ?? "—")} / 10</p><hr><div style="white-space:pre-wrap">${escapeHtml(sub.feedback || "Sem feedback informado.")}</div><script>window.onload=()=>window.print()<\/script></body></html>`);
    popup.document.close();
  };


  const handleDeleteCase = async (id: string) => {
    if (!confirm("Deseja realmente excluir este caso clínico?")) return;
    const { error } = await supabase
      .from("clinical_cases" as any)
      .delete()
      .eq("id", id)
      .eq("discipline_id", disciplineId);
    if (!error) {
      toast.success("Caso excluído com sucesso.");
      fetchData();
    } else {
      toast.error("Erro ao excluir caso.");
    }
  };

  const handleBulkDeleteCases = async () => {
    if (!confirm(`Excluir ${selected.size} caso(s) clínico(s) selecionado(s)?`)) return;
    const { error } = await supabase
      .from("clinical_cases" as any)
      .delete()
      .in("id", Array.from(selected))
      .eq("discipline_id", disciplineId);
    if (!error) {
      toast.success("Casos excluídos com sucesso.");
      setSelected(new Set());
      fetchData();
    } else {
      toast.error("Erro ao excluir casos.");
    }
  };

  const getDeadlineBadge = (c: any) => {
    if (!c?.due_date) return null;
    return (
      <ActivityDeadlineBadges
        dueDate={c.due_date}
        dueTime={c.due_time}
        allowLate={c.allow_late_submission}
        penaltyPerDay={c.late_penalty_per_day}
        penaltyType={c.late_penalty_type}
      />
    );
  };

  const getRemainingTimeBadge = (dueDate?: string) => {
    if (!dueDate) return null;
    const now = new Date();
    const deadline = new Date(dueDate);
    
    if (isAfter(now, deadline)) {
      return (
        <Badge variant="destructive" className="flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> Prazo Encerrado
        </Badge>
      );
    }

    const days = differenceInDays(deadline, now);
    const hours = differenceInHours(deadline, now) % 24;
    const mins = differenceInMinutes(deadline, now) % 60;
    
    let timeStr = "";
    if (days > 0) timeStr = `${days}d ${hours}h`;
    else if (hours > 0) timeStr = `${hours}h ${mins}min`;
    else timeStr = `${mins}min`;

    return (
      <Badge variant="outline" className="flex items-center gap-1 border-amber-500 text-amber-600 bg-amber-50">
        <Clock className="h-3 w-3" /> Faltam {timeStr}
      </Badge>
    );
  };

  const pendingCount = (caseId: string) =>
    submissions.filter(
      (s) => s.case_id === caseId && !["released", "graded", "reviewed", "corrected", "teacher_reviewed"].includes(s.status),
    ).length;

  const renderSubmissionsQueue = (list: any[], title = "Fila de Submissões Pendentes") => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0 sm:p-6 sm:pt-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ALUNO</TableHead>
              <TableHead>ATIVIDADE</TableHead>
              <TableHead>ENVIADO EM</TableHead>
              <TableHead className="text-center">STATUS</TableHead>
              <TableHead className="text-center">NOTA</TableHead>
              <TableHead className="text-right">AÇÕES</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((s) => {
              const clinicalCase = cases.find((item) => item.id === s.case_id);
              const published = ["released", "graded", "reviewed", "corrected", "teacher_reviewed"].includes(s.status);
              return (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.profiles?.name || "Aluno"}</TableCell>
                  <TableCell>{clinicalCase?.title || "Caso clínico"}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {s.submitted_at ? format(new Date(s.submitted_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }) : "—"}
                  </TableCell>
                  <TableCell className="text-center">
                    {(() => {
                      const corrected = published || !!s.feedback;
                      const steps = [
                        { label: "Enviado", done: true },
                        { label: "Em correção", done: corrected },
                        { label: "Publicado", done: published },
                      ];
                      return (
                        <div className="flex flex-col items-center gap-1">
                          <Badge variant={published ? "default" : "secondary"}>
                            {published ? "Publicado" : corrected ? "Em correção" : "Aguardando correção"}
                          </Badge>
                          <div className="flex items-center gap-1" aria-label="Etapas da correção">
                            {steps.map((st) => (
                              <span
                                key={st.label}
                                title={st.label}
                                className={`h-1.5 w-5 rounded-full ${st.done ? "bg-primary" : "bg-muted"}`}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="text-center font-semibold">
                    {s.score != null ? Number(s.score).toFixed(2) : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        onClick={() => prepareReview(s, manualDiaryColumn || diaryColumns[0]?.id || "")}
                        disabled={reviewingId === s.id}
                      >
                        {reviewingId === s.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {published ? "Ver" : "Corrigir"}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-9 w-9 text-primary hover:bg-primary/10 hover:text-primary"
                        onClick={() => prepareReview(s, manualDiaryColumn || diaryColumns[0]?.id || "", true)}
                        disabled={reviewingId === s.id}
                        aria-label="Sugestão da IA"
                        title="Gerar sugestão de correção com IA (o professor revisa antes de publicar)"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCancelSubmission(s)}
                        disabled={reviewingId === s.id}
                        title="Apaga o envio para que o aluno possa enviar novamente"
                      >
                        🔄 Permitir Reenvio
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-9 w-9 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => handleDeleteSubmission(s.id)}
                        aria-label="Excluir envio"
                        title="Excluir envio"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {list.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  Nenhuma submissão pendente para correção.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      {isTeacher ? (
        <div className="space-y-6">
          <Dialog
            open={generatorOpen}
            onOpenChange={(open) => {
              setGeneratorOpen(open);
              if (!open) setPlannedSeed(null);
            }}
          >
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {plannedSeed ? "Gerar Caso Clínico previsto no Plano de Aula" : "Gerar Novo Caso Clínico com IA"}
                </DialogTitle>
                <DialogDescription>
                  {plannedSeed
                    ? `Cenário e objetivos do plano serão usados como base para “${plannedSeed.title}”.`
                    : "Gere um caso alinhado ao conteúdo da disciplina e publique para os alunos."}
                </DialogDescription>
              </DialogHeader>
              <ClinicalCaseGenerator
                key={plannedSeed?.id ?? "new"}
                disciplineId={disciplineId}
                plannedCase={plannedSeed}
                onPublished={() => {
                  setGeneratorOpen(false);
                  setPlannedSeed(null);
                  fetchData();
                }}
              />
            </DialogContent>
          </Dialog>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-white">
                <h2 className="text-lg font-semibold">SimulSaúde</h2>
                <p className="text-sm opacity-80">
                  {cases.length} caso(s) publicado(s) · simulações clínicas interativas com correção por IA
                </p>
              </div>
              <Button
                onClick={() => {
                  setPlannedSeed(null);
                  setGeneratorOpen(true);
                }}
              >
                <BrainCircuit className="h-4 w-4 mr-2" /> Gerar Novo Caso com IA
              </Button>
            </div>

            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <>
                {plannedCases.length > 0 && (
                  <div className="rounded-xl border-2 border-primary/25 bg-primary/5 p-4 space-y-3">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 text-left"
                      onClick={() => setPlanItemsOpen((v) => !v)}
                    >
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wide text-primary">
                          Casos previstos no Plano de Aula
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {plannedCases.length} cenário(s) aguardando geração do caso completo. Visíveis apenas para você.
                        </p>
                      </div>
                      <Sparkles className="h-5 w-5 shrink-0 text-primary/70" />
                    </button>
                    {planItemsOpen && (
                      <ul className="space-y-2">
                        {plannedCases.map((pc) => (
                          <li key={pc.id} className="rounded-lg border bg-card p-3 space-y-2">
                            <div className="min-w-0">
                              <div className="text-xs font-medium text-primary/80">
                                {pc.module_number ? `Módulo ${pc.module_number}` : "Plano de Aula"}
                              </div>
                              <div className="font-medium leading-tight break-words">{pc.title}</div>
                              {pc.scenario && (
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-3">
                                  <span className="font-semibold text-foreground/80">Cenário:</span> {pc.scenario}
                                </p>
                              )}
                              {pc.objectives && (
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                  <span className="font-semibold text-foreground/80">Objetivos:</span> {pc.objectives}
                                </p>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                onClick={() => {
                                  setPlannedSeed(pc);
                                  setGeneratorOpen(true);
                                }}
                              >
                                <BrainCircuit className="h-3.5 w-3.5 mr-1" /> Gerar caso completo
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:bg-destructive/5 ml-auto"
                                onClick={() => handleDeletePlanned(pc.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {cases.length === 0 ? (
                  <div className="border-2 border-dashed rounded-xl py-12 text-center bg-card/50">
                    <Stethoscope className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">Nenhum caso clínico publicado.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {cases.map((c) => (
                      <div
                        key={c.id}
                        className="rounded-xl border bg-card p-4"
                        style={{ boxShadow: "var(--shadow-card)" }}
                      >
                        <div className="flex items-center justify-between gap-3 min-w-0">
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            <UIFieldCheckbox
                              className="shrink-0"
                              checked={selected.has(c.id)}
                              onCheckedChange={() => toggleSelected(c.id)}
                              aria-label="Selecionar caso"
                            />
                            <div className="flex-1 min-w-0 break-words whitespace-normal">
                              <div className="font-medium break-words leading-tight">{c.title}</div>
                              <div className="text-xs text-muted-foreground">Simulação Clínica</div>
                              {c.due_date && (
                                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                  <span className="inline-flex items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 text-[11px] font-medium">
                                    <CalendarClock className="h-3 w-3" /> Entrega:{" "}
                                    {format(new Date(c.due_date), "dd/MM/yyyy")}
                                  </span>
                                  <CaseDeadlineCountdown
                                    dueDate={c.due_date}
                                    allowLate={c.allow_late_submission}
                                    penaltyPerDay={
                                      c.late_penalty_per_day != null ? Number(c.late_penalty_per_day) : null
                                    }
                                  />
                                </div>
                              )}
                              {c.description && (
                                <p className="text-sm mt-2 text-muted-foreground break-words whitespace-normal leading-tight line-clamp-3">
                                  {c.description}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="shrink-0 text-[10px] px-2 py-0.5 rounded bg-green-100 text-green-700">
                              Publicado
                            </span>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button size="sm" variant="ghost" onClick={() => setViewingCase(c)}>
                            <FileText className="h-3.5 w-3.5 mr-1" /> Ver caso clínico
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setViewingCase(c)}>
                            <BookOpen className="h-3.5 w-3.5 mr-1" /> Ver rubrica
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setEditingCase({ ...c })}>
                            Editar
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setSubmissionsCase(c)}>
                            {pendingCount(c.id) > 0 ? `Submissões (${pendingCount(c.id)})` : "Ver Resultados"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:bg-destructive/5 ml-auto"
                            onClick={() => handleDeleteCase(c.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {selected.size > 0 && (
                  <BulkDeleteBar
                    count={selected.size}
                    itemLabel="caso clínico"
                    onConfirm={handleBulkDeleteCases}
                    onClear={() => setSelected(new Set())}
                  />
                )}

              </>
            )}
          </div>
        </div>
      ) : !selectedCase ? (
        <div className="space-y-6">
          <div className="space-y-2">
            {cases.map((c) => (
              <div key={c.id} className="rounded-xl border bg-card p-4 transition-shadow" style={{ boxShadow: "var(--shadow-card)" }}>
                <div className="flex items-center justify-between gap-3 min-w-0">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="flex-1 min-w-0 break-words whitespace-normal">
                      <div className="font-medium break-words leading-tight">{c.title}</div>
                      <div className="text-xs text-muted-foreground">
                        Simulação Clínica • {c.created_at ? format(new Date(c.created_at), "dd/MM/yyyy") : "N/A"}
                      </div>
                      {c.due_date && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <CaseDeadlineCountdown
                            dueDate={c.due_date}
                            allowLate={c.allow_late_submission}
                            penaltyPerDay={
                              c.late_penalty_per_day != null
                                ? Number(c.late_penalty_per_day)
                                : null
                            }
                          />
                        </div>
                      )}
                      {c.description && (
                        <p className="text-sm mt-2 text-muted-foreground break-words whitespace-normal leading-tight line-clamp-2">
                          {c.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="shrink-0 text-[10px] px-2 py-0.5 rounded bg-green-100 text-green-700">
                      Publicado
                    </span>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setViewingCase(c)}>
                    <FileText className="h-3.5 w-3.5 mr-1" /> Ver caso clínico
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setViewingCase(c)}>
                    <BookOpen className="h-3.5 w-3.5 mr-1" /> Ver rubrica
                  </Button>
                  {(() => {
                    // Mesmo comportamento de Atividades Extras: envio único + selo "Enviada" / "Nota".
                    const me = mySubs.find((s) => s.case_id === c.id);
                    const released = me && ["released", "teacher_reviewed", "corrected"].includes(me.status);
                    return (
                      <>
                        {me && (
                          <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 self-center">
                            {released ? `Nota: ${me.score != null ? Number(me.score).toFixed(2) : "—"}` : "Enviada — aguardando correção"}
                          </span>
                        )}
                        <Button size="sm" className="ml-auto" variant={me ? "outline" : "default"} onClick={() => setSelectedCase(c)}>
                          {me ? (released ? "Ver resultado" : "Ver minha resposta") : "Iniciar Simulação Clínica"}
                        </Button>
                        {released && me?.feedback && (
                          <details className="text-xs w-full">
                            <summary className="cursor-pointer text-primary">Ver feedback</summary>
                            <div className="mt-2 p-2 bg-muted/50 rounded">
                              <div className="prose prose-sm max-w-none dark:prose-invert"><ReactMarkdown remarkPlugins={[remarkGfm]}>{String(me.feedback)}</ReactMarkdown></div>
                            </div>
                          </details>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Stethoscope className="h-6 w-6 text-primary" />
              Simulação Clínica Interativa
            </h2>
            <Button variant="ghost" onClick={() => setSelectedCase(null)}>Voltar aos casos</Button>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-4 mb-4">
              <TabsTrigger value="pep">Prontuário & Sinais</TabsTrigger>
              <TabsTrigger value="investigation">Investigação & Exames</TabsTrigger>
              <TabsTrigger value="chat">Chat com Paciente</TabsTrigger>
              <TabsTrigger value="decision">Tomada de Decisão</TabsTrigger>
            </TabsList>

            <TabsContent value="pep">
              <PEPInterface case={selectedCase} activeTab="pep" />
            </TabsContent>

            <TabsContent value="investigation">
              <PEPInterface case={selectedCase} activeTab="investigation" />
            </TabsContent>

            <TabsContent value="chat">
              <PatientChat case={selectedCase} />
            </TabsContent>

            <TabsContent value="decision">
              {mySubs.some((s) => s.case_id === selectedCase.id && !['teacher_reviewed', 'released', 'corrected'].includes(s.status)) ? (
                <Card className="border-primary/30 bg-primary/5">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-primary">
                      <CheckCircle2 className="h-6 w-6" />
                      Resposta enviada
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm text-muted-foreground">
                    <p>O envio é único. Aguarde a correção do professor — a nota e o feedback aparecerão aqui quando forem publicados.</p>
                  </CardContent>
                </Card>
              ) : mySubs.some((s) => s.case_id === selectedCase.id) ? (
                <Card className="border-green-200 bg-green-50/30">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-green-700">
                      <CheckCircle2 className="h-6 w-6" />
                      Resultado da Avaliação
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {(() => {
                      const mine = mySubs.find((s) => s.case_id === selectedCase.id);
                      return (
                        <>
                          <div className="flex justify-between items-center">
                            <Badge className="bg-green-600">AVALIAÇÃO CONCLUÍDA</Badge>
                            <span className="text-2xl font-bold">Nota Final: {mine?.score != null ? Number(mine.score).toFixed(2) : "—"}</span>
                          </div>
                          {mine?.feedback ? (
                            <div className="p-4 bg-white border rounded-lg shadow-sm space-y-3">
                              <p className="font-bold text-sm border-b pb-1">Feedback Detalhado:</p>
                              <div className="text-sm text-foreground leading-relaxed prose prose-sm dark:prose-invert max-w-none font-sans">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{mine.feedback}</ReactMarkdown>
                              </div>
                            </div>
                          ) : mine?.teacher_comment ? (
                            <div className="p-4 bg-white border rounded-lg shadow-sm">
                              <p className="font-semibold text-sm mb-2">Comentário do Professor:</p>
                              <p className="text-sm text-muted-foreground italic">{mine.teacher_comment}</p>
                            </div>
                          ) : null}
                        </>
                      );
                    })()}
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle>Resolução do Caso Clínico</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {clinicalQuestions.length > 0 ? (
                      <div className="space-y-6">
                        {clinicalQuestions.map((question: string, index: number) => (
                          <div key={`${selectedCase.id}-question-${index}`} className="space-y-2">
                            <Label htmlFor={`clinical-answer-${index}`} className="text-sm font-semibold leading-relaxed">
                              {index + 1}. {question}
                            </Label>
                            <Textarea
                              id={`clinical-answer-${index}`}
                              className="min-h-[140px]"
                              placeholder="Digite sua resposta..."
                              value={clinicalAnswers[index] ?? ""}
                              onChange={(event) =>
                                setClinicalAnswers((current) => ({
                                  ...current,
                                  [index]: event.target.value,
                                }))
                              }
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Este caso ainda não possui perguntas dissertativas disponíveis.
                      </p>
                    )}
                    <Button
                      className="w-full h-12"
                      onClick={handleSubmit}
                      disabled={
                        clinicalQuestions.length === 0 ||
                        clinicalQuestions.some((_: string, index: number) => !(clinicalAnswers[index]?.trim()))
                      }
                    >
                      <Send className="h-5 w-5 mr-2" /> Enviar Respostas
                    </Button>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}
      
      {releaseModal && (
        <ModalLancamentoNotaDiario
          open={releaseModal.open}
          onClose={() => setReleaseModal(null)}
          disciplineId={disciplineId}
          studentId={releaseModal.studentId}
          studentName={releaseModal.studentName}
          obtainedScore={releaseModal.score}
          maxScore={10}
          activityRef={{
            id: releaseModal.subId,
            type: "clinical_case",
            title: "Simulação Clínica"
          }}
          onSuccess={() => fetchData()}
        />
      )}

      {viewingCase && (
        <Dialog open onOpenChange={() => setViewingCase(null)}>
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{viewingCase.title}</DialogTitle>
              <DialogDescription>Enunciado completo do caso clínico</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              {viewingCase.description && <p className="text-muted-foreground">{viewingCase.description}</p>}
              <div>
                <h4 className="font-semibold mb-1">Identificação e Anamnese</h4>
                <p className="whitespace-pre-wrap text-muted-foreground">
                  {[
                    viewingCase.patient_info?.name && `Paciente: ${viewingCase.patient_info.name}`,
                    viewingCase.patient_info?.age && `Idade: ${viewingCase.patient_info.age}`,
                    viewingCase.patient_info?.sex && `Sexo: ${viewingCase.patient_info.sex}`,
                    viewingCase.patient_info?.occupation && `Ocupação: ${viewingCase.patient_info.occupation}`,
                    viewingCase.patient_info?.chief_complaint && `Queixa principal: ${viewingCase.patient_info.chief_complaint}`,
                    viewingCase.patient_info?.anamnesis,
                    viewingCase.patient_info?.history,
                  ]
                    .filter(Boolean)
                    .join("\n")}
                </p>
              </div>
              {(viewingCase.patient_info?.vital_signs ?? []).length > 0 && (
                <div>
                  <h4 className="font-semibold mb-1">Sinais Vitais</h4>
                  <ul className="list-disc pl-5 text-muted-foreground">
                    {viewingCase.patient_info.vital_signs.map((v: any, i: number) => (
                      <li key={i}>{v.parameter}: {v.value} {v.unit} (ref. {v.reference}) — {v.classification}</li>
                    ))}
                  </ul>
                </div>
              )}
              {(viewingCase.investigation_data?.lab_exams ?? []).length > 0 && (
                <div>
                  <h4 className="font-semibold mb-1">Exames Laboratoriais</h4>
                  <ul className="list-disc pl-5 text-muted-foreground">
                    {viewingCase.investigation_data.lab_exams.map((e: any, i: number) => (
                      <li key={i}>{e.exam}: {e.value} {e.unit} (ref. {e.reference}){e.classification ? ` — ${e.classification}` : ""}</li>
                    ))}
                  </ul>
                </div>
              )}
              {(viewingCase.decision_tree?.evaluation_criteria ?? []).length > 0 && (
                <div>
                  <h4 className="font-semibold mb-1">Critérios de Avaliação</h4>
                  <ul className="list-disc pl-5 text-muted-foreground">
                    {viewingCase.decision_tree.evaluation_criteria.map((c: string, i: number) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => downloadCasePDF(viewingCase)}>
                <Download className="h-4 w-4 mr-2" /> Baixar PDF
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {editingCase && (
        <Dialog open onOpenChange={() => setEditingCase(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Editar caso clínico</DialogTitle>
              <DialogDescription>Ajuste título, resumo, conteúdo do caso, prazo e penalidade por atraso.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Título</Label>
                <Input
                  value={editingCase.title ?? ""}
                  onChange={(e) => setEditingCase({ ...editingCase, title: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Resumo do cenário</Label>
                <Textarea
                  value={editingCase.description ?? ""}
                  onChange={(e) => setEditingCase({ ...editingCase, description: e.target.value })}
                />
              </div>

              <div className="space-y-3 pt-2 border-t border-white/5">
                <p className="text-sm font-semibold">Conteúdo do Caso</p>
                {([
                  ["chief_complaint", "Queixa Principal", 2],
                  ["anamnesis", "Anamnese", 8],
                  ["history", "Histórico", 5],
                ] as const).map(([key, label, rows]) => (
                  <div key={key} className="space-y-2">
                    <Label>{label}</Label>
                    <Textarea
                      rows={rows}
                      value={editingCase.patient_info?.[key] ?? ""}
                      onChange={(e) =>
                        setEditingCase({
                          ...editingCase,
                          patient_info: { ...(editingCase.patient_info ?? {}), [key]: e.target.value },
                        })
                      }
                    />
                  </div>
                ))}
              </div>

              
              <div className="grid grid-cols-2 gap-4 pt-2 border-t border-white/5">
                <div className="space-y-2">
                  <Label>Data Limite</Label>
                  <Input
                    type="date"
                    value={editingCase.due_date ? format(new Date(editingCase.due_date), "yyyy-MM-dd") : ""}
                    onChange={(e) => setEditingCase({ ...editingCase, due_date: e.target.value ? new Date(`${e.target.value}T${editingCase.due_time || '23:59'}:00`).toISOString() : null })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Horário Limite</Label>
                  <Input
                    type="time"
                    value={editingCase.due_time || '23:59'}
                    onChange={(e) => setEditingCase({ ...editingCase, due_time: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-4 pt-2 border-t border-white/5">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm">Aceitar entrega após o prazo</Label>
                    <p className="text-[10px] text-muted-foreground">Permite envios tardios com penalidade automática.</p>
                  </div>
                  <Switch
                    checked={!!editingCase.allow_late_submission}
                    onCheckedChange={(v: boolean) => setEditingCase({ ...editingCase, allow_late_submission: v })}
                  />
                </div>

                {editingCase.allow_late_submission && (
                  <div className="space-y-4 pl-3 border-l-2 border-primary/30 animate-in slide-in-from-left-2">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Tipo de Penalidade</Label>
                        <Select 
                          value={editingCase.late_penalty_type || 'percentage'} 
                          onValueChange={(v) => setEditingCase({ ...editingCase, late_penalty_type: v })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="percentage">Porcentagem (%)</SelectItem>
                            <SelectItem value="fixed">Valor Fixo (Pontos)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>{editingCase.late_penalty_type === 'fixed' ? 'Pontos/dia' : '%/dia'}</Label>
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          value={editingCase.late_penalty_per_day ?? 0}
                          onChange={(e) => setEditingCase({ ...editingCase, late_penalty_per_day: Number(e.target.value) })}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Tolerância (Data)</Label>
                        <Input
                          type="date"
                          value={editingCase.late_tolerance_date || ''}
                          onChange={(e) => setEditingCase({ ...editingCase, late_tolerance_date: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Tolerância (Hora)</Label>
                        <Input
                          type="time"
                          value={editingCase.late_tolerance_time || '23:59'}
                          onChange={(e) => setEditingCase({ ...editingCase, late_tolerance_time: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEditingCase(null)}>
                Cancelar
              </Button>
              <Button disabled={savingEdit} onClick={saveCaseEdits}>
                {savingEdit && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {submissionsCase && (
        <Dialog open onOpenChange={() => setSubmissionsCase(null)}>
          <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Submissões — {submissionsCase.title}</DialogTitle>
              <DialogDescription>
                Pré-avaliação da IA com cálculo transparente da nota (desconto por atraso) e alerta de similaridade.
              </DialogDescription>
            </DialogHeader>
            {renderSubmissionsQueue(
              submissions.filter((s) => s.case_id === submissionsCase.id),
              "Submissões do caso",
            )}
          </DialogContent>
        </Dialog>
      )}
      {reviewModal && (() => {
        const sub = reviewModal.sub;
        const clinicalCase = cases.find((item) => item.id === sub.case_id);

        // 5 rubricas clínicas fixas para avaliação de simulações de saúde
        // These match the backend CLINICAL_RUBRIC_5 in simulsaude-review.functions.ts
        const CLINICAL_RUBRIC_5 = [
          { name: "Análise de Dados e Identificação", max_score: 2.0, weight: 20 },
          { name: "Raciocínio Clínico e Diagnóstico", max_score: 2.5, weight: 25 },
          { name: "Conduta Terapêutica e Manejo", max_score: 3.0, weight: 30 },
          { name: "Justificativa e Base Científica", max_score: 1.5, weight: 15 },
          { name: "Segurança do Paciente e Visão Holística", max_score: 1.0, weight: 10 },
        ];

        const defaultRubric: SubmissionReviewCriterion[] = CLINICAL_RUBRIC_5.map((crit, index) => ({
          id: `c${index + 1}`,
          name: crit.name,
          weight: crit.weight,
          max_score: crit.max_score,
        }));
        const reviewRow: SubmissionReviewRow = {
          id: sub.id,
          student_id: sub.student_id,
          student_name: sub.profiles?.name || "Aluno",
          enrollment_number: null,
          parent_id: sub.case_id,
          parent_title: clinicalCase?.title || "Caso clínico",
          file_url: "inline_submission",
          status: sub.status,
          submitted_at: sub.submitted_at,
          released_at: sub.graded_at ?? null,
          total_score: sub.score ?? null,
          final_score: sub.score ?? null,
          final_feedback: sub.feedback ?? null,
          ai_feedback_draft: null,
          ai_usage_report: null,
          rubric_snapshot: defaultRubric,
          rubric_scores: Array.isArray(sub.rubricScores)
            ? sub.rubricScores.map((item: any) => ({ id: item.id, score: Number(item.score), comment: item.comment }))
            : null,
          diary_assessment_id: sub.diary_assessment_id ?? manualDiaryColumn ?? null,
          parent_diary_assessment_id: manualDiaryColumn || null,
        };
        const submissionText = `Conduta escolhida: ${sub.answers?.conduct?.label || "Não selecionada"}\n\nJustificativa clínica:\n${sub.answers?.text || "Sem texto"}`;
        return (
          <CorrectionDialog
            key={`${sub.id}-${reviewModal.nonce ?? 0}`}
            submission={reviewRow}
            disciplineId={disciplineId}
            kind="activity"
            defaultRubric={defaultRubric}
            onClose={() => setReviewModal(null)}
            onChanged={() => {
              setReviewModal(null);
              fetchData();
            }}
            clinicalAdapter={{
              submissionText,
              onSuggest: async () => {
                const { reviewClinicalSubmission } = await import("@/backend/simulsaude-review.functions");
                const result = await reviewClinicalSubmission({ data: { submissionId: sub.id, reset: !!reviewModal.reset } });
                return {
                  score: result.score,
                  feedback: result.feedback,
                  rubricScores: result.rubricScores,
                };
              },
              onPublish: async ({ score, feedback, diaryAssessmentId }) => {
                const { publishClinicalSubmissionGrade } = await import("@/backend/simulsaude-review.functions");
                await publishClinicalSubmissionGrade({
                  data: { submissionId: sub.id, disciplineId, diaryAssessmentId, score, feedback },
                });
              },
              onDownloadSource: () => clinicalCase && downloadCasePDF(clinicalCase),
              onDownloadFeedback: ({ score, feedback }) => downloadClinicalFeedbackPDF({ ...sub, score, feedback }),
            }}
          />
        );
      })()}
    </div>
  );
};