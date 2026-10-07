import { useEffect, useState } from "react";
import { CalendarCheck2, Link2, Link2Off, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getOnlineExamConfig,
  listAttendanceSessionsForExam,
  saveOnlineExamConfig,
} from "@/backend/online-exams.functions";

/* ============================================================================
 * "Configurar Prova Online" — chamado pela lista de avaliacoes.
 *
 * Nao cria um modulo novo: acrescenta, na avaliacao existente, a opcao de
 * aplicar a prova no navegador. As questoes vem da propria avaliacao e o
 * gabarito permanece no servidor.
 *
 * CONTROLE DE INTEGRIDADE: a sala de prova so e liberada se o aluno
 * tiver PRESENCA confirmada no Diario Digital na CHAMADA especifica
 * vinculada a esta prova (attendance_session_id). O proprio aluno
 * registra a presenca (via QR Code ou codigo de 6 letras), e a sala
 * e destravada automaticamente. Se nenhuma chamada for vinculada,
 * a prova fica bloqueada ate o professor vincular. Ver
 * `getOnlineExamAccess` em online-exams.student.functions.ts.
 * ========================================================================== */

type AttendanceOption = {
  id: string;
  topic: string | null;
  session_date: string;
  starts_at: string;
  closed_at: string | null;
};

function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function OnlineExamConfigDialog({
  assessmentId,
  disciplineId,
  defaultTitle,
  defaultMaxScore,
  onClose,
  onSaved,
}: {
  assessmentId: string;
  disciplineId: string;
  defaultTitle: string;
  defaultMaxScore: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const loadFn = useServerFn(getOnlineExamConfig);
  const saveFn = useServerFn(saveOnlineExamConfig);
  const listAttendanceFn = useServerFn(listAttendanceSessionsForExam);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [instructions, setInstructions] = useState("");
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [timeLimit, setTimeLimit] = useState("60");
  const [maxScore, setMaxScore] = useState(String(defaultMaxScore || 10));
  const [maxAttempts, setMaxAttempts] = useState("1");
  const [attendanceSessionId, setAttendanceSessionId] = useState<string>("");
  const [attendanceOptions, setAttendanceOptions] = useState<AttendanceOption[]>([]);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  /** Flag visual: alerta o professor se a prova vai ficar bloqueada. */
  const attendanceRequired = !!attendanceSessionId;

  // Carrega a config existente e as chamadas da disciplina.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cfg = (await loadFn({ data: { assessmentId } })) as {
          title: string;
          opens_at: string | null;
          closes_at: string | null;
          time_limit_minutes: number;
          max_score: number;
          max_attempts: number;
          attendance_session_id: string | null;
        } | null;
        if (!alive || !cfg) return;
        setEnabled(true);
        setTitle(cfg.title);
        setOpensAt(toLocalInput(cfg.opens_at));
        setClosesAt(toLocalInput(cfg.closes_at));
        setTimeLimit(String(cfg.time_limit_minutes));
        setMaxScore(String(cfg.max_score));
        setMaxAttempts(String(cfg.max_attempts));
        setAttendanceSessionId(cfg.attendance_session_id ?? "");
      } catch (e) {
        // Config inexistente ainda e o caso normal: segue com o formulario vazio.
        if (alive) {
          setMaxScore(String(defaultMaxScore || 10));
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessmentId]);

  // Recarrega a lista de chamadas quando a janela da prova muda.
  useEffect(() => {
    let alive = true;
    setLoadingAttendance(true);
    (async () => {
      try {
        const opts = (await listAttendanceFn({
          data: {
            disciplineId,
            opensAt: opensAt ? new Date(opensAt).toISOString() : null,
            closesAt: closesAt ? new Date(closesAt).toISOString() : null,
          },
        })) as AttendanceOption[];
        if (alive) setAttendanceOptions(opts ?? []);
      } catch {
        if (alive) setAttendanceOptions([]);
      } finally {
        if (alive) setLoadingAttendance(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disciplineId, opensAt, closesAt]);

  async function save() {
    if (!title.trim()) {
      toast.error("Informe o título da prova online");
      return;
    }
    if (!attendanceSessionId) {
      toast.error("Vincule a prova a uma chamada do Diário Digital antes de salvar");
      return;
    }
    setSaving(true);
    const t = toast.loading("Salvando configuração...");
    try {
      await saveFn({
        data: {
          assessmentId,
          disciplineId,
          title: title.trim(),
          instructions: instructions.trim() || null,
          opensAt: opensAt ? new Date(opensAt).toISOString() : null,
          closesAt: closesAt ? new Date(closesAt).toISOString() : null,
          timeLimitMinutes: Number(timeLimit) || 60,
          maxScore: Number(maxScore) || 0,
          maxAttempts: Number(maxAttempts) || 1,
          attendanceSessionId,
          biometricRequired: false,
          tabSwitchLimit: null,
        },
      });
      toast.success("Prova online configurada", { id: t });
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar", { id: t });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Configurar Prova Online</DialogTitle>
          <DialogDescription>
            A prova usa as questões desta avaliação. O gabarito permanece no servidor e nunca é
            enviado ao navegador do aluno.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando configuração...
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3 rounded-md border bg-background p-3">
              <div className="space-y-0.5">
                <Label className="text-sm flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" /> Disponibilizar como prova online
                </Label>
                <p className="text-xs text-muted-foreground">
                  Libera esta avaliação para aplicação no navegador dos alunos.
                </p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>

            {enabled && (
              <div className="space-y-4 animate-in fade-in slide-in-from-top-1">
                <div className="space-y-1.5">
                  <Label htmlFor="oe-cfg-title">Título da prova</Label>
                  <Input
                    id="oe-cfg-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="oe-cfg-inst">Orientações ao aluno</Label>
                  <Textarea
                    id="oe-cfg-inst"
                    rows={2}
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder="Opcional. Exibido antes de a prova começar."
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="oe-cfg-opens">Início</Label>
                    <Input
                      id="oe-cfg-opens"
                      type="datetime-local"
                      value={opensAt}
                      onChange={(e) => setOpensAt(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="oe-cfg-closes">Término</Label>
                    <Input
                      id="oe-cfg-closes"
                      type="datetime-local"
                      value={closesAt}
                      onChange={(e) => setClosesAt(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="oe-cfg-limit">Duração (min)</Label>
                    <Input
                      id="oe-cfg-limit"
                      type="number"
                      min={1}
                      max={600}
                      value={timeLimit}
                      onChange={(e) => setTimeLimit(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="oe-cfg-score">Nota máxima</Label>
                    <Input
                      id="oe-cfg-score"
                      type="number"
                      step="0.01"
                      min={0}
                      value={maxScore}
                      onChange={(e) => setMaxScore(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="oe-cfg-attempts">Tentativas</Label>
                    <Input
                      id="oe-cfg-attempts"
                      type="number"
                      min={1}
                      max={20}
                      value={maxAttempts}
                      onChange={(e) => setMaxAttempts(e.target.value)}
                    />
                  </div>
                </div>

                <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <Label className="text-sm flex items-center gap-2">
                        {attendanceRequired ? (
                          <Link2 className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <Link2Off className="h-4 w-4 text-amber-600" />
                        )}
                        Vincular a uma chamada do Diário Digital
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        A sala só é liberada para o aluno depois que ele registrar presença (via QR
                        Code ou código de 6 letras) na chamada vinculada.
                      </p>
                    </div>
                    {attendanceRequired ? (
                      <Badge
                        variant="outline"
                        className="border-emerald-300/60 text-emerald-200 bg-emerald-50"
                      >
                        <CalendarCheck2 className="h-3 w-3 mr-1" /> Vinculada
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-amber-300/60 text-amber-200 bg-amber-50"
                      >
                        Sem chamada vinculada
                      </Badge>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="oe-cfg-attendance-session">Chamada do Diário Digital</Label>
                    <Select
                      value={attendanceSessionId || undefined}
                      onValueChange={(v) => setAttendanceSessionId(v)}
                    >
                      <SelectTrigger id="oe-cfg-attendance-session" disabled={loadingAttendance}>
                        <SelectValue
                          placeholder={
                            loadingAttendance
                              ? "Carregando..."
                              : "Selecione a chamada que libera a prova"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {attendanceOptions.length === 0 && !loadingAttendance && (
                          <SelectItem value="__none__" disabled>
                            Nenhuma chamada encontrada na janela da prova
                          </SelectItem>
                        )}
                        {attendanceOptions.map((opt) => {
                          const dt = new Date(opt.starts_at);
                          const label = `${dt.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} — ${
                            opt.topic || "Aula sem tópico"
                          }${opt.closed_at ? " (encerrada)" : ""}`;
                          return (
                            <SelectItem key={opt.id} value={opt.id}>
                              {label}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      A lista mostra as chamadas dentro da janela da prova (ou das últimas 60 dias,
                      se a prova não tiver janela). Para vincular uma chamada de outro período,
                      ajuste a janela acima.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Fechar
          </Button>
          {enabled && (
            <Button onClick={save} disabled={saving || loading || !attendanceSessionId}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar configuração
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
