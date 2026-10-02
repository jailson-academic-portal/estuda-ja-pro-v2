import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { enrollStudents, unenrollStudent, resetStudentPassword, syncDisciplineStudents, cleanupDisciplineDuplicates, setEnrollmentStatus } from "@/backend/students.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Upload, UserPlus, Trash2, Users, KeyRound, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { UpgradeRequiredDialog } from "@/components/UpgradeRequiredDialog";

interface StudentRow {
  id: string;
  name: string;
  enrollment_number: string | null;
  enrollment_status?: string;
}

/** Very small CSV parser supporting quoted fields and commas/semicolons. */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  const sep = text.includes(";") && !text.includes(",") ? ";" : ",";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === sep) { cur.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (field !== "" || cur.length) { cur.push(field); rows.push(cur); cur = []; field = ""; }
        if (c === "\r" && text[i + 1] === "\n") i++;
      } else field += c;
    }
  }
  if (field !== "" || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}

function detectColumns(rows: string[][]): { nameIdx: number; matIdx: number; startRow: number } {
  if (!rows.length) return { nameIdx: 1, matIdx: 0, startRow: 0 };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const matIdx = header.findIndex((h) => /(matr|enroll|registro)/.test(h));
  const nameIdx = header.findIndex((h) => /(nome|name)/.test(h));
  if (matIdx >= 0 && nameIdx >= 0) return { nameIdx, matIdx, startRow: 1 };
  // Fallback: first column = matricula, second = name
  return { nameIdx: 1, matIdx: 0, startRow: 0 };
}

export function StudentsModule({ disciplineId }: { disciplineId: string }) {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [removing, setRemoving] = useState<StudentRow | null>(null);
  const [resetting, setResetting] = useState<StudentRow | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive" | "all">("active");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [statusLoadingId, setStatusLoadingId] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    
    // Automatic cleanup of duplicates when opening the module
    try {
      await cleanupDisciplineDuplicates({ data: { discipline_id: disciplineId } });
    } catch (err) {
      console.warn("Falha silenciosa na limpeza de duplicidades:", err);
    }

    const { data: ds } = await supabase
      .from("discipline_students").select("student_id, status").eq("discipline_id", disciplineId);
    const rows = ds ?? [];
    const ids = rows.map((r) => r.student_id);
    if (ids.length) {
      const statusById = new Map(rows.map((r) => [r.student_id, r.status as string]));
      const { data: profs } = await supabase.rpc("get_profiles_safe", { _ids: ids });
      setStudents(((profs ?? []) as StudentRow[])
        .map((p) => ({ ...p, enrollment_status: statusById.get(p.id) ?? "active" }))
        .sort((a, b) => a.name.localeCompare(b.name)));
    } else setStudents([]);
    setSelectedIds([]);
    setLoading(false);
  }, [disciplineId]);

  const visibleStudents = students.filter((s) =>
    statusFilter === "all" ? true
      : statusFilter === "active" ? s.enrollment_status !== "inactive"
      : s.enrollment_status === "inactive");

  const applyEnrollmentStatus = async (ids: string[], status: "active" | "inactive") => {
    if (!ids.length) return;
    if (ids.length === 1) setStatusLoadingId(ids[0]); else setBulkSaving(true);
    try {
      await setEnrollmentStatus({ data: { discipline_id: disciplineId, student_ids: ids, status } });
      toast.success(status === "inactive"
        ? `${ids.length} matrícula(s) inativada(s) nesta disciplina`
        : `${ids.length} matrícula(s) reativada(s)`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao alterar status da matrícula");
    } finally {
      setStatusLoadingId(null);
      setBulkSaving(false);
    }
  };

  useEffect(() => { load(); }, [load]);

  const handleRemove = async () => {
    if (!removing) return;
    try {
      await unenrollStudent({ data: { discipline_id: disciplineId, student_id: removing.id } });
      toast.success("Estudante removido da disciplina");
      setRemoving(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover");
    }
  };

  const handleReset = async () => {
    if (!resetting) return;
    setResetLoading(true);
    try {
      const res = await resetStudentPassword({
        data: { discipline_id: disciplineId, student_id: resetting.id },
      });
      toast.success(`Senha resetada para a matrícula ${res.enrollment_number}. O aluno definirá uma nova senha no próximo acesso.`);
      setResetting(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao resetar senha");
    } finally {
      setResetLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await syncDisciplineStudents({ data: { discipline_id: disciplineId } });
      const summary = `Sincronização concluída: ${res.synced} aluno(s) oficializado(s).`;
      if (res.errors.length) {
        toast.info(`${summary} (${res.errors.length} erros ignorados)`);
        console.warn("Sync errors:", res.errors);
      } else {
        toast.success(summary);
      }
      setSyncOpen(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na sincronização");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="text-white">
          <h2 className="text-lg font-semibold">Alunos matriculados</h2>
          <p className="text-sm opacity-80">
            {students.filter((s) => s.enrollment_status !== "inactive").length} ativo(s) ·{" "}
            {students.filter((s) => s.enrollment_status === "inactive").length} inativo(s)
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setSyncOpen(true)} title="Sincronizar alunos antigos com o sistema global">
            <RefreshCw className="h-4 w-4 mr-2" /> Sincronizar Turma
          </Button>
          <Button variant="outline" onClick={() => setCsvOpen(true)}>
            <Upload className="h-4 w-4 mr-2" /> Importar CSV
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <UserPlus className="h-4 w-4 mr-2" /> Adicionar aluno
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border bg-card overflow-hidden">
          {([["active", "Apenas Ativos"], ["inactive", "Inativos"], ["all", "Todos"]] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => { setStatusFilter(v); setSelectedIds([]); }}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${statusFilter === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {selectedIds.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/80">{selectedIds.length} selecionado(s)</span>
            {statusFilter === "inactive" ? (
              <Button size="sm" variant="outline" disabled={bulkSaving} onClick={() => applyEnrollmentStatus(selectedIds, "active")}>
                {bulkSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Reativar Selecionados
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled={bulkSaving} onClick={() => applyEnrollmentStatus(selectedIds, "inactive")}>
                {bulkSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Inativar Selecionados desta Disciplina
              </Button>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : visibleStudents.length === 0 ? (
        <div className="border-2 border-dashed rounded-xl py-12 text-center">
          <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {students.length === 0 ? "Nenhum aluno matriculado ainda." : "Nenhum aluno neste filtro."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    aria-label="Selecionar todos"
                    checked={visibleStudents.length > 0 && selectedIds.length === visibleStudents.length}
                    onChange={(e) => setSelectedIds(e.target.checked ? visibleStudents.map((s) => s.id) : [])}
                  />
                </th>
                <th className="text-left px-4 py-2">Matrícula</th>
                <th className="text-left px-4 py-2">Nome</th>
                <th className="text-left px-4 py-2">Matrícula na disciplina</th>
                <th className="text-right px-4 py-2 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {visibleStudents.map((s) => {
                const inactive = s.enrollment_status === "inactive";
                return (
                <tr key={s.id} className={`border-t ${inactive ? "opacity-60" : ""}`}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${s.name}`}
                      checked={selectedIds.includes(s.id)}
                      onChange={(e) => setSelectedIds((prev) => e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id))}
                    />
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{s.enrollment_number ?? "—"}</td>
                  <td className="px-4 py-2">{s.name}</td>
                  <td className="px-4 py-2">
                    <Button
                      size="sm"
                      variant={inactive ? "outline" : "ghost"}
                      className="h-7 text-xs"
                      disabled={statusLoadingId === s.id}
                      onClick={() => applyEnrollmentStatus([s.id], inactive ? "active" : "inactive")}
                      title={inactive ? "Reativar matrícula nesta disciplina" : "Inativar matrícula nesta disciplina"}
                    >
                      {statusLoadingId === s.id && <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
                      {inactive ? "Inativo — Reativar" : "Ativo — Inativar"}
                    </Button>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setResetting(s)}
                      aria-label={`Resetar senha de ${s.name}`}
                      title="Resetar senha"
                    >
                      <KeyRound className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setRemoving(s)} aria-label={`Remover ${s.name}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AddStudentDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        disciplineId={disciplineId}
        onDone={() => { setAddOpen(false); load(); }}
      />
      <CsvImportDialog
        open={csvOpen}
        onOpenChange={setCsvOpen}
        disciplineId={disciplineId}
        onDone={() => { setCsvOpen(false); load(); }}
      />

      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover aluno?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.name} deixará de estar matriculado nesta disciplina. A conta de usuário não é excluída.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!resetting} onOpenChange={(o) => !o && !resetLoading && setResetting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resetar senha?</AlertDialogTitle>
            <AlertDialogDescription>
              A senha de <strong>{resetting?.name}</strong> voltará a ser a matrícula
              {" "}<span className="font-mono">{resetting?.enrollment_number ?? "—"}</span>.
              Ele(a) será obrigado(a) a definir uma nova senha no próximo acesso.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetLoading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset} disabled={resetLoading}>
              {resetLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Resetar senha
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={syncOpen} onOpenChange={(o) => !o && !syncing && setSyncOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sincronizar Turma</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação irá varrer a lista de alunos da disciplina e oficializar no sistema global (Cadastro e Auth) 
              aqueles que ainda não possuem acesso, preservando todas as notas e presenças existentes. 
              <strong> Não duplica dados nem apaga o histórico.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={syncing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleSync} disabled={syncing} className="bg-primary">
              {syncing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Sincronizar agora
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AddStudentDialog({
  open, onOpenChange, disciplineId, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  disciplineId: string;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [enrollment, setEnrollment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  useEffect(() => { if (open) { setName(""); setEnrollment(""); } }, [open]);

  const submit = async () => {
    const normalizedEnrollment = enrollment.trim().toUpperCase();
    const MATRICULA_REGEX = /^[A-Za-z]{2}\d{1,9}$/;

    if (!name.trim() || !normalizedEnrollment) {
      toast.error("Informe nome e matrícula");
      return;
    }

    if (!MATRICULA_REGEX.test(normalizedEnrollment)) {
      toast.error("Formato de matrícula inválido. Use 2 letras seguidas de até 9 números (Ex: UL262001674).");
      return;
    }
    setSubmitting(true);
    try {
      const res = await enrollStudents({
        data: { 
          discipline_id: disciplineId, 
          students: [{ 
            name: name.toUpperCase().trim(), 
            enrollment_number: enrollment.toUpperCase().trim() 
          }] 
        },
      });
      if (res.errors.length) {
        const msg = res.errors[0].message;
        if (msg.includes("plano Gratuito")) setUpgradeOpen(true);
        else toast.error(msg);
      } else if (res.already_enrolled) {
        toast.info("Aluno já estava matriculado");
      } else {
        toast.success(res.created ? "Aluno criado e matriculado" : "Aluno matriculado");
        onDone();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro inesperado";
      if (msg.includes("plano Gratuito")) setUpgradeOpen(true);
      else toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar aluno</DialogTitle>
          <DialogDescription>
            O aluno definirá a senha no primeiro acesso usando a matrícula informada.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="s-mat">Matrícula</Label>
            <Input id="s-mat" value={enrollment} onChange={(e) => setEnrollment(e.target.value)} maxLength={40} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-name">Nome completo</Label>
            <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
      <UpgradeRequiredDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} reason="students" />
    </Dialog>
  );
}

function CsvImportDialog({
  open, onOpenChange, disciplineId, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  disciplineId: string;
  onDone: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [parsed, setParsed] = useState<{ name: string; enrollment_number: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  useEffect(() => { if (open) { setParsed([]); setFileName(null); } }, [open]);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    const text = await f.text();
    const rows = parseCSV(text).filter((r) => r.some((c) => c.trim() !== ""));
    if (!rows.length) { toast.error("CSV vazio"); return; }
    const { nameIdx, matIdx, startRow } = detectColumns(rows);
    const out: { name: string; enrollment_number: string }[] = [];
    const MATRICULA_REGEX = /^[A-Za-z]{2}\d{1,9}$/;
    
    for (let i = startRow; i < rows.length; i++) {
      const r = rows[i];
      const enrollment = (r[matIdx] ?? "").toUpperCase().trim();
      const name = (r[nameIdx] ?? "").toUpperCase().trim();
      
      if (!enrollment || !name) continue;
      
      if (!MATRICULA_REGEX.test(enrollment)) {
        console.warn(`Pulando matrícula inválida: ${enrollment}`);
        continue;
      }
      
      out.push({ name, enrollment_number: enrollment });
    }
    if (!out.length) {
      toast.error("Nenhuma linha válida. Use colunas: matrícula, nome");
      return;
    }
    setParsed(out);
  };

  const submit = async () => {
    if (!parsed.length) return;
    setSubmitting(true);
    try {
      const res = await enrollStudents({ data: { discipline_id: disciplineId, students: parsed } });
      const summary = `Criados: ${res.created} · Reaproveitados: ${res.reused} · Já matriculados: ${res.already_enrolled} · Erros: ${res.errors.length}`;
      if (res.errors.some((e) => e.message?.includes("plano Gratuito"))) {
        toast.error("Limite do plano Gratuito atingido. Faça upgrade para o Pro para importar mais alunos.");
      } else if (res.errors.length) toast.error(summary);
      else toast.success(summary);
      onDone();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao importar";
      if (msg.includes("plano Gratuito")) toast.error("Limite do plano Gratuito atingido. Faça upgrade para o Pro.");
      else toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Importar alunos por CSV</DialogTitle>
          <DialogDescription>
            Arquivo com duas colunas: <strong>matrícula</strong> e <strong>nome</strong>. Vírgula ou ponto-e-vírgula como separador.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="upload">
          <TabsList>
            <TabsTrigger value="upload">Upload</TabsTrigger>
            <TabsTrigger value="preview" disabled={!parsed.length}>Pré-visualização ({parsed.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="upload" className="space-y-3 pt-3">
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onPick} />
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4 mr-2" /> {fileName ? "Trocar arquivo" : "Escolher CSV"}
            </Button>
            {fileName && <p className="text-xs text-muted-foreground">Arquivo: {fileName} · {parsed.length} linhas válidas</p>}
            <div className="text-xs text-muted-foreground">
              Exemplo:
              <pre className="bg-muted/50 p-2 rounded mt-1">matricula,nome
2024001,Maria Silva
2024002,João Souza</pre>
            </div>
          </TabsContent>
          <TabsContent value="preview" className="pt-3">
            <div className="max-h-72 overflow-auto rounded border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase">
                  <tr><th className="text-left px-3 py-2">Matrícula</th><th className="text-left px-3 py-2">Nome</th></tr>
                </thead>
                <tbody>
                  {parsed.map((p, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-1.5 font-mono text-xs">{p.enrollment_number}</td>
                      <td className="px-3 py-1.5">{p.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={!parsed.length || submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Importar {parsed.length} aluno(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}