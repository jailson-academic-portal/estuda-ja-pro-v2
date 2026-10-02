import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Catálogo customizável administrado pelos Admins. Guarda tipos personalizados
 * de atividades, trabalhos acadêmicos, tipos de questão e temas de pesquisa,
 * e permite conceder itens específicos a professores individuais via
 * `catalog_item_grants`.
 */

const CATALOG_KINDS = ["activity_subtype", "work_subtype", "question_type", "research_theme"] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

async function assertAdmin(supabase: import("@supabase/supabase-js").SupabaseClient, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Apenas administradores podem gerenciar o catálogo.");
}

export const listCatalogItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({ kind: z.enum(CATALOG_KINDS).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    let query = context.supabase
      .from("catalog_items")
      .select("id, kind, code, label, description, prompt_hint, is_active, created_at, updated_at")
      .order("kind", { ascending: true })
      .order("label", { ascending: true });
    if (data.kind) query = query.eq("kind", data.kind);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return { items: rows ?? [] };
  });

export const upsertCatalogItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        id: z.string().uuid().optional(),
        kind: z.enum(CATALOG_KINDS),
        code: z
          .string()
          .trim()
          .min(2)
          .max(60)
          .regex(/^[a-z0-9_]+$/, "Use apenas letras minúsculas, números e _"),
        label: z.string().trim().min(2).max(120),
        description: z.string().trim().max(30000).optional().nullable(),
        prompt_hint: z.string().trim().max(30000).optional().nullable(),
        is_active: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const payload = {
      kind: data.kind,
      code: data.code,
      label: data.label,
      description: data.description ?? null,
      prompt_hint: data.prompt_hint ?? null,
      is_active: data.is_active,
      created_by: context.userId,
    };
    if (data.id) {
      const { error } = await context.supabase
        .from("catalog_items")
        .update(payload)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id, ok: true };
    }
    const { data: row, error } = await context.supabase
      .from("catalog_items")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row!.id, ok: true };
  });

export const deleteCatalogItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase.from("catalog_items").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listCatalogGrants = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ catalog_item_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: rows, error } = await context.supabase
      .from("catalog_item_grants")
      .select("id, teacher_id, created_at")
      .eq("catalog_item_id", data.catalog_item_id);
    if (error) throw new Error(error.message);
    const ids = (rows ?? []).map((r) => r.teacher_id);
    let profiles: Array<{ id: string; name: string | null; email: string | null }> = [];
    if (ids.length) {
      const { data: p } = await context.supabase
        .from("profiles")
        .select("id, name, email")
        .in("id", ids);
      profiles = (p ?? []) as typeof profiles;
    }
    return {
      items: (rows ?? []).map((g) => ({
        grant_id: g.id,
        teacher_id: g.teacher_id,
        created_at: g.created_at,
        profile: profiles.find((x) => x.id === g.teacher_id) ?? null,
      })),
    };
  });

export const grantCatalogItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        catalog_item_id: z.string().uuid(),
        teacher_id: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("catalog_item_grants")
      .upsert(
        { catalog_item_id: data.catalog_item_id, teacher_id: data.teacher_id },
        { onConflict: "catalog_item_id,teacher_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const revokeCatalogItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ grant_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("catalog_item_grants")
      .delete()
      .eq("id", data.grant_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const searchTeachers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({ query: z.string().trim().min(1).max(120) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const like = `%${data.query.replace(/[%_]/g, "")}%`;
    const { data: rows, error } = await context.supabase
      .from("profiles")
      .select("id, name, email")
      .eq("profile_type", "teacher")
      .or(`name.ilike.${like},email.ilike.${like}`)
      .limit(20);
    if (error) throw new Error(error.message);
    return { items: rows ?? [] };
  });

/**
 * Chamada por professores para saber quais itens de catálogo customizados
 * lhes foram concedidos (usado pelos criadores de atividade/trabalho/etc.).
 */
export const listMyCatalogItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({ kind: z.enum(CATALOG_KINDS) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: grants, error: gErr } = await context.supabase
      .from("catalog_item_grants")
      .select("catalog_item_id")
      .eq("teacher_id", context.userId);
    if (gErr) throw new Error(gErr.message);
    const ids = (grants ?? []).map((g) => g.catalog_item_id);
    if (ids.length === 0) return { items: [] };
    const { data: rows, error } = await context.supabase
      .from("catalog_items")
      .select("id, kind, code, label, description, prompt_hint")
      .eq("kind", data.kind)
      .eq("is_active", true)
      .in("id", ids)
      .order("label", { ascending: true });
    if (error) throw new Error(error.message);
    return { items: rows ?? [] };
  });