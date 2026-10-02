import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useEffect, useRef } from "react";
import { useAuth, type ProfileType } from "@/lib/auth-context";
import { AppHeader } from "@/components/AppHeader";
import { WelcomeGate } from "@/components/WelcomeGate";
import { WelcomeVideoDialog } from "@/components/WelcomeVideoDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { GraduationCap, LayoutDashboard, UserSquare2, ShieldCheck, School } from "lucide-react";
import { Button } from "@/components/ui/button";

// Dashboards as standard imports to fix dynamic import issues in some environments
import { AdminDashboard } from "@/components/dashboards/AdminDashboard";
import { InstitutionDashboard } from "@/components/dashboards/InstitutionDashboard";
import { TeacherDashboard } from "@/components/dashboards/TeacherDashboard";
import { StudentDashboard } from "@/components/dashboards/StudentDashboard";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Painel — EstudaJá Pro" },
      { name: "description", content: "Acesse seu painel de gestão acadêmica no EstudaJá Pro." },
    ],
  }),
  component: Index,
});

function Index() {
  const { user, profile, loading, effectiveProfileType, signOut, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const retriedProfile = useRef(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/inicio" });
  }, [user, loading, navigate]);

  useEffect(() => {
    // Force profile refresh when dashboard loads if profile is missing
    if (user && !profile && !loading && !retriedProfile.current) {
      retriedProfile.current = true;
      refreshProfile();
    }
  }, [user, profile, loading]);

  if (loading) {
    return (
      <div className="min-h-screen academic-bg">
        <AppHeader />
        <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
          <DashboardSkeleton />
        </main>
      </div>
    );
  }

  if (!user) return null;

  if (!profile) {
    return (
      <div className="min-h-screen academic-bg flex flex-col items-center justify-center p-4 text-center">
        <GraduationCap className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2 text-white">Erro ao carregar perfil</h2>
        <p className="text-white/80 max-w-md mb-6">
          Não foi possível carregar suas informações de acesso após várias tentativas. Isso pode ser um problema temporário de conexão.
        </p>
        <div className="flex gap-4">
          <Button onClick={() => window.location.reload()} variant="secondary">
            Tentar novamente
          </Button>
          <Button onClick={() => signOut()} variant="ghost" className="text-white hover:bg-white/10">
            Sair
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen academic-bg">
      <AppHeader />
      <WelcomeGate />
      <WelcomeVideoDialog userId={user.id} />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8">
        <Suspense fallback={<DashboardSkeleton type={effectiveProfileType} />}>
          {effectiveProfileType === "admin" && <AdminDashboard />}
          {effectiveProfileType === "institution" && <InstitutionDashboard />}
          {effectiveProfileType === "teacher" && <TeacherDashboard />}
          {effectiveProfileType === "student" && <StudentDashboard />}
          {effectiveProfileType === "gestor" && <InstitutionDashboard />}
        </Suspense>
      </main>
    </div>
  );
}

function DashboardSkeleton({ type }: { type?: ProfileType | null }) {
  const Icon = type === 'admin' ? ShieldCheck : 
               type === 'student' ? UserSquare2 :
               type === 'institution' || type === 'gestor' ? School :
               LayoutDashboard;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
            <Icon className="w-6 h-6 text-white/40" />
          </div>
          <Skeleton className="h-8 w-48 bg-white/20" />
        </div>
        <Skeleton className="h-4 w-72 bg-white/10" />
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Skeleton className="h-32 w-full rounded-2xl bg-white/15" />
        <Skeleton className="h-32 w-full rounded-2xl bg-white/15" />
        <Skeleton className="h-32 w-full rounded-2xl bg-white/15" />
      </div>

      <div className="space-y-4">
        <Skeleton className="h-6 w-32 bg-white/10" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <Skeleton key={i} className="h-48 w-full rounded-2xl bg-white/10" />
          ))}
        </div>
      </div>
    </div>
  );
}
