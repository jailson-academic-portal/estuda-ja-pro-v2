import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { ArrowLeft, NotebookPen, Loader2 } from "lucide-react";

export const Route = createFileRoute("/diary")({
  head: () => ({
    meta: [
      { title: "Diário Digital — EstudaJá Pro" },
      { name: "description", content: "Diário digital consolidando frequência, atividades e notas das suas disciplinas." },
    ],
  }),
  component: DiaryPage,
});

function DiaryPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login", search: { tab: "email" } });
  }, [user, loading, navigate]);

  if (loading || !user) {
    return (
      <div className="min-h-screen academic-bg flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen academic-bg">
      <AppHeader />
      <main className="mx-auto max-w-4xl px-4 sm:px-6 py-6 sm:py-8 space-y-4">
        <Button variant="ghost" size="sm" asChild className="text-white hover:bg-white/15 hover:text-white">
          <Link to="/"><ArrowLeft className="h-4 w-4 mr-2" /> Voltar</Link>
        </Button>
        <div className="rounded-2xl border bg-card p-8 text-center" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="mx-auto h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <NotebookPen className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Diário Digital</h1>
          <p className="text-muted-foreground mt-2 max-w-lg mx-auto">
            Consolida frequência, atividades, notas e ocorrências das suas disciplinas em um único lugar.
          </p>
          <p className="text-xs text-muted-foreground mt-4">
            Em construção — chegará junto com Frequência, Notas e Calendário.
          </p>
        </div>
      </main>
    </div>
  );
}