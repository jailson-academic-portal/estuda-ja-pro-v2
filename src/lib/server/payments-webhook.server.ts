import Stripe from "stripe";
import { type StripeEnv } from "@/lib/server/stripe.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const PLAN_NAMES: Record<string, string> = {
  teacher_pro_monthly: "Professor Pro",
  teacher_pro_yearly: "Professor Pro (Anual)",
  teacher_pro_1m: "Professor Pro (Mensal)",
  teacher_pro_3m: "Professor Pro (Trimestral)",
  teacher_pro_6m: "Professor Pro (Semestral)",
  teacher_pro_12m: "Professor Pro (Anual)",
};

// Duration in days per prepaid price lookup_key.
const PREPAID_DAYS: Record<string, number> = {
  teacher_pro_1m: 30,
  teacher_pro_3m: 90,
  teacher_pro_6m: 180,
  teacher_pro_12m: 365,
};

function planCodeFromLookupKey(key: string | null | undefined): string {
  if (!key) return "pro";
  if (key.startsWith("institution")) return "institution";
  if (key.startsWith("teacher_pro")) return "pro";
  return key;
}

export async function upsertSubscriptionFromStripe(
  subscription: Stripe.Subscription,
  env: StripeEnv,
) {
  const userId = (subscription.metadata as Record<string, string>)?.userId;
  if (!userId) {
    console.error("[stripe webhook] missing userId on subscription", subscription.id);
    return;
  }
  const item = subscription.items?.data?.[0];
  const lookupKey =
    (item?.price?.metadata as Record<string, string> | undefined)?.lovable_external_id ??
    item?.price?.lookup_key ??
    null;
  const planCode = planCodeFromLookupKey(lookupKey);
  const planName = (lookupKey && PLAN_NAMES[lookupKey]) || "Professor Pro";

  // Period fields live on the item in dahlia api version
  const periodEnd =
    (item as unknown as { current_period_end?: number })?.current_period_end ??
    (subscription as unknown as { current_period_end?: number })?.current_period_end;

  // Map Stripe status -> our enum
  const statusMap: Record<string, string> = {
    trialing: "trialing",
    active: "active",
    past_due: "past_due",
    canceled: "canceled",
    incomplete: "incomplete",
    incomplete_expired: "expired",
    unpaid: "past_due",
    paused: "canceled",
  };
  const status = statusMap[subscription.status] ?? "active";

  const customerId = typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer.id;

  // Check if a row already exists for this (subscriber, kind, env).
  // If yes -> update it. If no -> insert. (Avoids relying on the partial unique index for upsert.)
  const { data: existing } = await supabaseAdmin
    .from("subscriptions")
    .select("id")
    .eq("subscriber_id", userId)
    .eq("subscriber_kind", "teacher")
    .eq("environment", env)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const payload = {
      plan_code: planCode,
      plan_name: planName,
      status: status as never,
      provider: "stripe",
      provider_customer_id: customerId,
      provider_subscription_id: subscription.id,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      stripe_price_id: item?.price?.id ?? null,
      amount_cents: item?.price?.unit_amount ?? null,
      currency: item?.price?.currency?.toUpperCase() ?? "BRL",
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: subscription.cancel_at_period_end ?? false,
      environment: env,
      updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    await supabaseAdmin.from("subscriptions").update(payload as never).eq("id", existing.id);
  } else {
    await supabaseAdmin.from("subscriptions").insert({
      ...payload,
      subscriber_id: userId,
      subscriber_kind: "teacher",
    } as never);
  }
}

export async function handleSubscriptionDeleted(subscription: Stripe.Subscription, env: StripeEnv) {
  const userId = (subscription.metadata as Record<string, string>)?.userId;
  if (!userId) return;
  // Revert to free, keep grace via current_period_end already set
  await supabaseAdmin
    .from("subscriptions")
    .update({
      status: "canceled" as never,
      cancel_at_period_end: true,
      plan_code: "free",
      plan_name: "Gratuito",
      environment: env,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("subscriber_id", userId)
    .eq("subscriber_kind", "teacher" as never)
    .eq("environment", env);
}
/**
 * Handle a one-time prepaid checkout session (mode="payment").
 * Called on checkout.session.completed (cartão/pix) and
 * checkout.session.async_payment_succeeded (boleto).
 * Sets a subscription row with computed current_period_end.
 */
export async function upsertPrepaidFromSession(
  session: Stripe.Checkout.Session,
  env: StripeEnv,
) {
  const userId = (session.metadata as Record<string, string> | null)?.userId;
  if (!userId) {
    console.error("[stripe webhook] missing userId on prepaid session", session.id);
    return;
  }
  if (session.payment_status !== "paid") {
    console.log("[stripe webhook] prepaid session not paid yet", session.id, session.payment_status);
    return;
  }

  // Fetch line item to resolve the lookup_key of the price purchased.
  const { createStripeClient } = await import("@/lib/server/stripe.server");
  const stripe = createStripeClient(env);
  const items = await stripe.checkout.sessions.listLineItems(session.id, {
    limit: 1,
    expand: ["data.price"],
  });
  const price = items.data[0]?.price;
  const lookupKey =
    (price?.metadata as Record<string, string> | undefined)?.lovable_external_id ??
    price?.lookup_key ??
    null;
  const days = (lookupKey && PREPAID_DAYS[lookupKey]) || 30;
  const planName = (lookupKey && PLAN_NAMES[lookupKey]) || "Professor Pro";
  const planCode = planCodeFromLookupKey(lookupKey);

  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id ?? null;

  // Idempotency guard: if any row already references this checkout session,
  // the payment was already applied (Stripe retry / dashboard "Resend").
  const { data: already } = await supabaseAdmin
    .from("subscriptions")
    .select("id")
    .eq("subscriber_id", userId)
    .eq("environment", env)
    .or(`stripe_subscription_id.eq.${session.id},provider_subscription_id.eq.${session.id}`)
    .limit(1)
    .maybeSingle();

  if (already?.id) {
    console.log("[stripe webhook] prepaid session already applied, skipping", session.id);
    return;
  }

  // If user already has an active prepaid row, extend it from the current end date.
  const { data: existing } = await supabaseAdmin
    .from("subscriptions")
    .select("id, current_period_end, status, plan_code")
    .eq("subscriber_id", userId)
    .eq("subscriber_kind", "teacher")
    .eq("environment", env)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const baseDate =
    existing?.current_period_end &&
    existing.plan_code !== "free" &&
    new Date(existing.current_period_end as string) > new Date()
      ? new Date(existing.current_period_end as string)
      : new Date();
  const newEnd = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

  const payload = {
    plan_code: planCode,
    plan_name: planName,
    status: "active" as never,
    provider: "stripe",
    provider_customer_id: customerId,
    provider_subscription_id: session.id,
    stripe_customer_id: customerId,
    stripe_subscription_id: session.id,
    stripe_price_id: price?.id ?? null,
    amount_cents: price?.unit_amount ?? session.amount_total ?? null,
    currency: (price?.currency ?? session.currency ?? "brl").toUpperCase(),
    current_period_end: newEnd,
    cancel_at_period_end: true, // prepaid does not auto-renew
    environment: env,
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    await supabaseAdmin.from("subscriptions").update(payload as never).eq("id", existing.id);
  } else {
    await supabaseAdmin.from("subscriptions").insert({
      ...payload,
      subscriber_id: userId,
      subscriber_kind: "teacher",
    } as never);
  }
}
