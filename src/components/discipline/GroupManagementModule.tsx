import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Trash2, Users, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface AcademicWork {
  id: string;
  title: string;
}

interface GroupRow {
  id: string;
  leader_id: string;
  member_ids: string[] | null;
}

interface GroupView {
  id: string;
  leader_id: string;
  member_ids: string[];
}

interface GroupManagementModuleProps {
  disciplineId: string;
  isTeacher: boolean;
}

export function GroupManagementModule({
  disciplineId,
  isTeacher,
}: GroupManagementModuleProps) {
  const [works, setWorks] = useState<AcademicWork[]>([]);
  const [selectedWorkId, setSelectedWorkId] = useState<string>("");
  const [groups, setGroups] = useState<GroupView[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [loadingWorks, setLoadingWorks] = useState(true);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [removingMember, setRemovingMember] = useState<string | null>(null);
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTeacher) return;

    let active = true;

    const loadWorks = async () => {
      setLoadingWorks(true);
      setError(null);

      const { data, error: worksError } = await supabase
        .from("academic_works")
        .select("id, title")
        .eq("discipline_id", disciplineId)
        .order("created_at", { ascending: false });

      if (!active) return;

      if (worksError) {
        setError(worksError.message);
        setWorks([]);
        setLoadingWorks(false);
        return;
      }

      const loadedWorks = (data ?? []) as AcademicWork[];
      setWorks(loadedWorks);
      setSelectedWorkId((current) =>
        current && loadedWorks.some((work) => work.id === current)
          ? current
          : loadedWorks[0]?.id ?? "",
      );
      setLoadingWorks(false);
    };

    loadWorks();

    return () => {
      active = false;
    };
  }, [disciplineId, isTeacher]);

  const loadGroups = useCallback(async (): Promise<boolean> => {
    if (!isTeacher || !selectedWorkId) {
      setGroups([]);
      setProfiles({});
      return true;
    }

    setLoadingGroups(true);
    setError(null);

    const { data: groupRows, error: groupsError } = await supabase
      .from("activity_groups")
      .select("id, leader_id, member_ids")
      .eq("activity_id", selectedWorkId)
      .eq("activity_kind", "work")
      .order("created_at", { ascending: true });

    if (groupsError) {
      setError(groupsError.message);
      setGroups([]);
      setProfiles({});
      setLoadingGroups(false);
      return false;
    }

    const normalizedGroups = ((groupRows ?? []) as GroupRow[]).map((group) => ({
      id: group.id,
      leader_id: group.leader_id,
      member_ids: Array.from(
        new Set([group.leader_id, ...(group.member_ids ?? [])]),
      ),
    }));
    const memberIds = Array.from(
      new Set(normalizedGroups.flatMap((group) => group.member_ids)),
    );

    const { data: profileRows, error: profilesError } = memberIds.length
      ? await supabase.from("profiles").select("id, name").in("id", memberIds)
      : { data: [], error: null };

    if (profilesError) {
      setError(profilesError.message);
      setGroups(normalizedGroups);
      setProfiles({});
      setLoadingGroups(false);
      return false;
    }

    setGroups(normalizedGroups);
    setProfiles(
      Object.fromEntries(
        ((profileRows ?? []) as Array<{ id: string; name: string | null }>).map(
          (profile) => [profile.id, profile.name?.trim() || "Aluno sem nome"],
        ),
      ),
    );
    setLoadingGroups(false);
    return true;
  }, [isTeacher, selectedWorkId]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  const handleRemoveMember = async (group: GroupView, memberId: string) => {
    const isLast = group.member_ids.length <= 1;
    if (!window.confirm(isLast
      ? "Este é o último integrante. Removê-lo dissolverá o grupo. Deseja continuar?"
      : `Remover ${profiles[memberId] ?? "este aluno"} do grupo?`)) return;
    const removalKey = `${group.id}:${memberId}`;
    setRemovingMember(removalKey);
    setError(null);

    const { data: currentGroupRow, error: fetchError } = await supabase
      .from("activity_groups")
      .select("id, leader_id, member_ids")
      .eq("id", group.id)
      .maybeSingle();

    if (fetchError) {
      setError(fetchError.message);
      toast.error(fetchError.message);
      setRemovingMember(null);
      return;
    }

    if (!currentGroupRow) {
      const message = "Grupo não encontrado.";
      setError(message);
      toast.error(message);
      setRemovingMember(null);
      return;
    }

    const currentGroup = currentGroupRow as GroupRow;
    const currentMemberIds = currentGroup.member_ids ?? [];

    if (currentMemberIds.length <= 1) {
      setRemovingMember(null);
      await handleDeleteGroup(group.id, true);
      return;
    }

    const remainingMembers = currentMemberIds.filter((id) => id !== memberId);
    const isRemovingLeader = memberId === currentGroup.leader_id;
    const updatePayload = isRemovingLeader
      ? {
          leader_id: remainingMembers[0],
          member_ids: remainingMembers,
        }
      : { member_ids: remainingMembers };

    const { data, error: updateError } = await supabase
      .from("activity_groups")
      .update(updatePayload)
      .eq("id", group.id)
      .select();

    if (updateError) {
      setError(updateError.message);
      toast.error(updateError.message);
      setRemovingMember(null);
      return;
    }

    if (!data || data.length === 0) {
      const message = "Nenhum grupo foi atualizado.";
      setError(message);
      toast.error(message);
      setRemovingMember(null);
      return;
    }

    const refreshed = await loadGroups();
    setRemovingMember(null);

    if (!refreshed) return;

    toast.success("Aluno removido com sucesso");
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  };

  const handleDeleteGroup = async (groupId: string, confirmed = false) => {
    if (!confirmed && !window.confirm("Dissolver este grupo? Esta ação não pode ser desfeita.")) return;
    setDeletingGroupId(groupId);
    setError(null);

    const { data, error } = await supabase
      .from("activity_groups")
      .delete()
      .eq("id", groupId)
      .select();

    if (error) {
      setError(error.message);
      toast.error(error.message);
      setDeletingGroupId(null);
      return;
    }

    if (!data || data.length === 0) {
      const message = "Nenhum grupo foi excluído.";
      setError(message);
      toast.error(message);
      setDeletingGroupId(null);
      return;
    }

    toast.success("Grupo dissolvido com sucesso!");
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  };

  const selectedWork = useMemo(
    () => works.find((work) => work.id === selectedWorkId),
    [selectedWorkId, works],
  );

  if (!isTeacher) return null;

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-2">
        <h2 className="flex items-center gap-2 text-2xl font-bold text-white">
          <Users className="h-6 w-6" /> Gestão de Grupos e Equipes
        </h2>
        <p className="text-sm text-white/80">
          Consulte os grupos formados e os alunos integrantes de cada trabalho acadêmico.
        </p>
      </div>

      <Card className="border-white/40 bg-white/95 shadow-lg">
        <CardHeader>
          <CardTitle className="text-base">Selecionar atividade</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingWorks ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando trabalhos acadêmicos...
            </div>
          ) : works.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum trabalho acadêmico foi cadastrado nesta disciplina.
            </p>
          ) : (
            <Select value={selectedWorkId} onValueChange={setSelectedWorkId}>
              <SelectTrigger className="w-full max-w-xl">
                <SelectValue placeholder="Escolha um trabalho acadêmico" />
              </SelectTrigger>
              <SelectContent>
                {works.map((work) => (
                  <SelectItem key={work.id} value={work.id}>
                    {work.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Não foi possível carregar os dados: {error}
        </div>
      )}

      {selectedWork && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-white">Grupos de {selectedWork.title}</h3>
            {!loadingGroups && groups.length > 0 && (
              <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white">
                {groups.length} grupo(s)
              </span>
            )}
          </div>

          {loadingGroups ? (
            <div className="flex justify-center rounded-xl border border-white/30 bg-white/90 py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : groups.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-white/40 bg-white/90 px-6 py-12 text-center">
              <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Nenhum grupo foi formado para este trabalho.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {groups.map((group, index) => (
                <Card key={group.id} className="border-white/40 bg-white/95 shadow-md">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center justify-between gap-2 text-base">
                      <span className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-primary" /> Grupo {index + 1}
                      </span>
                      <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                        {group.member_ids.length} integrante(s)
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                          onClick={() => handleDeleteGroup(group.id)}
                          disabled={deletingGroupId !== null}
                          aria-label="Dissolver grupo"
                          title="Dissolver grupo"
                        >
                          {deletingGroupId === group.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-3">
                      {group.member_ids.map((memberId) => {
                        const removalKey = `${group.id}:${memberId}`;
                        const isRemoving = removingMember === removalKey;

                        return (
                          <li key={memberId} className="flex items-center gap-2 text-sm">
                            <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate">
                              {profiles[memberId] ?? "Aluno sem nome"}
                            </span>
                            {memberId === group.leader_id && (
                              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                                Líder
                              </span>
                            )}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                              onClick={() => handleRemoveMember(group, memberId)}
                              disabled={removingMember !== null}
                              aria-label={`Remover ${profiles[memberId] ?? "aluno"} do grupo`}
                              title="Remover aluno do grupo"
                            >
                              {isRemoving ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
