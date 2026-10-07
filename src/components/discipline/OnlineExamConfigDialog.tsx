import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
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
import { getOnlineExamConfig, saveOnlineExamConfig } from "@/backend/online-exams.functions";

/* ============================================================================
 * "Configurar Prova Online" — chamado pela lista de avaliacoes.
 *
 * Nao cria um modulo novo: acrescenta, na avaliacao existente, a opcao de
 * aplicar a prova no navegador. As questoes vem da propria avaliacao e o
 * gabarito permanece no servidor.
 *
 * CONTROLE DE INTEGRIDADE: nao ha mais PIN nem codigo. A sala de prova
 * so e liberada se o aluno tiver PRESENCA confirmada no Diario Digital
 * (attendance_records.status='present') em uma aula cuja `starts_at`
 * cai dentro da janela `opens_at..closes_at` da prova. Ver
 * `getOnlineExamAccess` em online-exams.student.functions.ts.
 * ========================================================================== */

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

  // Carrega a config existente para o formulario ja abrir preenchido.
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
          biometric_required: boolean;
          biometric_kind_required: string | null;
          require_face_match: boolean;
          tab_switch_limit: number | null;
        } | null;
        if (!alive || !cfg) return;
        setEnabled(true);
        setTitle(cfg.title);
        setOpensAt(toLocalInput(cfg.opens_at));
        setClosesAt(toLocalInput(cfg.closes_at));
        setTimeLimit(String(cfg.time_limit_minutes));
        setMaxScore(String(cfg.max_score));
        setMaxAttempts(String(cfg.max_attempts));
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

  async function save() {
    if (!title.trim()) {
      toast.error("Informe o título da prova online");
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

                <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">
                    Liberação automática pela presença no Diário Digital
                  </p>
                  <p>
                    O aluno só conseguirá abrir a sala de prova se tiver a presença confirmada em
                    uma aula (chamada do Diário Digital) da mesma disciplina que aconteça dentro da
                    janela acima (<em>Início</em> a <em>Término</em>). Não há código ou PIN para
                    configurar.
                  </p>
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
            <Button onClick={save} disabled={saving || loading}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar configuração
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
