import { useRouter } from "@tanstack/react-router";
import { AlertCircle, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OwlLogo } from "@/components/OwlLogo";

/**
 * Global error boundary to prevent application crashes from unhandled server exceptions.
 * It renders a graceful fallback instead of the native TanStack Start error overlay.
 */
export function CustomErrorBoundary({ error, reset }: { error: any; reset: () => void }) {
  const router = useRouter();

  // Log the error silently to the console instead of letting it bubble up
  console.error("Global Error Caught by Boundary:", error);

  // Only bail out for genuine redirects, which the router handles itself.
  // Anything else (including plain objects that merely carry a `status` field,
  // such as 401 responses from server functions) must still render the
  // friendly fallback UI instead of a blank screen.
  const isRedirect =
    error instanceof Response
      ? error.status >= 300 && error.status < 400
      : Boolean(error && typeof error === "object" && ((error as any).isRedirect || (error as any).__isRedirect));

  if (isRedirect) {
    return null;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0f172a] p-4 text-white">
      <div className="mb-8 animate-bounce">
        <OwlLogo size={96} withText={false} className="animate-bounce" />
      </div>

      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center backdrop-blur-xl">
        <div className="mb-6 flex justify-center text-[#0d9488]">
          <AlertCircle className="h-16 w-16" />
        </div>

        <h1 className="mb-4 text-2xl font-bold tracking-tight">
          Ops! Identificamos uma pequena oscilação.
        </h1>
        
        <p className="mb-8 text-sm text-slate-400">
          Não se preocupe, seus dados estão seguros. Às vezes o sistema precisa de um empurrãozinho para continuar.
        </p>

        {import.meta.env.DEV && error?.message && (
          <div className="mb-8 overflow-hidden rounded-lg bg-black/40 p-4 text-left font-mono text-xs text-red-400">
            <p className="mb-1 font-semibold uppercase text-red-500">Detalhes técnicos:</p>
            <pre className="whitespace-pre-wrap">{error.message}</pre>
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button
            onClick={() => {
              // Reset local state and trigger re-render
              router.invalidate();
              reset();
            }}
            className="group gap-2 bg-[#0d9488] transition-all hover:bg-[#0d9488]/90"
          >
            <RefreshCw className="h-4 w-4 transition-transform group-hover:rotate-180" />
            Recarregar
          </Button>
          
          <Button
            variant="outline"
            onClick={() => {
              window.location.href = "/";
            }}
            className="gap-2 border-white/10 bg-transparent text-white hover:bg-white/5"
          >
            <Home className="h-4 w-4" />
            Início
          </Button>
        </div>
      </div>
      
      <p className="mt-8 text-xs text-slate-500">
        EstudaJá Pro &copy; {new Date().getFullYear()} — Tecnologia Educacional Avançada
      </p>
    </div>
  );
}
