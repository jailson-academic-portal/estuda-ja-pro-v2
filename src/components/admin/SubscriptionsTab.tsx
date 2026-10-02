import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listAllSubscriptions, adminUpdateSubscription } from "@/backend/subscriptions.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

interface Sub {
  id: string;
  subscriber_id: string;
  subscriber_kind: "teacher" | "institution";
  plan_code: string;
  plan_name: string;
  status: "trialing" | "active" | "past_due" | "canceled" | "incomplete" | "expired";
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  amount_cents: number | null;
  currency: string | null;
  subscriber: { name: string; email: string | null; profile_type: string } | null;
}

const statusBadge = (s: Sub["status"]) => {
  if (s === "active" || s === "trialing")
    return <Badge className="bg-green-100 text-green-700 hover:bg-green-100">{s === "trialing" ? "Trial" : "Ativo"}</Badge>;
  if (s === "past_due")
    return <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100">Atraso</Badge>;
  return <Badge className="bg-red-100 text-red-700 hover:bg-red-100">{s}</Badge>;
};

export function SubscriptionsTab() {
  const listFn = useServerFn(listAllSubscriptions);
  const updateFn = useServerFn(adminUpdateSubscription);
  const [items, setItems] = useState<Sub[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Sub | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await listFn();
      setItems(Array.isArray(data) ? (data as unknown as Sub[]) : []);
    } catch (e) {
      console.error("[subs] load failed", e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const safe = Array.isArray(items) ? items : [];

  return (
    <Card className="border-0" style={{ boxShadow: "var(--shadow-card)" }}>
      <CardContent className="space-y-4 pt-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border p-3">
            <div className="text-xs uppercase text-muted-foreground">Total</div>
            <div className="text-2xl font-bold">{safe.length}</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs uppercase text-muted-foreground">Ativos</div>
            <div className="text-2xl font-bold text-green-600">
              {safe.filter((s) => s.status === "active" || s.status === "trialing").length}
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs uppercase text-muted-foreground">Pagos</div>
            <div className="text-2xl font-bold">
              {safe.filter((s) => s.plan_code !== "free" && (s.status === "active" || s.status === "trialing")).length}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : safe.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nenhuma assinatura encontrada.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground border-b">
                <tr>
                  <th className="py-2">Assinante</th>
                  <th>Tipo</th>
                  <th>Plano</th>
                  <th>Status</th>
                  <th>Vence em</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {safe.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="py-2">
                      <div className="font-medium">{s.subscriber?.name || "—"}</div>
                      <div className="text-xs text-muted-foreground">{s.subscriber?.email}</div>
                    </td>
                    <td>{s.subscriber_kind === "institution" ? "Instituição" : "Professor"}</td>
                    <td>{s.plan_name}</td>
                    <td>{statusBadge(s.status)}</td>
                    <td className="text-muted-foreground">
                      {s.current_period_end ? new Date(s.current_period_end).toLocaleDateString("pt-BR") : "—"}
                    </td>
                    <td className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                        <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      <EditSubscriptionDialog
        sub={editing}
        open={editing !== null}
        onOpenChange={(o) => { if (!o) setEditing(null); }}
        onSaved={async (patch) => {
          if (!editing) return;
          try {
            await updateFn({ data: { subscription_id: editing.id, ...patch } });
            toast.success("Assinatura atualizada");
            setEditing(null);
            await load();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Erro");
          }
        }}
      />
    </Card>
  );
}

function EditSubscriptionDialog({
  sub, open, onOpenChange, onSaved,
}: {
  sub: Sub | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: (patch: { plan_code?: string; plan_name?: string; status?: Sub["status"]; current_period_end?: string | null }) => void;
}) {
  const [planCode, setPlanCode] = useState("");
  const [planName, setPlanName] = useState("");
  const [status, setStatus] = useState<Sub["status"]>("active");
  const [periodEnd, setPeriodEnd] = useState("");

  useEffect(() => {
    if (sub) {
      setPlanCode(sub.plan_code);
      setPlanName(sub.plan_name);
      setStatus(sub.status);
      setPeriodEnd(sub.current_period_end ? sub.current_period_end.slice(0, 10) : "");
    }
  }, [sub]);

  if (!sub) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Editar assinatura</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Código do plano</Label>
              <Input value={planCode} onChange={(e) => setPlanCode(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Nome do plano</Label>
              <Input value={planName} onChange={(e) => setPlanName(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as Sub["status"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="trialing">Trial</SelectItem>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="past_due">Atraso</SelectItem>
                  <SelectItem value="canceled">Cancelado</SelectItem>
                  <SelectItem value="incomplete">Incompleto</SelectItem>
                  <SelectItem value="expired">Expirado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Vence em</Label>
              <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => onSaved({
            plan_code: planCode,
            plan_name: planName,
            status,
            current_period_end: periodEnd ? new Date(periodEnd).toISOString() : null,
          })}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}