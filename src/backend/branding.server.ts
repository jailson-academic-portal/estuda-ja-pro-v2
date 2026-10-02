import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function resolveBrandingLogoUrl(teacherId: string): Promise<string | null> {
  const { data: prof } = await supabaseAdmin
    .from("profiles")
    .select("logo_url, institution_id")
    .eq("id", teacherId)
    .maybeSingle();
  if (!prof) return null;
  // Se o professor tiver uma logo personalizada (marca própria/assinatura) no perfil, 
  // ela tem precedência se ele for admin ou se explicitamente quisermos priorizar a marca dele.
  // No entanto, seguindo a lógica de herança: Instituição > Perfil.
  // O requisito diz que a marca própria do Admin/Professor deve ser aplicada.
  
  // Verificamos se ele é Admin. Admins sempre usam sua própria logo do perfil se disponível.
  const { data: roleData } = await supabaseAdmin
    .from("profiles")
    .select("profile_type")
    .eq("id", teacherId)
    .maybeSingle();

  if (roleData?.profile_type === 'admin' && prof.logo_url) {
    return prof.logo_url;
  }

  if (prof.institution_id) {
    const { data: inst } = await supabaseAdmin
      .from("institutions")
      .select("logo_url")
      .eq("id", prof.institution_id)
      .maybeSingle();
    return inst?.logo_url ?? prof.logo_url ?? null;
  }
  return prof.logo_url ?? null;
}
