import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  listCatalogItems,
  upsertCatalogItem,
  deleteCatalogItem,
  listCatalogGrants,
  grantCatalogItem,
  revokeCatalogItem,
  searchTeachers,
  type CatalogKind,
} from "@/backend/catalog.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, Trash2, Users, X } from "lucide-react";

const KIND_LABELS: Record<CatalogKind, string> = {
  activity_subtype: "Tipos de Atividade Extra",
  work_subtype: "Tipos de Trabalho Acadêmico",
  question_type: "Tipos de Questão",
  research_theme: "Temas de Pesquisa",
};

type Item = {
  id: string;
  kind: CatalogKind;
  code: string;
  label: string;
  description: string | null;
  prompt_hint: string | null;
  is_active: boolean;
};

type Grant = {
  grant_id: string;
  teacher_id: string;
  profile: { id: string; name: string | null; email: string | null } | null;
};

export function CatalogTab() {
  const listFn = useServerFn(listCatalogItems);
  const upsertFn = useServerFn(upsertCatalogItem);
  const deleteFn = useServerFn(deleteCatalogItem);
  const [kind, setKind] = useState<CatalogKind>("activity_subtype");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Partial<Item> | null>(null);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const [grantsFor, setGrantsFor] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listFn({ data: { kind } });
      setItems((res.items ?? []) as Item[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar catálogo");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await upsertFn({
        data: {
          id: editing.id,
          kind,
          code: (editing.code ?? "").trim().toLowerCase(),
          label: (editing.label ?? "").trim(),
          description: editing.description ?? null,
          prompt_hint: editing.prompt_hint ?? null,
          is_active: editing.is_active ?? true,
        },
      });
      toast.success("Item salvo");
      setEditing(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteFn({ data: { id: deleting.id } });
      toast.success("Item excluído");
      setDeleting(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao excluir");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 justify-between">
        <div className="space-y-1">
          <Label>Categoria</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as CatalogKind)}>
            <SelectTrigger className="w-full sm:w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(KIND_LABELS) as CatalogKind[]).map((k) => (
                <SelectItem key={k} value={k}>{KIND_LABELS[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Itens ficam disponíveis apenas para os professores explicitamente concedidos.
          </p>
        </div>
        <Button onClick={() => setEditing({ kind, is_active: true })}>
          <Plus className="h-4 w-4 mr-1" /> Novo item
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : items.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">
              Nenhum item nesta categoria ainda.
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((it) => (
                <li key={it.id} className="p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{it.label}</span>
                      <Badge variant="outline" className="text-[10px]">{it.code}</Badge>
                      {!it.is_active && <Badge variant="secondary" className="text-[10px]">inativo</Badge>}
                    </div>
                    {it.description && (
                      <p className="text-xs text-muted-foreground truncate">{it.description}</p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => setGrantsFor(it)}>
                      <Users className="h-4 w-4 mr-1" /> Professores
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(it)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(it)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editing.id ? "Editar item do catálogo" : "Novo item do catálogo"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Categoria</Label>
                <Input value={KIND_LABELS[kind]} disabled />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Código *</Label>
                  <Input
                    value={editing.code ?? ""}
                    onChange={(e) =>
                      setEditing({ ...editing, code: e.target.value.toLowerCase() })
                    }
                    placeholder="ex: mesa_redonda"
                    disabled={!!editing.id}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Identificador único (letras minúsculas, números e _).
                  </p>
                </div>
                <div>
                  <Label>Rótulo visível *</Label>
                  <Input
                    value={editing.label ?? ""}
                    onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                    placeholder="ex: Mesa-redonda"
                  />
                </div>
              </div>
              <div>
                <Label>Descrição curta</Label>
                <Input
                  value={editing.description ?? ""}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  placeholder="Aparece como legenda no formulário do professor"
                />
              </div>
              <div>
                <Label>Orientação para a IA (opcional)</Label>
                <Textarea
                  rows={3}
                  value={editing.prompt_hint ?? ""}
                  onChange={(e) => setEditing({ ...editing, prompt_hint: e.target.value })}
                  placeholder="Instruções específicas usadas na geração de conteúdo por IA para este item."
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={editing.is_active ?? true}
                  onCheckedChange={(v) => setEditing({ ...editing, is_active: v === true })}
                />
                Ativo (disponível para os professores concedidos)
              </label>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
              <Button onClick={save} disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {grantsFor && (
        <GrantsDialog item={grantsFor} onClose={() => setGrantsFor(null)} />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir item?</AlertDialogTitle>
            <AlertDialogDescription>
              Isto remove o item do catálogo e todas as concessões a professores.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function GrantsDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const listFn = useServerFn(listCatalogGrants);
  const grantFn = useServerFn(grantCatalogItem);
  const revokeFn = useServerFn(revokeCatalogItem);
  const searchFn = useServerFn(searchTeachers);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ id: string; name: string | null; email: string | null }>>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listFn({ data: { catalog_item_id: item.id } });
      setGrants((res.items ?? []) as Grant[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar concessões");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const res = await searchFn({ data: { query: q } });
        setResults(res.items ?? []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, searchFn]);

  const grantedIds = useMemo(() => new Set(grants.map((g) => g.teacher_id)), [grants]);

  const doGrant = async (teacherId: string) => {
    setBusy(true);
    try {
      await grantFn({ data: { catalog_item_id: item.id, teacher_id: teacherId } });
      toast.success("Professor liberado");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao conceder");
    } finally {
      setBusy(false);
    }
  };

  const doRevoke = async (grantId: string) => {
    setBusy(true);
    try {
      await revokeFn({ data: { grant_id: grantId } });
      toast.success("Acesso removido");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao revogar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Professores com acesso a "{item.label}"</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <Label>Buscar professor</Label>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nome ou e-mail (mín. 2 letras)"
          />
          {searching && (
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> buscando…
            </div>
          )}
          {results.length > 0 && (
            <ul className="border rounded-md divide-y max-h-40 overflow-auto">
              {results.map((r) => (
                <li key={r.id} className="flex items-center justify-between p-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate">{r.name || "(sem nome)"}</div>
                    <div className="text-xs text-muted-foreground truncate">{r.email}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || grantedIds.has(r.id)}
                    onClick={() => doGrant(r.id)}
                  >
                    {grantedIds.has(r.id) ? "Já liberado" : "Liberar"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2 mt-2">
          <Label>Liberações atuais</Label>
          {loading ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> carregando…
            </div>
          ) : grants.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum professor liberado ainda.</p>
          ) : (
            <ul className="border rounded-md divide-y max-h-52 overflow-auto">
              {grants.map((g) => (
                <li key={g.grant_id} className="flex items-center justify-between p-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate">{g.profile?.name || "(sem nome)"}</div>
                    <div className="text-xs text-muted-foreground truncate">{g.profile?.email}</div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => doRevoke(g.grant_id)} disabled={busy}>
                    <X className="h-4 w-4 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}