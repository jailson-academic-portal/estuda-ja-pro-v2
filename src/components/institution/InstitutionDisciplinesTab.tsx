import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  listInstitutionDisciplines,
  listInstitutionTeachers,
  listInstitutionStudents,
  createInstitutionDiscipline,
  updateInstitutionDiscipline,
  enrollStudentsInDiscipline,
} from "@/backend/institution.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Settings2, Users, BarChart3, Download, Pencil } from "lucide-react";
import { toast } from "sonner";
import { DisciplineConfigDialog } from "./DisciplineConfigDialog";
import { DisciplineGradesDialog } from "./DisciplineGradesDialog";

interface Discipline {
  id: string; name: string; code: string | null; group_name: string | null;
  semester: string; year: number; status: string; teacher_id: string;
  teacher_name: string | null; student_count: number; location: string | null;
}
interface Teacher { id: string; name: string; email: string | null }
interface Student { id: string; name: string; enrollment_number: string | null; disciplines: string[] }

const CURRENT_YEAR = new Date().getFullYear();

export function InstitutionDisciplinesTab() {
  const listDisc = useServerFn(listInstitutionDisciplines);
  const listTeachers = useServerFn(listInstitutionTeachers);
  const listStudents = useServerFn(listInstitutionStudents);
  const createFn = useServerFn(createInstitutionDiscipline);
  const updateFn = useServerFn(updateInstitutionDiscipline);
  const enrollFn = useServerFn(enrollStudentsInDiscipline);

  const [disciplines, setDisciplines] = useState<Discipline[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Discipline | null>(null);
  const [form, setForm] = useState({
    name: "", teacher_id: "", group_name: "", semester: "1", year: CURRENT_YEAR, location: "",
  });

  const [configFor, setConfigFor] = useState<Discipline | null>(null);
  const [gradesFor, setGradesFor] = useState<Discipline | null>(null);
  const [enrollFor, setEnrollFor] = useState<Discipline | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, t, s] = await Promise.all([listDisc(), listTeachers(), listStudents()]);
      setDisciplines((Array.isArray(d) ? d : []) as Discipline[]);
      setTeachers((Array.isArray(t) ? t : []) as Teacher[]);
      setStudents((Array.isArray(s) ? s : []) as Student[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar disciplinas");
    } finally {
      setLoading(false);
    }
  }, [listDisc, listTeachers, listStudents]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", teacher_id: teachers[0]?.id ?? "", group_name: "", semester: "1", year: CURRENT_YEAR, location: "" });
    setFormOpen(true);
  };

  const openEdit = (d: Discipline) => {
    setEditing(d);
    setForm({
      name: d.name, teacher_id: d.teacher_id, group_name: d.group_name ?? "",
      semester: d.semester, year: d.year, location: d.location ?? "",
    });
    setFormOpen(true);
  };

  const submit = async () => {
    if (!form.name.trim() || !form.teacher_id) {
      toast.error("Informe o nome da disciplina e o professor responsável");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateFn({ data: { discipline_id: editing.id, ...form, group_name: form.group_name || null, location: form.location || null } });
        toast.success("Disciplina atualizada");
      } else {
        await createFn({ data: { ...form, group_name: form.group_name || undefined, location: form.location || undefined } });
        toast.success("Disciplina criada e vinculada ao professor");
      }
      setFormOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (d: Discipline) => {
    try {
      await updateFn({ data: { discipline_id: d.id, status: d.status === "active" ? "archived" : "active" } });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  const confirmEnroll = async () => {
    if (!enrollFor || selected.length === 0) return;
    setSaving(true);
    try {
      const res = await enrollFn({ data: { discipline_id: enrollFor.id, student_ids: selected } });
      toast.success(`${res.enrolled} aluno(s) matriculado(s)`);
      setEnrollFor(null);
      setSelected([]);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao matricular");
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () => {
    const header = ["Disciplina", "Código", "Turma", "Professor", "Período", "Alunos", "Status"];
    const rows = disciplines.map((d) => [
      d.name, d.code ?? "", d.group_name ?? "", d.teacher_name ?? "",
      `${d.semester}/${d.year}`, String(d.student_count), d.status === "active" ? "Ativa" : "Arquivada",
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url; a.download = "disciplinas.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="border-0" style={{ boxShadow: "var(--shadow-card)" }}>
      <CardContent className="pt-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Crie a disciplina, configure o diário e matricule os alunos — o professor acessa e já encontra tudo pronto.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!disciplines.length}>
              <Download className="h-4 w-4 mr-1" /> CSV
            </Button>
            <Button size="sm" onClick={openCreate} disabled={!teachers.length}>
              <Plus className="h-4 w-4 mr-1" /> Nova disciplina
            </Button>
          </div>
        </div>

        {!teachers.length && !loading && (
          <p className="text-sm text-muted-foreground border border-dashed rounded-lg p-4">
            Cadastre ao menos um professor (aba Convites) antes de criar disciplinas.
          </p>
        )}

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : disciplines.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Nenhuma disciplina criada ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground border-b">
                <tr>
                  <th className="py-2">Disciplina</th>
                  <th>Professor</th>
                  <th>Período</th>
                  <th>Alunos</th>
                  <th>Status</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {disciplines.map((d) => (
                  <tr key={d.id} className="border-b last:border-0">
                    <td className="py-2">
                      <div className="font-medium">{d.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {d.group_name || "Sem turma"} {d.code ? `• ${d.code}` : ""}
                      </div>
                    </td>
                    <td>{d.teacher_name ?? "—"}</td>
                    <td>{d.semester}/{d.year}</td>
                    <td>{d.student_count}</td>
                    <td>
                      {d.status === "active"
                        ? <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Ativa</Badge>
                        : <Badge variant="secondary">Arquivada</Badge>}
                    </td>
                    <td className="text-right space-x-1 whitespace-nowrap">
                      <Button size="sm" variant="ghost" title="Editar" onClick={() => openEdit(d)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" title="Configurar diário" onClick={() => setConfigFor(d)}>
                        <Settings2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" title="Matricular alunos"
                        onClick={() => { setEnrollFor(d); setSelected([]); }}>
                        <Users className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" title="Ver notas" onClick={() => setGradesFor(d)}>
                        <BarChart3 className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => toggleStatus(d)}>
                        {d.status === "active" ? "Arquivar" : "Reativar"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Editar disciplina" : "Nova disciplina"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Nome da disciplina</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Ex.: Farmacognosia" />
            </div>
            <div className="space-y-1">
              <Label>Professor responsável</Label>
              <Select value={form.teacher_id} onValueChange={(v) => setForm((f) => ({ ...f, teacher_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {teachers.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Turma</Label>
                <Input value={form.group_name} onChange={(e) => setForm((f) => ({ ...f, group_name: e.target.value }))}
                  placeholder="Ex.: Farmácia 5º período" />
              </div>
              <div className="space-y-1">
                <Label>Local</Label>
                <Input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                  placeholder="Ex.: Sala 12" />
              </div>
              <div className="space-y-1">
                <Label>Semestre</Label>
                <Select value={form.semester} onValueChange={(v) => setForm((f) => ({ ...f, semester: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1º semestre</SelectItem>
                    <SelectItem value="2">2º semestre</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Ano</Label>
                <Input type="number" value={form.year}
                  onChange={(e) => setForm((f) => ({ ...f, year: Number(e.target.value) }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!enrollFor} onOpenChange={(v) => !v && setEnrollFor(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Matricular alunos — {enrollFor?.name}</DialogTitle></DialogHeader>
          {students.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              Nenhum aluno cadastrado nesta instituição. Use a aba "Alunos" para importar por CSV.
            </p>
          ) : (
            <div className="space-y-2">
              {students.map((s) => {
                const already = enrollFor ? s.disciplines.includes(enrollFor.name) : false;
                return (
                  <label key={s.id} className="flex items-center gap-3 border rounded-md px-3 py-2 cursor-pointer">
                    <Checkbox
                      checked={already || selected.includes(s.id)}
                      disabled={already}
                      onCheckedChange={(c) =>
                        setSelected((prev) => (c ? [...prev, s.id] : prev.filter((id) => id !== s.id)))
                      }
                    />
                    <span className="flex-1">
                      <span className="text-sm font-medium">{s.name}</span>
                      <span className="block text-xs text-muted-foreground font-mono">{s.enrollment_number ?? "—"}</span>
                    </span>
                    {already && <Badge variant="secondary">Matriculado</Badge>}
                  </label>
                );
              })}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnrollFor(null)}>Fechar</Button>
            <Button onClick={confirmEnroll} disabled={saving || selected.length === 0}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Matricular ({selected.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {configFor && (
        <DisciplineConfigDialog
          disciplineId={configFor.id}
          disciplineName={configFor.name}
          open={!!configFor}
          onOpenChange={(v) => !v && setConfigFor(null)}
        />
      )}
      {gradesFor && (
        <DisciplineGradesDialog
          disciplineId={gradesFor.id}
          disciplineName={gradesFor.name}
          open={!!gradesFor}
          onOpenChange={(v) => !v && setGradesFor(null)}
        />
      )}
    </Card>
  );
}
