import { useEffect, useState, useCallback } from "react";
import { getGroupContext, createGroup, updateGroupMembers } from "@/backend/groups.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Users, Crown, UserPlus, X, Trash2 } from "lucide-react";
import { toast } from "sonner";


type Classmate = { id: string; name: string; matricula?: string; email?: string };
type Group = { id: string; leader_id: string; member_ids: string[] };

export function GroupPanel({
  disciplineId,
  activityId,
  activityKind,
  currentUserId,
  onCanSubmitChange,
}: {
  disciplineId: string;
  activityId: string;
  activityKind: "activity" | "work";
  currentUserId: string;
  onCanSubmitChange: (canSubmit: boolean) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [deliveryType, setDeliveryType] = useState<string>("individual");
  const [maxGroupSize, setMaxGroupSize] = useState<number | null>(null);
  const [enrollmentDeadline, setEnrollmentDeadline] = useState<string | null>(null);
  const [enrollmentOpen, setEnrollmentOpen] = useState(true);
  const [classmates, setClassmates] = useState<Classmate[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [myGroup, setMyGroup] = useState<Group | null>(null);
  const [isLeader, setIsLeader] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const classmateOf = useCallback(
    (id: string) => classmates.find((c) => c.id === id),
    [classmates],
  );

  const nameOf = useCallback(
    (id: string) => classmateOf(id)?.name ?? "Aluno",
    [classmateOf],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ctx = await getGroupContext({
        data: { discipline_id: disciplineId, activity_id: activityId, activity_kind: activityKind },
      });
      setDeliveryType(ctx.delivery_type);
      setMaxGroupSize(ctx.max_group_size);
      setEnrollmentDeadline(ctx.enrollment_deadline ?? null);
      setEnrollmentOpen(ctx.enrollment_open ?? true);
      setClassmates(ctx.classmates);
      setGroups(ctx.groups);
      setMyGroup(ctx.my_group);
      setIsLeader(ctx.is_leader);
      const individual = ctx.delivery_type !== "group";
      onCanSubmitChange(individual || (!!ctx.my_group && ctx.is_leader));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar grupo");
      onCanSubmitChange(false);
    } finally {
      setLoading(false);
    }
  }, [disciplineId, activityId, activityKind, onCanSubmitChange]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (deliveryType !== "group") return null;

  const maxSize = maxGroupSize ?? 2;
  const takenIds = new Set<string>();
  for (const g of groups) {
    takenIds.add(g.leader_id);
    for (const m of g.member_ids) takenIds.add(m);
  }

  const availableClassmates = classmates.filter(
    (c) =>
      c.id !== currentUserId &&
      !takenIds.has(c.id) &&
      (c.name.toLowerCase().includes(search.trim().toLowerCase()) ||
       c.matricula?.toLowerCase().includes(search.trim().toLowerCase()) ||
       c.email?.toLowerCase().includes(search.trim().toLowerCase())),
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length + 1 >= maxSize) {
        toast.error(`O grupo pode ter no máximo ${maxSize} integrante(s) (você incluído).`);
        return prev;
      }
      return [...prev, id];
    });
  };

  const onCreate = async () => {
    setBusy(true);
    try {
      await createGroup({
        data: {
          discipline_id: disciplineId,
          activity_id: activityId,
          activity_kind: activityKind,
          member_ids: selected,
        },
      });
      toast.success("Grupo criado — você é o líder.");
      setSelected([]);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar grupo");
    } finally {
      setBusy(false);
    }
  };

  const onRemoveMember = async (memberId: string) => {
    if (!myGroup || !isLeader) return;
    
    // Update local state immediately for responsiveness
    const oldGroup = { ...myGroup };
    const newMembers = myGroup.member_ids.filter((id) => id !== memberId);
    setMyGroup({ ...myGroup, member_ids: newMembers });
    
    setBusy(true);
    try {
      await updateGroupMembers({
        data: {
          group_id: myGroup.id,
          member_ids: newMembers,
        },
      });
      toast.success("Integrante removido.");
      // Full reload to sync other possible data
      await load();
    } catch (e) {
      // Revert state on error
      setMyGroup(oldGroup);
      toast.error(e instanceof Error ? e.message : "Erro ao remover integrante");
    } finally {
      setBusy(false);
    }
  };

  const onAddMember = async (memberId: string) => {
    if (!myGroup || !isLeader) return;
    if (myGroup.member_ids.length >= maxSize) {
      toast.error(`O grupo já atingiu o limite de ${maxSize} integrantes.`);
      return;
    }

    // Update local state immediately
    const oldGroup = { ...myGroup };
    const newMembers = Array.from(new Set([...myGroup.member_ids, memberId]));
    setMyGroup({ ...myGroup, member_ids: newMembers });
    setSearch(""); // Clear search immediately

    setBusy(true);
    try {
      await updateGroupMembers({
        data: {
          group_id: myGroup.id,
          member_ids: newMembers,
        },
      });
      toast.success("Integrante adicionado.");
      await load();
    } catch (e) {
      // Revert state on error
      setMyGroup(oldGroup);
      toast.error(e instanceof Error ? e.message : "Erro ao adicionar integrante");
    } finally {
      setBusy(false);
    }
  };



  return (
    <div className="rounded-md border p-3 space-y-3" style={{ boxShadow: "var(--shadow-card)" }}>
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Meu grupo</span>
        <span className="text-xs text-muted-foreground">(máx. {maxSize} integrantes)</span>
      </div>
      {enrollmentDeadline && (
        <p className="text-xs text-muted-foreground">
          Inscrição de grupos até{" "}
          {new Date(enrollmentDeadline).toLocaleString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}{" "}
          (1 semana antes da entrega).
          {!enrollmentOpen && <span className="text-destructive"> Inscrições encerradas.</span>}
        </p>
      )}

      {myGroup ? (
        <div className="space-y-3">
          <ul className="space-y-2 text-sm">
            {Array.from(new Set([myGroup.leader_id, ...myGroup.member_ids])).map((id) => (
              <li key={id} className="flex items-center justify-between gap-1.5 p-1 rounded hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-1.5">
                  {id === myGroup.leader_id && <Crown className="h-3.5 w-3.5 text-amber-500" />}
                  <span className="font-medium">{nameOf(id)}</span>
                  {id === currentUserId && <span className="text-xs text-muted-foreground">(você)</span>}
                </div>
                {isLeader && id !== myGroup.leader_id && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
                    disabled={busy}
                    onClick={() => onRemoveMember(id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>

                )}
              </li>
            ))}
          </ul>

          {isLeader && myGroup.member_ids.length < maxSize && (
            <div className="space-y-2 pt-2 border-t">
              <Label className="text-[10px] uppercase text-muted-foreground">Adicionar colega ao grupo</Label>
              <div className="relative">
                <Input
                  placeholder="Pesquisar por nome ou matrícula…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 text-xs"
                />
                {search && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-40 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
                    {availableClassmates.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground py-2 text-center">Nenhum colega disponível.</p>
                    ) : (
                      availableClassmates.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-xs hover:bg-accent cursor-pointer text-left"
                          onClick={() => onAddMember(c.id)}
                          disabled={busy}
                        >
                          <div className="flex flex-col">
                            <span className="font-medium">{c.name}</span>
                            <span className="text-[9px] text-muted-foreground">{c.matricula}</span>
                          </div>
                          <UserPlus className="h-3 w-3 text-primary" />
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground italic leading-tight pt-1">
            {isLeader
              ? "Como líder, somente você envia o arquivo. A nota e o feedback são aplicados a todo o grupo."
              : "Apenas o líder do grupo envia o arquivo. A nota e o feedback chegarão a você automaticamente."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {!enrollmentOpen ? (
            <p className="text-sm text-destructive">
              O prazo de inscrição de grupos encerrou. Procure o professor.
            </p>
          ) : (
          <>
          <div className="space-y-2">
            <Label className="text-xs">Criar um grupo (pesquise colegas)</Label>
            <div className="relative">
              <Input
                placeholder="Pesquisar por nome, matrícula ou e-mail…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-10"
              />
              {search && (
                <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-md border bg-popover p-1 shadow-md animate-in fade-in zoom-in-95">
                  {availableClassmates.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2 text-center">
                      Nenhum colega disponível.
                    </p>
                  ) : (
                    availableClassmates.map((c) => {
                      const isSelected = selected.includes(c.id);
                      const atLimit = !isSelected && selected.length + 1 >= maxSize;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          disabled={atLimit}
                          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground cursor-pointer text-left disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={() => {
                            if (atLimit) {
                              toast.error(`Limite de ${maxSize} integrantes atingido (você incluído).`);
                              return;
                            }
                            toggle(c.id);
                            setSearch("");
                          }}
                        >
                          <Checkbox
                            checked={isSelected}
                            disabled={atLimit}
                            tabIndex={-1}
                            className="pointer-events-none"
                          />
                          <div className="flex flex-col">
                            <span className="font-medium">{c.name}</span>
                            {(c.matricula || c.email) && (
                              <span className="text-[10px] text-muted-foreground">
                                {[c.matricula, c.email].filter(Boolean).join(" · ")}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {selected.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <Label className="text-[10px] uppercase text-muted-foreground">
                  Integrantes selecionados: {selected.length + 1}/{maxSize} (você incluído)
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {selected.map(id => {
                    const c = classmateOf(id);
                    return (
                      <div
                        key={id}
                        className="flex items-center gap-1.5 rounded-full bg-primary/10 pl-3 pr-1.5 py-1 text-xs text-primary border border-primary/20"
                      >
                        <span className="font-medium">{c?.name ?? "Aluno"}</span>
                        {c?.matricula && (
                          <span className="text-[10px] text-muted-foreground">({c.matricula})</span>
                        )}
                        <button
                          type="button"
                          aria-label={`Remover ${c?.name ?? "colega"}`}
                          onClick={() => toggle(id)}
                          className="ml-0.5 rounded-full p-0.5 hover:bg-destructive/15 hover:text-destructive transition-colors"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
                {selected.length + 1 >= maxSize && (
                  <p className="text-[10px] text-amber-600">
                    Limite máximo de {maxSize} integrantes atingido.
                  </p>
                )}
              </div>
            )}

            <Button size="sm" className="w-full mt-2" disabled={busy} onClick={onCreate}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <UserPlus className="h-3.5 w-3.5 mr-1" /> Criar grupo (eu sou líder)
            </Button>
          </div>

          {groups.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs">Grupos formados</Label>
              <ul className="space-y-1">
                {groups.map((g) => {
                  return (
                    <li
                      key={g.id}
                      className="flex items-center justify-between rounded border px-2 py-1.5 text-xs bg-muted/20"
                    >
                      <span className="truncate">
                        Líder: {nameOf(g.leader_id)} · {g.member_ids.length}/{maxSize}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          </>
          )}
        </div>
      )}
    </div>
  );
}
