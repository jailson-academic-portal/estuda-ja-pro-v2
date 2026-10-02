import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const getMySubscription = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { environment: string }) => d)
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const env = data?.environment === "sandbox" ? "sandbox" : "live";
    
    const { data: role } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    if (role && env === "live") {
      return {
        id: "admin-unlimited",
        plan_code: "admin_unlimited",
        plan_name: "Administrador/Criador",
        status: "active",
        current_period_end: null,
        cancel_at_period_end: false,
        amount_cents: 0,
        currency: "BRL",
      };
    }

    const { data: sub, error } = await supabaseAdmin
      .from("subscriptions")
      .select(
        "id, subscriber_id, subscriber_kind, plan_code, plan_name, status, current_period_end, cancel_at_period_end, provider, amount_cents, currency, created_at, updated_at, environment"
      )
      .eq("subscriber_id", userId)
      .eq("environment", env)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[subscriptions] Error fetching subscription:", error);
      throw new Error("Erro ao buscar assinatura no banco de dados.");
    }

    return sub || null;
  });

export const listAllSubscriptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("profiles").select("profile_type").eq("id", userId).maybeSingle();
    if (profile?.profile_type !== "admin") throw new Error("Apenas admin");

    const { data: subs } = await supabaseAdmin
      .from("subscriptions").select("*").order("created_at", { ascending: false });
    const list = subs ?? [];
    const ids = list.map((s) => s.subscriber_id);
    const { data: profs } = await supabaseAdmin
      .from("profiles").select("id,name,email,profile_type")
      .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    const map = new Map((profs ?? []).map((p) => [p.id, p]));
    return list.map((s: any) => ({ ...s, subscriber: map.get(s.subscriber_id) ?? null }));
  });

const updateSchema = z.object({
  subscription_id: z.string().uuid(),
  plan_code: z.string().min(1).max(50).optional(),
  plan_name: z.string().min(1).max(100).optional(),
  status: z.enum(["trialing","active","past_due","canceled","incomplete","expired"]).optional(),
  current_period_end: z.string().datetime().nullable().optional(),
  cancel_at_period_end: z.boolean().optional(),
});

export const adminUpdateSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: any) => updateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("profiles").select("profile_type").eq("id", userId).maybeSingle();
    if (profile?.profile_type !== "admin") throw new Error("Apenas admin");

    const { subscription_id, ...patch } = data;
    const { error } = await supabaseAdmin
      .from("subscriptions").update(patch).eq("id", subscription_id);
    if (error) throw error;
    return { ok: true };
  });