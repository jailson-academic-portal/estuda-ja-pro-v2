import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getInstitutionDisciplineGrades } from "@/backend/institution.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Download } from "lucide-react";
import { toast } from "sonner";

interface Assessment { id: string; name: string; weight?: number; max_score?: number }
interface Student { id: string; name: string; enrollment_number: string | null }
interface Entry { student_id: string; assessment_id: string; score: number | null }

const fmt = (n: number | null | undefined) =>
  n == null || Number.isNaN(Number(n)) ? "—" : Number(n).toFixed(2).replace(".", ",");

export function DisciplineGradesDialog({
  disciplineId, disciplineName, open, onOpenChange,
}: { disciplineId: string; disciplineName: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const fetchGrades = useServerFn(getInstitutionDisciplineGrades);
  const [loading, setLoading] = useState(true);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [passing, setPassing] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      try {
        const res = await fetchGrades({ data: { discipline_id: disciplineId } });
        const struct = res.structure as { assessments?: Assessment[]; passing_average?: number } | null;
        setAssessments(Array.isArray(struct?.assessments) ? struct!.assessments! : []);
        setPassing(struct?.passing_average ?? null);
        setStudents(res.students as Student[]);
        setEntries(res.entries as Entry[]);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao carregar notas");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, disciplineId, fetchGrades]);

  const scoreOf = (studentId: string, assessmentId: string) =>
    entries.find((e) => e.student_id === studentId && e.assessment_id === assessmentId)?.score ?? null;

  const averageOf = (studentId: string) => {
    if (!assessments.length) return null;
    let sum = 0, weights = 0;
    for (const a of assessments) {
      const s = scoreOf(studentId, a.id);
      if (s == null) continue;
      const w = Number(a.weight ?? 0) || 0;
      sum += Number(s) * w;
      weights += w;
    }
    return weights > 0 ? sum / weights : null;
  };

  const exportCsv = () => {
    const header = ["Matrícula", "Aluno", ...assessments.map((a) => a.name), "Média"];
    const lines = students.map((s) => [
      s.enrollment_number ?? "",
      s.name,
      ...assessments.map((a) => fmt(scoreOf(s.id, a.id))),
      fmt(averageOf(s.id)),
    ]);
    const csv = [header, ...lines].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `notas-${disciplineName.replace(/\s+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Notas — {disciplineName} (somente leitura)</DialogTitle></DialogHeader>
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : students.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Nenhum aluno matriculado.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={exportCsv}>
                <Download className="h-4 w-4 mr-1" /> Baixar CSV
              </Button>
            </div>
            <div className="overflow-x-auto border rounded-md">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2 px-3 text-left">Aluno</th>
                    {assessments.map((a) => <th key={a.id} className="px-2 text-center">{a.name}</th>)}
                    <th className="px-2 text-center">Média</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => {
                    const avg = averageOf(s.id);
                    const failing = passing != null && avg != null && avg < passing;
                    return (
                      <tr key={s.id} className="border-t">
                        <td className="py-1.5 px-3">
                          <div className="font-medium">{s.name}</div>
                          <div className="text-xs text-muted-foreground font-mono">{s.enrollment_number ?? "—"}</div>
                        </td>
                        {assessments.map((a) => (
                          <td key={a.id} className="px-2 text-center">{fmt(scoreOf(s.id, a.id))}</td>
                        ))}
                        <td className={`px-2 text-center font-semibold ${failing ? "text-destructive" : ""}`}>{fmt(avg)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
