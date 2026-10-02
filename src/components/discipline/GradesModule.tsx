import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { saveGradeStructure, upsertGradeEntry, publishGrades, clearRecoveryEntry } from "@/backend/grades.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, BarChart3, Settings, Send, Undo2, Sparkles, Download, PieChart as PieIcon } from "lucide-react";
import { AnalyticsModule } from "./AnalyticsModule";
import { toast } from "sonner";


interface SubItem { id: string; name: string; }
interface Assessment { id: string; name: string; weight: number; max_score: number; sub_items?: SubItem[]; }
interface RecoveryConfig {
  enabled: boolean;
  name: string;
  max_score: number;
  mode: "lowest" | "specific";
  target_assessment_id?: string | null;
}
interface Structure {
  assessments: Assessment[];
  passing_average: number;
  recovery_average: number | null;
  grade_scale: 10 | 100;
  formula: string;
  recovery_config: RecoveryConfig | null;
}
interface Entry { student_id: string; assessment_id: string; score: number | null; }
interface Student { id: string; name: string; enrollment_number: string | null; }

const RECOVERY_KEY = "__recovery__";

/** Composite key para armazenar uma sub-nota como grade_entry.assessment_id. */
function subKey(assessmentId: string, subId: string): string {
  return `${assessmentId}#${subId}`;
}

/** Média das sub-notas presentes (ignora ausentes). Retorna null se nenhuma. */
function subAverage(entries: Entry[], student_id: string, a: Assessment): number | null {
  if (!a.sub_items?.length) return null;
  const scores: number[] = [];
  for (const sub of a.sub_items) {
    const e = entries.find((x) => x.student_id === student_id && x.assessment_id === subKey(a.id, sub.id));
    if (e?.score != null) scores.push(Number(e.score));
  }
  if (!scores.length) return null;
  return scores.reduce((s, n) => s + n, 0) / scores.length;
}

/** Nota efetiva de uma avaliação: sub-média quando houver sub-itens, senão nota direta. */
function effectiveScore(entries: Entry[], student_id: string, a: Assessment): number | null {
  if (a.sub_items?.length) return subAverage(entries, student_id, a);
  const e = entries.find((x) => x.student_id === student_id && x.assessment_id === a.id);
  return e?.score ?? null;
}

/** Formata nota com duas casas decimais e vírgula como separador. */
function formatGrade(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return Number(value).toFixed(2).replace(".", ",");
}

/** Célula numérica para CSV: força o Excel a manter as duas casas decimais como texto. */
function csvGrade(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return "";
  return `="${Number(value).toFixed(2).replace(".", ",")}"`;
}

/** Campo de nota editável que exibe duas casas decimais quando não está em foco. */
function GradeInput({
  value,
  max,
  onCommit,
}: {
  value: number | null | undefined;
  max: number;
  onCommit: (v: number | null) => void;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");
  const display = focused
    ? draft
    : value != null && !Number.isNaN(Number(value))
      ? Number(value).toFixed(2).replace(".", ",")
      : "";
  return (
    <Input
      type="text"
      inputMode="decimal"
      className="h-8 w-20 text-center mx-auto"
      value={display}
      onFocus={() => {
        setFocused(true);
        setDraft(value != null ? String(value).replace(".", ",") : "");
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false);
        const raw = draft.trim().replace(",", ".");
        if (raw === "") {
          onCommit(null);
          return;
        }
        let n = Number(raw);
        if (Number.isNaN(n)) return;
        if (n < 0) n = 0;
        if (n > max) n = max;
        onCommit(n);
      }}
    />
  );
}

interface RecoveryApplied {
  applied: boolean;
  replaced_assessment_id: string | null;
  recovery_score: number | null;
  original_score: number | null;
  reason?: "kept_original" | null;
}

function getRecoveryScore(entries: Entry[], student_id: string): number | null {
  const e = entries.find((x) => x.student_id === student_id && x.assessment_id === RECOVERY_KEY);
  return e?.score ?? null;
}

function resolveRecovery(
  entries: Entry[],
  student_id: string,
  assessments: Assessment[],
  recovery: RecoveryConfig | null,
): RecoveryApplied {
  if (!recovery?.enabled) return { applied: false, replaced_assessment_id: null, recovery_score: null, original_score: null };
  const recScore = getRecoveryScore(entries, student_id);
  if (recScore == null) return { applied: false, replaced_assessment_id: null, recovery_score: null, original_score: null };

  let targetId: string | null = null;
  if (recovery.mode === "specific") {
    targetId = recovery.target_assessment_id ?? null;
  } else {
    // lowest
    let lowest: { id: string; score: number } | null = null;
    for (const a of assessments) {
      const s = effectiveScore(entries, student_id, a);
      if (s == null) continue;
      if (!lowest || s < lowest.score) lowest = { id: a.id, score: s };
    }
    targetId = lowest?.id ?? null;
  }
  if (!targetId) return { applied: false, replaced_assessment_id: null, recovery_score: recScore, original_score: null };
  const targetAssessment = assessments.find((x) => x.id === targetId);
  const origScore = targetAssessment ? effectiveScore(entries, student_id, targetAssessment) : null;
  if (origScore == null) {
    return { applied: true, replaced_assessment_id: targetId, recovery_score: recScore, original_score: null };
  }
  if (recScore <= Number(origScore)) {
    return { applied: false, replaced_assessment_id: targetId, recovery_score: recScore, original_score: Number(origScore), reason: "kept_original" };
  }
  return { applied: true, replaced_assessment_id: targetId, recovery_score: recScore, original_score: Number(origScore) };
}

function calcAverage(
  entries: Entry[],
  student_id: string,
  assessments: Assessment[],
  formula: string,
  recovery: RecoveryConfig | null,
): number | null {
  const rec = resolveRecovery(entries, student_id, assessments, recovery);
  const scores = assessments.map((a) => {
    let score: number | null = effectiveScore(entries, student_id, a);
    if (rec.applied && rec.replaced_assessment_id === a.id && rec.recovery_score != null) {
      score = rec.recovery_score;
    }
    return { a, score };
  });
  const valid = scores.filter((s) => s.score != null);
  if (!valid.length) return null;
  if (formula === "simple_average") {
    return valid.reduce((sum, s) => sum + Number(s.score), 0) / valid.length;
  }
  const totalWeight = valid.reduce((sum, s) => sum + s.a.weight, 0);
  if (!totalWeight) return null;
  return valid.reduce((sum, s) => sum + (Number(s.score) * s.a.weight), 0) / totalWeight;
}

function getStatus(avg: number | null, passing: number, recoveryMin: number | null): { label: string; className: string } {
  if (avg == null) return { label: "—", className: "bg-muted text-muted-foreground" };
  if (avg >= passing) return { label: "Aprovado", className: "bg-green-100 text-green-700" };
  const recThreshold = recoveryMin ?? Math.max(passing - 2, 0);
  if (avg >= recThreshold) return { label: "Em recuperação", className: "bg-yellow-100 text-yellow-700" };
  return { label: "Reprovado", className: "bg-red-100 text-red-700" };
}

export function GradesModule({ disciplineId, isTeacher }: { disciplineId: string; isTeacher: boolean }) {
  const { user } = useAuth();
  const [structure, setStructure] = useState<Structure | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: gs } = await supabase
      .from("grade_structures").select("*").eq("discipline_id", disciplineId).maybeSingle();
    setStructure(gs ? {
      assessments: (gs.assessments as unknown as Assessment[]) ?? [],
      passing_average: Number(gs.passing_average),
      recovery_average: (gs as unknown as { recovery_average?: number | null }).recovery_average != null
        ? Number((gs as unknown as { recovery_average?: number | null }).recovery_average)
        : null,
      grade_scale: (((gs as unknown as { grade_scale?: number }).grade_scale ?? 10) === 100 ? 100 : 10) as 10 | 100,
      formula: gs.formula,
      recovery_config: ((gs as unknown as { recovery_config?: RecoveryConfig | null }).recovery_config) ?? null,
    } : null);
    const { data: ge } = await supabase
      .from("grade_entries").select("student_id, assessment_id, score").eq("discipline_id", disciplineId);
    setEntries((ge ?? []) as Entry[]);
    if (isTeacher) {
      const { data: ds } = await supabase.from("discipline_students").select("student_id").eq("discipline_id", disciplineId).eq("status", "active");
      const ids = (ds ?? []).map((d) => d.student_id);
      if (ids.length) {
        const { data: profs } = await supabase.rpc("get_profiles_safe", { _ids: ids });
        setStudents(((profs ?? []) as Student[]).sort((a, b) => a.name.localeCompare(b.name)));
      } else setStudents([]);
    } else if (user) {
      const { data: me } = await supabase.from("profiles").select("id, name, enrollment_number").eq("id", user.id).maybeSingle();
      setStudents(me ? [me as Student] : []);
    }
    setLoading(false);
  }, [disciplineId, isTeacher, user]);

  useEffect(() => { load(); }, [load]);

  // Realtime: recalcula totais ao vivo quando notas ou estrutura mudam
  useEffect(() => {
    const channel = supabase
      .channel(`grades:${disciplineId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "grade_entries", filter: `discipline_id=eq.${disciplineId}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "grade_structures", filter: `discipline_id=eq.${disciplineId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [disciplineId, load]);

  const updateScore = async (student_id: string, assessment_id: string, score: number | null) => {
    setEntries((prev) => {
      const idx = prev.findIndex((e) => e.student_id === student_id && e.assessment_id === assessment_id);
      if (idx >= 0) { const cp = [...prev]; cp[idx] = { ...cp[idx], score }; return cp; }
      return [...prev, { student_id, assessment_id, score }];
    });
    try {
      await upsertGradeEntry({ data: { discipline_id: disciplineId, student_id, assessment_id, score } });
      // Avisa o(a) professor(a) caso a recuperação não tenha substituído a nota
      if (assessment_id === RECOVERY_KEY && score != null && structure?.recovery_config?.enabled) {
        const rec = resolveRecovery(
          [...entries.filter((e) => !(e.student_id === student_id && e.assessment_id === assessment_id)), { student_id, assessment_id, score }],
          student_id,
          structure.assessments,
          structure.recovery_config,
        );
        if (rec.reason === "kept_original") {
          toast.warning("Nota original mantida", {
            description: `A nota de recuperação (${score}) é menor que a original (${rec.original_score}). A nota original foi preservada.`,
          });
        }
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); load(); }
  };

  const undoRecovery = async (student_id: string) => {
    try {
      await clearRecoveryEntry({ data: { discipline_id: disciplineId, student_id } });
      toast.success("Recuperação desfeita. Nota original restaurada.");
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
  };

  const publish = async () => {
    try {
      await publishGrades({ data: { discipline_id: disciplineId } });
      toast.success("Notas publicadas (alunos notificados)");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
  };

  const downloadCsv = () => {
    if (!structure) return;
    const rec = structure.recovery_config?.enabled ? structure.recovery_config : null;
    const headers = [
      "Aluno",
      "Matrícula",
      ...structure.assessments.flatMap((a) =>
        a.sub_items?.length
          ? [...a.sub_items.map((sub) => `${a.name} — ${sub.name}`), `${a.name} — Média (${a.weight}%)`]
          : [`${a.name} (${a.weight}%)`],
      ),
      ...(rec ? [rec.name] : []),
      "Média",
      "Status",
    ];
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = students.map((s) => {
      const avg = calcAverage(entries, s.id, structure.assessments, structure.formula, rec);
      const status = getStatus(avg, structure.passing_average, structure.recovery_average);
      const cells = [
        s.name,
        s.enrollment_number ?? "",
      ...structure.assessments.flatMap((a) => {
        if (a.sub_items?.length) {
          const subCells = a.sub_items.map((sub) => {
            const e = entries.find((x) => x.student_id === s.id && x.assessment_id === subKey(a.id, sub.id));
            return e?.score != null ? csvGrade(e.score) : "";
          });
          const avg = subAverage(entries, s.id, a);
          return [...subCells, avg != null ? csvGrade(avg) : ""];
        }
        const e = entries.find((x) => x.student_id === s.id && x.assessment_id === a.id);
        return [e?.score != null ? csvGrade(e.score) : ""];
      }),
        ...(rec ? [(() => { const v = getRecoveryScore(entries, s.id); return v != null ? csvGrade(v) : ""; })()] : []),
        avg != null ? csvGrade(avg) : "",
        status.label,
      ];
      return cells.map(escape).join(";");
    });
    const csv = "\uFEFF" + [headers.map(escape).join(";"), ...rows].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `notas-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("Tabela de notas exportada (CSV)");
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const recovery = structure?.recovery_config?.enabled ? structure.recovery_config : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-white">
          <h2 className="text-lg font-semibold">Notas</h2>
          <p className="text-sm opacity-80">
            {structure ? (
              <>
                Escala 0–{structure.grade_scale} · Aprovação ≥ {structure.passing_average}
                {structure.recovery_average != null && <> · Recuperação ≥ {structure.recovery_average}</>}
              </>
            ) : "Configure as avaliações"}
            {recovery && <> · Recuperação: <span className="font-medium">{recovery.name}</span> ({recovery.mode === "lowest" ? "substitui menor nota" : "substitui avaliação específica"})</>}
          </p>
        </div>
        {isTeacher && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setSettingsOpen(true)}><Settings className="h-4 w-4 mr-2" /> Configurar</Button>
            {structure && students.length > 0 && (
              <Button variant="outline" onClick={downloadCsv}><Download className="h-4 w-4 mr-2" /> Baixar CSV</Button>
            )}
            {structure && <Button onClick={publish}><Send className="h-4 w-4 mr-2" /> Notificar alunos</Button>}
          </div>
        )}
      </div>

      {!structure ? (
        <div className="border-2 border-dashed rounded-xl py-12 text-center">
          <BarChart3 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">{isTeacher ? "Configure a estrutura de avaliações para começar." : "Estrutura de notas ainda não configurada."}</p>
        </div>
      ) : students.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">Sem alunos matriculados.</p>
      ) : !isTeacher ? (
        <div className="space-y-6">
          <AnalyticsModule disciplineId={disciplineId} isTeacher={false} />

          <StudentGradeCards
            student={students[0]}
            entries={entries}
            structure={structure}
            recovery={recovery}
          />
        </div>
      ) : (
        <div className="rounded-xl border bg-card overflow-x-auto" style={{ boxShadow: "var(--shadow-card)" }}>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2">Aluno</th>
                {structure.assessments.map((a) => (
                  <th key={a.id} className="text-center px-3 py-2">{a.name} <span className="text-muted-foreground font-normal">({a.weight}%)</span></th>
                ))}
                {recovery && (
                  <th className="text-center px-3 py-2 bg-amber-50 dark:bg-amber-950/30">
                    <div className="flex items-center justify-center gap-1"><Sparkles className="h-3 w-3" /> {recovery.name}</div>
                    <div className="text-muted-foreground font-normal text-[10px]">máx {recovery.max_score}</div>
                  </th>
                )}
                <th className="text-center px-3 py-2">Média</th>
                <th className="text-center px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => {
                const rec = resolveRecovery(entries, s.id, structure.assessments, recovery);
                const avg = calcAverage(entries, s.id, structure.assessments, structure.formula, recovery);
                const allScored = structure.assessments.every((a) => {
                  if (a.sub_items?.length) {
                    return a.sub_items.every((sub) => {
                      const e = entries.find(
                        (x) => x.student_id === s.id && x.assessment_id === subKey(a.id, sub.id),
                      );
                      return e?.score != null;
                    });
                  }
                  return effectiveScore(entries, s.id, a) != null;
                });
                const status = allScored
                  ? getStatus(avg, structure.passing_average, structure.recovery_average)
                  : { label: "Aguardando lançamento", className: "bg-muted text-muted-foreground" };
                return (
                  <tr key={s.id} className="border-t">
                    <td className="px-3 py-2">
                      <div>{s.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{s.enrollment_number ?? "—"}</div>
                    </td>
                    {structure.assessments.map((a) => {
                      const directEntry = a.sub_items?.length
                        ? null
                        : entries.find((x) => x.student_id === s.id && x.assessment_id === a.id);
                      const score = a.sub_items?.length
                        ? subAverage(entries, s.id, a)
                        : directEntry?.score;
                      const replacedHere = rec.applied && rec.replaced_assessment_id === a.id;
                      return (
                        <td key={a.id} className={`px-3 py-2 text-center ${replacedHere ? "bg-amber-50 dark:bg-amber-950/20" : ""}`}>
                          {a.sub_items?.length ? (
                            <div className="space-y-1">
                              {a.sub_items.map((sub) => {
                                const se = entries.find((x) => x.student_id === s.id && x.assessment_id === subKey(a.id, sub.id));
                                return (
                                  <div key={sub.id} className="flex items-center gap-1 justify-center">
                                    <span className="text-[10px] text-muted-foreground w-16 text-right truncate" title={sub.name}>{sub.name}</span>
                                    <GradeInput
                                      value={se?.score}
                                      max={a.max_score}
                                      onCommit={(v) => updateScore(s.id, subKey(a.id, sub.id), v)}
                                    />
                                  </div>
                                );
                              })}
                              <div className="text-[11px] font-semibold pt-1 border-t border-dashed">
                                Média: {formatGrade(score)}
                              </div>
                            </div>
                          ) : isTeacher ? (
                            <GradeInput
                              value={score}
                              max={a.max_score}
                              onCommit={(v) => updateScore(s.id, a.id, v)}
                            />
                          ) : (
                            <span className={replacedHere ? "line-through text-muted-foreground" : ""}>{formatGrade(score)}</span>
                          )}
                          {replacedHere && (
                            <div className="text-[10px] text-amber-700 dark:text-amber-400 mt-1">
                              Substituída → {formatGrade(rec.recovery_score)}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    {recovery && (
                      <td className="px-3 py-2 text-center bg-amber-50/50 dark:bg-amber-950/10">
                        {isTeacher ? (
                          <div className="flex items-center justify-center gap-1">
                            <GradeInput
                              value={getRecoveryScore(entries, s.id)}
                              max={recovery.max_score}
                              onCommit={(v) => updateScore(s.id, RECOVERY_KEY, v)}
                            />
                            {getRecoveryScore(entries, s.id) != null && (
                              <Button size="icon" variant="ghost" className="h-7 w-7" title="Desfazer recuperação" onClick={() => undoRecovery(s.id)}>
                                <Undo2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        ) : (
                          <span>{formatGrade(getRecoveryScore(entries, s.id))}</span>
                        )}
                        {rec.reason === "kept_original" && (
                          <div className="text-[10px] text-muted-foreground mt-1">Original mantida ({formatGrade(rec.original_score)})</div>
                        )}
                      </td>
                    )}
                    <td className={`px-3 py-2 text-center font-semibold ${avg != null ? (avg >= 5 ? "text-blue-600" : "text-red-600") : ""}`}>{formatGrade(avg)}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-xs px-2 py-1 rounded ${status.className}`}>{status.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {settingsOpen && isTeacher && (
        <StructureDialog disciplineId={disciplineId} initial={structure}
          onClose={() => setSettingsOpen(false)}
          onDone={() => { setSettingsOpen(false); load(); }} />
      )}
    </div>
  );
}

/** Visão do aluno: cartões verticais (sem rolagem horizontal). */
function StudentGradeCards({
  student,
  entries,
  structure,
  recovery,
}: {
  student: Student;
  entries: Entry[];
  structure: Structure;
  recovery: RecoveryConfig | null;
}) {
  const rec = resolveRecovery(entries, student.id, structure.assessments, recovery);
  const avg = calcAverage(entries, student.id, structure.assessments, structure.formula, recovery);
  const allScored = structure.assessments.every((a) => {
    if (a.sub_items?.length) {
      return a.sub_items.every((sub) => {
        const e = entries.find(
          (x) => x.student_id === student.id && x.assessment_id === subKey(a.id, sub.id),
        );
        return e?.score != null;
      });
    }
    return effectiveScore(entries, student.id, a) != null;
  });
  const rawStatus = getStatus(avg, structure.passing_average, structure.recovery_average);
  const status = allScored
    ? rawStatus
    : { label: "Aguardando lançamento", className: "bg-muted text-muted-foreground" };
  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-card p-4" style={{ boxShadow: "var(--shadow-card)" }}>
        <div className="flex items-center justify-between gap-3 pb-3 border-b">
          <div className="text-sm">
            <div className="text-muted-foreground">Média final</div>
            <div className={`text-2xl font-bold ${avg != null ? (avg >= 5 ? "text-blue-600" : "text-red-600") : ""}`}>{formatGrade(avg)}</div>
          </div>
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${status.className}`}>{status.label}</span>
        </div>
        <ul className="divide-y">
          {structure.assessments.map((a) => {
            const score = effectiveScore(entries, student.id, a);
            const replacedHere = rec.applied && rec.replaced_assessment_id === a.id;
            return (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="font-medium truncate">{a.name}</div>
                  <div className="text-xs text-muted-foreground">
                    Peso {a.weight}%
                    {a.sub_items?.length ? ` · média de ${a.sub_items.length} notas` : ""}
                  </div>
                  {a.sub_items?.length ? (
                    <ul className="mt-1 space-y-0.5">
                      {a.sub_items.map((sub) => {
                        const se = entries.find((x) => x.student_id === student.id && x.assessment_id === subKey(a.id, sub.id));
                        return (
                          <li key={sub.id} className="text-[11px] text-muted-foreground flex justify-between gap-2">
                            <span className="truncate">{sub.name}</span>
                            <span className="tabular-nums">{formatGrade(se?.score)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
                <div className="text-right">
                  <span className={`font-semibold ${replacedHere ? "line-through text-muted-foreground" : ""}`}>
                    {formatGrade(score)}
                  </span>
                  {replacedHere && (
                    <div className="text-[11px] text-amber-700 dark:text-amber-400">
                      Substituída → {formatGrade(rec.recovery_score)}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
          {recovery && (
            <li className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="font-medium truncate flex items-center gap-1">
                  <Sparkles className="h-3.5 w-3.5 text-amber-600" /> {recovery.name}
                </div>
                <div className="text-xs text-muted-foreground">máx {recovery.max_score}</div>
              </div>
              <div className="text-right">
                <span className="font-semibold">{formatGrade(getRecoveryScore(entries, student.id))}</span>
                {rec.reason === "kept_original" && (
                  <div className="text-[11px] text-muted-foreground">Original mantida ({formatGrade(rec.original_score)})</div>
                )}
              </div>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

function StructureDialog({ disciplineId, initial, onClose, onDone }: {
  disciplineId: string; initial: Structure | null; onClose: () => void; onDone: () => void;
}) {
  const [scale, setScale] = useState<10 | 100>(initial?.grade_scale ?? 10);
  const [assessments, setAssessments] = useState<Assessment[]>(
    initial?.assessments ?? [
      { id: crypto.randomUUID(), name: "Prova 1", weight: 40, max_score: 10 },
      { id: crypto.randomUUID(), name: "Prova 2", weight: 40, max_score: 10 },
      { id: crypto.randomUUID(), name: "Trabalhos", weight: 20, max_score: 10 },
    ],
  );
  const [passing, setPassing] = useState(initial?.passing_average ?? (initial?.grade_scale === 100 ? 60 : 6));
  const [recoveryAvg, setRecoveryAvg] = useState<number | null>(
    initial?.recovery_average ?? (initial?.grade_scale === 100 ? 40 : 4),
  );
  const [recovery, setRecovery] = useState<RecoveryConfig>(
    initial?.recovery_config ?? { enabled: false, name: "Prova de Recuperação", max_score: 10, mode: "lowest", target_assessment_id: null },
  );
  const [submitting, setSubmitting] = useState(false);

  const totalWeight = assessments.reduce((s, a) => s + (a.weight ?? 0), 0);

  const save = async () => {
    if (!assessments.length || assessments.some((a) => !a.name.trim())) { toast.error("Cada avaliação precisa de nome"); return; }
    if (Math.abs(totalWeight - 100) > 0.01) { toast.error(`Pesos devem somar 100% (atual: ${totalWeight})`); return; }
    if (passing < 0 || passing > scale) { toast.error(`A média de aprovação deve estar entre 0 e ${scale}`); return; }
    if (recoveryAvg != null && (recoveryAvg < 0 || recoveryAvg > passing)) {
      toast.error("A média de recuperação deve estar entre 0 e a média de aprovação"); return;
    }
    if (recovery.enabled) {
      if (!recovery.name.trim()) { toast.error("Dê um nome à avaliação de recuperação"); return; }
      if (recovery.mode === "specific" && !recovery.target_assessment_id) { toast.error("Selecione a avaliação a ser substituída"); return; }
      if (recovery.mode === "specific" && !assessments.find((a) => a.id === recovery.target_assessment_id)) {
        toast.error("A avaliação selecionada para recuperação não existe mais"); return;
      }
    }
    setSubmitting(true);
    try {
      await saveGradeStructure({ data: {
        discipline_id: disciplineId, assessments,
        formula: "weighted_average", passing_average: passing,
        recovery_average: recoveryAvg,
        grade_scale: scale,
        recovery_config: recovery.enabled ? recovery : null,
      } });
      toast.success("Estrutura salva"); onDone();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
    finally { setSubmitting(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Estrutura de avaliações</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Escala de notas</Label>
              <Select value={String(scale)} onValueChange={(v) => {
                const newScale = (v === "100" ? 100 : 10) as 10 | 100;
                const factor = newScale / scale;
                setScale(newScale);
                setPassing((p) => Math.round(p * factor * 10) / 10);
                setRecoveryAvg((r) => r == null ? r : Math.round(r * factor * 10) / 10);
                setAssessments((arr) => arr.map((a) => ({ ...a, max_score: Math.round(a.max_score * factor * 10) / 10 })));
                setRecovery((rc) => ({ ...rc, max_score: Math.round(rc.max_score * factor * 10) / 10 }));
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">0 a 10</SelectItem>
                  <SelectItem value="100">0 a 100</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Soma dos pesos</Label>
              <Input value={`${totalWeight}%`} disabled className={Math.abs(totalWeight - 100) > 0.01 ? "text-destructive" : ""} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Média de aprovação (≥)</Label>
              <Input type="number" min={0} max={scale} step={0.1} value={passing} onChange={(e) => setPassing(Number(e.target.value))} />
              <p className="text-[11px] text-muted-foreground mt-1">Status "Aprovado" a partir desta nota.</p>
            </div>
            <div>
              <Label>Média de recuperação (≥)</Label>
              <Input type="number" min={0} max={passing} step={0.1} value={recoveryAvg ?? ""} onChange={(e) => setRecoveryAvg(e.target.value === "" ? null : Number(e.target.value))} />
              <p className="text-[11px] text-muted-foreground mt-1">
                "Em recuperação" entre {recoveryAvg ?? "—"} e {passing}. Abaixo de {recoveryAvg ?? "—"} = "Reprovado".
              </p>
            </div>
          </div>
          <div>
            <Label>Avaliações</Label>
            <div className="space-y-2 mt-2">
              {assessments.map((a, i) => (
                <div key={a.id} className="border rounded-md p-2 space-y-2 bg-background">
                  <div className="flex gap-2">
                    <Input value={a.name} placeholder="Nome da coluna (ex.: Relatório de Aulas Práticas)" onChange={(e) => setAssessments(assessments.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} />
                    <Input type="number" className="w-20" value={a.weight} placeholder="Peso %" onChange={(e) => setAssessments(assessments.map((x, idx) => idx === i ? { ...x, weight: Number(e.target.value) } : x))} />
                    <Input type="number" className="w-20" value={a.max_score} placeholder="Máx" onChange={(e) => setAssessments(assessments.map((x, idx) => idx === i ? { ...x, max_score: Number(e.target.value) } : x))} />
                    <Button size="icon" variant="ghost" className="h-9 w-9 text-destructive" onClick={() => setAssessments(assessments.filter((_, idx) => idx !== i))}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="pl-2 border-l-2 border-dashed space-y-1.5">
                    <div className="text-[11px] text-muted-foreground">
                      Sub-notas (opcional) — a coluna mostrará a média destas notas.
                    </div>
                    {(a.sub_items ?? []).map((sub, si) => (
                      <div key={sub.id} className="flex gap-2">
                        <Input
                          className="h-8"
                          value={sub.name}
                          placeholder={`Nota ${si + 1} (ex.: Aula Prática ${si + 1})`}
                          onChange={(e) => setAssessments(assessments.map((x, idx) => idx === i ? {
                            ...x,
                            sub_items: (x.sub_items ?? []).map((y, yi) => yi === si ? { ...y, name: e.target.value } : y),
                          } : x))}
                        />
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setAssessments(assessments.map((x, idx) => idx === i ? {
                          ...x,
                          sub_items: (x.sub_items ?? []).filter((_, yi) => yi !== si),
                        } : x))}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => setAssessments(assessments.map((x, idx) => {
                        if (idx !== i) return x;
                        const subs = x.sub_items ?? [];
                        const nextIdx = subs.length + 1;
                        return {
                          ...x,
                          sub_items: [
                            ...subs,
                            { id: crypto.randomUUID().slice(0, 8), name: `${x.name || "Nota"} ${nextIdx}` },
                          ],
                        };
                      }))}
                    >
                      <Plus className="h-3 w-3 mr-1" /> Adicionar nota nesta coluna
                    </Button>
                  </div>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => setAssessments([...assessments, { id: crypto.randomUUID(), name: "", weight: 0, max_score: 10 }])}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Avaliação
              </Button>
            </div>
          </div>

          <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
            <div className="flex items-center justify-between">
              <div>
                <Label className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-amber-600" /> Recuperação acadêmica</Label>
                <p className="text-xs text-muted-foreground mt-1">Permite uma nota substitutiva opcional ao final do período.</p>
              </div>
              <Switch checked={recovery.enabled} onCheckedChange={(v) => setRecovery({ ...recovery, enabled: v })} />
            </div>
            {recovery.enabled && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Nome da avaliação</Label>
                    <Input value={recovery.name} placeholder="Prova de Recuperação" onChange={(e) => setRecovery({ ...recovery, name: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">Nota máxima</Label>
                    <Input type="number" min={0.1} max={100} step={0.1} value={recovery.max_score} onChange={(e) => setRecovery({ ...recovery, max_score: Number(e.target.value) })} />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Regra de substituição</Label>
                  <Select value={recovery.mode} onValueChange={(v: "lowest" | "specific") => setRecovery({ ...recovery, mode: v, target_assessment_id: v === "lowest" ? null : recovery.target_assessment_id })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lowest">Substituir a menor nota automaticamente</SelectItem>
                      <SelectItem value="specific">Substituir uma avaliação específica</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {recovery.mode === "specific" && (
                  <div>
                    <Label className="text-xs">Avaliação a ser substituída</Label>
                    <Select value={recovery.target_assessment_id ?? ""} onValueChange={(v) => setRecovery({ ...recovery, target_assessment_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                      <SelectContent>
                        {assessments.filter((a) => a.name.trim()).map((a) => (
                          <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">
                  A substituição só ocorre quando a nota da recuperação for <strong>maior</strong> que a nota original.
                  Caso contrário, a nota original é mantida.
                </p>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={submitting} onClick={save}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}