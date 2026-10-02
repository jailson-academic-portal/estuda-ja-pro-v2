import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppHeader } from "@/components/AppHeader";
import { WelcomeGate } from "@/components/WelcomeGate";
import { WelcomeVideoDialog } from "@/components/WelcomeVideoDialog";
import { StudentDashboard } from "@/components/dashboards/StudentDashboard";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/aluno")({
  head: () => ({
    meta: [
      { title: "Painel do Aluno — EstudaJá Pro" },
      { name: "description", content: "Acompanhe disciplinas, atividades e desempenho no painel do aluno." },
      { property: "og:title", content: "Painel do Aluno — EstudaJá Pro" },
      { property: "og:description", content: "Acompanhe disciplinas, atividades e desempenho no painel do aluno." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StudentRoute,
});

function StudentRoute() {
  const { user, profile, loading, effectiveProfileType } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && (!user || !profile)) navigate({ to: "/login", search: { tab: "matricula" } });
  }, [loading, profile, user, navigate]);

  if (loading || !user || !profile) {
    return (
      <div className="min-h-screen academic-bg">
        <AppHeader />
        <main className="mx-auto max-w-7xl px-4 py-8">
          <Skeleton className="h-32 w-full rounded-2xl bg-white/15" />
        </main>
      </div>
    );
  }

  if (effectiveProfileType !== "student") {
    navigate({ to: "/" });
    return null;
  }

  return (
    <div className="min-h-screen academic-bg">
      <AppHeader />
      <WelcomeGate />
      <WelcomeVideoDialog userId={user.id} />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8">
        <Suspense fallback={<Skeleton className="h-32 w-full rounded-2xl bg-white/15" />}>
          <StudentDashboard />
        </Suspense>
      </main>
    </div>
  );
}
