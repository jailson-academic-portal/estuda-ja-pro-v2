import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Retorna a logo aplicável ao usuário atual.
 * - Se o professor está vinculado a uma instituição, retorna a logo institucional.
 * - Caso contrário, retorna a logo do próprio perfil (professor autônomo).
 */
export const getMyBranding = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("logo_url, institution_id, profile_type")
      .eq("id", userId)
      .maybeSingle();
    if (!prof) return { logo_url: null, scope: "teacher" as const, can_edit: false };

    // Se for admin geral, ele tem permissão total (mesmo que esteja em uma instituição, ele pode querer marca própria?)
    // Mas o requisito diz: Se o usuário for Administrador Geral, altere o texto descritivo...
    // E permitir upload para 'Admin' ou 'Professor' (sem vínculo obrigatório).
    
    const isSuperAdmin = prof.profile_type === 'admin';

    if (prof.institution_id && !isSuperAdmin) {
      const { data: inst } = await supabaseAdmin
        .from("institutions")
        .select("logo_url, owner_user_id")
        .eq("id", prof.institution_id)
        .maybeSingle();
      return {
        logo_url: inst?.logo_url ?? null,
        scope: "institution" as const,
        can_edit: inst?.owner_user_id === userId,
        institution_id: prof.institution_id,
      };
    }
    
    // Admin ou Professor sem instituição (ou Admin forçando marca própria)
    return {
      logo_url: prof.logo_url ?? null,
      scope: "teacher" as const,
      can_edit: prof.profile_type === "teacher" || prof.profile_type === "admin",
    };
  });

/**
 * Faz o upload de uma imagem para o bucket `branding` no servidor (evita erros de RLS
 * no storage quando a sessão do navegador está expirada/renovando).
 * Recebe o arquivo em base64 e devolve a URL pública.
 */
export const uploadBrandingFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) =>
    z
      .object({
        base64: z.string().min(1),
        content_type: z.string().min(1),
        prefix: z.string().default("logo"),
        ext: z.string().default("png"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    if (bytes.byteLength > 3 * 1024 * 1024) throw new Error("Tamanho máximo: 3 MB");
    const safeExt = data.ext.replace(/[^a-zA-Z0-9]/g, "").slice(0, 5) || "png";
    const path = `${userId}/${data.prefix}-${Date.now()}.${safeExt}`;
    const { error } = await supabaseAdmin.storage.from("branding").upload(path, bytes, {
      upsert: true,
      contentType: data.content_type,
      cacheControl: "3600",
    });
    if (error) throw new Error(error.message);
    const { data: pub } = supabaseAdmin.storage.from("branding").getPublicUrl(path);
    return { url: pub.publicUrl };
  });

/** Salva a URL da logo (após upload no bucket `branding`). */
export const setMyBranding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ logo_url: z.string().url().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("institution_id, profile_type")
      .eq("id", userId)
      .maybeSingle();
    if (!prof) throw new Error("Perfil não encontrado");

    const isSuperAdmin = prof.profile_type === 'admin';

    if (prof.institution_id && !isSuperAdmin) {
      // só o owner da instituição pode alterar
      const { data: inst } = await supabaseAdmin
        .from("institutions")
        .select("owner_user_id")
        .eq("id", prof.institution_id)
        .maybeSingle();
      if (!inst || inst.owner_user_id !== userId) {
        throw new Error("Apenas o gestor da instituição pode alterar a logo institucional.");
      }
      await supabaseAdmin
        .from("institutions")
        .update({ logo_url: data.logo_url })
        .eq("id", prof.institution_id);
    } else {
      await supabaseAdmin.from("profiles").update({ logo_url: data.logo_url }).eq("id", userId);
    }
    return { ok: true };
  });

/**
 * Helper interno (não exportado como server fn) para resolver a logo de um professor
 * a partir do `teacher_id` da disciplina — usado pelo construtor de cabeçalhos.
 */