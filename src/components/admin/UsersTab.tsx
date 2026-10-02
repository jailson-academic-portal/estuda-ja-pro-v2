import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  adminListUsers,
  adminDeleteUser,
  adminDeleteUsersBulk,
  adminListDisciplines,
  adminLinkInstitution,
  adminMigrateAuthorizedStudents,
  adminSetUsersStatus,
} from "@/backend/users.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Pencil, Trash2, Loader2, Building2, ChevronLeft, ChevronRight, X, Download } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { EditUserDialog, type EditableUser } from "./EditUserDialog";

const typeLabel: Record<string, string> = {
  admin: "Admin", institution: "Instituição", teacher: "Professor", student: "Estudante",
};

const statusBadge = (s: string) => {
  if (s === "active") return <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Ativo</Badge>;
  if (s === "pending") return <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100">Pendente</Badge>;
  return <Badge variant="secondary">Inativo</Badge>;
};

const PAGE_SIZE = 50;

export function UsersTab() {
  const listFn = useServerFn(adminListUsers);
  const deleteFn = useServerFn(adminDeleteUser);
  const deleteBulkFn = useServerFn(adminDeleteUsersBulk);
  const listDisciplinesFn = useServerFn(adminListDisciplines);
  const linkInstitutionFn = useServerFn(adminLinkInstitution);
  const migrateFn = useServerFn(adminMigrateAuthorizedStudents);
  const setStatusFn = useServerFn(adminSetUsersStatus);

  const [users, setUsers] = useState<(EditableUser & { disciplines?: { id: string; name: string }[] })[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [disciplines, setDisciplines] = useState<{ id: string; name: string }[]>([]);
  const [filterDiscipline, setFilterDiscipline] = useState<string>("all");
  
  const [isMigrating, setIsMigrating] = useState(false);
  const [editing, setEditing] = useState<EditableUser | null>(null);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<EditableUser | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [statusLoadingId, setStatusLoadingId] = useState<string | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<{ ids: string[]; label: string } | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);

  const applyStatus = async (ids: string[], status: "active" | "inactive") => {
    setStatusSaving(true);
    if (ids.length === 1) setStatusLoadingId(ids[0]);
    try {
      const res = await setStatusFn({ data: { user_ids: ids, status } });
      toast.success(
        status === "inactive"
          ? `${res.updated} aluno(s) inativado(s) e desvinculado(s) das disciplinas`
          : `${res.updated} aluno(s) reativado(s)`,
      );
      setConfirmDeactivate(null);
      if (ids.length > 1) setSelectedIds(new Set());
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao alterar status");
    } finally {
      setStatusSaving(false);
      setStatusLoadingId(null);
    }
  };

  const load = async (currentPage = page, currentSearch = search, currentType = filterType, currentDisc = filterDiscipline) => {
    setLoading(true);
    try {
      const res = await listFn({
        data: {
          page: currentPage,
          pageSize: PAGE_SIZE,
          search: currentSearch || undefined,
          filterType: currentType,
          filterDiscipline: currentDisc
        }
      });
      setUsers(res.users as any[]);
      setTotalCount(res.count);
    } catch (e) {
      console.error("[users] load failed", e);
      setUsers([]);
      setTotalCount(0);
      toast.error("Erro ao carregar usuários. Verifique sua conexão.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [page, filterType]);

  useEffect(() => {
    setPage(0);
    load(0, search, filterType, filterDiscipline);
  }, [filterDiscipline]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(0);
      load(0, search, filterType, filterDiscipline);
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    (async () => {
      try {
        const d = await listDisciplinesFn();
        setDisciplines(Array.isArray(d) ? (d as { id: string; name: string }[]) : []);
      } catch (e) {
        console.error("[users] disciplines load failed", e);
      }
    })();
  }, []);

  const handleLinkInstitution = async (u: EditableUser) => {
    setLinkingId(u.id);
    try {
      await linkInstitutionFn({ data: { user_id: u.id, institution_name: u.name || undefined } });
      toast.success("Instituição vinculada com sucesso");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao vincular instituição");
    } finally {
      setLinkingId(null);
    }
  };

  const handleMigrate = async () => {
    setIsMigrating(true);
    try {
      const res = await migrateFn();
      toast.success(`${res.migrated} matrículas migradas, ${res.skipped} já existiam.`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na migração");
    } finally {
      setIsMigrating(false);
    }
  };

  const handleExportCsv = async () => {
    setIsExporting(true);
    try {
      const res = await listFn({
        data: {
          page: 0,
          pageSize: 10000,
          search: search || undefined,
          filterType,
          filterDiscipline,
        },
      });
      const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
      const fmtDate = (d?: string) => {
        if (!d) return "";
        const dt = new Date(d);
        return isNaN(dt.getTime()) ? "" : dt.toLocaleDateString("pt-BR");
      };
      const statusLabel = (s: string) => (s === "active" ? "Ativo" : s === "pending" ? "Pendente" : "Inativo");
      const header = ["Matrícula", "Nome Completo", "Turma / Grupo", "Disciplina", "Status", "Data de Cadastro"];
      const lines = (res.users as any[]).map((u) => {
        const discs: { id: string; name: string }[] = u.disciplines ?? [];
        return [
          escape(u.enrollment_number ?? ""),
          escape(u.name ?? ""),
          escape(discs[0]?.name ?? ""),
          escape(discs.map((d) => d.name).join(" | ")),
          escape(statusLabel(u.status)),
          escape(fmtDate(u.created_at)),
        ].join(";");
      });
      const csv = "\uFEFF" + [header.map(escape).join(";"), ...lines].join("\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
      const a = document.createElement("a");
      const dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `alunos_exportacao_${dateStr}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Lista de alunos exportada com sucesso!");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao exportar CSV");
    } finally {
      setIsExporting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setDeleteLoading(true);
    try {
      await deleteFn({ data: { user_id: deleting.id } });
      toast.success("Usuário excluído");
      setDeleting(null);
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(deleting.id);
        return next;
      });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao excluir");
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setDeleteLoading(true);
    try {
      const res = await deleteBulkFn({ data: { user_ids: Array.from(selectedIds) } });
      toast.success(`${res.deleted} usuários excluídos com sucesso`);
      setSelectedIds(new Set());
      setIsBulkDeleting(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao excluir usuários em lote");
    } finally {
      setDeleteLoading(false);
    }
  };

  const toggleAll = (checked: boolean) => {
    if (checked) {
      const allIds = users.map(u => u.id);
      setSelectedIds(new Set(allIds));
    } else {
      setSelectedIds(new Set());
    }
  };

  const toggleOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <Card className="border-0" style={{ boxShadow: "var(--shadow-card)" }}>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input 
              value={search} 
              onChange={(e) => setSearch(e.target.value)} 
              placeholder="Buscar nome, e-mail ou matrícula no banco..." 
              className="pl-9" 
            />
          </div>
          <Select value={filterType} onValueChange={(v) => { setFilterType(v); setPage(0); }}>
            <SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os perfis</SelectItem>
              <SelectItem value="admin">Admins</SelectItem>
              <SelectItem value="institution">Instituições</SelectItem>
              <SelectItem value="teacher">Professores</SelectItem>
              <SelectItem value="student">Estudantes</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterDiscipline} onValueChange={(v) => { setFilterDiscipline(v); setPage(0); }}>
            <SelectTrigger className="sm:w-56"><SelectValue placeholder="Filtrar por disciplina" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as disciplinas</SelectItem>
              {disciplines.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedIds.size > 0 && (
          <div className="flex items-center justify-between p-3 bg-teal-50 border border-teal-100 rounded-lg animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center gap-2">
              <Badge className="bg-teal-600">{selectedIds.size}</Badge>
              <span className="text-sm font-medium text-teal-900">
                {selectedIds.size === 1 ? "usuário selecionado nesta página" : "usuários selecionados nesta página"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" className="text-teal-700 hover:text-teal-800 hover:bg-teal-100" onClick={() => setSelectedIds(new Set())}>
                <X className="h-4 w-4 mr-1" /> Limpar
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmDeactivate({
                  ids: Array.from(selectedIds),
                  label: `${selectedIds.size} aluno(s) selecionado(s)`,
                })}
              >
                Alterar Status para Inativo
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setIsBulkDeleting(true)}>
                <Trash2 className="h-4 w-4 mr-1" /> Excluir Selecionados
              </Button>
            </div>
          </div>
        )}

        <div className="flex justify-between items-center mb-2">
          <div className="text-sm font-medium text-muted-foreground">
            {totalCount} usuários encontrados no total
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              disabled={isExporting}
              className="text-xs h-8"
            >
              {isExporting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Download className="h-3 w-3 mr-1" />}
              Exportar CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleMigrate}
              disabled={isMigrating}
              className="text-xs h-8 border-dashed hover:border-solid"
            >
              {isMigrating ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Building2 className="h-3 w-3 mr-1" />}
              Sincronizar Matrículas Legadas
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground border-b">
                  <tr>
                    <th className="py-2 w-10">
                      <Checkbox 
                        checked={users.length > 0 && selectedIds.size === users.length}
                        onCheckedChange={(c) => toggleAll(!!c)}
                      />
                    </th>
                    <th className="py-2">Nome</th>
                    <th>E-mail / Matrícula</th>
                    <th>Perfil</th>
                    <th>Disciplinas</th>
                    <th>Status</th>
                    <th className="text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className={`border-b last:border-0 transition-colors ${selectedIds.has(u.id) ? 'bg-teal-50/50' : 'hover:bg-muted/50'}`}>
                      <td className="py-2">
                        <Checkbox 
                          checked={selectedIds.has(u.id)} 
                          onCheckedChange={() => toggleOne(u.id)}
                        />
                      </td>
                      <td className="py-2 font-medium">{u.name || "—"}</td>
                      <td className="text-muted-foreground">{u.email || u.enrollment_number || "—"}</td>
                      <td><Badge variant="secondary">{typeLabel[u.profile_type]}</Badge></td>
                      <td className="py-2">
                        <div className="flex items-center gap-1">
                          {u.disciplines && u.disciplines.length > 0 ? (
                            <>
                              <Badge variant="outline" className="text-[10px] py-0 px-1 border-teal-200 bg-teal-50 text-teal-700 whitespace-nowrap overflow-hidden text-ellipsis max-w-[120px]">
                                {u.disciplines[0].name}
                              </Badge>
                              {u.disciplines.length > 1 && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Badge variant="outline" className="text-[10px] py-0 px-1 border-teal-200 bg-teal-100 text-teal-800 cursor-help whitespace-nowrap">
                                        +{u.disciplines.length - 1} {u.disciplines.length - 1 === 1 ? 'matéria' : 'matérias'}
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent className="bg-white p-2 border border-border shadow-md">
                                      <div className="flex flex-col gap-1">
                                        <p className="text-[11px] font-semibold text-muted-foreground border-b pb-1 mb-1">Todas as disciplinas:</p>
                                        {u.disciplines.map(d => (
                                          <span key={d.id} className="text-[10px] text-teal-700">{d.name}</span>
                                        ))}
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          title={u.status === "active" ? "Clique para inativar e desvincular das disciplinas" : "Clique para reativar"}
                          disabled={statusLoadingId === u.id}
                          className="cursor-pointer disabled:opacity-60"
                          onClick={() => {
                            if (u.status === "active") {
                              setConfirmDeactivate({ ids: [u.id], label: u.name || u.email || "este aluno" });
                            } else {
                              applyStatus([u.id], "active");
                            }
                          }}
                        >
                          {statusLoadingId === u.id
                            ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            : statusBadge(u.status)}
                        </button>
                      </td>
                      <td className="text-right">
                        {u.profile_type === "institution" && !u.institution_id && (
                          <Button size="sm" variant="ghost" className="text-primary" disabled={linkingId === u.id} onClick={() => handleLinkInstitution(u)}>
                            {linkingId === u.id
                              ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                              : <Building2 className="h-3.5 w-3.5 mr-1" />}
                            Vincular
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => { setEditing(u); setOpen(true); }}>
                          <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleting(u)}>
                          <Trash2 className="h-3.5 w-3.5 mr-1" /> Excluir
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">Nenhum usuário encontrado.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-4 border-t">
                <div className="text-xs text-muted-foreground">
                  Página {page + 1} de {totalPages}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={page === totalPages - 1}
                  >
                    Próxima <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
      <EditUserDialog user={editing} open={open} onOpenChange={setOpen} onSaved={() => load()} />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && !deleteLoading && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir usuário?</AlertDialogTitle>
            <AlertDialogDescription>
              A conta de <strong>{deleting?.name || deleting?.email || "usuário"}</strong> será excluída
              permanentemente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleteLoading} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isBulkDeleting} onOpenChange={(o) => !o && !deleteLoading && setIsBulkDeleting(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir usuários selecionados?</AlertDialogTitle>
            <AlertDialogDescription>
              Você está prestes a excluir <strong>{selectedIds.size}</strong> usuários permanentemente.
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkDelete} disabled={deleteLoading} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Excluir Todos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmDeactivate} onOpenChange={(o) => !o && !statusSaving && setConfirmDeactivate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Inativar e desvincular das disciplinas?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{confirmDeactivate?.label}</strong> passará para o status Inativo e será
              removido(a) das disciplinas em que está matriculado(a), deixando de aparecer nas
              listas de chamada, diários e notas dos professores.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={statusSaving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDeactivate && applyStatus(confirmDeactivate.ids, "inactive")}
              disabled={statusSaving}
            >
              {statusSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}