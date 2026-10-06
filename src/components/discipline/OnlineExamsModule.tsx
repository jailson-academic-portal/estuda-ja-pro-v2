import { useEffect, useState } from "react";
import {
  Camera,
  Clock,
  Copy,
  FileText,
  Fingerprint,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useServerFn } from "@tanstack/react-start";
import {
  createOnlineExam,
  deleteOnlineExam,
  listAssessmentsForOnlineExam,
  listOnlineExams,
  setOnlineExamStatus,
  updateOnlineExam,
} from "@/backend/online-exams.functions";
import type { BiometricKind, OnlineExamStatus } from "@/integrations/supabase/online-exams.types";

/* ============================================================================
 * AVALIAÇÕES ONLINE — painel do professor
 *
 * Cria e gerencia provas online vinculadas a uma `assessment` existente.
 * A biometria aqui é só configuração de exigência; a checagem real acontece
 * no início da sessão do aluno (próxima entrega).
 * ========================================================================== */

type ExamRow = {
  id: string;
  title: string;
  status: OnlineExamStatus;
  time_limit_minutes: number;
  max_score: number;
  opens_at: string | null;
  closes_at: string | null;
  biometric_required: boolean;
  biometric_kind_required: BiometricKind | null;
  require_face_match: boolean;
  max_attempts: number;
  proctoring_enabled: boolean;
  assessment_title: string;
  session_total: number;
  session_submitted: number;
};

type AssessmentOption = {
  id: string;
  title: string;
  status: string;
  question_count: number;
};

const STATUS_LABEL: Record<OnlineExamStatus, string> = {
  draft: "Rascunho",
  scheduled: "Agendada",
  open: "Aberta",
  closed: "Encerrada",
  archived: "Arquivada",
};

const STATUS_VARIANT: Record<OnlineExamStatus, string> = {
  draft: "secondary",
  scheduled: "outline",
  open: "default",
  closed: "secondary",
  archived: "secondary",
};

const KIND_LABEL: Record<BiometricKind, string> = {
  face: "Reconhecimento facial",
  fingerprint: "Digital",
  iris: "Íris",
  voice: "Voz",
};

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function OnlineExamsModule({ disciplineId }: { disciplineId: string }) {
  const listFn = useServerFn(listOnlineExams);
  const candidatesFn = useServerFn(listAssessmentsForOnlineExam);
  const deleteFn = useServerFn(deleteOnlineExam);
  const statusFn = useServerFn(setOnlineExamStatus);

  const [rows, setRows] = useState<ExamRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setRows((await listFn({ data: { disciplineId } })) as unknown as ExamRow[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }

  async function changeStatus(id: string, status: OnlineExamStatus) {
    try {
      await statusFn({ data: { id, status } });
      toast.success(`Prova marcada como ${STATUS_LABEL[status].toLowerCase()}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao alterar status");
    }
  }

  async function remove(id: string) {
    if (
      !confirm(
        "Excluir esta prova online? As sessões e respostas dos alunos também serão removidas.",
      )
    ) {
      return;
    }
    try {
      const r = await deleteFn({ data: { id } });
      const n = r?.sessions_removed ?? 0;
      toast.success(n > 0 ? `Prova excluída com ${n} sessão(ões) removida(s)` : "Prova excluída");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao excluir");
    }
  }

  // Primeira carga no mount (fora do render para evitar re-render em loop).
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disciplineId]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> Provas Online
          </h2>
          <p className="text-sm text-muted-foreground">
            Transforme uma avaliação em prova aplicada no navegador, com limite de tempo e exigência
            opcional de biometria.
          </p>
        </div>
        <ExamFormDialog
          disciplineId={disciplineId}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSaved={load}
        />
      </div>

      {loading && rows === null ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando provas...
        </div>
      ) : rows && rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center space-y-3">
          <FileText className="h-8 w-8 mx-auto text-muted-foreground" />
          <div className="font-medium">Nenhuma prova online criada</div>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Escolha uma avaliação já existente como banco de questões e defina as regras de
            aplicação.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {rows?.map((e) => (
            <div
              key={e.id}
              className="rounded-xl border bg-card p-4"
              style={{ boxShadow: "var(--shadow-card)" }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{e.title}</span>
                    <Badge variant={STATUS_VARIANT[e.status] as never}>
                      {STATUS_LABEL[e.status]}
                    </Badge>
                    {e.biometric_required && (
                      <Badge variant="outline" className="gap-1">
                        <Fingerprint className="h-3 w-3" />
                        {e.biometric_kind_required
                          ? KIND_LABEL[e.biometric_kind_required]
                          : "Biometria"}
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>Banco: {e.assessment_title}</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {e.time_limit_minutes} min
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3" /> {e.session_submitted}/{e.session_total}
                      sessões
                    </span>
                    <span>Nota máx. {e.max_score}</span>
                    <span>{e.max_attempts} tentativa(s)</span>
                  </div>
                  {(e.opens_at || e.closes_at) && (
                    <div className="text-xs text-muted-foreground">
                      Janela: {e.opens_at ? toLocalInput(e.opens_at).replace("T", " ") : "aberta"}{" "}
                      até {e.closes_at ? toLocalInput(e.closes_at).replace("T", " ") : "—"}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <ExamFormDialog disciplineId={disciplineId} exam={e} onSaved={load} />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Ações">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {(["draft", "scheduled", "open", "closed", "archived"] as OnlineExamStatus[])
                        .filter((s) => s !== e.status)
                        .map((s) => (
                          <DropdownMenuItem key={s} onClick={() => changeStatus(e.id, s)}>
                            Marcar como {STATUS_LABEL[s].toLowerCase()}
                          </DropdownMenuItem>
                        ))}
                      <DropdownMenuItem className="text-destructive" onClick={() => remove(e.id)}>
                        <Trash2 className="h-4 w-4 mr-2" /> Excluir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- FORMULÁRIO ------------------------------------------------------
type FormState = {
  assessmentId: string;
  title: string;
  instructions: string;
  status: OnlineExamStatus;
  timeLimit: string;
  maxScore: string;
  opensAt: string;
  closesAt: string;
  maxAttempts: string;
  randomizeQuestions: boolean;
  randomizeOptions: boolean;
  allowResume: boolean;
  biometricRequired: boolean;
  biometricKind: BiometricKind;
  requireFaceMatch: boolean;
  proctoringEnabled: boolean;
  tabSwitchLimit: string;
};

const EMPTY: FormState = {
  assessmentId: "",
  title: "",
  instructions: "",
  status: "draft",
  timeLimit: "60",
  maxScore: "10",
  opensAt: "",
  closesAt: "",
  maxAttempts: "1",
  randomizeQuestions: false,
  randomizeOptions: false,
  allowResume: true,
  biometricRequired: false,
  biometricKind: "face",
  requireFaceMatch: false,
  proctoringEnabled: false,
  tabSwitchLimit: "",
};

function ExamFormDialog({
  disciplineId,
  exam,
  onSaved,
  open: openProp,
  onOpenChange,
}: {
  disciplineId: string;
  exam?: ExamRow;
  onSaved: () => void | Promise<void>;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  const isEdit = Boolean(exam);
  const candidatesFn = useServerFn(listAssessmentsForOnlineExam);
  const createFn = useServerFn(createOnlineExam);
  const updateFn = useServerFn(updateOnlineExam);

  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const [options, setOptions] = useState<AssessmentOption[] | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function ensureOptions() {
    if (options) return;
    try {
      setOptions((await candidatesFn({ data: { disciplineId } })) as unknown as AssessmentOption[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar avaliações");
    }
  }

  // Hidrata o formulário quando o diálogo de edição abre.
  useEffect(() => {
    if (!exam || saving) return;
    setForm({
      assessmentId: (exam as unknown as { assessment_id?: string }).assessment_id ?? "",
      title: exam!.title,
      instructions: "",
      status: exam!.status,
      timeLimit: String(exam!.time_limit_minutes),
      maxScore: String(exam!.max_score),
      opensAt: toLocalInput(exam!.opens_at),
      closesAt: toLocalInput(exam!.closes_at),
      maxAttempts: String(exam!.max_attempts),
      randomizeQuestions: false,
      randomizeOptions: false,
      allowResume: true,
      biometricRequired: exam!.biometric_required,
      biometricKind: exam!.biometric_kind_required ?? "face",
      requireFaceMatch: exam!.require_face_match,
      proctoringEnabled: exam!.proctoring_enabled,
      tabSwitchLimit: "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam?.id]);

  function onOpenChangeWrapped(v: boolean) {
    setOpen(v);
    if (v) {
      void ensureOptions();
      if (!isEdit) setForm(EMPTY);
    }
  }

  async function save() {
    if (!isEdit && !form.assessmentId) {
      toast.error("Escolha a avaliação de origem");
      return;
    }
    if (!form.title.trim()) {
      toast.error("Informe o título");
      return;
    }

    const payload = {
      title: form.title.trim(),
      instructions: form.instructions.trim() || null,
      status: form.status,
      time_limit_minutes: Number(form.timeLimit) || 60,
      max_score: Number(form.maxScore) || 0,
      randomize_questions: form.randomizeQuestions,
      randomize_options: form.randomizeOptions,
      opens_at: form.opensAt ? new Date(form.opensAt).toISOString() : null,
      closes_at: form.closesAt ? new Date(form.closesAt).toISOString() : null,
      biometric_required: form.biometricRequired,
      biometric_kind_required: form.biometricRequired ? form.biometricKind : null,
      require_face_match: form.biometricRequired && form.requireFaceMatch,
      max_attempts: Number(form.maxAttempts) || 1,
      proctoring_enabled: form.biometricRequired && form.proctoringEnabled,
      tab_switch_limit: form.tabSwitchLimit ? Number(form.tabSwitchLimit) : null,
      allow_resume: form.allowResume,
    };

    setSaving(true);
    const t = toast.loading(isEdit ? "Salvando..." : "Criando prova online...");
    try {
      if (isEdit) {
        await updateFn({ data: { id: exam!.id, ...payload } });
      } else {
        await createFn({
          data: { disciplineId, assessmentId: form.assessmentId, ...payload },
        });
      }
      toast.success(isEdit ? "Prova atualizada" : "Prova online criada", { id: t });
      setOpen(false);
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar", { id: t });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChangeWrapped}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button variant="ghost" size="icon" aria-label="Editar prova">
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button>
            <Plus className="h-4 w-4 mr-2" /> Nova prova online
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar prova online" : "Nova prova online"}</DialogTitle>
          <DialogDescription>
            As questões vêm da avaliação de origem. O gabarito permanece no servidor e nunca é
            enviado ao navegador do aluno.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!isEdit && (
            <div className="space-y-2">
              <Label>Avaliação de origem *</Label>
              <Select value={form.assessmentId} onValueChange={(v) => set("assessmentId", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a avaliação" />
                </SelectTrigger>
                <SelectContent>
                  {options?.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.title} ({o.question_count} questões)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {options && options.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nenhuma avaliação nesta disciplina. Crie uma em Avaliações primeiro.
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="oe-title">Título *</Label>
            <Input
              id="oe-title"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Prova de Cardiologia"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="oe-inst">Orientações</Label>
            <Textarea
              id="oe-inst"
              rows={3}
              value={form.instructions}
              onChange={(e) => set("instructions", e.target.value)}
              placeholder="Instruções exibidas ao aluno antes de iniciar."
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="oe-limit">Duração (min)</Label>
              <Input
                id="oe-limit"
                type="number"
                min={1}
                max={600}
                value={form.timeLimit}
                onChange={(e) => set("timeLimit", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="oe-score">Nota máxima</Label>
              <Input
                id="oe-score"
                type="number"
                step="0.01"
                min={0}
                value={form.maxScore}
                onChange={(e) => set("maxScore", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="oe-attempts">Tentativas</Label>
              <Input
                id="oe-attempts"
                type="number"
                min={1}
                max={20}
                value={form.maxAttempts}
                onChange={(e) => set("maxAttempts", e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="oe-opens">Abre em</Label>
              <Input
                id="oe-opens"
                type="datetime-local"
                value={form.opensAt}
                onChange={(e) => set("opensAt", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="oe-closes">Fecha em</Label>
              <Input
                id="oe-closes"
                type="datetime-local"
                value={form.closesAt}
                onChange={(e) => set("closesAt", e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => set("status", v as OnlineExamStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STATUS_LABEL) as OnlineExamStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-sm flex items-center gap-2">
                  <Camera className="h-4 w-4" /> Exigir biometria
                </div>
                <p className="text-xs text-muted-foreground">
                  O aluno precisa ter uma biometria cadastrada para iniciar a prova.
                </p>
              </div>
              <Switch
                checked={form.biometricRequired}
                onCheckedChange={(v) => set("biometricRequired", v)}
              />
            </div>

            {form.biometricRequired && (
              <div className="space-y-3 border-t pt-3">
                <div className="space-y-2">
                  <Label>Tipo de biometria</Label>
                  <Select
                    value={form.biometricKind}
                    onValueChange={(v) => set("biometricKind", v as BiometricKind)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(KIND_LABEL) as BiometricKind[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {KIND_LABEL[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">Reconhecimento facial ao iniciar</div>
                    <p className="text-xs text-muted-foreground">
                      Confere a identidade do aluno antes da prova começar.
                    </p>
                  </div>
                  <Switch
                    checked={form.requireFaceMatch}
                    onCheckedChange={(v) => set("requireFaceMatch", v)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">Monitoramento da prova</div>
                    <p className="text-xs text-muted-foreground">
                      Registra saídas de aba e perda de foco durante a sessão.
                    </p>
                  </div>
                  <Switch
                    checked={form.proctoringEnabled}
                    onCheckedChange={(v) => set("proctoringEnabled", v)}
                  />
                </div>

                {form.proctoringEnabled && (
                  <div className="space-y-2">
                    <Label htmlFor="oe-tabs">Limite de trocas de aba</Label>
                    <Input
                      id="oe-tabs"
                      type="number"
                      min={0}
                      max={999}
                      value={form.tabSwitchLimit}
                      onChange={(e) => set("tabSwitchLimit", e.target.value)}
                      placeholder="Sem limite"
                      className="max-w-[10rem]"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={form.randomizeQuestions}
                onCheckedChange={(v) => set("randomizeQuestions", v)}
              />
              Embaralhar questões
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={form.randomizeOptions}
                onCheckedChange={(v) => set("randomizeOptions", v)}
              />
              Embaralhar alternativas
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.allowResume} onCheckedChange={(v) => set("allowResume", v)} />
              Permitir retomar
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit ? "Salvar" : "Criar prova"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
