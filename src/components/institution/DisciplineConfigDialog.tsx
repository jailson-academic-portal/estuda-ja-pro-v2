import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getInstitutionDisciplineConfig,
  saveInstitutionDisciplineConfig,
} from "@/backend/institution.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface AssessmentRow { id: string; name: string; weight: number; max_score: number }

const DEFAULT_ASSESSMENTS: AssessmentRow[] = [
  { id: "n1", name: "Nota 1", weight: 50, max_score: 10 },
  { id: "n2", name: "Nota 2", weight: 50, max_score: 10 },
];

export function DisciplineConfigDialog({
  disciplineId,
  disciplineName,
  open,
  onOpenChange,
}: {
  disciplineId: string;
  disciplineName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const getConfig = useServerFn(getInstitutionDisciplineConfig);
  const saveConfig = useServerFn(saveInstitutionDisciplineConfig);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [minAttendance, setMinAttendance] = useState(75);
  const [justifiedCounts, setJustifiedCounts] = useState(true);
  const [windowHours, setWindowHours] = useState(72);
  const [gradeScale, setGradeScale] = useState<10 | 100>(10);
  const [passing, setPassing] = useState(6);
  const [assessments, setAssessments] = useState<AssessmentRow[]>(DEFAULT_ASSESSMENTS);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      try {
        const cfg = await getConfig({ data: { discipline_id: disciplineId } });
        if (cfg.settings) {
          setMinAttendance(Number(cfg.settings.min_attendance_percent ?? 75));
          setJustifiedCounts(Boolean(cfg.settings.justified_counts_as_presence));
          setWindowHours(Number(cfg.settings.attendance_window_hours ?? 72));
        }
        if (cfg.structure) {
          setGradeScale((Number(cfg.structure.grade_scale) === 100 ? 100 : 10) as 10 | 100);
          setPassing(Number(cfg.structure.passing_average ?? 6));
          const arr = cfg.structure.assessments as unknown as AssessmentRow[] | null;
          if (Array.isArray(arr) && arr.length) {
            setAssessments(arr.map((a) => ({
              id: String(a.id), name: String(a.name),
              weight: Number(a.weight ?? 0), max_score: Number(a.max_score ?? 10),
            })));
          }
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao carregar configuração");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, disciplineId, getConfig]);

  const totalWeight = assessments.reduce((s, a) => s + (Number(a.weight) || 0), 0);

  const update = (i: number, patch: Partial<AssessmentRow>) =>
    setAssessments((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));

  const onSave = async () => {
    setSaving(true);
    try {
      await saveConfig({
        data: {
          discipline_id: disciplineId,
          min_attendance_percent: minAttendance,
          justified_counts_as_presence: justifiedCounts,
          attendance_window_hours: windowHours,
          grade_scale: gradeScale,
          passing_average: passing,
          assessments,
        },
      });
      toast.success("Configuração do diário salva");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Configurar diário — {disciplineName}</DialogTitle></DialogHeader>
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-6">
            <section className="space-y-3">
              <h4 className="text-sm font-semibold">Frequência</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Frequência mínima (%)</Label>
                  <Input type="number" min={0} max={100} value={minAttendance}
                    onChange={(e) => setMinAttendance(Number(e.target.value))} />
                </div>
                <div className="space-y-1">
                  <Label>Janela de presença/justificativa (horas)</Label>
                  <Input type="number" min={1} max={720} value={windowHours}
                    onChange={(e) => setWindowHours(Number(e.target.value))} />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">Falta justificada conta como presença</p>
                  <p className="text-xs text-muted-foreground">Aplica-se ao cálculo de frequência do aluno.</p>
                </div>
                <Switch checked={justifiedCounts} onCheckedChange={setJustifiedCounts} />
              </div>
            </section>

            <section className="space-y-3">
              <h4 className="text-sm font-semibold">Notas</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Escala de nota</Label>
                  <Select value={String(gradeScale)} onValueChange={(v) => setGradeScale(Number(v) as 10 | 100)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">0 a 10</SelectItem>
                      <SelectItem value="100">0 a 100</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Média de aprovação</Label>
                  <Input type="number" step="0.01" min={0} max={gradeScale} value={passing}
                    onChange={(e) => setPassing(Number(e.target.value))} />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Colunas de avaliação</Label>
                  <span className={`text-xs ${Math.abs(totalWeight - 100) > 0.01 ? "text-destructive" : "text-muted-foreground"}`}>
                    Soma dos pesos: {totalWeight}%
                  </span>
                </div>
                {assessments.map((a, i) => (
                  <div key={a.id} className="flex gap-2 items-end">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs text-muted-foreground">Nome</Label>
                      <Input value={a.name} onChange={(e) => update(i, { name: e.target.value })} />
                    </div>
                    <div className="w-24 space-y-1">
                      <Label className="text-xs text-muted-foreground">Peso %</Label>
                      <Input type="number" value={a.weight} onChange={(e) => update(i, { weight: Number(e.target.value) })} />
                    </div>
                    <div className="w-24 space-y-1">
                      <Label className="text-xs text-muted-foreground">Nota máx.</Label>
                      <Input type="number" step="0.01" value={a.max_score}
                        onChange={(e) => update(i, { max_score: Number(e.target.value) })} />
                    </div>
                    <Button variant="ghost" size="icon" disabled={assessments.length <= 1}
                      onClick={() => setAssessments((p) => p.filter((_, idx) => idx !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm"
                  onClick={() => setAssessments((p) => [...p, {
                    id: `n${Date.now().toString(36)}`, name: `Nota ${p.length + 1}`, weight: 0, max_score: gradeScale,
                  }])}>
                  <Plus className="h-4 w-4 mr-1" /> Adicionar coluna
                </Button>
              </div>
            </section>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={onSave} disabled={saving || loading}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salvar configuração
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
