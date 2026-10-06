import { useEffect, useMemo, useState } from "react";
import { sortItemsNumerically } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2,
  Plus,
  Trash2,
  FileDown,
  ClipboardCheck,
  FileText,
  ScanLine,
  BarChart3,
  ShieldAlert,
  Pencil,
  Globe,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  listAssessments,
  listAssessmentApostilas,
  generateAssessment,
  deleteAssessment,
  exportAssessmentPDF,
  listAssessmentTargets,
  generateAssessmentReport,
  updateAssessmentSettings,
} from "@/backend/assessments.functions";
import { OnlineExamConfigDialog } from "./OnlineExamConfigDialog";
import { AssessmentGraderDialog } from "./AssessmentGraderDialog";
import { AssessmentReviewDialog } from "./AssessmentReviewDialog";
import { supabase } from "@/integrations/supabase/client";

type Assessment = {
  id: string;
  title: string;
  module_name: string | null;
  max_score: number;
  version_count: number;
  copies_per_version: number;
  status: string;
  created_at: string;
  diary_assessment_id: string | null;
  diary_column_label?: string | null;
  assessment_date?: string | null;
  pending_audits?: number;
  kept_audits?: number;
  config?: {
    kind?: "regular" | "second_call" | "recovery";
    target_student_ids?: string[] | null;
  } | null;
};

const KIND_LABELS: Record<string, string> = {
  regular: "Regular",
  second_call: "Segunda chamada",
  recovery: "Recuperação",
  turma_dividida: "Turma Dividida",
};
const KIND_BADGE: Record<string, string> = {
  regular: "bg-muted text-muted-foreground",
  second_call: "bg-blue-100 text-blue-700",
  recovery: "bg-amber-100 text-amber-800",
  turma_dividida: "bg-teal-100 text-teal-800",
};

/**
 * Formata a data da avaliação tratando a string como data LOCAL
 * (evita o retrocesso de um dia causado pelo offset UTC).
 * Oculta o horário quando ele não foi definido (00:00) ou é inválido.
 */
function formatAssessmentDateLabel(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "—";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (m) {
    const [, y, mo, d, hh, mm] = m;
    const label = `${d}/${mo}/${y}`;
    if (hh == null || mm == null) return label;
    if (hh === "00" && mm === "00") return label;
    return `${label} às ${hh}:${mm}`;
  }
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) return s;
  const label = parsed.toLocaleDateString("pt-BR");
  if (parsed.getHours() === 0 && parsed.getMinutes() === 0) return label;
  return `${label} às ${parsed.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

export function AssessmentsModule({ disciplineId }: { disciplineId: string }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Assessment[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [graderFor, setGraderFor] = useState<Assessment | null>(null);
  const [reviewFor, setReviewFor] = useState<any>(null);
  const [reportFor, setReportFor] = useState<Assessment | null>(null);
  const [editFor, setEditFor] = useState<Assessment | null>(null);
  const [onlineExamFor, setOnlineExamFor] = useState<Assessment | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportText, setReportText] = useState("");
  const [reportFilename, setReportFilename] = useState("relatorio.md");

  const openReport = async (a: Assessment) => {
    setReportFor(a);
    setReportText("");
    setReportLoading(true);
    try {
      const r = await generateAssessmentReport({ data: { id: a.id } });
      setReportText(r.report);
      setReportFilename(r.filename);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar relatório");
      setReportFor(null);
    } finally {
      setReportLoading(false);
    }
  };

  const downloadReport = () => {
    const blob = new Blob([reportText], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = reportFilename;
    el.style.display = "none";
    document.body.appendChild(el);
    el.click();
    setTimeout(() => {
      document.body.removeChild(el);
      URL.revokeObjectURL(url);
    }, 1500);
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await listAssessments({ data: { discipline_id: disciplineId } });
      setItems(sortItemsNumerically(r.items as Assessment[]));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    refresh();
  }, [disciplineId]);

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir esta avaliação? As versões e folhas geradas serão removidas.")) return;
    try {
      await deleteAssessment({ data: { id } });
      toast.success("Removida");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  const handleExport = async (
    id: string,
    block: "all" | "questions" | "answers" | "keys" = "all",
  ) => {
    const target = items.find((i) => i.id === id);
    if (target && (target.pending_audits ?? 0) > 0) {
      toast.error(
        "Há questões marcadas como problemáticas. Escolha corrigir, editar ou manter conscientemente antes de gerar o PDF.",
      );
      setReviewFor(target);
      return;
    }
    const t = toast.loading("Gerando PDF...", {
      duration: 10000,
    });
    try {
      const r = await exportAssessmentPDF({ data: { id, block } });
      const blob = new Blob([Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0))], {
        type: "application/pdf",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename;
      a.rel = "noopener";
      a.style.display = "none";
      document.body.appendChild(a);

      // Delay de renderização para garantir recursos carregados no servidor (caso as sementes mudem)
      await new Promise((resolve) => setTimeout(resolve, 300));

      a.click();

      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 60000);

      toast.success("🎉 Avaliação pronta para baixar!", {
        id: t,
        duration: 5000,
        action: {
          label: "Baixar Agora",
          onClick: () => {
            a.click();
            toast.dismiss(t);
          },
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao gerar PDF";
      if (msg.includes("REVISAO_PENDENTE")) {
        toast.error("Existem questões aguardando revisão. Abra a revisão da avaliação.", {
          id: t,
          duration: Infinity,
          action: {
            label: "Visualizar Prova",
            onClick: () => {
              if (target) setReviewFor(target);
              toast.dismiss(t);
            },
          },
        });
        refresh();
      } else {
        toast.error(msg, { id: t, duration: 8000 });
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-white">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-white" />
            Avaliações
          </h2>
          <p className="text-sm opacity-80">
            Central de correção automática das avaliações criadas pelo Criador de Avaliações
            (Assistente de IA). Aqui você imprime as folhas com QR Code, faz a leitura óptica das
            respostas e acompanha os resultados.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-xl border bg-card/50 p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 animate-pulse"
            >
              <div className="flex-1 space-y-2">
                <div className="h-5 w-1/3 bg-muted rounded" />
                <div className="h-4 w-1/4 bg-muted/50 rounded" />
              </div>
              <div className="h-9 w-24 bg-muted rounded-md" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhuma avaliação criada ainda.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((a) => (
            <li
              key={a.id}
              className="rounded-xl border bg-card p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 min-w-0"
              style={{ boxShadow: "var(--shadow-card)" }}
            >
              <div className="min-w-0 flex-1 w-full break-words whitespace-normal">
                <div className="font-medium flex items-center gap-2 flex-wrap min-w-0">
                  <span className="break-words leading-tight">{a.title}</span>
                  {a.config?.kind && a.config.kind !== "regular" && (
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0 ${KIND_BADGE[a.config.kind as keyof typeof KIND_BADGE] || KIND_BADGE.regular}`}
                    >
                      {KIND_LABELS[a.config.kind as keyof typeof KIND_LABELS] || a.config.kind}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-1.5 gap-y-0.5 break-words whitespace-normal leading-tight">
                  <span className="whitespace-nowrap">
                    Nota máx. {Number(a.max_score).toFixed(1)}
                  </span>
                  <span className="opacity-50">•</span>
                  <span className="whitespace-nowrap">{a.version_count} versão(ões)</span>
                  <span className="opacity-50">•</span>
                  <span className="whitespace-nowrap">{a.copies_per_version} cópia(s)/versão</span>
                  {a.config?.kind && a.config.kind !== "regular" && a.config.target_student_ids && (
                    <>
                      <span className="opacity-50">•</span>
                      <span className="whitespace-nowrap">
                        {a.config.target_student_ids.length} aluno(s)
                      </span>
                    </>
                  )}
                </div>
                {a.module_name && (
                  <div className="text-xs text-muted-foreground mt-1 break-words whitespace-normal leading-tight">
                    Módulo/aulas: {a.module_name}
                  </div>
                )}
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                  {a.diary_assessment_id && (
                    <div className="text-xs text-primary break-words leading-tight">
                      Lançamento no diário: {a.diary_column_label ?? "—"}
                    </div>
                  )}
                  {a.assessment_date && (
                    <div className="text-xs text-muted-foreground leading-tight">
                      Data:{" "}
                      {a.assessment_date.split(" | ").map((dt, idx) => (
                        <span key={dt}>
                          {idx > 0 && " | "}
                          {formatAssessmentDateLabel(dt)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {(a.pending_audits ?? 0) > 0 ? (
                  <button
                    type="button"
                    onClick={() => setReviewFor(a)}
                    className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-200 w-fit"
                  >
                    <ShieldAlert className="h-3.5 w-3.5" />
                    {a.pending_audits} questão(ões) aguardam revisão — PDFs bloqueados
                  </button>
                ) : (a.kept_audits ?? 0) > 0 ? (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Validada com {a.kept_audits} questão(ões) mantida(s) pelo professor.
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap md:flex-nowrap gap-1.5 shrink-0 w-full md:w-auto overflow-x-auto pb-1 md:pb-0 scrollbar-none">
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => setGraderFor(a)}
                  className="whitespace-nowrap"
                  title="Abrir corretor (QR + objetivas)"
                >
                  <ScanLine className="h-4 w-4 mr-1" /> Corretor
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setOnlineExamFor(a)}
                  title="Configurar Prova Online"
                >
                  <Globe className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditFor(a)} title="Editar">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="outline" onClick={() => setReviewFor(a)} title="Revisão">
                  <ShieldAlert
                    className={`h-4 w-4 ${(a.pending_audits ?? 0) > 0 ? "text-amber-600" : ""}`}
                  />
                </Button>
                <Button size="sm" variant="outline" onClick={() => openReport(a)} title="Relatório">
                  <BarChart3 className="h-4 w-4" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" title="Baixar PDF">
                      <FileDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuLabel>Baixar PDF</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => handleExport(a.id, "all")}>
                      PDF completo (3 blocos)
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => handleExport(a.id, "questions")}>
                      Bloco 1 — Folhas de Questões
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExport(a.id, "answers")}>
                      Bloco 2 — Folhas de Resposta (com QR)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExport(a.id, "keys")}>
                      Bloco 3 — Gabarito do Professor
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDelete(a.id)}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  title="Excluir"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AssessmentWizardDialog
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        disciplineId={disciplineId}
        onCreated={() => {
          setWizardOpen(false);
          refresh();
        }}
        setReviewFor={setReviewFor}
        handleExport={handleExport}
      />

      {graderFor && (
        <AssessmentGraderDialog
          open={!!graderFor}
          onClose={() => setGraderFor(null)}
          assessmentId={graderFor.id}
          assessmentTitle={graderFor.title}
          disciplineId={disciplineId}
          diaryAssessmentId={graderFor.diary_assessment_id}
        />
      )}

      {reviewFor && (
        <AssessmentReviewDialog
          open={!!reviewFor}
          onClose={() => {
            setReviewFor(null);
            refresh();
          }}
          assessmentId={reviewFor.id}
          onResolved={refresh}
        />
      )}

      {onlineExamFor && (
        <OnlineExamConfigDialog
          assessmentId={onlineExamFor.id}
          disciplineId={disciplineId}
          defaultTitle={onlineExamFor.title}
          defaultMaxScore={Number(onlineExamFor.max_score) || 10}
          onClose={() => setOnlineExamFor(null)}
          onSaved={() => refresh()}
        />
      )}
      {editFor && (
        <AssessmentEditDialog
          assessment={editFor}
          disciplineId={disciplineId}
          onClose={() => setEditFor(null)}
          onSaved={() => {
            setEditFor(null);
            refresh();
          }}
        />
      )}

      <Dialog
        open={!!reportFor}
        onOpenChange={(o) => {
          if (!o) setReportFor(null);
        }}
      >
        <DialogContent className="max-w-3xl w-[92vw] sm:w-full overflow-x-hidden max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Relatório da avaliação</DialogTitle>
            <DialogDescription>
              Análise pedagógica de {reportFor?.title} — visão geral, equilíbrio de conteúdo e
              dificuldade, ajustes e recomendações.
            </DialogDescription>
          </DialogHeader>
          {reportLoading ? (
            <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              Analisando as questões...
            </div>
          ) : (
            <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed font-sans">
              {reportText}
            </pre>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReportFor(null)}>
              Fechar
            </Button>
            <Button onClick={downloadReport} disabled={!reportText}>
              <FileText className="h-4 w-4 mr-1" /> Baixar relatório
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type DiaryColumn = { id: string; name: string; weight: number; max_score: number };

async function fetchDiaryColumns(disciplineId: string): Promise<DiaryColumn[]> {
  const { data } = await supabase
    .from("grade_structures")
    .select("assessments")
    .eq("discipline_id", disciplineId)
    .maybeSingle();
  const arr = Array.isArray(data?.assessments) ? (data!.assessments as unknown[]) : [];
  const cols: DiaryColumn[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const a = raw as {
      id?: unknown;
      name?: unknown;
      weight?: unknown;
      max_score?: unknown;
      sub_items?: unknown;
    };
    if (typeof a.id !== "string" || typeof a.name !== "string") continue;
    const subs = Array.isArray(a.sub_items)
      ? (a.sub_items as Array<{ id?: unknown; name?: unknown }>)
      : [];
    const validSubs = subs.filter(
      (s) => s && typeof s.id === "string" && typeof s.name === "string",
    ) as Array<{ id: string; name: string }>;
    const weight = typeof a.weight === "number" ? a.weight : 0;
    const maxScore = typeof a.max_score === "number" ? a.max_score : 10;
    if (validSubs.length > 0) {
      for (const sub of validSubs) {
        cols.push({
          id: `${a.id}#${sub.id}`,
          name: `${a.name} — ${sub.name}`,
          weight,
          max_score: maxScore,
        });
      }
    } else {
      cols.push({ id: a.id, name: a.name, weight, max_score: maxScore });
    }
  }
  return cols;
}

function AssessmentEditDialog({
  assessment,
  disciplineId,
  onClose,
  onSaved,
}: {
  assessment: Assessment;
  disciplineId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [cols, setCols] = useState<DiaryColumn[]>([]);
  const [title, setTitle] = useState(assessment.title);
  const [moduleName, setModuleName] = useState(assessment.module_name ?? "");
  const [diaryCol, setDiaryCol] = useState(assessment.diary_assessment_id ?? "");
  const [date, setDate] = useState(assessment.assessment_date?.split("T")[0] ?? "");
  const [time, setTime] = useState(
    assessment.assessment_date?.includes("T")
      ? assessment.assessment_date.split("T")[1].slice(0, 5)
      : "",
  );

  // Modalidade e Data Secundária
  const [modalidade, setModalidade] = useState<string>("regular");
  const [date2, setDate2] = useState("");
  const [time2, setTime2] = useState("");

  useEffect(() => {
    // Tenta detectar se já existe uma segunda data concatenada
    if (assessment.assessment_date?.includes(" | ")) {
      const parts = assessment.assessment_date.split(" | ");
      if (parts.length > 1) {
        const p1 = parts[0];
        const p2 = parts[1];

        setDate(p1.split("T")[0]);
        setTime(p1.includes("T") ? p1.split("T")[1].slice(0, 5) : "");

        setDate2(p2.split("T")[0]);
        setTime2(p2.includes("T") ? p2.split("T")[1].slice(0, 5) : "");
        setModalidade("turma_dividida");
      }
    }
  }, [assessment.assessment_date]);
  const [maxScore, setMaxScore] = useState<number>(Number(assessment.max_score) || 10);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchDiaryColumns(disciplineId)
      .then(setCols)
      .catch(() => setCols([]));
  }, [disciplineId]);

  const save = async () => {
    if (title.trim().length < 3) return toast.error("Informe um título com ao menos 3 caracteres.");
    if (!diaryCol) return toast.error("Selecione a coluna do diário para lançamento da nota.");
    if (!date) return toast.error("Informe a data da avaliação.");
    if (!time) return toast.error("Informe o horário da avaliação.");

    let isoDate = `${date}T${time}:00`;
    if (modalidade === "turma_dividida" && date2 && time2) {
      isoDate += ` | ${date2}T${time2}:00`;
    }

    if (!(maxScore > 0)) return toast.error("Informe o valor máximo da nota.");

    const safeTitle = title.trim().substring(0, 140);

    setSaving(true);
    try {
      await updateAssessmentSettings({
        data: {
          id: assessment.id,
          title: safeTitle,
          module_name: moduleName.trim() || null,
          diary_assessment_id: diaryCol,
          assessment_date: isoDate,
          max_score: maxScore,
        },
      });
      toast.success("Avaliação atualizada. Diário e calendário sincronizados.");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-lg w-[92vw] sm:w-full max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar avaliação</DialogTitle>
          <DialogDescription>
            Ajuste o título, o módulo vinculado, a coluna do diário, a data da prova e o valor
            máximo da nota.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-title">Título</Label>
            <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-module">Módulo / aulas vinculadas</Label>
            <Textarea
              id="edit-module"
              rows={2}
              value={moduleName}
              onChange={(e) => setModuleName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-diary">
              Coluna do Diário Digital <span className="text-destructive">*</span>
            </Label>
            <select
              id="edit-diary"
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={diaryCol}
              onChange={(e) => setDiaryCol(e.target.value)}
            >
              <option value="">Selecione uma coluna do diário...</option>
              {cols.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (peso {c.weight} · máx {c.max_score})
                </option>
              ))}
            </select>
            {cols.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Nenhuma coluna cadastrada. Configure as avaliações em Notas &amp; Diário.
              </p>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 col-span-full">
              <Label>
                Data e Horário da Avaliação <span className="text-destructive">*</span>
              </Label>
              <Input
                type="datetime-local"
                className="w-full"
                value={date ? `${date}T${time || ""}` : ""}
                onChange={(e) => {
                  const [d, t] = e.target.value.split("T");
                  setDate(d ?? "");
                  setTime((t ?? "").slice(0, 5));
                }}
                required
              />
            </div>

            <div className="space-y-1.5 col-span-full">
              <Label htmlFor="edit-modalidade">Modalidade da Prova</Label>
              <select
                id="edit-modalidade"
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={modalidade}
                onChange={(e) => setModalidade(e.target.value)}
              >
                <option value="regular">Regular</option>
                <option value="segunda_chamada">Segunda Chamada</option>
                <option value="recuperacao">Recuperação</option>
                <option value="turma_dividida">Turma Dividida — duas datas</option>
              </select>

              {modalidade === "turma_dividida" && (
                <div className="mt-2 space-y-1.5 p-3 rounded-md bg-muted/30 border border-dashed animate-in fade-in slide-in-from-top-1">
                  <Label>
                    2ª Data da Avaliação (Turma B) <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    type="datetime-local"
                    className="w-full"
                    value={date2 ? `${date2}T${time2 || ""}` : ""}
                    onChange={(e) => {
                      const [d, t] = e.target.value.split("T");
                      setDate2(d ?? "");
                      setTime2((t ?? "").slice(0, 5));
                    }}
                    required={modalidade === "turma_dividida"}
                  />
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-max">Valor máximo da nota</Label>
              <Input
                id="edit-max"
                type="number"
                min={0.1}
                step="0.1"
                value={maxScore}
                onChange={(e) => setMaxScore(Number(e.target.value) || 0)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Salvar alterações
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssessmentWizardDialog({
  open,
  onClose,
  disciplineId,
  onCreated,
  setReviewFor,
  handleExport,
}: {
  open: boolean;
  onClose: () => void;
  disciplineId: string;
  onCreated: () => void;
  setReviewFor: (a: any) => void;
  handleExport: (id: string) => void;
}) {
  const [apostilas, setApostilas] = useState<Array<{ id: string; title: string }>>([]);
  const [apostilaId, setApostilaId] = useState("");
  const [title, setTitle] = useState("");
  const [titleEditado, setTitleEditado] = useState(false);
  const [moduleLessons, setModuleLessons] = useState("");
  const [moduloEditado, setModuloEditado] = useState(false);

  // Nome do módulo extraído do título da apostila ("Apostila — Módulo 1" → "Módulo 1").
  const apostilaSelecionada = apostilas.find((a) => a.id === apostilaId);
  const moduloDaApostila = useMemo(() => {
    const bruto = (apostilaSelecionada?.title ?? "").trim();
    if (!bruto) return "";
    const modulo = bruto
      .replace(/^apostila\s*[—–\-:]?\s*/i, "")
      .replace(/\s*[—–\-:]?\s*$/, "")
      .trim();
    // Se o título não tiver nada além da palavra "Apostila", usa o título
    // inteiro: sem isso o campo "módulo/aulas" (oculto na tela) ficaria vazio
    // e o botão "Gerar avaliação" bloquearia sem forma de o usuário corrigir.
    return modulo || bruto;
  }, [apostilaSelecionada?.title]);

  // Título preenchido automaticamente: "Avaliação: {módulo}".
  // Só é sobrescrito enquanto o usuário não tiver digitado um título próprio.
  useEffect(() => {
    if (!moduloDaApostila) return;
    if (!titleEditado) setTitle(`Avaliação: ${moduloDaApostila}`);
    // O módulo/aulas também é preenchido no background: o botão "Gerar
    // avaliação" exige esse campo, então ele continua sendo enviado ao backend
    // mesmo estando oculto na interface.
    if (!moduloEditado) setModuleLessons(moduloDaApostila);
  }, [moduloDaApostila, titleEditado, moduloEditado]);

  const [mc, setMc] = useState(5);
  const [tf, setTf] = useState(2);
  const [fb, setFb] = useState(2);
  const [es, setEs] = useState(1);
  // Tipos de questão marcados pelo usuário. As quantidades em mc/tf/fb/es
  // continuam sendo a fonte de verdade enviada ao backend; os checkboxes
  // apenas controlam quais tipos aparecem na tela.
  const TIPOS_QUESTAO = [
    { id: "multiple_choice", label: "Múltipla escolha" },
    { id: "true_false", label: "V/F" },
    { id: "fill_blank", label: "Lacunas" },
    { id: "essay", label: "Dissertativa" },
  ] as const;
  type TipoQuestaoId = (typeof TIPOS_QUESTAO)[number]["id"];
  const [tiposAtivos, setTiposAtivos] = useState<TipoQuestaoId[]>([
    "multiple_choice",
    "true_false",
    "fill_blank",
    "essay",
  ]);
  const [qtdPorTipo, setQtdPorTipo] = useState<Record<TipoQuestaoId, number>>({
    multiple_choice: 5,
    true_false: 2,
    fill_blank: 2,
    essay: 1,
  });
  const [maxScore, setMaxScore] = useState(10);
  const [versions, setVersions] = useState(2);
  const [shuffleItems, setShuffleItems] = useState(true);
  const [diaryCol, setDiaryCol] = useState("");
  const [wizardCols, setWizardCols] = useState<DiaryColumn[]>([]);
  const [assessmentDate, setAssessmentDate] = useState("");
  const [assessmentTime, setAssessmentTime] = useState("");

  // Data secundária (Turma B)
  const [assessmentDate2, setAssessmentDate2] = useState("");
  const [assessmentTime2, setAssessmentTime2] = useState("");

  const [rigor, setRigor] = useState<"light" | "balanced" | "strict">("balanced");
  const [submitting, setSubmitting] = useState(false);

  // Parâmetros pedagógicos avançados.
  type DiffLevel = "basico" | "medio" | "avancado" | "superior";
  const [topicsText, setTopicsText] = useState("");
  const [difficultyLevel, setDifficultyLevel] = useState<DiffLevel>("medio");
  const [diffMC, setDiffMC] = useState<DiffLevel>("medio");
  const [diffTF, setDiffTF] = useState<DiffLevel>("medio");
  const [diffFB, setDiffFB] = useState<DiffLevel>("medio");
  const [diffES, setDiffES] = useState<DiffLevel>("medio");
  const [layoutTemplate, setLayoutTemplate] = useState<
    "classic" | "compact" | "two_column" | "exam_board"
  >("classic");
  const QUALITY_RULES: Array<{ id: string; label: string }> = [
    { id: "evitar_repeticao", label: "Evitar repetição de enunciados" },
    { id: "distratores_plausiveis", label: "Distratores plausíveis (múltipla escolha)" },
    { id: "clareza_precisao", label: "Clareza e precisão na linguagem" },
    { id: "contexto_especifico", label: "Contexto específico do conteúdo" },
    { id: "estrutura_vf", label: "Estrutura correta de blocos V/F" },
    { id: "estrutura_lacunas", label: "Estrutura correta de blocos de lacunas" },
  ];
  const [qualityRules, setQualityRules] = useState<string[]>([
    "evitar_repeticao",
    "distratores_plausiveis",
    "clareza_precisao",
    "contexto_especifico",
  ]);
  const toggleQuality = (id: string) =>
    setQualityRules((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));

  // Novos campos solicitados (UI). Bindam-se aos states existentes para
  // não duplicar dados nem alterar o payload enviado ao servidor.
  const [pesoMode, setPesoMode] = useState<"igual" | "personalizado">("igual");
  const [pesoMC, setPesoMC] = useState(1);
  const [pesoTF, setPesoTF] = useState(1);
  const [pesoFB, setPesoFB] = useState(1);
  const [pesoES, setPesoES] = useState(1);
  const [studentCount, setStudentCount] = useState<number | null>(null);

  // Modalidade da prova: regular (turma toda), segunda chamada, recuperação ou turma dividida.
  type Kind = "regular" | "second_call" | "recovery" | "turma_dividida";
  const [kind, setKind] = useState<Kind>("regular");
  const [allStudents, setAllStudents] = useState<
    Array<{ id: string; name: string; enrollment_number: string | null }>
  >([]);
  const [recoveryIds, setRecoveryIds] = useState<string[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [studentSearch, setStudentSearch] = useState("");

  const toggleStudent = (id: string) =>
    setSelectedStudents((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  useEffect(() => {
    if (!open) return;
    listAssessmentApostilas({ data: { discipline_id: disciplineId } })
      .then((r) => {
        const sorted = (r.items as Array<{ id: string; title: string; created_at: string }>).sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
        setApostilas(sorted);
      })
      .catch(() => setApostilas([]));
    fetchDiaryColumns(disciplineId)
      .then(setWizardCols)
      .catch(() => setWizardCols([]));
    (async () => {
      try {
        const { count } = await supabase
          .from("discipline_students")
          .select("student_id", { count: "exact", head: true })
          .eq("discipline_id", disciplineId);
        setStudentCount(count ?? 0);
      } catch {
        setStudentCount(null);
      }
    })();
    // Carrega alunos matriculados e candidatos à recuperação para os
    // seletores de "Segunda chamada" e "Recuperação".
    listAssessmentTargets({ data: { discipline_id: disciplineId } })
      .then((r) => {
        setAllStudents(r.students as typeof allStudents);
        setRecoveryIds(r.recovery_student_ids as string[]);
      })
      .catch(() => {
        setAllStudents([]);
        setRecoveryIds([]);
      });
    setKind("regular");
    setSelectedStudents([]);
    setStudentSearch("");
  }, [open, disciplineId]);

  // Ao trocar para "Recuperação", pré-seleciona os alunos elegíveis.
  useEffect(() => {
    if (kind === "recovery") setSelectedStudents(recoveryIds);
    if (kind === "regular") setSelectedStudents([]);
    if (kind === "second_call") setSelectedStudents((prev) => prev);
  }, [kind, recoveryIds]);

  const totalQ = mc + tf + fb + es;

  // Setters por tipo: mantêm mc/tf/fb/es sincronizados com a tabela de
  // quantidades, que é o que de fato vai para o payload.
  const setQtd = (id: TipoQuestaoId, n: number) => {
    const valor = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
    setQtdPorTipo((prev) => ({ ...prev, [id]: valor }));
    if (id === "multiple_choice") setMc(valor);
    if (id === "true_false") setTf(valor);
    if (id === "fill_blank") setFb(valor);
    if (id === "essay") setEs(valor);
  };

  // Marca/desmarca um tipo. Ao desmarcar, a quantidade vai a zero (continua
  // válida no payload) e o total é redistribuído entre os tipos restantes.
  const alternarTipo = (id: TipoQuestaoId, marcado: boolean) => {
    setTiposAtivos((prevAtivos) => {
      const ativos = marcado
        ? TIPOS_QUESTAO.map((t) => t.id).filter((t) => [...prevAtivos, id].includes(t))
        : prevAtivos.filter((t) => t !== id);

      if (ativos.length === 0) {
        // Mantém ao menos um tipo marcado para não quebrar o formulário.
        return prevAtivos.length === 0 ? prevAtivos : [id];
      }

      if (marcado && !prevAtivos.includes(id)) {
        // Ao ligar um tipo novo, divide o total igualmente entre todos.
        const total = TIPOS_QUESTAO.filter((t) => ativos.includes(t.id)).reduce(
          (acc, t) => acc + qtdPorTipo[t.id],
          0,
        );
        const base = Math.floor(total / ativos.length);
        const resto = total % ativos.length;
        const novaTabela = { ...qtdPorTipo };
        ativos.forEach((t, i) => {
          novaTabela[t] = base + (i < resto ? 1 : 0);
        });
        setQtdPorTipo(novaTabela);
        setMc(novaTabela.multiple_choice);
        setTf(novaTabela.true_false);
        setFb(novaTabela.fill_blank);
        setEs(novaTabela.essay);
      } else if (!marcado) {
        const novaTabela = { ...qtdPorTipo, [id]: 0 };
        setQtdPorTipo(novaTabela);
        if (id === "multiple_choice") setMc(0);
        if (id === "true_false") setTf(0);
        if (id === "fill_blank") setFb(0);
        if (id === "essay") setEs(0);
      }
      return ativos;
    });
  };

  // Cálculo da soma dos pesos × quantidade por tipo.
  const pesoSum =
    pesoMode === "igual"
      ? totalQ > 0
        ? Number((Number(maxScore) || 0).toFixed(4))
        : 0
      : Number((mc * pesoMC + tf * pesoTF + fb * pesoFB + es * pesoES).toFixed(4));
  const pesoOK = totalQ === 0 || Math.abs(pesoSum - (Number(maxScore) || 0)) < 0.01;

  const submit = async () => {
    if (!apostilaId) return toast.error("Selecione uma apostila base.");

    // Check if the selected apostila actually has content
    const selectedApo = apostilas.find((a) => a.id === apostilaId);
    if (selectedApo && !moduleLessons.trim()) {
      return toast.error(
        "Por favor, informe o módulo/aulas ou garanta que a ementa esteja cadastrada antes de gerar a prova.",
      );
    }

    if (!title.trim()) return toast.error("Defina um título.");
    if (!moduleLessons.trim()) return toast.error("Informe o módulo/aulas a contemplar.");
    if (!diaryCol) return toast.error("Selecione a coluna do diário para lançamento da nota.");
    if (!assessmentDate) return toast.error("Informe a data da avaliação.");
    if (!assessmentTime) return toast.error("Informe o horário da avaliação.");

    let isoDate = `${assessmentDate}T${assessmentTime}:00`;
    if (kind === "turma_dividida" && assessmentDate2 && assessmentTime2) {
      isoDate += ` | ${assessmentDate2}T${assessmentTime2}:00`;
    }

    if (totalQ === 0) return toast.error("Defina ao menos uma questão.");
    if (!pesoOK) return toast.error("A soma dos pesos não corresponde à nota máxima.");
    if (kind !== "regular" && selectedStudents.length === 0) {
      return toast.error(
        kind === "recovery"
          ? "Nenhum aluno em recuperação selecionado."
          : "Selecione ao menos um aluno para a segunda chamada.",
      );
    }

    const safeTitle = title.trim().substring(0, 140);
    const safeTopics = topicsText
      .split(/[\n;]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 40)
      .map((topic) => topic.substring(0, 190));

    setSubmitting(true);
    const t = toast.loading("Gerando avaliação com IA...");
    try {
      const gen = await generateAssessment({
        data: {
          discipline_id: disciplineId,
          apostila_id: apostilaId,
          title: safeTitle,
          module_lessons: moduleLessons.trim(),
          counts: { multiple_choice: mc, true_false: tf, fill_blank: fb, essay: es },
          max_score: maxScore,
          version_count: versions,
          copies_per_version: 1,
          shuffle_questions: shuffleItems,
          layout: "mixed",
          diary_assessment_id: diaryCol,
          assessment_date: isoDate,
          rigor,
          topics: safeTopics,
          quality_rules: qualityRules,
          difficulty_level: difficultyLevel,
          difficulty_by_type: {
            multiple_choice: diffMC,
            true_false: diffTF,
            fill_blank: diffFB,
            essay: diffES,
          },
          layout_template: layoutTemplate,
          kind,
          target_student_ids: kind === "regular" ? null : selectedStudents,
        },
      });
      toast.success(
        "🎉 Avaliação criada com sucesso! Acesse suas avaliações para visualizar ou baixar os PDFs.",
        {
          id: t,
          duration: 5000,
          action: {
            label: "Baixar Agora",
            onClick: () => {
              handleExport(gen.id);
              toast.dismiss(t);
            },
          },
        },
      );
      const warns =
        (gen as { alignment_warnings?: Array<{ version: string; position: number }> })
          ?.alignment_warnings ?? [];
      if (warns.length > 0) {
        toast.warning(
          `${warns.length} questão(ões) podem estar desalinhadas com a apostila (ex.: versão ${warns[0].version}, questão ${warns[0].position}). Revise antes de aplicar.`,
          {
            duration: Infinity,
            action: {
              label: "Abrir Revisão",
              onClick: () => {
                if (gen.id) setReviewFor(gen as any);
              },
            },
          },
        );
      }
      onCreated();
    } catch (e) {
      console.error("Erro detalhado na geração da avaliação:", e);
      const msg = e instanceof Error ? e.message : "Erro";
      if (msg.includes("AI_CALL_TIMEOUT")) {
        toast.error(
          "O processamento da IA demorou muito. Tentando reprocessar em segundo plano...",
          { id: t },
        );
      } else {
        toast.error(msg, {
          id: t,
          duration: Infinity,
          action: { label: "Entendido", onClick: () => toast.dismiss(t) },
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            AVALIAÇÃO -{" "}
            {apostilas.find((a) => a.id === apostilaId)?.title?.toUpperCase() || "MÓDULO"}
          </DialogTitle>
          <DialogDescription>
            A IA gera questões pedagogicamente conectadas à apostila escolhida. Você poderá baixar o
            PDF com versões embaralhadas e folhas de resposta com QR Code.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Apostila base</Label>
            <Select value={apostilaId} onValueChange={setApostilaId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione uma apostila desta disciplina" />
              </SelectTrigger>
              <SelectContent>
                {(() => {
                  const getNome = (item: any) =>
                    String(item?.title || item?.titulo || item?.nome || item?.name || "")
                      .toLowerCase()
                      .trim();

                  const apostilasFiltradas = (apostilas || []).filter((item: any) => {
                    const texto = getNome(item);
                    // Permite APENAS o que contém a palavra 'apostila'
                    const ehApostila = texto.includes("apostila");
                    // Bloqueia explicitamente qualquer outro tipo
                    const ehIndesejado =
                      texto.includes("exercício") ||
                      texto.includes("exercicio") ||
                      texto.includes("slide") ||
                      texto.includes("plano") ||
                      texto.includes("ementa") ||
                      texto.includes("estudo de caso");
                    return ehApostila && !ehIndesejado;
                  });

                  if (apostilasFiltradas.length === 0) {
                    return (
                      <SelectItem value="none" disabled>
                        Nenhuma apostila disponível
                      </SelectItem>
                    );
                  }

                  return apostilasFiltradas.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.title}
                    </SelectItem>
                  ));
                })()}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Tema da Avaliação</Label>
            <Input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setTitleEditado(true);
              }}
              placeholder={
                moduloDaApostila ? `Avaliação: ${moduloDaApostila}` : "Avaliação: [Módulo]"
              }
            />
            <p className="text-xs text-muted-foreground mt-1">
              Preenchido automaticamente a partir da apostila selecionada. Edite se quiser
              personalizar.
            </p>
          </div>
          {/* "Módulo / aulas a contemplar" e "Tópicos de Conteúdo" seguem no
              estado e são enviados ao backend, mas ficam ocultos na interface:
              o módulo é preenchido automaticamente a partir da apostila. */}

          {/* Modalidade da prova */}
          <div className="rounded-md border bg-muted/20 p-3 space-y-3">
            <div>
              <Label>Modalidade</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="regular">Regular — toda a turma</SelectItem>
                  <SelectItem value="second_call">Segunda chamada — alunos específicos</SelectItem>
                  <SelectItem value="recovery">Recuperação — alunos em recuperação</SelectItem>
                  <SelectItem value="turma_dividida">Turma Dividida — duas datas</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {kind === "regular"
                  ? "A prova será distribuída para todos os alunos matriculados."
                  : kind === "second_call"
                    ? "Pesquise e selecione os alunos que farão a prova de segunda chamada. O professor tem liberdade para escolher os temas entre todos os módulos."
                    : kind === "recovery"
                      ? "Os alunos em recuperação (média abaixo da aprovação no diário) já aparecem selecionados. Você pode ajustar e escolher os temas entre todos os módulos."
                      : "A prova terá duas datas de aplicação (ex: Turma A e Turma B). Informe os dois momentos abaixo."}
              </p>
            </div>

            {kind === "turma_dividida" && (
              <div className="mt-2 space-y-2 p-3 rounded-md bg-muted/30 border border-dashed animate-in fade-in slide-in-from-top-1">
                <Label className="text-xs font-semibold">
                  2ª Data da Avaliação (Turma B) <span className="text-destructive">*</span>
                </Label>
                <div className="flex gap-2 items-center">
                  <Input
                    type="datetime-local"
                    className="w-full"
                    value={assessmentDate2 ? `${assessmentDate2}T${assessmentTime2 || ""}` : ""}
                    onChange={(e) => {
                      const [d, t] = e.target.value.split("T");
                      setAssessmentDate2(d ?? "");
                      setAssessmentTime2((t ?? "").slice(0, 5));
                    }}
                    required={kind === "turma_dividida"}
                  />
                </div>
              </div>
            )}

            {kind !== "regular" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs">
                    {kind === "recovery" ? "Alunos em recuperação" : "Alunos"} —{" "}
                    <span className="text-muted-foreground">
                      {selectedStudents.length} selecionado(s)
                    </span>
                  </Label>
                  {kind === "recovery" && recoveryIds.length > 0 && (
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() => setSelectedStudents(recoveryIds)}
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
                    const base =
                      kind === "recovery" && !q
                        ? allStudents.filter(
                            (s) => recoveryIds.includes(s.id) || selectedStudents.includes(s.id),
                          )
                        : allStudents;
                    const list = q
                      ? base.filter(
                          (s) =>
                            s.name.toLowerCase().includes(q) ||
                            (s.enrollment_number ?? "").toLowerCase().includes(q),
                        )
                      : base;
                    if (list.length === 0) {
                      return (
                        <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                          {kind === "recovery"
                            ? "Nenhum aluno em recuperação no diário. Você ainda pode pesquisar e selecionar manualmente."
                            : "Nenhum aluno encontrado."}
                        </div>
                      );
                    }
                    return list.map((s) => {
                      const checked = selectedStudents.includes(s.id);
                      const inRecovery = recoveryIds.includes(s.id);
                      return (
                        <label
                          key={s.id}
                          className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40"
                        >
                          <Checkbox checked={checked} onCheckedChange={() => toggleStudent(s.id)} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate">{s.name}</div>
                            {s.enrollment_number && (
                              <div className="text-[11px] text-muted-foreground">
                                Matrícula {s.enrollment_number}
                              </div>
                            )}
                          </div>
                          {inRecovery && kind === "second_call" && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                              recuperação
                            </span>
                          )}
                        </label>
                      );
                    });
                  })()}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-md border bg-muted/20 p-3 space-y-3">
            <div className="text-sm font-medium">Distribuição por Tipo de Questão</div>
            <p className="text-xs text-muted-foreground">
              Marque os tipos de questão que deseja incluir na prova e ajuste a quantidade de cada
              um.
            </p>

            <div className="space-y-2">
              {TIPOS_QUESTAO.map((t) => {
                const ativo = tiposAtivos.includes(t.id);
                return (
                  <div
                    key={t.id}
                    className="flex items-center justify-between gap-3 rounded-md border bg-background p-2.5"
                  >
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={ativo}
                        onCheckedChange={(v) => alternarTipo(t.id, v === true)}
                      />
                      <span>{t.label}</span>
                    </label>
                    {ativo && (
                      <div className="w-20">
                        <Input
                          type="number"
                          min={1}
                          max={40}
                          value={qtdPorTipo[t.id]}
                          onChange={(e) => setQtd(t.id, Number(e.target.value || 0))}
                          className="h-8"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="text-xs text-muted-foreground">
              Total: <strong>{totalQ}</strong> questão(ões).
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <Label>Nota máxima</Label>
              <Input
                type="number"
                min={1}
                max={100}
                step={0.5}
                value={maxScore}
                onChange={(e) => setMaxScore(Number(e.target.value || 10))}
              />
            </div>
            <div>
              <Label>Versões</Label>
              <Select value={String(versions)} onValueChange={(v) => setVersions(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 (sem embaralhar)</SelectItem>
                  <SelectItem value="2">2 versões (A, B)</SelectItem>
                  <SelectItem value="3">3 versões (A, B, C)</SelectItem>
                  <SelectItem value="4">4 versões (A, B, C, D)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Peso por Questão, Nota Máxima e embaralhamento */}
          <div className="rounded-md border bg-muted/20 p-3 space-y-3">
            <div className="text-sm font-medium">Configuração de pesos e embaralhamento</div>

            <div>
              <Label>Peso por Questão</Label>
              <Select value={pesoMode} onValueChange={(v) => setPesoMode(v as typeof pesoMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="igual">Igual para todas as questões</SelectItem>
                  <SelectItem value="personalizado">Personalizado por tipo</SelectItem>
                </SelectContent>
              </Select>
              {pesoMode === "personalizado" && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                  <NumField label="Peso M. escolha" value={pesoMC} onChange={setPesoMC} max={100} />
                  <NumField label="Peso V/F" value={pesoTF} onChange={setPesoTF} max={100} />
                  <NumField label="Peso Lacunas" value={pesoFB} onChange={setPesoFB} max={100} />
                  <NumField label="Peso Dissert." value={pesoES} onChange={setPesoES} max={100} />
                </div>
              )}
              <div
                className={`text-xs mt-2 ${pesoOK ? "text-muted-foreground" : "text-destructive"}`}
              >
                {pesoMode === "igual"
                  ? `Cada questão valerá ${(totalQ > 0 ? (Number(maxScore) || 0) / totalQ : 0).toFixed(2)} ponto(s). Soma = ${pesoSum.toFixed(2)} / ${(Number(maxScore) || 0).toFixed(2)}.`
                  : `Soma dos pesos × quantidade = ${pesoSum.toFixed(2)} / ${(Number(maxScore) || 0).toFixed(2)}.`}
                {!pesoOK && " A soma dos pesos deve corresponder à nota máxima."}
              </div>
            </div>

            <div>
              <Label>Nota Máxima da Avaliação</Label>
              <Input
                type="number"
                min={1}
                max={100}
                step={0.5}
                value={maxScore}
                onChange={(e) => setMaxScore(Number(e.target.value || 10))}
              />
            </div>

            <div className="flex items-start justify-between gap-3 rounded-md border bg-background p-3">
              <div className="space-y-0.5">
                <Label className="text-sm">Embaralhar questões e itens</Label>
                <p className="text-xs text-muted-foreground">
                  Reorganiza a ordem das questões e das alternativas dentro de cada versão para
                  dificultar a cola.
                </p>
              </div>
              <Switch checked={shuffleItems} onCheckedChange={setShuffleItems} />
            </div>

            <div className="text-xs text-muted-foreground">
              {studentCount === null
                ? "Verificando alunos da turma..."
                : studentCount === 0
                  ? "Nenhum aluno cadastrado nesta turma — nenhuma folha será gerada."
                  : `Serão geradas ${studentCount} avaliação(ões) — uma por aluno matriculado — distribuídas de forma embaralhada entre as ${versions} versão(ões), cada uma com questões diferentes.`}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Rigor pedagógico</Label>
              <Select value={rigor} onValueChange={(v) => setRigor(v as typeof rigor)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Leve — consolidação</SelectItem>
                  <SelectItem value="balanced">Equilibrado</SelectItem>
                  <SelectItem value="strict">Rigoroso — síntese crítica</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>
                Lançar nota no diário <span className="text-destructive">*</span>
              </Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={diaryCol}
                onChange={(e) => setDiaryCol(e.target.value)}
              >
                <option value="">Selecione uma coluna do diário...</option>
                {wizardCols.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} (peso {c.weight} · máx {c.max_score})
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-full">
              <Label>
                Data e Horário da Avaliação <span className="text-destructive">*</span>
              </Label>
              <Input
                type="datetime-local"
                className="w-full"
                value={assessmentDate ? `${assessmentDate}T${assessmentTime || ""}` : ""}
                onChange={(e) => {
                  const [d, t] = e.target.value.split("T");
                  setAssessmentDate(d ?? "");
                  setAssessmentTime((t ?? "").slice(0, 5));
                }}
                required
              />
            </div>
          </div>

          {/* Dificuldade e layout das folhas de questões. "Tópicos
              específicos" (topicsText) permanece no estado e é enviado ao
              backend, mas fica oculto da interface. */}
          <div className="rounded-md border bg-muted/20 p-3 space-y-3">
            <div className="text-sm font-medium">Dificuldade e layout</div>

            {/* "Nível de dificuldade geral" e "Padrões de qualidade das
                questões" saíram da interface. Ambos continuam com seus valores
                padrão no estado e são enviados ao backend: a dificuldade é
                definida por tipo de questão abaixo e os padrões de qualidade
                são aplicados como padrão no prompt. */}

            <div>
              <Label className="text-xs">Dificuldade por tipo de questão</Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-1">
                <DifficultySelector label="Múltipla escolha" value={diffMC} onChange={setDiffMC} />
                <DifficultySelector label="V/F" value={diffTF} onChange={setDiffTF} />
                <DifficultySelector label="Lacunas" value={diffFB} onChange={setDiffFB} />
                <DifficultySelector label="Dissertativa" value={diffES} onChange={setDiffES} />
              </div>
            </div>

            <div>
              <Label>Layout das folhas de questões</Label>
              <Select
                value={layoutTemplate}
                onValueChange={(v) => setLayoutTemplate(v as typeof layoutTemplate)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="classic">Clássico (coluna única)</SelectItem>
                  <SelectItem value="compact">Compacto (misto)</SelectItem>
                  <SelectItem value="two_column">Duas colunas</SelectItem>
                  <SelectItem value="exam_board">Estilo banca (misto)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground flex gap-2">
            <FileText className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              O PDF conterá <strong>{versions}</strong> versão(ões) com{" "}
              <strong>questões diferentes</strong> sobre o mesmo conteúdo +{" "}
              <strong>1 folha de resposta por aluno</strong>, com QR Code único usado pelo Corretor.
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            Gerar avaliação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NumField({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  max: number;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.max(0, Math.min(max, Number(e.target.value || 0))))}
      />
    </div>
  );
}

type DiffLevelValue = "basico" | "medio" | "avancado" | "superior";
function DifficultySelector({
  label,
  value,
  onChange,
}: {
  label: string;
  value: DiffLevelValue;
  onChange: (v: DiffLevelValue) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as DiffLevelValue)}>
        <SelectTrigger className="h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="basico">Básico</SelectItem>
          <SelectItem value="medio">Médio</SelectItem>
          <SelectItem value="avancado">Avançado</SelectItem>
          <SelectItem value="superior">Superior</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

export default AssessmentsModule;
