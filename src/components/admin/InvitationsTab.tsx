import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listInvitations, revokeInvitation, regenerateInvitation } from "@/backend/invitations.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Copy, RefreshCcw, Trash2, Send, Building2, GraduationCap } from "lucide-react";
import { toast } from "sonner";
import { NewInvitationDialog } from "./NewInvitationDialog";

interface Invitation {
  id: string;
  token: string;
  kind: "institution" | "teacher";
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  revoked_at: string | null;
  recipient_name: string | null;
  recipient_email: string | null;
  note: string | null;
  created_at: string;
}

type InviteStatus = "pendente" | "aceito" | "expirado" | "revogado";

function getStatus(i: Invitation): InviteStatus {
  if (i.revoked_at) return "revogado";
  if (i.used_count >= i.max_uses) return "aceito";
  if (i.expires_at && new Date(i.expires_at) < new Date()) return "expirado";
  return "pendente";
}

function StatusBadge({ status }: { status: InviteStatus }) {
  if (status === "pendente") return <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100">Pendente</Badge>;
  if (status === "aceito") return <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Aceito</Badge>;
  if (status === "expirado") return <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Expirado</Badge>;
  return <Badge variant="secondary">Revogado</Badge>;
}

export function InvitationsTab({ allowInstitution }: { allowInstitution: boolean }) {
  const listFn = useServerFn(listInvitations);
  const revokeFn = useServerFn(revokeInvitation);
  const regenFn = useServerFn(regenerateInvitation);
  const [items, setItems] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogKind, setDialogKind] = useState<"institution" | "teacher" | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await listFn();
      setItems(Array.isArray(data) ? (data as Invitation[]) : []);
    } catch (e) {
      console.error("[invitations] load failed", e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const buildLink = (token: string) => `${window.location.origin}/invite/${token}`;
  const copy = async (token: string) => {
    await navigator.clipboard.writeText(buildLink(token));
    toast.success("Link copiado");
  };
  const onRevoke = async (id: string) => {
    await revokeFn({ data: { id } });
    toast.success("Convite cancelado");
    await load();
  };
  const onRegen = async (i: Invitation) => {
    try {
      const fresh = await regenFn({ data: { id: i.id, expires_in_days: 30 } });
      const link = buildLink((fresh as { token: string }).token);
      await navigator.clipboard.writeText(link);
      toast.success("Novo link gerado e copiado");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };
  const sendEmail = (i: Invitation) => {
    if (!i.recipient_email) {
      toast.error("Convite sem e-mail de destinatário");
      return;
    }
    const subject = encodeURIComponent("Convite EstudaJá Pro");
    const body = encodeURIComponent(`Olá ${i.recipient_name ?? ""},\n\nReenviando seu convite para EstudaJá Pro:\n${buildLink(i.token)}`);
    window.open(`mailto:${i.recipient_email}?subject=${subject}&body=${body}`);
  };

  const safe = Array.isArray(items) ? items : [];

  return (
    <Card className="border-0" style={{ boxShadow: "var(--shadow-card)" }}>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap gap-2">
          {allowInstitution && (
            <Button onClick={() => setDialogKind("institution")}>
              <Building2 className="h-4 w-4 mr-2" /> Novo Convite para Instituição
            </Button>
          )}
          <Button onClick={() => setDialogKind("teacher")} variant={allowInstitution ? "outline" : "default"}>
            <GraduationCap className="h-4 w-4 mr-2" />
            {allowInstitution ? "Novo Convite para Professor Global" : "Novo Convite para Professor"}
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : safe.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nenhum convite gerado ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground border-b">
                <tr>
                  <th className="py-2">Destinatário</th>
                  <th>Tipo</th>
                  <th>Envio</th>
                  <th>Status</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {safe.map((i) => {
                  const s = getStatus(i);
                  return (
                    <tr key={i.id} className="border-b last:border-0 align-top">
                      <td className="py-3">
                        <div className="font-medium">{i.recipient_name || i.note || "—"}</div>
                        <div className="text-xs text-muted-foreground">{i.recipient_email || "—"}</div>
                      </td>
                      <td className="py-3">{i.kind === "institution" ? "Instituição" : "Professor"}</td>
                      <td className="py-3 text-muted-foreground">
                        {new Date(i.created_at).toLocaleDateString("pt-BR")}
                      </td>
                      <td className="py-3"><StatusBadge status={s} /></td>
                      <td className="py-3 text-right space-x-1 whitespace-nowrap">
                        {s === "pendente" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => copy(i.token)}>
                              <Copy className="h-3.5 w-3.5 mr-1" /> Copiar Link
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => onRevoke(i.id)} title="Cancelar convite">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                        {s === "expirado" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => onRegen(i)}>
                              <RefreshCcw className="h-3.5 w-3.5 mr-1" /> Gerar Novo
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => sendEmail(i)}>
                              <Send className="h-3.5 w-3.5 mr-1" /> Reenviar
                            </Button>
                          </>
                        )}
                        {s === "aceito" && (
                          <span className="text-xs text-muted-foreground">{i.used_count}/{i.max_uses} usos</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      <NewInvitationDialog
        open={dialogKind !== null}
        onOpenChange={(o) => { if (!o) setDialogKind(null); }}
        kind={dialogKind ?? "teacher"}
        onCreated={load}
      />
    </Card>
  );
}

export function activeInvitationsCount(items: Invitation[]) {
  return (Array.isArray(items) ? items : []).filter((i) => getStatus(i) === "pendente").length;
}