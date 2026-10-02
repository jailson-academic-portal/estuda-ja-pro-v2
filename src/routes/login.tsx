import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { studentMatriculaLogin } from "@/backend/student-login.functions";
import { emailPasswordLoginProxy } from "@/backend/email-login.functions";

import { OwlLogo } from "@/components/OwlLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Entrar — EstudaJá Pro" },
      { name: "description", content: "Acesse o EstudaJá Pro como estudante, professor, instituição ou administrador." },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    tab: search.tab === "matricula" || search.tab === "email" || search.tab === "gestor" ? (search.tab as "matricula" | "email" | "gestor") : undefined,
  }),
  component: LoginPage,
});

const emailSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("E-mail inválido")
    .max(255),
  password: z.string().min(6, "A senha deve ter ao menos 6 caracteres").max(100),
});

const matriculaSchema = z.object({
  matricula: z
    .string()
    .trim()
    .min(2, "Informe sua matrícula")
    .max(20)
    .regex(/^[A-Za-z0-9.-]+$/, "Matrícula inválida. Digite apenas o número da sua matrícula."),
});


function LoginPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const { tab } = Route.useSearch();
  const defaultTab = tab === "email" ? "email" : tab === "gestor" ? "gestor" : "matricula";

  useEffect(() => {
    if (!loading && user) navigate({ to: "/" });
  }, [user, loading, navigate]);

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ backgroundImage: "var(--gradient-header)" }}
    >
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <Card className="w-full max-w-md shadow-2xl border-0">
          <CardHeader className="text-center space-y-2">
            <div className="flex justify-center mb-1">
              <OwlLogo size={120} withText={false} />
            </div>
            <CardTitle className="text-4xl sm:text-5xl font-extrabold mt-0 mb-3">
              <span className="text-teal-600">EstudaJá</span>{" "}
              <span className="text-amber-400">Pro</span>
            </CardTitle>
            <CardDescription className="text-base">
              Plataforma acadêmica completa com IA para professores e alunos.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <Tabs defaultValue={defaultTab} className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="matricula" className="text-xs sm:text-sm">Aluno</TabsTrigger>
                <TabsTrigger value="email" className="text-xs sm:text-sm">Professor</TabsTrigger>
                <TabsTrigger value="gestor" className="text-xs sm:text-sm">Gestor / Instituição</TabsTrigger>
              </TabsList>
              <TabsContent value="matricula" className="mt-4">
                <MatriculaForm />
              </TabsContent>
              <TabsContent value="email" className="mt-4">
                <EmailForm submitting={submitting} setSubmitting={setSubmitting} />
              </TabsContent>
              <TabsContent value="gestor" className="mt-4">
                <EmailForm submitting={submitting} setSubmitting={setSubmitting} isGestor />
              </TabsContent>
            </Tabs>
            <p className="text-center text-xs text-muted-foreground mt-6">
              Não tem conta de professor ou instituição?{" "}
              <Link to="/signup" className="text-primary font-medium hover:underline">Criar conta</Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Remove tokens corrompidos / sessões zumbis antes de um novo login. */
function cleanupCorruptedAuthStorage() {
  const scrub = (store: Storage) => {
    try {
      for (const key of Object.keys(store)) {
        if (!key.startsWith("sb-") || !key.includes("auth-token")) continue;
        const raw = store.getItem(key);
        if (!raw) { store.removeItem(key); continue; }
        try {
          const parsed = JSON.parse(raw);
          if (!parsed || typeof parsed !== "object" || (!parsed.access_token && !parsed.refresh_token)) {
            store.removeItem(key);
          }
        } catch {
          store.removeItem(key);
        }
      }
    } catch { /* ignore */ }
  };
  if (typeof window === "undefined") return;
  scrub(window.localStorage);
  scrub(window.sessionStorage);
}

/** Apaga toda sessão/cachê de autenticação local antes de iniciar um novo login. */
function purgeAuthStorage() {
  if (typeof window === "undefined") return;
  const wipe = (store: Storage) => {
    try {
      for (const key of Object.keys(store)) {
        if (key.startsWith("sb-") || key.startsWith("estudaja:profileCache") || key === "estudaja:viewAs") {
          store.removeItem(key);
        }
      }
    } catch { /* ignore */ }
  };
  wipe(window.localStorage);
  wipe(window.sessionStorage);
  // Cookies de auth (SSR) do domínio atual.
  try {
    for (const c of document.cookie.split(";")) {
      const name = c.split("=")[0]?.trim();
      if (name && name.startsWith("sb-")) {
        document.cookie = `${name}=; Max-Age=0; path=/`;
      }
    }
  } catch { /* ignore */ }
}

/** Detecta erros reais de rede (dignos de retry). */
function isNetworkError(err: unknown) {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed") ||
    msg.includes("load failed") ||
    msg.includes("timeout")
  );
}

function friendlyAuthMessage(error: any): string {
  const status = error?.status ?? error?.code;
  const msg = String(error?.message ?? "").toLowerCase();

  if (status === 429 || msg.includes("rate limit") || msg.includes("too many")) {
    return "Muitas tentativas. Aguarde alguns instantes.";
  }
  if (msg.includes("invalid login credentials") || msg.includes("invalid_credentials") || status === 400) {
    return "E-mail ou senha incorretos.";
  }
  if (msg.includes("user not found") || msg.includes("banned") || msg.includes("disabled") || msg.includes("not confirmed") || status === 404) {
    return "Usuário não localizado ou inativo.";
  }
  if (msg.includes("email not confirmed")) {
    return "Usuário não localizado ou inativo.";
  }
  return error?.message ? `Não foi possível entrar: ${error.message}` : "Não foi possível entrar. Tente novamente.";
}

function EmailForm({ submitting, setSubmitting, isGestor }: { submitting: boolean; setSubmitting: (v: boolean) => void; isGestor?: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = emailSchema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setSubmitting(true);

    cleanupCorruptedAuthStorage();

    try {


    const MAX_ATTEMPTS = 3; // 1 tentativa + 2 retries
    let lastNetworkError: unknown = null;

    /** Fallback: autentica pelo servidor quando o navegador não alcança o endpoint de auth. */
    const proxyLogin = async (): Promise<boolean> => {
      try {
        const res = await emailPasswordLoginProxy({ data: parsed.data });
        if (!res?.ok) {
          setSubmitting(false);
          toast.error(
            res?.reason === "rate_limit"
              ? "Muitas tentativas. Aguarde alguns instantes."
              : res?.reason === "server"
                ? "Serviço de autenticação indisponível. Tente novamente."
                : "E-mail ou senha incorretos.",
          );
          return true; // tratado
        }
        const { error } = await supabase.auth.setSession({
          access_token: res.accessToken,
          refresh_token: res.refreshToken,
        });
        if (error) {
          console.error("[Auth Error] setSession:", error);
          setSubmitting(false);
          toast.error("Não foi possível iniciar sua sessão. Tente novamente.");
          return true;
        }
        setSubmitting(false);
        toast.success("Bem-vindo!");
        await queryClient.resetQueries();
        navigate({ to: "/" });
        return true;
      } catch (proxyErr) {
        console.error("[Auth Error] proxy:", proxyErr);
        return false;
      }
    };

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const { error } = await supabase.auth.signInWithPassword(parsed.data);

        if (error) {
          console.error("[Auth Error]:", error);
          // Erro de rede reportado pelo SDK → retry
          if (isNetworkError(error) && attempt < MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, 500 * attempt));
            continue;
          }
          if (isNetworkError(error)) {
            if (await proxyLogin()) return;
          }
          setSubmitting(false);
          toast.error(friendlyAuthMessage(error));
          return;
        }

        setSubmitting(false);
        toast.success("Bem-vindo!");
        // Descarta caches de sessões anteriores para que perfil e disciplinas
        // sejam recarregados do zero na Dashboard.
        await queryClient.resetQueries();
        navigate({ to: "/" });
        return;
      } catch (err) {
        console.error("[Auth Error]:", err);
        if (isNetworkError(err) && attempt < MAX_ATTEMPTS) {
          lastNetworkError = err;
          await new Promise((r) => setTimeout(r, 500 * attempt));
          continue;
        }
        if (isNetworkError(err)) {
          if (await proxyLogin()) return;
        }
        setSubmitting(false);
        toast.error(
          isNetworkError(err)
            ? "Falha de rede ao conectar. Tente novamente em instantes."
            : friendlyAuthMessage(err),
        );
        return;
      }
    }

      console.error("[Auth Error]: retries esgotados", lastNetworkError);
      if (await proxyLogin()) return;
      toast.error("Falha de rede ao conectar. Tente novamente em instantes.");
    } finally {
      // Libera o botão de submit independentemente do resultado.
      setSubmitting(false);
    }
  };



  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="email">{isGestor ? "E-mail do Gestor / Instituição" : "E-mail"}</Label>
        <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Senha</Label>
        <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Entrar
      </Button>
    </form>
  );
}

function MatriculaForm() {
  const [submitting, setSubmitting] = useState(false);
  const [matricula, setMatricula] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Pré-preencher a matrícula salva do último login (após hidratação para evitar mismatch SSR/CSR).
  useEffect(() => {
    try {
      const saved = localStorage.getItem("estudaja:matricula");
      if (saved) setMatricula(saved);
    } catch { /* ignore */ }
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanMatricula = matricula.trim().toUpperCase();

    const parsed = matriculaSchema.safeParse({ matricula: cleanMatricula });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setSubmitting(true);
    const rawMatricula = parsed.data.matricula.trim().toUpperCase();

    try {
      // Sessão limpa: encerra qualquer sessão anterior (ex.: professor) e remove
      // tokens/cachês locais antes de abrir a sessão do aluno.
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch { /* ignore */ }
      purgeAuthStorage();
      queryClient.clear();

      // O servidor pode levar até ~16s no primeiro acesso (criação do usuário),
      // então esperamos com folga antes de cancelar para não abortar um login
      // que já está sendo concluído no servidor.
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), 20000);
      const loginPromise = studentMatriculaLogin({
        data: { matricula: rawMatricula },
        signal: controller.signal,
      });
      const timeoutPromise = new Promise((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(new Error("Timeout")));
      });
      let res: Awaited<ReturnType<typeof studentMatriculaLogin>>;
      try {
        res = (await Promise.race([loginPromise, timeoutPromise])) as Awaited<
          ReturnType<typeof studentMatriculaLogin>
        >;
      } finally {
        clearTimeout(abortTimer);
      }

      if (!res?.ok) {
        setSubmitting(false);
        if (res?.reason === "not_found") {
          toast.error("Matrícula não encontrada. Verifique os dados digitados.", { duration: 6000 });
        } else if (res?.reason === "inactive") {
          toast.error("Sua matrícula está inativa. Contate seu professor.", { duration: 6000 });
        } else if (res?.reason === "timeout") {
          toast.error("O servidor demorou para responder. Toque em Entrar novamente.", { duration: 6000 });
        } else {
          toast.error("Erro de conexão com o servidor. Tente novamente.");
        }
        return;
      }


      const { error } = await supabase.auth.verifyOtp({
        token_hash: res.tokenHash,
        type: "magiclink",
      });
      if (error) {
        console.error("[MatriculaForm] verifyOtp falhou:", error);
        toast.error("Não foi possível iniciar sua sessão. Tente novamente.");
        return;
      }

      try {
        localStorage.setItem("estudaja:matricula", res.enrollment);
      } catch { /* ignore */ }
      toast.success("Bem-vindo!");
      // O painel só abre depois da sessão segura estar disponível no cliente.
      await queryClient.resetQueries();
      navigate({ to: "/aluno" });
    } catch (err) {
      console.error("[MatriculaForm] Erro crítico no fluxo de matrícula:", err);
      const msg = err instanceof Error ? err.message : String(err ?? "");
      toast.error(
        msg === "Timeout"
          ? "O servidor demorou para responder. Toque em Entrar novamente."
          : "Erro de conexão com o servidor. Tente novamente.",
      );
    } finally {
      // Garante que o botão nunca fique travado, qualquer que seja a resposta.
      setSubmitting(false);
    }
  };



  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="matricula">Matrícula</Label>
        <Input
          id="matricula"
          value={matricula}
          onChange={(e) => setMatricula(e.target.value)}
          required
          placeholder="ex: UL262001674"
        />
        <p className="text-xs text-muted-foreground">
          Seu acesso é feito apenas com a matrícula, individual e intransferível.
        </p>
      </div>
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Entrar
      </Button>
    </form>
  );
}