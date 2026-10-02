import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Resolve a instituição do usuário SEM nomes fixos: usa o vínculo do perfil e,
 * se ausente, deduz pelo institution_id real das instituições que ele possui
 * ou das disciplinas em que ele é professor. O vínculo é persistido no perfil.
 */
export async function resolveInstitutionId(userId: string): Promise<string | null> {
  const { data: me } = await supabaseAdmin
    .from("profiles")
    .select("institution_id")
    .eq("id", userId)
    .maybeSingle();
  if (me?.institution_id) return me.institution_id;

  const { data: owned } = await supabaseAdmin
    .from("institutions")
    .select("id")
    .eq("owner_user_id", userId)
    .limit(1);
  let instId = owned?.[0]?.id ?? null;

  if (!instId) {
    const { data: discs } = await supabaseAdmin
      .from("disciplines")
      .select("institution_id")
      .eq("teacher_id", userId)
      .not("institution_id", "is", null)
      .limit(1);
    instId = discs?.[0]?.institution_id ?? null;
  }

  if (instId) {
    await supabaseAdmin.from("profiles").update({ institution_id: instId }).eq("id", userId);
  }
  return instId;
}

/** Ensures the caller is an institution manager (or platform admin) and returns its institution id. */
/**
 * Lista os professores da instituição: perfis com papel 'teacher' ou 'admin'
 * vinculados à instituição — incluindo perfis de professor ainda sem vínculo,
 * para que nenhum docente cadastrado fique invisível no painel.
 */
export async function listTeacherProfiles(instId: string) {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id, name, email, profile_type, institution_id")
    .in("profile_type", ["teacher", "admin"])
    .or(`institution_id.eq.${instId},institution_id.is.null`)
    .order("name");
  return (data ?? []).map((p) => ({ id: p.id, name: p.name, email: p.email }));
}

export async function requireInstitution(userId: string): Promise<string> {
  const { data: me } = await supabaseAdmin
    .from("profiles")
    .select("profile_type")
    .eq("id", userId)
    .maybeSingle();
  if (me?.profile_type !== "institution" && me?.profile_type !== "admin") {
    throw new Error("Apenas instituições podem executar esta ação.");
  }
  const instId = await resolveInstitutionId(userId);
  if (!instId) throw new Error("Sua conta ainda não está vinculada a uma instituição.");
  return instId;
}

/** Ensures the discipline belongs to the caller's institution. */
export async function requireInstitutionDiscipline(userId: string, disciplineId: string) {
  const instId = await requireInstitution(userId);
  const { data: disc } = await supabaseAdmin
    .from("disciplines")
    .select("id, name, institution_id, teacher_id")
    .eq("id", disciplineId)
    .maybeSingle();
  if (!disc || disc.institution_id !== instId) throw new Error("Disciplina não encontrada nesta instituição.");
  return { instId, disc };
}

/** Confirms the teacher belongs to the institution. */
export async function assertTeacherOfInstitution(instId: string, teacherId: string) {
  const { data: t } = await supabaseAdmin
    .from("profiles")
    .select("id, profile_type, institution_id")
    .eq("id", teacherId)
    .maybeSingle();
  if (!t || t.institution_id !== instId || t.profile_type !== "teacher") {
    throw new Error("Professor(a) não pertence a esta instituição.");
  }
}
