import { useEffect, useRef, useState } from "react";
import { KeyRound, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { verifyPresenceCode } from "@/backend/online-exams.student.functions";

/**
 * Gate do Código de Presença.
 *
 * Renderizado ANTES da sala de prova quando a prova exige Código de
 * Presença. Pede um PIN curto (4-6 caracteres), chama a server fn
 * `verifyPresenceCode` (que faz a comparação constant-time no servidor)
 * e só libera o conteúdo depois do sucesso.
 *
 * Por segurança:
 *  - O input usa `type="password"` para esconder o PIN dos ombros.
 *  - O PIN é validado localmente (regex 4-6 alfanum) antes de enviar.
 *  - A server fn é a única que conhece o hash e devolve apenas `{ok}`.
 *  - Em caso de reload da página, o aluno precisa digitar o PIN de novo
 *    (sem atalhos). Em uma próxima iteração pode-se introduzir
 *    `sessionStorage` com TTL curto, mas isso amplia a superfície de
 *    ataque — manteremos a checagem a cada "abertura" da sala.
 */
export function PresenceCodeGate({
  examId,
  examTitle,
  onUnlocked,
}: {
  examId: string;
  examTitle: string;
  onUnlocked: () => void;
}) {
  const verifyFn = useServerFn(verifyPresenceCode);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Foco automático no input para tablets/lousas.
    inputRef.current?.focus();
  }, []);

  const isValid = /^[A-Za-z0-9]{4,6}$/.test(code);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!isValid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = (await verifyFn({ data: { examId, code } })) as {
        ok: boolean;
        required: boolean;
      };
      if (res.required && !res.ok) {
        setError("Código incorreto. Confira o PIN na lousa e tente novamente.");
        toast.error("Código incorreto");
        setCode("");
        inputRef.current?.focus();
        return;
      }
      // Sucesso (required ou não).
      onUnlocked();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha ao verificar código";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mx-auto max-w-md border-white/10 bg-white/5 text-white shadow-lg">
      <CardHeader>
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/20 text-amber-300">
            <Lock className="h-4 w-4" aria-hidden />
          </span>
          <CardTitle className="text-base sm:text-lg">Código de Presença</CardTitle>
        </div>
        <CardDescription className="text-white/70">
          Para iniciar a prova <strong className="text-white">{examTitle}</strong>, digite o PIN que
          o(a) professor(a) está exibindo na lousa.
        </CardDescription>
      </CardHeader>
      <form onSubmit={submit}>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="presence-pin" className="text-white/90">
              <KeyRound className="inline h-3.5 w-3.5 mr-1" />
              PIN da prova
            </Label>
            <Input
              id="presence-pin"
              ref={inputRef}
              type="password"
              inputMode="text"
              autoComplete="off"
              pattern="[A-Za-z0-9]{4,6}"
              minLength={4}
              maxLength={6}
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                if (error) setError(null);
              }}
              placeholder="4 a 6 caracteres"
              className="font-mono tracking-[0.3em] text-center text-lg bg-white/10 border-white/20 text-white placeholder:text-white/40"
              aria-invalid={!!error}
              aria-describedby={error ? "presence-pin-error" : undefined}
              disabled={submitting}
            />
            {error && (
              <p id="presence-pin-error" role="alert" className="text-xs text-rose-300">
                {error}
              </p>
            )}
            <p className="text-xs text-white/60">
              O PIN tem 4 a 6 caracteres (letras e/ou números). Sem o código correto, a sala não
              pode ser aberta.
            </p>
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" disabled={!isValid || submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Verificando…
              </>
            ) : (
              <>
                <Lock className="h-4 w-4 mr-2" />
                Liberar prova
              </>
            )}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
