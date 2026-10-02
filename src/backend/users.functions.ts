import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

async function assertAdmin(supabase: SupabaseClient<Database>, userId: string) {
  const { data } = await supabase
    .from("profiles").select("profile_type").eq("id", userId).maybeSingle();
  if (data?.profile_type !== "admin") throw new Error("Apenas admin");
}

export const adminGetDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    
    const [inst, teach, stud] = await Promise.all([
      context.supabase.from("institutions").select("id", { count: "exact", head: true }).eq("status", "active"),
      context.supabase.from("profiles").select("id", { count: "exact", head: true }).eq("profile_type", "teacher"),
      context.supabase.from("profiles").select("id", { count: "exact", head: true }).eq("profile_type", "student"),
    ]);

    return {
      institutions: inst.count ?? 0,
      teachers: teach.count ?? 0,
      students: stud.count ?? 0,
    };
  });

export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({
    page: z.number().default(0),
    pageSize: z.number().default(50),
    search: z.string().optional(),
    filterType: z.string().optional(),
    filterDiscipline: z.string().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    
    let query = context.supabase
      .from("profiles")
      .select(`
        id, name, email, enrollment_number, profile_type, status, institution_id, created_at,
        discipline_students!inner(
          disciplines(id, name)
        )
      `, { count: 'exact' });

    // Se não houver filtro de disciplina, voltamos para o select normal para não excluir quem não tem disciplina
    if (!data.filterDiscipline || data.filterDiscipline === "all") {
      query = context.supabase
        .from("profiles")
        .select(`
          id, name, email, enrollment_number, profile_type, status, institution_id, created_at,
          discipline_students(
            disciplines(id, name)
          )
        `, { count: 'exact' });
    }

    if (data.search) {
      const q = `%${data.search}%`;
      query = query.or(`name.ilike.${q},email.ilike.${q},enrollment_number.ilike.${q}`);
    }

    if (data.filterType && data.filterType !== "all") {
      query = query.eq("profile_type", data.filterType as any);
    }

    if (data.filterDiscipline && data.filterDiscipline !== "all") {
      query = query.eq("discipline_students.discipline_id", data.filterDiscipline);
    }
    
    const from = data.page * data.pageSize;
    const to = from + data.pageSize - 1;

    const { data: profiles, error, count } = await query
      .order("name", { ascending: true })
      .range(from, to);

    if (error) throw error;

    const users = (profiles ?? []).map(p => ({
      ...p,
      disciplines: (p.discipline_students as any[])
        ?.map((ds: any) => ds.disciplines)
        .filter(Boolean) || []
    }));

    return {
      users,
      count: count ?? 0
    };
  });


export const adminListInstitutions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("institutions")
      .select("id,name,email,status,created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const adminListDisciplines = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("disciplines")
      .select("id,name")
      .order("name", { ascending: true })
      .limit(100);
    if (error) throw error;
    return data ?? [];
  });

export const adminListDisciplineStudentIds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ discipline_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: rows, error } = await context.supabase
      .from("discipline_students")
      .select("student_id")
      .eq("discipline_id", data.discipline_id);
    if (error) throw error;
    return (rows ?? []).map((r) => r.student_id as string);
  });

const updateUserSchema = z.object({
  user_id: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  status: z.enum(["active","inactive","pending"]).optional(),
  profile_type: z.enum(["admin","institution","teacher","student"]).optional(),
  institution_id: z.string().uuid().nullable().optional(),
});

export const adminUpdateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => updateUserSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { user_id, ...patch } = data;
    const { error } = await supabaseAdmin.from("profiles").update(patch).eq("id", user_id);
    if (error) throw error;

    if (patch.profile_type) {
      await supabaseAdmin.from("user_roles").upsert(
        { user_id, role: patch.profile_type },
        { onConflict: "user_id,role" },
      );
    }

    // Deactivating a student also unlinks them from every discipline, so they
    // stop showing up in attendance lists, diaries and grade sheets.
    if (patch.status === "inactive") {
      await supabaseAdmin.from("discipline_students").delete().eq("student_id", user_id);
    }
    return { ok: true };
  });

/** Bulk status change (used by the selection bar). Inactive => unlink disciplines. */
export const adminSetUsersStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({
    user_ids: z.array(z.string().uuid()).min(1),
    status: z.enum(["active", "inactive", "pending"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const ids = data.user_ids.filter((id) => id !== context.userId);
    if (ids.length === 0) return { ok: true, updated: 0 };

    const { error } = await supabaseAdmin
      .from("profiles").update({ status: data.status }).in("id", ids);
    if (error) throw error;

    let unlinked = 0;
    if (data.status === "inactive") {
      const { data: removed } = await supabaseAdmin
        .from("discipline_students").delete().in("student_id", ids).select("id");
      unlinked = removed?.length ?? 0;
    }
    return { ok: true, updated: ids.length, unlinked };
  });

export const adminResetPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({
    user_id: z.string().uuid(),
    new_password: z.string().min(6).max(72),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, { password: data.new_password });
    if (error) throw error;
    return { ok: true };
  });

export const adminDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.user_id === context.userId) throw new Error("Você não pode excluir a própria conta");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw error;
    return { ok: true };
  });

export const adminLinkInstitution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({
    user_id: z.string().uuid(),
    institution_id: z.string().uuid().optional(),
    institution_name: z.string().trim().min(2).max(160).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const { data: prof, error: profErr } = await supabaseAdmin
      .from("profiles").select("id,name,email,profile_type").eq("id", data.user_id).maybeSingle();
    if (profErr) throw profErr;
    if (!prof) throw new Error("Usuário não encontrado");

    let instId = data.institution_id ?? null;

    if (!instId) {
      const name = (data.institution_name || prof.name || prof.email || "Instituição").trim();
      const { data: existing } = await supabaseAdmin
        .from("institutions").select("id").eq("owner_user_id", data.user_id).maybeSingle();
      if (existing) {
        instId = existing.id;
        await supabaseAdmin.from("institutions").update({ name, status: "active" }).eq("id", existing.id);
      } else {
        const { data: created, error: insErr } = await supabaseAdmin
          .from("institutions")
          .insert({ name, email: prof.email, owner_user_id: data.user_id, status: "active" })
          .select("id").single();
        if (insErr) throw insErr;
        instId = created.id;
      }
    }

    const { error: upErr } = await supabaseAdmin
      .from("profiles")
      .update({ institution_id: instId, profile_type: "institution", status: "active" })
      .eq("id", data.user_id);
    if (upErr) throw upErr;

    await supabaseAdmin.from("user_roles").upsert(
      { user_id: data.user_id, role: "institution" },
      { onConflict: "user_id,role" },
    );

    return { ok: true, institution_id: instId };
  });

export const adminDeleteUsersBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ user_ids: z.array(z.string().uuid()) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const idsToDelete = data.user_ids.filter(id => id !== context.userId);
    if (idsToDelete.length === 0) return { ok: true, deleted: 0 };
    
    const results = await Promise.all(
      idsToDelete.map(id => supabaseAdmin.auth.admin.deleteUser(id))
    );
    
    const errors = results.filter(r => r.error).map(r => r.error);
    if (errors.length > 0 && errors.length === idsToDelete.length) {
      throw new Error(`Falha ao excluir usuários: ${errors[0]?.message}`);
    }

    return { ok: true, deleted: idsToDelete.length - errors.length, errors: errors.length };
  });

export const adminMigrateAuthorizedStudents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    
    const { data: authStudents, error: fetchErr } = await supabaseAdmin
      .from("authorized_students")
      .select("*");
      
    if (fetchErr) throw fetchErr;
    if (!authStudents?.length) return { migrated: 0, skipped: 0 };

    let migrated = 0;
    let skipped = 0;
    const errors: string[] = [];

    const matriculaToSyntheticEmail = (matricula: string) => {
      return `${matricula.trim().toLowerCase().replace(/[^a-z0-9]/g, "")}@students.estudaja.local`;
    };

    for (const student of authStudents) {
      try {
        const matricula = student.enrollment_number.trim();
        const { data: existing } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .ilike("enrollment_number", matricula)
          .maybeSingle();

        if (existing) {
          skipped++;
          continue;
        }

        const email = matriculaToSyntheticEmail(matricula);
        const password = matricula.length >= 6 ? matricula : `${matricula}${"0".repeat(6 - matricula.length)}`;
        
        const { data: created, error: cErr } = await supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            name: student.name,
            enrollment_number: matricula,
            profile_type: "student",
          },
        });

        if (cErr || !created.user) {
          errors.push(`Erro ao criar Auth para ${student.name}: ${cErr?.message}`);
          continue;
        }

        await supabaseAdmin.auth.admin.updateUserById(created.user.id, {
          password: password,
        });

        await supabaseAdmin.from("profiles").update({
          institution_id: student.institution_id,
          password_set: false,
          status: "active"
        }).eq("id", created.user.id);

        migrated++;
      } catch (e) {
        errors.push(`Falha no processamento de ${student.name}: ${e instanceof Error ? e.message : "Erro desconhecido"}`);
      }
    }

    return { migrated, skipped, errors: errors.length > 0 ? errors : undefined };
  });
