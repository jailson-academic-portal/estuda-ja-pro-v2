import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth-context";
import { getInstitutionOverview } from "@/backend/institution.functions";
import { StatCard } from "./StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GraduationCap, Users, BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { InvitationsPanel } from "../InvitationsPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InstitutionDisciplinesTab } from "@/components/institution/InstitutionDisciplinesTab";
import { InstitutionStudentsTab } from "@/components/institution/InstitutionStudentsTab";
import { AcademicHierarchyTab } from "../admin/AcademicHierarchyTab";
import { AdminImportStudentsV2 } from "../admin/AdminImportStudentsV2";
import { InstitutionBrandingTab } from "../admin/InstitutionBrandingTab";
import { InstitutionAnalyticsTab } from "../analytics/InstitutionAnalyticsTab";
import { Skeleton } from "@/components/ui/skeleton";

export function InstitutionDashboard() {
  const { profile, loading } = useAuth();
  const fetchOverview = useServerFn(getInstitutionOverview);
  const [stats, setStats] = useState({ teachers: 0, students: 0, disciplines: 0 });
  const [teachers, setTeachers] = useState<{ id: string; name: string; email: string | null }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [instId, setInstId] = useState<string | null>(null);

  useEffect(() => {
    // Aguarda a resolução completa do perfil antes de decidir o que renderizar.
    if (loading || !profile) return;
    setLoaded(false);
    (async () => {
      try {
        const data = await fetchOverview();
        setInstId(data.institutionId ?? profile?.institution_id ?? null);
        setStats({ teachers: data.teachers, students: data.students, disciplines: data.disciplines });
        setTeachers(data.teacherList);
      } catch {
        setInstId(profile?.institution_id ?? null);
        setStats({ teachers: 0, students: 0, disciplines: 0 });
        setTeachers([]);
      } finally {
        setLoaded(true);
      }
    })();
  }, [loading, profile, profile?.institution_id, fetchOverview]);

  const resolving = loading || !profile || !loaded;

  if (resolving) {
    return (
      <div className="space-y-8">
        <div className="space-y-2">
          <Skeleton className="h-8 w-72 bg-white/25" />
          <Skeleton className="h-4 w-96 bg-white/20" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Skeleton className="h-24 w-full bg-white/25" />
          <Skeleton className="h-24 w-full bg-white/25" />
          <Skeleton className="h-24 w-full bg-white/25" />
        </div>
        <Skeleton className="h-64 w-full bg-white/20" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-white">Painel da instituição</h1>
        <p className="text-white/90 text-sm sm:text-base font-medium">Acompanhe professores, estudantes e disciplinas vinculados.</p>
      </div>
      {!instId && profile?.profile_type === "institution" && (
        <Card className="border-dashed"><CardContent className="py-6 text-sm text-muted-foreground">
          Sua conta foi criada sem um link de convite. Aguarde a aprovação do administrador para ter sua instituição vinculada.
        </CardContent></Card>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Professores" value={stats.teachers} icon={GraduationCap} tone="teal" />
        <StatCard label="Estudantes" value={stats.students} icon={Users} tone="purple" />
        <StatCard label="Disciplinas ativas" value={stats.disciplines} icon={BookOpen} tone="green" />
      </div>

      {instId ? (
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="overview">Início</TabsTrigger>
            <TabsTrigger value="analytics">Central Analytics</TabsTrigger>
            <TabsTrigger value="hierarchy">Hierarquia Acadêmica</TabsTrigger>
            <TabsTrigger value="import">Importar Alunos</TabsTrigger>
            <TabsTrigger value="branding">Personalização</TabsTrigger>
            <TabsTrigger value="disciplines">Disciplinas</TabsTrigger>
            <TabsTrigger value="invites">Convites</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <Card className="border-0" style={{ boxShadow: "var(--shadow-card)" }}>
              <CardHeader><CardTitle className="text-lg">Professores</CardTitle></CardHeader>
              <CardContent>
                {teachers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum professor vinculado ainda.</p>
                ) : (
                  <ul className="divide-y">
                    {teachers.map((t) => (
                      <li key={t.id} className="py-2 flex items-center justify-between">
                        <div>
                          <div className="font-medium text-sm">{t.name || "Professor(a)"}</div>
                          <div className="text-xs text-muted-foreground">{t.email}</div>
                        </div>
                        <Badge variant="secondary">Professor</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="analytics"><InstitutionAnalyticsTab /></TabsContent>
          
          <TabsContent value="hierarchy"><AcademicHierarchyTab /></TabsContent>
          <TabsContent value="import"><AdminImportStudentsV2 /></TabsContent>
          <TabsContent value="branding"><InstitutionBrandingTab /></TabsContent>
          <TabsContent value="disciplines"><InstitutionDisciplinesTab /></TabsContent>
          <TabsContent value="invites"><InvitationsPanel allowInstitution={false} /></TabsContent>
        </Tabs>
      ) : (
        <Card className="border-0" style={{ boxShadow: "var(--shadow-card)" }}>
          <CardHeader><CardTitle className="text-lg">Professores</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Nenhum professor vinculado ainda.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}