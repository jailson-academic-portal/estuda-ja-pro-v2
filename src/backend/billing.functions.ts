import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  createStripeClient,
  resolveOrCreateCustomer,
  type StripeEnv,
} from "@/lib/server/stripe.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const checkoutSchema = z.object({
  priceId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .max(80),
  returnUrl: z.string().url().max(500),
  environment: z.enum(["sandbox", "live"]),
});

export const createCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => checkoutSchema.parse(d))
  .handler(async ({ data, context }) => {
    const env: StripeEnv = data.environment;
    const stripe = createStripeClient(env);

    // Resolve human-readable price ID via lookup_keys
    const prices = await stripe.prices.list({
      lookup_keys: [data.priceId],
      expand: ["data.product"],
    });
    if (!prices.data.length) throw new Error("Plano não encontrado");
    const stripePrice = prices.data[0];
    const isRecurring = stripePrice.type === "recurring";

    // Get user email from profile
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email,name")
      .eq("id", context.userId)
      .maybeSingle();

    // Prepaid model: a new purchase simply extends the access period from the
    // current expiration date. No duplicate-check block; upsertPrepaidFromSession
    // handles stacking.

    const session = await stripe.checkout.sessions.create({
      line_items: [{ price: stripePrice.id, quantity: 1 }],
      mode: isRecurring ? "subscription" : "payment",
      ui_mode: "embedded_page",
      return_url: data.returnUrl,
      customer: await resolveOrCreateCustomer(stripe, {
        email: profile?.email ?? undefined,
        userId: context.userId,
      }),
      metadata: { userId: context.userId },
      ...(!isRecurring && {
        payment_intent_data: { description: "Professor Pro — EstudaJá" },
      }),
      ...(isRecurring && {
        subscription_data: {
          metadata: { userId: context.userId },
        },
      }),
    });

    if (!session.client_secret) throw new Error("Falha ao iniciar checkout");
    return { clientSecret: session.client_secret };
  });

const portalSchema = z.object({
  returnUrl: z.string().url().max(500),
  environment: z.enum(["sandbox", "live"]),
});

export const createBillingPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => portalSchema.parse(d))
  .handler(async ({ data, context }) => {
    const env: StripeEnv = data.environment;
    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("subscriber_id", context.userId)
      .eq("environment", env)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sub?.stripe_customer_id) throw new Error("Nenhuma assinatura encontrada");

    const stripe = createStripeClient(env);
    const portal = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: data.returnUrl,
    });
    return { url: portal.url };
  });
