import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const createSchema = z.object({
  kind: z.enum(["institution", "teacher"]),
  note: z.string().trim().max(200).optional(),
  expires_in_days: z.number().int().min(1).max(365).optional(),
  recipient_name: z.string().trim().max(120).optional(),
  recipient_email: z.string().trim().email().max(200).optional(),
});

export const createInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("profiles")
      .select("profile_type, institution_id")
      .eq("id", userId)
      .maybeSingle();
    if (!profile) throw new Error("Perfil não encontrado");

    if (data.kind === "institution" && profile.profile_type !== "admin") {
      throw new Error("Apenas o admin pode convidar instituições");
    }
    if (data.kind === "teacher" && !["admin", "institution"].includes(profile.profile_type)) {
      throw new Error("Sem permissão para convidar professores");
    }

    const max_uses = data.kind === "institution" ? 1 : 50;
    const expires_at = data.expires_in_days
      ? new Date(Date.now() + data.expires_in_days * 86400000).toISOString()
      : null;
    const institution_id =
      data.kind === "teacher" && profile.profile_type === "institution"
        ? profile.institution_id
        : null;

    const { data: inv, error } = await supabase
      .from("invitations")
      .insert({
        kind: data.kind,
        created_by: userId,
        institution_id,
        max_uses,
        expires_at,
        note: data.note ?? null,
        recipient_name: data.recipient_name ?? null,
        recipient_email: data.recipient_email ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    return inv;
  });

export const listInvitations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("profiles").select("profile_type, institution_id").eq("id", userId).maybeSingle();
    if (!profile) return [];
    // Admin: ALL invitations. Institution: only their own (kind=teacher).
    if (profile.profile_type === "admin") {
      const { data, error } = await supabaseAdmin
        .from("invitations").select("*").order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data ?? [];
    }
    if (profile.profile_type === "institution") {
      const { data, error } = await supabase
        .from("invitations").select("*").eq("created_by", userId)
        .order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data ?? [];
    }
    return [];
  });

export const revokeInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

/** Generate a fresh invitation copying name/email/kind/institution from an old one. */
export const regenerateInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ id: z.string().uuid(), expires_in_days: z.number().int().min(1).max(365).default(30) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: profile } = await supabase
      .from("profiles")
      .select("profile_type, institution_id")
      .eq("id", userId)
      .maybeSingle();
    if (!profile) throw new Error("Perfil não encontrado");

    const { data: old } = await supabaseAdmin.from("invitations").select("*").eq("id", data.id).maybeSingle();
    if (!old) throw new Error("Convite não encontrado");

    // SECURITY: only the invitation's author, or a platform admin, may
    // regenerate it. Institutions may additionally regenerate teacher
    // invitations scoped to their own institution. Without this check any
    // authenticated user who guesses an invitation id could mint a valid
    // token carrying another organisation's institution_id/kind.
    const isAdmin = profile.profile_type === "admin";
    const isAuthor = old.created_by === userId;
    const isOwnInstitutionInvite =
      profile.profile_type === "institution" &&
      old.kind === "teacher" &&
      old.institution_id !== null &&
      old.institution_id === profile.institution_id;

    if (!isAdmin && !isAuthor && !isOwnInstitutionInvite) {
      throw new Error("Sem permissão para regenerar este convite");
    }
    if (old.kind === "institution" && !isAdmin) {
      throw new Error("Apenas o admin pode regenerar convites de instituição");
    }


    const expires_at = new Date(Date.now() + data.expires_in_days * 86400000).toISOString();
    const { data: inv, error } = await supabase
      .from("invitations").insert({
        kind: old.kind,
        created_by: userId,
        institution_id: old.institution_id,
        max_uses: old.max_uses,
        expires_at,
        note: old.note,
        recipient_name: old.recipient_name,
        recipient_email: old.recipient_email,
      }).select("*").single();
    if (error) throw error;
    return inv;
  });

const lookupSchema = z.object({ token: z.string().min(8).max(128) });

export const lookupInvitation = createServerFn({ method: "GET" })
  .validator((d) => lookupSchema.parse(d))
  .handler(async ({ data }) => {
    // Token-gated public lookup: uses the server client since invitations
    // are not readable by anon (RLS). Only non-sensitive fields are returned.
    const { supabaseAdmin: sb } = await import("@/integrations/supabase/client.server");
    const { data: inv, error } = await sb
      .from("invitations")
      .select("id,kind,max_uses,used_count,expires_at,revoked_at")
      .eq("token", data.token)
      .maybeSingle();
    if (error) throw error;
    if (!inv) return { valid: false as const, reason: "not_found" };
    if (inv.revoked_at) return { valid: false as const, reason: "revoked" };
    if (inv.expires_at && new Date(inv.expires_at) < new Date())
      return { valid: false as const, reason: "expired" };
    if (inv.used_count >= inv.max_uses) return { valid: false as const, reason: "exhausted" };
    return { valid: true as const, kind: inv.kind as "institution" | "teacher" };
  });