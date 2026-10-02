import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { lookupInvitation } from "@/backend/invitations.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { OwlLogo } from "@/components/OwlLogo";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

export const Route = createFileRoute("/invite/$token")({
  head: () => ({
    meta: [
      { title: "Convite — EstudaJá Pro" },
      { name: "description", content: "Aceite seu convite e crie sua conta no EstudaJá Pro." },
    ],
  }),
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const lookupFn = useServerFn(lookupInvitation);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<"institution" | "teacher" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [responsible, setResponsible] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await lookupFn({ data: { token } });
        if (!r.valid) {
          setError(
            r.reason === "expired" ? "Este convite expirou."
            : r.reason === "revoked" ? "Este convite foi revogado."
            : r.reason === "exhausted" ? "Este convite já atingiu o limite de uso."
            : "Convite inválido."
          );
        } else {
          setKind(r.kind);
        }
      } catch {
        setError("Não foi possível validar o convite.");
      } finally {
        setLoading(false);
      }
    })();
  }, [token, lookupFn]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!kind) return;
    const schema = z.object({
      email: z.string().trim().email("E-mail inválido"),
      password: z.string().min(6, "Senha mínima de 6 caracteres"),
      name: z.string().trim().min(2, "Informe o nome"),
    });
    const finalName = kind === "institution" ? name : name;
    const parsed = schema.safeParse({ email, password, name: finalName });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }

    setSubmitting(true);
    const { error: err } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: {
          name: kind === "institution" ? name : finalName,
          profile_type: kind,
          invitation_token: token,
          ...(kind === "institution" ? { responsible_name: responsible } : {}),
        },
      },
    });
    setSubmitting(false);
    if (err) {
      toast.error(err.message.includes("registered") ? "E-mail já cadastrado" : err.message);
      return;
    }
    toast.success("Conta criada! Redirecionando…");
    navigate({ to: "/" });
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10" style={{ backgroundImage: "var(--gradient-header)" }}>
      <Card className="w-full max-w-md shadow-2xl border-0">
        <CardHeader className="text-center space-y-2">
          <div className="flex justify-center"><OwlLogo size={56} withText={false} /></div>
          <CardTitle className="text-2xl">
            {kind === "institution" ? "Cadastro de Instituição" : kind === "teacher" ? "Cadastro de Professor(a)" : "Convite"}
          </CardTitle>
          <CardDescription>
            {kind ? "Preencha os dados abaixo para ativar sua conta." : "Validando convite…"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : error ? (
            <p className="text-sm text-destructive text-center py-6">{error}</p>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              {kind === "institution" ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Nome da instituição</Label>
                    <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="resp">Responsável</Label>
                    <Input id="resp" value={responsible} onChange={(e) => setResponsible(e.target.value)} required maxLength={120} />
                  </div>
                </>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="name">Nome completo</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Senha</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Criar conta
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}