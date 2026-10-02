import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getMySubscription } from "@/backend/subscriptions.functions";
import { useAuth } from "@/lib/auth-context";
import { getStripeEnvironment } from "@/lib/stripe";

export interface SubscriptionInfo {
  id: string;
  plan_code: string;
  plan_name: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  amount_cents: number | null;
  currency: string | null;
}

/** Dias de tolerância após o vencimento em que a plataforma continua funcionando. */
export const GRACE_PERIOD_DAYS = 3;
const GRACE_MS = GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
/** A partir de quantos dias antes do vencimento começamos a avisar o professor. */
export const RENEWAL_WARNING_DAYS = 7;

export interface UseSubscriptionResult {
  subscription: SubscriptionInfo | null;
  loading: boolean;
  /** True when user has paid plan AND access has not lapsed (covers grace period after cancel). */
  isPaid: boolean;
  /** True when on free plan (or no row at all). */
  isFree: boolean;
  /** True when status === "trialing". */
  isTrialing: boolean;
  /** True when status === "past_due" — surface a banner but do not revoke access. */
  isPastDue: boolean;
  /** Data de término do acesso pago (ISO) ou null. */
  expiresAt: string | null;
  /** Milissegundos até o vencimento (negativo se já venceu). null se não houver data. */
  msUntilExpiry: number | null;
  /** True quando falta RENEWAL_WARNING_DAYS ou menos para vencer (ainda dentro do prazo). */
  isExpiringSoon: boolean;
  /** True quando já venceu mas ainda está dentro dos 3 dias de tolerância. */
  isInGracePeriod: boolean;
  /** Milissegundos restantes de tolerância (0 quando não aplicável). */
  graceMsLeft: number;
  refetch: () => Promise<void>;
}

export function useSubscription(): UseSubscriptionResult {
  const { profile } = useAuth();
  const fn = useServerFn(getMySubscription);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const data = await fn({ data: { environment: getStripeEnvironment() } });
      setSubscription((data as SubscriptionInfo | null) ?? null);
    } catch {
      setSubscription(null);
    } finally {
      setLoading(false);
    }
  }, [fn]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // Tick a cada 30s para o contador regressivo ficar vivo na tela.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const endMs = subscription?.current_period_end
    ? new Date(subscription.current_period_end).getTime()
    : null;
  const periodEndOk = !subscription?.current_period_end
    || (endMs !== null && endMs + GRACE_MS > now);
  const isPaidPlan = !!subscription && subscription.plan_code !== "free";
  const isAdmin = profile?.profile_type === "admin";
  const isPaid = isAdmin || (isPaidPlan && (
    (["active", "trialing", "past_due"].includes(subscription!.status) && periodEndOk)
    || (subscription!.status === "canceled" && !!subscription!.current_period_end && periodEndOk)
  ));

  const msUntilExpiry = endMs !== null ? endMs - now : null;
  const relevant = isPaidPlan && !isAdmin && endMs !== null;
  const isInGracePeriod = !!relevant && msUntilExpiry! <= 0 && endMs! + GRACE_MS > now;
  const isExpiringSoon =
    !!relevant && msUntilExpiry! > 0 && msUntilExpiry! <= RENEWAL_WARNING_DAYS * 24 * 60 * 60 * 1000;
  const graceMsLeft = isInGracePeriod ? endMs! + GRACE_MS - now : 0;

  return {
    subscription,
    loading,
    isPaid,
    isFree: !isPaid,
    isTrialing: subscription?.status === "trialing",
    isPastDue: subscription?.status === "past_due",
    expiresAt: subscription?.current_period_end ?? null,
    msUntilExpiry,
    isExpiringSoon,
    isInGracePeriod,
    graceMsLeft,
    refetch,
  };
}