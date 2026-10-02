import { createFileRoute } from "@tanstack/react-router";
import type Stripe from "stripe";
import { verifyStripeWebhook, type StripeEnv } from "@/lib/server/stripe.server";
import {
  upsertSubscriptionFromStripe,
  handleSubscriptionDeleted,
  upsertPrepaidFromSession,
} from "@/lib/server/payments-webhook.server";

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const rawEnv = url.searchParams.get("env");
        if (rawEnv !== "sandbox" && rawEnv !== "live") {
          return new Response(JSON.stringify({ received: true, ignored: "invalid env" }), { status: 200 });
        }
        const env: StripeEnv = rawEnv;
        try {
          const event = await verifyStripeWebhook(request, env);
          switch (event.type) {
            case "customer.subscription.created":
            case "customer.subscription.updated":
              await upsertSubscriptionFromStripe(event.data.object as Stripe.Subscription, env);
              break;
            case "customer.subscription.deleted":
              await handleSubscriptionDeleted(event.data.object as Stripe.Subscription, env);
              break;
            case "checkout.session.completed": {
              const session = event.data.object as Stripe.Checkout.Session;
              if (session.mode === "subscription" && session.subscription) {
                // Recurring: fetch subscription and upsert (webhook ordering fallback).
                const subId = typeof session.subscription === "string"
                  ? session.subscription : session.subscription.id;
                const { createStripeClient } = await import("@/lib/server/stripe.server");
                const stripe = createStripeClient(env);
                const sub = await stripe.subscriptions.retrieve(subId);
                await upsertSubscriptionFromStripe(sub, env);
              } else if (session.mode === "payment") {
                // Prepaid one-time: activates for card/pix immediately.
                // Boleto arrives here with payment_status="unpaid" and is
                // finalized later by checkout.session.async_payment_succeeded.
                await upsertPrepaidFromSession(session, env);
              }
              break;
            }
            case "checkout.session.async_payment_succeeded": {
              // Boleto / delayed methods finally cleared → activate prepaid.
              const session = event.data.object as Stripe.Checkout.Session;
              if (session.mode === "payment") {
                await upsertPrepaidFromSession(session, env);
              }
              break;
            }
            default:
              console.log("[stripe webhook] unhandled", event.type);
          }
          return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "Content-Type": "application/json" } });
        } catch (e) {
          console.error("[stripe webhook] error", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});