import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listInstitutionStudents, listInstitutionDisciplines } from "@/backend/institution.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search, Download } from "lucide-react";
import { toast } from "sonner";
import { ImportStudentsTab } from "@/components/admin/ImportStudentsTab";

interface Student { id: string; name: string; enrollment_number: string | null; disciplines: string[] }
interface Discipline { id: string; name: string }

export function InstitutionStudentsTab() {
  const listStudents = useServerFn(listInstitutionStudents);
  const listDisc = useServerFn(listInstitutionDisciplines);
  const [students, setStudents] = useState<Student[]>([]);
  const [disciplines, setDisciplines] = useState<Discipline[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, d] = await Promise.all([listStudents(), listDisc()]);
      setStudents((Array.isArray(s) ? s : []) as Student[]);
      setDisciplines((Array.isArray(d) ? d : []) as Discipline[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar alunos");
    } finally {
      setLoading(false);
    }
  }, [listStudents, listDisc]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return students
      .filter((s) => (filter === "all" ? true : s.disciplines.includes(filter)))
      .filter((s) =>
        !term ||
        s.name.toLowerCase().includes(term) ||
        (s.enrollment_number ?? "").toLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [students, q, filter]);

  const exportCsv = () => {
    const header = ["Matrícula", "Aluno", "Disciplinas"];
    const rows = visible.map((s) => [s.enrollment_number ?? "", s.name, s.disciplines.join(" | ")]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url; a.download = "alunos.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <ImportStudentsTab disciplineOptions={disciplines.map((d) => ({ id: d.id, name: d.name }))} />

      <Card className="border-0" style={{ boxShadow: "var(--shadow-card)" }}>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Buscar por nome ou matrícula"
                value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as disciplinas</SelectItem>
                {disciplines.map((d) => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!visible.length}>
              <Download className="h-4 w-4 mr-1" /> CSV
            </Button>
          </div>

          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : visible.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhum aluno encontrado.</p>
          ) : (
            <ul className="divide-y">
              {visible.map((s) => (
                <li key={s.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{s.enrollment_number ?? "—"}</div>
                  </div>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {s.disciplines.length === 0
                      ? <Badge variant="outline">Sem disciplina</Badge>
                      : s.disciplines.map((d) => <Badge key={d} variant="secondary">{d}</Badge>)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
