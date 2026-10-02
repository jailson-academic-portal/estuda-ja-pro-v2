import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { createInvitation, listInvitations, revokeInvitation } from "@/backend/invitations.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Copy, Loader2, Plus, Trash2 } from "lucide-react";

interface Invitation {
  id: string;
  token: string;
  kind: "institution" | "teacher";
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  revoked_at: string | null;
  note: string | null;
  created_at: string;
}

export function InvitationsPanel({ allowInstitution }: { allowInstitution: boolean }) {
  const createFn = useServerFn(createInvitation);
  const listFn = useServerFn(listInvitations);
  const revokeFn = useServerFn(revokeInvitation);
  const [items, setItems] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<"institution" | "teacher">(allowInstitution ? "institution" : "teacher");
  const [note, setNote] = useState("");
  const [days, setDays] = useState("30");
  const [creating, setCreating] = useState(false);

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

  const onCreate = async () => {
    setCreating(true);
    try {
      await createFn({ data: { kind, note: note || undefined, expires_in_days: Number(days) || 30 } });
      setNote("");
      toast.success("Convite criado");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar convite");
    } finally {
      setCreating(false);
    }
  };

  const buildLink = (token: string) => `${window.location.origin}/invite/${token}`;

  const copyLink = async (token: string) => {
    await navigator.clipboard.writeText(buildLink(token));
    toast.success("Link copiado");
  };

  const onRevoke = async (id: string) => {
    await revokeFn({ data: { id } });
    toast.success("Convite revogado");
    await load();
  };

  const statusBadge = (i: Invitation) => {
    if (i.revoked_at) return <Badge variant="destructive">Revogado</Badge>;
    if (i.expires_at && new Date(i.expires_at) < new Date()) return <Badge variant="secondary">Expirado</Badge>;
    if (i.used_count >= i.max_uses) return <Badge variant="secondary">Esgotado</Badge>;
    return <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Ativo</Badge>;
  };

  return (
    <Card className="border-0" style={{ boxShadow: "var(--shadow-card)" }}>
      <CardHeader>
        <CardTitle className="text-lg">Convites</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-2 items-end">
          {allowInstitution ? (
            <div className="space-y-1 sm:w-48">
              <label className="text-xs text-muted-foreground">Tipo</label>
              <Select value={kind} onValueChange={(v) => setKind(v as "institution" | "teacher")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="institution">Instituição</SelectItem>
                  <SelectItem value="teacher">Professor(a)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-1 flex-1">
            <label className="text-xs text-muted-foreground">Observação (opcional)</label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: Faculdade XYZ" />
          </div>
          <div className="space-y-1 sm:w-32">
            <label className="text-xs text-muted-foreground">Expira em (dias)</label>
            <Input type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} />
          </div>
          <Button onClick={onCreate} disabled={creating}>
            {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
            Gerar link
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">Nenhum convite gerado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground border-b">
                <tr>
                  <th className="py-2">Tipo</th>
                  <th>Observação</th>
                  <th>Usos</th>
                  <th>Status</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-b last:border-0">
                    <td className="py-2">{i.kind === "institution" ? "Instituição" : "Professor"}</td>
                    <td className="text-muted-foreground">{i.note || "—"}</td>
                    <td>{i.used_count}/{i.max_uses}</td>
                    <td>{statusBadge(i)}</td>
                    <td className="text-right space-x-1">
                      <Button size="sm" variant="outline" onClick={() => copyLink(i.token)}>
                        <Copy className="h-3.5 w-3.5 mr-1" /> Copiar
                      </Button>
                      {!i.revoked_at && (
                        <Button size="sm" variant="ghost" onClick={() => onRevoke(i.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}