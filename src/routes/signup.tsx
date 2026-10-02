import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { syncStudentProfile } from "@/backend/student-sync.functions";
import { validateEnrollment } from "@/backend/enrollment-validation.functions";
import { OwlLogo } from "@/components/OwlLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Criar conta — EstudaJá Pro" },
      { name: "description", content: "Cadastro de professores e instituições no EstudaJá Pro." },
    ],
  }),
  component: SignupPage,
});

const schema = z.object({
  name: z.string().trim().min(2, "Informe o nome").max(120),
  email: z.string().trim().email("E-mail inválido").max(255),
  password: z.string().min(6, "Mínimo 6 caracteres").max(100),
});

function SignupPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const type = "student";
  const [matricula, setMatricula] = useState("");
  const [isMatriculaVerified, setIsMatriculaVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const MATRICULA_REGEX = /^[A-Za-z]{2}\d{1,9}$/;

  const verifyMatricula = async () => {
    const normalizedMatricula = matricula.trim().toUpperCase();
    
    if (!normalizedMatricula) {
      toast.error("Informe a matrícula");
      return;
    }

    if (!MATRICULA_REGEX.test(normalizedMatricula)) {
      toast.error("Formato de matrícula inválido. Use 2 letras seguidas de até 9 números (Ex: UL262001674).");
      return;
    }

    setVerifying(true);
    try {
      const syntheticEmail = `${normalizedMatricula.toLowerCase()}@students.estudaja.local`;

      // Server-side check: returns a boolean only (no PII) to avoid enumeration.
      const authCheck = await validateEnrollment({ data: { matricula: normalizedMatricula } });

      if (!authCheck.authorized) {
        if ("alreadyRegistered" in authCheck && authCheck.alreadyRegistered) {
          toast.error("Esta conta já está ativa. Tente fazer login.");
          return;
        }
        toast.error("Acesso negado. Sua matrícula não foi encontrada. Por favor, procure seu professor para liberar o seu acesso.", {
          duration: 6000,
        });
        return;
      }

      setName("");
      setEmail(syntheticEmail);
      setIsMatriculaVerified(true);
      toast.success("Matrícula verificada! Complete o seu cadastro.");

    } catch (err) {
      toast.error("Erro ao verificar matrícula");
    } finally {
      setVerifying(false);
    }
  };



  useEffect(() => {
    if (!loading && user) navigate({ to: "/" });
  }, [user, loading, navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ name, email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setSubmitting(true);
    
    // Registration is now strictly allowed since it was verified in verifyMatricula

    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: {
          name: parsed.data.name,
          enrollment_number: matricula.trim().toUpperCase(),
          profile_type: "student",
        },
      },
    });

    if (!error) {
      // Update authorized_students status to active
      await supabase
        .from("authorized_students")
        .update({ status: "active" })
        .eq("enrollment_number", matricula.trim().toUpperCase());
      // Sincroniza nome real e adota vínculos de turma pré-existentes.
      try { await syncStudentProfile(); } catch (e) { console.error("[signup] sync falhou", e); }
    }
    setSubmitting(false);
    if (error) {
      toast.error(error.message.includes("registered") ? "E-mail já cadastrado" : error.message);
      return;
    }
    toast.success("Conta criada com sucesso!");
    navigate({ to: "/" });
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10" style={{ backgroundImage: "var(--gradient-header)" }}>
      <Card className="w-full max-w-md shadow-2xl border-0">
        <CardHeader className="text-center space-y-2">
          <div className="flex justify-center"><OwlLogo size={56} withText={false} /></div>
          <CardTitle className="text-2xl">Criar conta</CardTitle>
          <CardDescription>Estritamente para alunos com matrícula pré-cadastrada</CardDescription>
        </CardHeader>
        <CardContent>
          {!isMatriculaVerified ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="matricula">Digite sua Matrícula</Label>
                <Input 
                  id="matricula" 
                  value={matricula} 
                  onChange={(e) => setMatricula(e.target.value)} 
                  placeholder="Ex: FR300..."
                  required 
                />
              </div>
              <Button 
                onClick={verifyMatricula} 
                className="w-full" 
                disabled={verifying}
              >
                {verifying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Verificar Acesso
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Já tem conta? <Link to="/login" search={{ tab: "email" }} className="text-primary font-medium hover:underline">Entrar</Link>
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Nome completo</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Seu nome completo" />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email">E-mail de Acesso</Label>
                <Input id="email" type="email" value={email} disabled className="bg-muted" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Crie uma Senha</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} placeholder="Mínimo 6 caracteres" />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Finalizar Cadastro
              </Button>
              <Button variant="ghost" type="button" onClick={() => setIsMatriculaVerified(false)} className="w-full text-xs">
                Voltar
              </Button>
            </form>
          )}

        </CardContent>
      </Card>
    </div>
  );
}