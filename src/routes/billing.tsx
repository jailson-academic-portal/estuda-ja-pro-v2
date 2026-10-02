import { useState } from "react";
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AppHeader } from "@/components/AppHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Crown, Check, Loader2, ExternalLink, Building2, Mail } from "lucide-react";
import { SubscriptionStatusCard } from "@/components/SubscriptionStatusCard";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { StripeEmbeddedCheckout } from "@/components/StripeEmbeddedCheckout";
import { createBillingPortalSession } from "@/backend/billing.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

const searchSchema = z.object({
  status: z.enum(["success", "canceled"]).optional(),
  session_id: z.string().optional(),
});

export const Route = createFileRoute("/billing")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({ meta: [{ title: "Assinatura — EstudaJá Pro" }] }),
  component: BillingPage,
});

const PRO_FEATURES = [
  "Disciplinas ilimitadas",
  "Alunos ilimitados",
  "Importação por CSV",
  "Recursos avançados de IA",
  "Suporte prioritário",
];

const CONTACT_EMAIL = "contato@estudaja.com";

type Cycle = "1m" | "3m" | "6m" | "12m";
const CYCLES: Array<{
  key: Cycle;
  priceId: string;
  label: string;
  months: number;
  totalCents: number;
  monthlyEquivCents: number;
  discountLabel?: string;
}> = [
  { key: "1m", priceId: "teacher_pro_1m", label: "Mensal", months: 1, totalCents: 4000, monthlyEquivCents: 4000 },
  { key: "3m", priceId: "teacher_pro_3m", label: "Trimestral", months: 3, totalCents: 10800, monthlyEquivCents: 3600, discountLabel: "-10%" },
  { key: "6m", priceId: "teacher_pro_6m", label: "Semestral", months: 6, totalCents: 21120, monthlyEquivCents: 3520, discountLabel: "-12%" },
  { key: "12m", priceId: "teacher_pro_12m", label: "Anual", months: 12, totalCents: 40800, monthlyEquivCents: 3400, discountLabel: "-15%" },
];

function formatBRL(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function BillingPage() {
  const search = useSearch({ from: "/billing" });
  const { profile } = useAuth();
  const [checkoutPriceId, setCheckoutPriceId] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [cycle, setCycle] = useState<Cycle>("1m");
  const portalFn = useServerFn(createBillingPortalSession);
  const isInstitution = profile?.profile_type === "institution";
  const activeCycle = CYCLES.find((c) => c.key === cycle)!;
  const proPriceId = activeCycle.priceId;

  const openPortal = async () => {
    setPortalLoading(true);
    try {
      const res = await portalFn({
        data: {
          returnUrl: `${window.location.origin}/billing`,
          environment: getStripeEnvironment(),
        },
      });
      if (res?.url) window.open(res.url, "_blank");
      else toast.error("Não foi possível abrir o portal");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao abrir portal");
    } finally {
      setPortalLoading(false);
    }
  };

  return (
    <div className="min-h-screen academic-bg">
      <PaymentTestModeBanner />
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <Button asChild variant="ghost" size="sm" className="text-white hover:bg-white/15 hover:text-white">
          <Link to="/">
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar ao painel
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-white">Sua assinatura</h1>
          <p className="text-white/80 text-sm">Gerencie seu plano e dados de cobrança.</p>
        </div>

        {search.status === "success" && (
          <Card className="border-green-200 bg-green-50">
            <CardContent className="py-4 text-sm text-green-800">
              Pagamento processado! Sua assinatura será ativada em alguns segundos.
            </CardContent>
          </Card>
        )}

        <SubscriptionStatusCard pollForUpdate={search.status === "success"} />

        {isInstitution ? (
          <Card className="border-0" style={{ boxShadow: "var(--shadow-card)" }}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" /> Plano Institucional
              </CardTitle>
              <Button variant="outline" size="sm" onClick={openPortal} disabled={portalLoading}>
                {portalLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <ExternalLink className="h-4 w-4 mr-1" />
                )}
                Gerenciar cobrança
              </Button>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border p-5">
                <p className="text-sm text-muted-foreground">
                  O plano institucional libera{" "}
                  <strong>disciplinas e alunos ilimitados para todos os professores</strong>{" "}
                  vinculados à sua instituição. O valor é definido conforme o número de professores.
                </p>
                <ul className="mt-4 space-y-2 text-sm">
                  {[
                    "Acesso ilimitado para todos os professores",
                    "Importação por CSV",
                    "Recursos avançados de IA",
                    "Suporte prioritário",
                  ].map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" /> <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button asChild className="mt-5">
                  <a href={`mailto:${CONTACT_EMAIL}?subject=Plano%20Institucional%20EstudaJ%C3%A1`}>
                    <Mail className="h-4 w-4 mr-1" /> Falar com nossa equipe
                  </a>
                </Button>
                <p className="mt-3 text-xs text-muted-foreground">
                  Enviaremos uma proposta com o valor conforme o número de professores da
                  instituição.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-0" style={{ boxShadow: "var(--shadow-card)" }}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Crown className="h-5 w-5 text-amber-500" /> Planos disponíveis
              </CardTitle>
              <Button variant="outline" size="sm" onClick={openPortal} disabled={portalLoading}>
                {portalLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <ExternalLink className="h-4 w-4 mr-1" />
                )}
                Gerenciar cobrança
              </Button>
            </CardHeader>
            <CardContent>
              <div className="mb-5 flex flex-wrap rounded-lg border p-1 bg-muted/40 gap-1">
                {CYCLES.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setCycle(c.key)}
                    className={`px-3 py-1.5 text-sm rounded-md transition ${cycle === c.key ? "bg-background shadow font-medium" : "text-muted-foreground"}`}
                  >
                    {c.label}
                    {c.discountLabel && (
                      <span className="ml-1 text-green-600 font-medium">{c.discountLabel}</span>
                    )}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                Pagamento único (sem renovação automática). Aceita cartão, Pix e boleto.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                {/* Free plan */}
                <div className="rounded-lg border p-5 flex flex-col">
                  <div className="flex items-baseline justify-between">
                    <h3 className="font-semibold">Gratuito</h3>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Comece sem custo.</p>
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-3xl font-bold">R$ 0</span>
                    <span className="text-sm text-muted-foreground">/sempre</span>
                  </div>
                  <ul className="mt-4 space-y-2 text-sm flex-1">
                    {["1 disciplina ativa", "Até 30 alunos", "Diário e atividades básicas"].map(
                      (f) => (
                        <li key={f} className="flex items-start gap-2">
                          <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />{" "}
                          <span>{f}</span>
                        </li>
                      ),
                    )}
                  </ul>
                  <Button className="mt-5 w-full" variant="outline" disabled>
                    Plano atual
                  </Button>
                </div>
                {/* Professor Pro */}
                <div className="rounded-lg border p-5 flex flex-col border-primary ring-1 ring-primary/30">
                  <div className="flex items-baseline justify-between">
                    <h3 className="font-semibold">Professor Pro</h3>
                    <span className="text-[10px] uppercase tracking-wide bg-primary text-primary-foreground rounded px-2 py-0.5">
                      {activeCycle.discountLabel ?? "Popular"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Para professores que precisam de tudo, sem limites.
                  </p>
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-3xl font-bold">{formatBRL(activeCycle.totalCents)}</span>
                    <span className="text-sm text-muted-foreground">
                      /{activeCycle.months === 1 ? "mês" : `${activeCycle.months} meses`}
                    </span>
                  </div>
                  {activeCycle.months > 1 && (
                    <p className="text-xs text-green-600 mt-1">
                      Equivale a {formatBRL(activeCycle.monthlyEquivCents)}/mês
                    </p>
                  )}
                  <ul className="mt-4 space-y-2 text-sm flex-1">
                    {PRO_FEATURES.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />{" "}
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="mt-5 w-full"
                    disabled={checkoutPriceId === proPriceId}
                    onClick={() => setCheckoutPriceId(proPriceId)}
                  >
                    Comprar acesso
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {checkoutPriceId && (
          <Card className="border-0" style={{ boxShadow: "var(--shadow-card)" }}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Finalizar assinatura</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setCheckoutPriceId(null)}>
                Cancelar
              </Button>
            </CardHeader>
            <CardContent>
              <StripeEmbeddedCheckout priceId={checkoutPriceId} />
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
