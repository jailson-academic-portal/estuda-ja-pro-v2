import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const KindSchema = z.enum(["activity", "work"]);
type Kind = z.infer<typeof KindSchema>;

function parentTable(kind: Kind) {
  return kind === "activity" ? "activities" : "academic_works";
}

async function assertEnrolled(disciplineId: string, userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: disc } = await supabaseAdmin
    .from("disciplines")
    .select("teacher_id")
    .eq("id", disciplineId)
    .maybeSingle();
  if (disc?.teacher_id === userId) return true;
  const { data: enr } = await supabaseAdmin
    .from("discipline_students")
    .select("id")
    .eq("discipline_id", disciplineId)
    .eq("student_id", userId)
    .maybeSingle();
  if (!enr) throw new Error("Você não está matriculado nesta disciplina.");
  return false;
}

type GroupRow = {
  id: string;
  leader_id: string;
  member_ids: string[];
  activity_id: string;
  activity_kind: Kind;
  discipline_id: string;
};

/** Returns classmates, existing groups and the caller's group for an activity/work. */
export const getGroupContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        discipline_id: z.string().uuid(),
        activity_id: z.string().uuid(),
        activity_kind: KindSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertEnrolled(data.discipline_id, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: parent } = await supabaseAdmin
      .from(parentTable(data.activity_kind))
      .select("delivery_type, max_group_size, due_at")
      .eq("id", data.activity_id)
      .maybeSingle();

    const { data: enrolled } = await supabaseAdmin
      .from("discipline_students")
      .select("student_id")
      .eq("discipline_id", data.discipline_id);
    const studentIds = (enrolled ?? []).map((e) => e.student_id);
    const { data: profs } = studentIds.length
      ? await supabaseAdmin.from("profiles").select("id, name, enrollment_number, email").in("id", studentIds)
      : { data: [] as Array<{ id: string; name: string; enrollment_number?: string | null; email?: string | null }> };
    
    const classmates = (profs ?? [])
      .map((p: any) => ({ 
        id: p.id, 
        name: p.name ?? "Aluno",
        matricula: p.enrollment_number ?? undefined,
        email: p.email ?? undefined
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

    const { data: groupsRaw } = await supabaseAdmin
      .from("activity_groups")
      .select("id, leader_id, member_ids, activity_id, activity_kind, discipline_id")
      .eq("discipline_id", data.discipline_id)
      .eq("activity_id", data.activity_id)
      .eq("activity_kind", data.activity_kind);
    const groups = (groupsRaw ?? []) as unknown as GroupRow[];
    const myGroup =
      groups.find(
        (g) => g.leader_id === context.userId || g.member_ids.includes(context.userId),
      ) ?? null;

    const dueAt = (parent as { due_at?: string | null } | null)?.due_at ?? null;
    const enrollmentDeadline = dueAt
      ? new Date(new Date(dueAt).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
      : null;
    const enrollmentOpen = enrollmentDeadline ? Date.now() < new Date(enrollmentDeadline).getTime() : true;
    return {
      delivery_type: (parent?.delivery_type ?? "individual") as string,
      max_group_size: (parent?.max_group_size ?? null) as number | null,
      due_at: dueAt,
      enrollment_deadline: enrollmentDeadline,
      enrollment_open: enrollmentOpen,
      classmates,
      groups: groups.map((g) => ({
        id: g.id,
        leader_id: g.leader_id,
        member_ids: g.member_ids,
      })),
      my_group: myGroup
        ? { id: myGroup.id, leader_id: myGroup.leader_id, member_ids: myGroup.member_ids }
        : null,
      is_leader: myGroup ? myGroup.leader_id === context.userId : false,
    };
  });

export const createGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        discipline_id: z.string().uuid(),
        activity_id: z.string().uuid(),
        activity_kind: KindSchema,
        member_ids: z.array(z.string().uuid()).max(50).default([]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertEnrolled(data.discipline_id, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: parent } = await supabaseAdmin
      .from(parentTable(data.activity_kind))
      .select("delivery_type, max_group_size, due_at")
      .eq("id", data.activity_id)
      .maybeSingle();
    if (!parent) throw new Error("Atividade não encontrada.");
    if ((parent.delivery_type ?? "individual") !== "group") {
      throw new Error("Esta atividade não é em grupo.");
    }
    const maxSize = parent.max_group_size ?? 2;
    const dueAtCreate = (parent as { due_at?: string | null }).due_at ?? null;
    if (dueAtCreate) {
      const deadline = new Date(dueAtCreate).getTime() - 7 * 24 * 60 * 60 * 1000;
      if (Date.now() > deadline) {
        throw new Error("O prazo de inscrição de grupos encerrou (1 semana antes da entrega).");
      }
    }

    // Build member set (leader always included), validate enrollment.
    const members = Array.from(new Set([context.userId, ...data.member_ids]));
    const { data: enrolled } = await supabaseAdmin
      .from("discipline_students")
      .select("student_id")
      .eq("discipline_id", data.discipline_id)
      .in("student_id", members);
    const enrolledSet = new Set((enrolled ?? []).map((e) => e.student_id));
    for (const m of members) {
      if (!enrolledSet.has(m)) throw new Error("Todos os integrantes devem estar matriculados na disciplina.");
    }
    if (members.length > maxSize) {
      throw new Error(`O grupo pode ter no máximo ${maxSize} integrante(s).`);
    }

    // No member may already belong to a group for this activity.
    const { data: existing } = await supabaseAdmin
      .from("activity_groups")
      .select("member_ids, leader_id")
      .eq("discipline_id", data.discipline_id)
      .eq("activity_id", data.activity_id)
      .eq("activity_kind", data.activity_kind);
    const taken = new Set<string>();
    for (const g of (existing ?? []) as unknown as GroupRow[]) {
      taken.add(g.leader_id);
      for (const m of g.member_ids) taken.add(m);
    }
    for (const m of members) {
      if (taken.has(m)) throw new Error("Um dos integrantes já está em outro grupo desta atividade.");
    }

    const { error } = await supabaseAdmin.from("activity_groups").insert({
      discipline_id: data.discipline_id,
      activity_id: data.activity_id,
      activity_kind: data.activity_kind as never,
      leader_id: context.userId,
      member_ids: members,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** 
 * Removed: Students can no longer join groups manually. 
 * Use add/remove member logic in GroupPanel (Leader only).
 */
export const joinGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ group_id: z.string().uuid() }).parse(input))
  .handler(async () => {
    throw new Error("A entrada manual em grupos foi desativada. Solicite ao líder para adicioná-lo.");
  });

export const updateGroupMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        group_id: z.string().uuid(),
        member_ids: z.array(z.string().uuid()),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    
    // Security check: only leader can update
    const { data: group } = await supabaseAdmin
      .from("activity_groups")
      .select("leader_id, discipline_id, activity_id, activity_kind")
      .eq("id", data.group_id)
      .single();
    
    if (!group) throw new Error("Grupo não encontrado.");
    if (group.leader_id !== context.userId) {
      throw new Error("Apenas o líder pode gerenciar integrantes.");
    }

    // Validate members size
    const { data: parent } = await supabaseAdmin
      .from(parentTable(group.activity_kind as Kind))
      .select("max_group_size")
      .eq("id", group.activity_id)
      .single();
    
    const maxSize = parent?.max_group_size ?? 2;
    // Leader is counted separately or part of the array? 
    // Usually member_ids includes everyone EXCEPT the leader or INCLUDING the leader?
    // Based on createGroup: const members = Array.from(new Set([context.userId, ...data.member_ids]));
    // So member_ids INCLUDES the leader.
    
    if (data.member_ids.length > maxSize) {
      throw new Error(`O limite máximo é de ${maxSize} integrantes.`);
    }

    // Ensure leader is still in the group
    if (!data.member_ids.includes(context.userId)) {
      throw new Error("O líder não pode ser removido do grupo.");
    }

    const { error } = await supabaseAdmin
      .from("activity_groups")
      .update({ member_ids: data.member_ids })
      .eq("id", data.group_id);
    
    if (error) throw new Error(error.message);
    return { ok: true };
  });

