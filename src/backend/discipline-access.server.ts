export async function userIsAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await (await supabaseAdmin)
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function assertTeacherOrAdmin(disciplineId: string, userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await (await supabaseAdmin)
    .from("disciplines")
    .select("id, teacher_id")
    .eq("id", disciplineId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Disciplina não encontrada");
  if (data.teacher_id === userId) return data;
  if (await userIsAdmin(userId)) return data;
  throw new Error("Sem permissão");
}