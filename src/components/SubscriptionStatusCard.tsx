import { useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Crown, Calendar, Loader2, AlertTriangle, Clock, Timer } from "lucide-react";
import { useSubscription, GRACE_PERIOD_DAYS } from "@/hooks/use-subscription";

interface SubscriptionStatusCardProps {
  /** When true, polls the subscription every 2s while it is still free/not paid,
   *  so the UI updates as soon as the webhook processes the checkout. */
  pollForUpdate?: boolean;
}

/** Formata uma duração em ms como "2 dias e 5 h" / "5 h 20 min" / "18 min". */
function formatRemaining(ms: number) {
  const total = Math.max(0, ms);
  const days = Math.floor(total / 86400000);
  const hours = Math.floor((total % 86400000) / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  if (days > 0) return `${days} dia${days > 1 ? "s" : ""}${hours ? ` e ${hours} h` : ""}`;
  if (hours > 0) return `${hours} h${minutes ? ` ${minutes} min` : ""}`;
  return `${minutes} min`;
}

export function SubscriptionStatusCard({ pollForUpdate }: SubscriptionStatusCardProps) {
  const {
    subscription: sub,
    loading,
    isPaid,
    isTrialing,
    isPastDue,
    isExpiringSoon,
    isInGracePeriod,
    msUntilExpiry,
    graceMsLeft,
    refetch,
  } = useSubscription();

  useEffect(() => {
    if (!pollForUpdate || isPaid) return;
    refetch();
    const id = setInterval(() => refetch(), 2000);
    const timeout = setTimeout(() => clearInterval(id), 30000);
    return () => {
      clearInterval(id);
      clearTimeout(timeout);
    };
  }, [pollForUpdate, isPaid, refetch]);

  if (loading) {
    return (
      <Card className="border-0" style={{ boxShadow: "var(--shadow-card)" }}>
        <CardContent className="py-6 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const willEndSoon = sub?.cancel_at_period_end && sub?.current_period_end;
  return (
    <Card className="border-0 overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
      <CardContent className="p-5 sm:p-6">
        {isInGracePeriod && (
          <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 flex items-start gap-2">
            <Timer className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="font-semibold">Seu acesso venceu — período de tolerância</div>
              <p className="mt-0.5">
                Você está nos {GRACE_PERIOD_DAYS} dias de cortesia. A plataforma para em{" "}
                <strong>{formatRemaining(graceMsLeft)}</strong>. Renove agora para não perder o
                acesso às suas disciplinas.
              </p>
              <Button size="sm" className="mt-2" asChild>
                <a href="/billing">Renovar agora</a>
              </Button>
            </div>
          </div>
        )}
        {isExpiringSoon && !isInGracePeriod && (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex items-start gap-2">
            <Clock className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="font-semibold">Sua renovação está próxima</div>
              <p className="mt-0.5">
                Faltam <strong>{formatRemaining(msUntilExpiry ?? 0)}</strong> para o fim do seu
                acesso. Como o pagamento não é automático, renove antes do vencimento. Depois disso
                você ainda terá {GRACE_PERIOD_DAYS} dias de tolerância.
              </p>
              <Button size="sm" variant="outline" className="mt-2" asChild>
                <a href="/billing">Renovar acesso</a>
              </Button>
            </div>
          </div>
        )}
        {isPastDue && (
          <div className="mb-4 rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-800 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>Pagamento pendente. Tentaremos cobrar novamente nos próximos dias. Atualize seu cartão em "Gerenciar cobrança".</span>
          </div>
        )}
        {willEndSoon && (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 flex items-start gap-2">
            <Calendar className="h-4 w-4 mt-0.5 shrink-0" />
            <span>Sua assinatura termina em {new Date(sub!.current_period_end!).toLocaleDateString("pt-BR")}. Após essa data, sua conta volta para o plano Gratuito.</span>
          </div>
        )}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${isPaid ? "bg-amber-100 text-amber-600" : "bg-muted text-muted-foreground"}`}>
              <Crown className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Sua assinatura</div>
              <div className="text-lg font-semibold">{sub?.plan_name || "Gratuito"}</div>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant={isPaid ? "default" : "secondary"} className={isPaid ? "bg-green-100 text-green-700 hover:bg-green-100" : ""}>
                  {isTrialing ? "Período de teste" : sub?.status === "active" ? "Ativa" : sub?.status === "past_due" ? "Pagamento pendente" : sub?.status === "canceled" ? "Cancelada" : "Ativa"}
                </Badge>
                {sub?.current_period_end && (
                  <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {isTrialing ? "Cobrança em" : willEndSoon ? "Termina em" : "Renova em"} {new Date(sub.current_period_end).toLocaleDateString("pt-BR")}
                  </span>
                )}
              </div>
            </div>
          </div>
          <Button asChild>
            <a href="/billing">{isPaid ? "Gerenciar assinatura" : "Fazer upgrade"}</a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}