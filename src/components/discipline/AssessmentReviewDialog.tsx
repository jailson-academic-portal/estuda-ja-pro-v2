import { useCallback, useEffect, useState } from "react";
import { sortItemsNumerically } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Loader2, Pencil, Wand2, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import {
  listAssessmentAudits,
  resolveAssessmentAudit,
  resolveAssessmentVersionAudits,
} from "@/backend/assessments.functions";

type AuditItem = {
  id: string;
  version_label: string;
  position: number;
  concept: string | null;
  lesson_tag: string | null;
  status: string;
  message: string | null;
  concept_options: string[];
  declared_level: string | null;
  detected_level: string | null;
  suggested_prompt: string | null;
  resolution: string;
  prompt: string | null;
  options: string[] | null;
};

type VersionStatus = {
  version_label: string;
  pending_count: number;
  pending_positions: number[];
  kept_count: number;
  blocked: boolean;
  summary: string;
};

const STATUS_LABEL: Record<string, string> = {
  revisar: "Termo genérico / alinhamento com a apostila",
  nivel: "Nível de dificuldade incompatível",
};

/**
 * Tela de revisão pré-PDF: lista as questões sinalizadas pelas verificações
 * automáticas e permite aplicar a sugestão, editar manualmente ou manter a
 * questão como está. Os PDFs só são liberados quando não há pendências.
 */
export function AssessmentReviewDialog({ open, onClose, assessmentId, onResolved }: {
  open: boolean;
  onClose: () => void;
  assessmentId: string;
  onResolved?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<AuditItem[]>([]);
  const [versions, setVersions] = useState<VersionStatus[]>([]);
  const [pending, setPending] = useState(0);
  const [kept, setKept] = useState(0);
  const [summary, setSummary] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [editOptions, setEditOptions] = useState<Record<string, string[]>>({});
  const [openEditor, setOpenEditor] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listAssessmentAudits({ data: { id: assessmentId } });
      setItems(sortItemsNumerically(r.items as any[]) as AuditItem[]);
      setVersions((r.versions ?? []) as VersionStatus[]);
      setPending(r.pending_count);
      setKept(r.kept_count);
      setSummary(r.summary);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar a revisão");
    } finally {
      setLoading(false);
    }
  }, [assessmentId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const act = async (item: AuditItem, action: "suggestion" | "manual" | "keep" | "relevel") => {
    setBusyId(item.id);
    try {
      const r = await resolveAssessmentAudit({
        data: {
          audit_id: item.id,
          action,
          ...(action === "manual"
            ? {
                prompt: editing[item.id] ?? item.prompt ?? "",
                ...((editOptions[item.id] ?? item.options ?? []).length > 0
                  ? { options: (editOptions[item.id] ?? item.options ?? []).filter((o) => o.trim()) }
                  : {}),
              }
            : {}),
          ...(action === "suggestion" && chosen[item.id] ? { concept: chosen[item.id] } : {}),
        },
      });
      toast.success(
        action === "keep" ? "Questão mantida pelo professor fora da recomendação automática" :
        action === "relevel" ? `Enunciado mantido — nível da questão ajustado para ${item.detected_level ?? "intermediário/avançado"}` :
        action === "manual" ? "Questão atualizada manualmente" : "Questão regenerada com o conceito válido da apostila",
      );

      setPending(r.pending_count);
      await load();
      onResolved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao registrar a decisão");
    } finally {
      setBusyId(null);
    }
  };

  const pendingItems = items.filter((i) => i.resolution === "pending");
  const resolvedItems = items.filter((i) => i.resolution !== "pending");

  const actVersion = async (label: string, action: "suggestion" | "keep") => {
    setBusyId(`v-${label}`);
    try {
      const r = await resolveAssessmentVersionAudits({
        data: { assessment_id: assessmentId, version_label: label, action },
      });
      if (r.failures.length > 0) {
        toast.warning(
          `Versão ${label}: ${r.fixed} corrigida(s); ${r.failures.length} exige(m) edição manual (${r.failures
            .map((f) => `Q${f.position}`)
            .join(", ")}).`,
        );
      } else {
        toast.success(
          action === "keep"
            ? `Versão ${label}: ${r.fixed} questão(ões) mantidas conscientemente pelo professor.`
            : `Versão ${label}: ${r.fixed} questão(ões) corrigidas automaticamente.`,
        );
      }
      await load();
      onResolved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao resolver a versão");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Revisão da avaliação</DialogTitle>
          <DialogDescription>
            Verificações automáticas: termos genéricos no enunciado, coerência enunciado ↔ alternativas ↔ apostila
            e respeito ao nível de dificuldade escolhido. Resolva as pendências para liberar os PDFs.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <div className="space-y-4">
            <div className={`rounded-lg border p-3 text-sm flex items-start gap-2 ${pending > 0 ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
              {pending > 0 ? <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> : <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />}
              <div>
                <div className="font-medium">
                  {pending > 0
                    ? `${pending} questão(ões) aguardam revisão`
                    : "Validação concluída — PDFs liberados"}
                </div>
                <div className="text-xs mt-0.5">
                  {summary ?? `Questões sinalizadas: ${items.length} · resolvidas: ${items.length - pending} · mantidas pelo professor: ${kept}`}
                </div>
              </div>
            </div>

            {items.length === 0 && (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                Nenhuma questão sinalizada nesta avaliação.
              </div>
            )}

            {versions.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Validação por versão de prova
                </div>
                {versions.map((v) => (
                  <div
                    key={v.version_label}
                    className={`rounded-lg border p-3 text-sm flex flex-wrap items-center justify-between gap-2 ${
                      v.blocked ? "border-amber-300 bg-amber-50" : "border-emerald-300 bg-emerald-50"
                    }`}
                  >
                    <span className={v.blocked ? "text-amber-900" : "text-emerald-900"}>{v.summary}</span>
                    {v.blocked && (
                      <span className="flex gap-2">
                        <Button size="sm" disabled={busyId !== null} onClick={() => actVersion(v.version_label, "suggestion")}>
                          <Wand2 className="h-4 w-4 mr-1" /> Corrigir esta versão
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busyId !== null} onClick={() => actVersion(v.version_label, "keep")}>
                          Manter esta versão
                        </Button>
                      </span>
                    )}
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Os PDFs de cada versão só são liberados quando aquela versão estiver sem pendências.
                </p>
              </div>
            )}

            {pendingItems.map((item) => (
              <div key={item.id} className="rounded-xl border bg-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="text-sm font-medium">
                    Versão {item.version_label} · Questão {item.position}
                    {item.lesson_tag && <span className="text-muted-foreground font-normal"> · {item.lesson_tag}</span>}
                  </div>
                  <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                    {STATUS_LABEL[item.status] ?? item.status}
                  </span>
                </div>

                {item.prompt && (
                  <p className="text-sm bg-muted/40 rounded-md p-2 whitespace-pre-wrap">{item.prompt}</p>
                )}
                {item.message && <p className="text-xs text-amber-800">{item.message}</p>}
                {item.declared_level && item.detected_level && (
                  <p className="text-xs text-muted-foreground">
                    Nível declarado: {item.declared_level} · nível detectado: {item.detected_level}
                  </p>
                )}
                {item.suggested_prompt && item.status === "nivel" ? (
                  <div className="grid gap-2 text-xs">
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-2">
                      <div className="font-medium text-amber-900">Enunciado atual ({item.detected_level ?? "nível acima do declarado"})</div>
                      <p className="text-amber-900/80 whitespace-pre-wrap">{item.prompt}</p>
                    </div>
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2">
                      <div className="font-medium text-emerald-900">
                        Enunciado sugerido para nível {item.declared_level ?? "básico"}
                      </div>
                      <p className="text-emerald-900/80 whitespace-pre-wrap">{item.suggested_prompt}</p>
                    </div>
                  </div>
                ) : item.suggested_prompt ? (
                  <div className="text-xs">
                    <span className="font-medium">Sugestão: </span>
                    <span className="text-muted-foreground">{item.suggested_prompt}</span>
                  </div>
                ) : null}
                {!item.suggested_prompt && item.concept_options.length > 0 && (
                  <div className="space-y-1">
                    <Label className="text-xs">Conceito central da apostila</Label>
                    <Select value={chosen[item.id] ?? item.concept_options[0]} onValueChange={(v) => setChosen((s) => ({ ...s, [item.id]: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {item.concept_options.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-1">
                  {openEditor[item.id] && (
                    <div className="grid gap-3 md:grid-cols-[1fr_220px] border rounded-lg p-3 bg-muted/20">
                      <div className="space-y-2 min-w-0">
                        <div>
                          <Label className="text-xs">Enunciado</Label>
                          <Textarea
                            rows={3}
                            value={editing[item.id] ?? item.prompt ?? ""}
                            onChange={(e) => setEditing((s) => ({ ...s, [item.id]: e.target.value }))}
                          />
                        </div>
                        {(editOptions[item.id] ?? item.options ?? []).length > 0 && (
                          <div className="space-y-1">
                            <Label className="text-xs">Alternativas</Label>
                            {(editOptions[item.id] ?? item.options ?? []).map((opt, idx) => (
                              <div key={idx} className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground w-4">{String.fromCharCode(65 + idx)}</span>
                                <Textarea
                                  rows={1}
                                  className="min-h-[38px]"
                                  value={opt}
                                  onChange={(e) => setEditOptions((s) => {
                                    const base = [...(s[item.id] ?? item.options ?? [])];
                                    base[idx] = e.target.value;
                                    return { ...s, [item.id]: base };
                                  })}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                        <Button size="sm" variant="outline" disabled={busyId === item.id} onClick={() => act(item, "manual")}>
                          <Pencil className="h-4 w-4 mr-1" /> Salvar edição
                        </Button>
                      </div>
                      <div className="space-y-1 border-l md:pl-3">
                        <Label className="text-xs">Conceitos da apostila</Label>
                        {item.concept_options.length === 0 ? (
                          <p className="text-xs text-muted-foreground">Nenhum conceito sugerido.</p>
                        ) : (
                          <ul className="space-y-1">
                            {item.concept_options.map((c) => (
                              <li key={c}>
                                <button
                                  type="button"
                                  className="text-xs text-left text-primary hover:underline"
                                  onClick={() => setEditing((s) => ({
                                    ...s,
                                    [item.id]: `${(s[item.id] ?? item.prompt ?? "")} ${c}`.trim(),
                                  }))}
                                >
                                  + {c}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={busyId === item.id} onClick={() => act(item, "suggestion")}>
                    <Wand2 className="h-4 w-4 mr-1" />
                    {item.status === "nivel" ? "Aplicar enunciado básico" : "Corrigir automaticamente"}
                  </Button>
                  {item.status === "nivel" && (
                    <Button size="sm" variant="secondary" disabled={busyId === item.id} onClick={() => act(item, "relevel")}>
                      <ArrowUpRight className="h-4 w-4 mr-1" />
                      Manter enunciado e usar nível {item.detected_level ?? "superior"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === item.id}
                    onClick={() => setOpenEditor((s) => ({ ...s, [item.id]: !s[item.id] }))}
                  >
                    {openEditor[item.id] ? <X className="h-4 w-4 mr-1" /> : <Pencil className="h-4 w-4 mr-1" />}
                    {openEditor[item.id] ? "Fechar editor" : "Editar manualmente"}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busyId === item.id} onClick={() => act(item, "keep")}>
                    Ignorar e manter como está
                  </Button>
                </div>
              </div>
            ))}

            {resolvedItems.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Resolvidas</div>
                {resolvedItems.map((item) => (
                  <div key={item.id} className="rounded-lg border p-3 text-sm flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium">Versão {item.version_label} · Questão {item.position}</div>
                      <div className="text-xs text-muted-foreground break-words">
                        {item.resolution === "kept"
                          ? item.status === "nivel"
                            ? "Mantida pelo professor — fora do nível recomendado"
                            : "Questão mantida pelo professor fora da recomendação automática"
                          : item.resolution === "relevel"
                            ? `Enunciado mantido — nível ajustado para ${item.detected_level ?? "intermediário/avançado"}`
                            : item.resolution === "manual" ? "Editada manualmente" : "Corrigida automaticamente"}
                        {item.prompt ? ` — ${item.prompt.slice(0, 140)}${item.prompt.length > 140 ? "…" : ""}` : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
