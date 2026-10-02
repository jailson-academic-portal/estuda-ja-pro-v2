import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useServerFn } from "@tanstack/react-start";
import { createInvitation } from "@/backend/invitations.functions";
import { toast } from "sonner";
import { Loader2, Copy } from "lucide-react";

export function NewInvitationDialog({
  open, onOpenChange, kind, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  kind: "institution" | "teacher";
  onCreated: () => void;
}) {
  const createFn = useServerFn(createInvitation);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [days, setDays] = useState("30");
  const [creating, setCreating] = useState(false);
  const [createdLink, setCreatedLink] = useState<string | null>(null);

  const reset = () => {
    setName(""); setEmail(""); setDays("30"); setCreatedLink(null);
  };

  const onSubmit = async () => {
    if (!name.trim() || !email.trim()) {
      toast.error("Preencha nome e e-mail do destinatário");
      return;
    }
    setCreating(true);
    try {
      const inv = await createFn({ data: {
        kind,
        recipient_name: name.trim(),
        recipient_email: email.trim(),
        expires_in_days: Number(days) || 30,
        note: name.trim(),
      }});
      const link = `${window.location.origin}/invite/${(inv as { token: string }).token}`;
      setCreatedLink(link);
      onCreated();
      toast.success("Convite gerado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar convite");
    } finally {
      setCreating(false);
    }
  };

  const copy = async () => {
    if (!createdLink) return;
    await navigator.clipboard.writeText(createdLink);
    toast.success("Link copiado");
  };

  const sendEmail = () => {
    if (!createdLink || !email) return;
    const subject = encodeURIComponent("Convite EstudaJá Pro");
    const body = encodeURIComponent(`Olá ${name},\n\nVocê foi convidado(a) a se cadastrar no EstudaJá Pro como ${kind === "institution" ? "Instituição" : "Professor(a)"}.\n\nAcesse: ${createdLink}\n\nO link expira em ${days} dias.`);
    window.open(`mailto:${email}?subject=${subject}&body=${body}`);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {kind === "institution" ? "Novo Convite para Instituição" : "Novo Convite para Professor Global"}
          </DialogTitle>
        </DialogHeader>
        {createdLink ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Convite gerado para <strong>{name}</strong> ({email}).</p>
            <div className="space-y-1">
              <Label>Link de convite</Label>
              <div className="flex gap-2">
                <Input readOnly value={createdLink} />
                <Button variant="outline" size="icon" onClick={copy}><Copy className="h-4 w-4" /></Button>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={sendEmail} variant="outline" className="flex-1">Enviar por e-mail</Button>
              <Button onClick={() => onOpenChange(false)} className="flex-1">Concluir</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Nome do destinatário</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "institution" ? "Faculdade XYZ" : "Maria Silva"} />
              </div>
              <div className="space-y-1">
                <Label>E-mail</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contato@exemplo.com" />
              </div>
              <div className="space-y-1">
                <Label>Validade (dias)</Label>
                <Input type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={onSubmit} disabled={creating}>
                {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Gerar convite
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}