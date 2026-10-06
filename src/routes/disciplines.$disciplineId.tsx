import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDisciplineById } from "@/backend/discipline-fetch.functions";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Loader2, ExternalLink, FileText } from "lucide-react";
import { ModuleGrid, MODULES, type ModuleKey } from "@/components/discipline/ModuleGrid";
import { ModulePlaceholder } from "@/components/discipline/ModulePlaceholder";

// Cada módulo é carregado sob demanda: a troca de tela é instantânea e o
// navegador não precisa baixar/avaliar todos os módulos de uma vez.
const StudentsModule = lazy(() =>
  import("@/components/discipline/StudentsModule").then((m) => ({ default: m.StudentsModule })),
);
const AttendanceModule = lazy(() =>
  import("@/components/discipline/AttendanceModule").then((m) => ({ default: m.AttendanceModule })),
);
const MaterialsModule = lazy(() =>
  import("@/components/discipline/MaterialsModule").then((m) => ({ default: m.MaterialsModule })),
);
const ExercisesModule = lazy(() =>
  import("@/components/discipline/ExercisesModule").then((m) => ({ default: m.ExercisesModule })),
);
const ActivitiesModule = lazy(() =>
  import("@/components/discipline/ActivitiesModule").then((m) => ({ default: m.ActivitiesModule })),
);
const WorksModule = lazy(() =>
  import("@/components/discipline/WorksModule").then((m) => ({ default: m.WorksModule })),
);
const GroupManagementModule = lazy(() =>
  import("@/components/discipline/GroupManagementModule").then((m) => ({
    default: m.GroupManagementModule,
  })),
);
const RubricsModule = lazy(() =>
  import("@/components/discipline/RubricsModule").then((m) => ({ default: m.RubricsModule })),
);
const GradesModule = lazy(() =>
  import("@/components/discipline/GradesModule").then((m) => ({ default: m.GradesModule })),
);
const CalendarModule = lazy(() =>
  import("@/components/discipline/CalendarModule").then((m) => ({ default: m.CalendarModule })),
);
const MyDiaryModule = lazy(() =>
  import("@/components/discipline/MyDiaryModule").then((m) => ({ default: m.MyDiaryModule })),
);
const ChatModule = lazy(() =>
  import("@/components/discipline/ChatModule").then((m) => ({ default: m.ChatModule })),
);
const AIAssistantModule = lazy(() =>
  import("@/components/discipline/AIAssistantModule").then((m) => ({ default: m.AIAssistantModule })),
);
const AssessmentsModule = lazy(() =>
  import("@/components/discipline/AssessmentsModule").then((m) => ({ default: m.AssessmentsModule })),
);
const OnlineExamsModule = lazy(() =>
  import("@/components/discipline/OnlineExamsModule").then((m) => ({
    default: m.OnlineExamsModule,
  })),
);
const StudentAssessmentsModule = lazy(() =>
  import("@/components/discipline/StudentAssessmentsModule").then((m) => ({
    default: m.StudentAssessmentsModule,
  })),
);
const SimulSaudeModule = lazy(() =>
  import("@/components/discipline/SimulSaudeModule").then((m) => ({ default: m.SimulSaudeModule })),
);
const DataTablesModule = lazy(() =>
  import("@/components/discipline/DataTablesModule").then((m) => ({ default: m.DataTablesModule })),
);
const VirtualLabModule = lazy(() =>
  import("@/components/discipline/VirtualLabModule").then((m) => ({ default: m.VirtualLabModule })),
);

const AnalyticsModule = lazy(() =>
  import("@/components/discipline/AnalyticsModule").then((m) => ({ default: m.AnalyticsModule })),
);


function ModuleSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <Skeleton className="h-9 w-64" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  );
}

interface Discipline {
  id: string;
  name: string;
  code: string | null;
  group_name: string | null;
  semester: string;
  year: number;
  color: string;
  syllabus_text: string | null;
  syllabus_file_url: string | null;
  teacher_id: string;
}

import { z } from "zod";

const disciplineSearchSchema = z.object({
  tab: z.string().optional(),
});

export const Route = createFileRoute("/disciplines/$disciplineId")({
  validateSearch: (search) => disciplineSearchSchema.parse(search),
  head: () => ({
    meta: [
      { title: "Disciplina — EstudaJá Pro" },
      {
        name: "description",
        content: "Workspace da disciplina com alunos, frequência, materiais e Assistente de IA.",
      },
    ],
  }),
  component: DisciplinePage,
});

function DisciplinePage() {
  const { disciplineId } = Route.useParams();
  const { user, profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch() as { tab?: string };
  const [active, setActive] = useState<ModuleKey | null>((search.tab as ModuleKey) || null);

  useEffect(() => {
    if (search.tab) {
      setActive(search.tab as ModuleKey);
    }
  }, [search.tab]);
  const [syllabusUrl, setSyllabusUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/login", search: { tab: "email" } });
  }, [user, authLoading, navigate]);

  const fetchDiscipline = useServerFn(getDisciplineById);

  // Cache de 5 minutos: voltar ao painel e reabrir a disciplina não refaz o fetch.
  const { data: discipline, isPending: loading, error } = useQuery({
    queryKey: ["discipline", disciplineId],
    staleTime: 1000 * 60 * 5,
    retry: 1,
    queryFn: async (): Promise<Discipline | null> => {
      console.log("[discipline-page] fetching discipline via server function:", disciplineId);
      const data = await fetchDiscipline({ data: disciplineId });
      return data as Discipline;
    },
  });

  useEffect(() => {
    let cancelled = false;
    setSyllabusUrl(null);
    const path = discipline?.syllabus_file_url;
    if (!path) return;
    (async () => {
      const { data: signed } = await supabase.storage
        .from("syllabi")
        .createSignedUrl(path, 60 * 60);
      if (!cancelled) setSyllabusUrl(signed?.signedUrl ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [discipline?.syllabus_file_url]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen academic-bg flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !discipline) {
    const is404 = error instanceof Error && error.message.includes("404");
    const is401 = error instanceof Error && error.message.includes("401");

    return (
      <div className="min-h-screen academic-bg">
        <AppHeader />
        <main className="mx-auto max-w-3xl px-4 py-12 text-center">
          <h1 className="text-2xl font-bold text-white">
            {is401 ? "Sessão expirada" : "Disciplina não encontrada"}
          </h1>
          <p className="text-white/80 mt-2">
            {is401 
              ? "Sua sessão expirou ou você não está autenticado corretamente. Por favor, faça login novamente."
              : "Ela pode ter sido removida, o link está incorreto ou você não tem permissão para acessá-la."}
          </p>
          <div className="flex gap-4 justify-center mt-6">
            <Button asChild>
              <Link to="/">Voltar ao painel</Link>
            </Button>
            {is401 && (
              <Button variant="outline" onClick={() => navigate({ to: "/login", search: { tab: "email" } })}>
                Ir para Login
              </Button>
            )}
          </div>
        </main>
      </div>
    );
  }

  const isTeacher = profile?.profile_type === "teacher" || profile?.profile_type === "admin" || profile?.profile_type === "institution";
  const headerColor = `var(--color-card-${discipline.color})`;
  const activeModule = active ? MODULES.find((m) => m.key === active) : null;

  return (
    <div className="min-h-screen academic-bg">
      <AppHeader />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <Button variant="ghost" size="sm" asChild className="text-white hover:bg-white/15 hover:text-white">
          <Link to="/">
            <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
          </Link>
        </Button>

        <div
          className="rounded-2xl text-white p-5 sm:p-6"
          style={{ backgroundColor: headerColor, boxShadow: "var(--shadow-card)" }}
        >
          <div className="text-xs uppercase tracking-wide opacity-90 font-mono">
            {discipline.code}
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold mt-1">{discipline.name}</h1>
          <div className="text-sm opacity-90 mt-1">
            {discipline.semester}º semestre · {discipline.year}
            {discipline.group_name ? ` · Turma ${discipline.group_name}` : ""}
          </div>
          {(discipline.syllabus_text || syllabusUrl) && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer opacity-90 hover:opacity-100">Ver ementa</summary>
              <div className="mt-2 bg-white/10 rounded p-3 space-y-2">
                {discipline.syllabus_text && (
                  <p className="whitespace-pre-wrap">{discipline.syllabus_text}</p>
                )}
                {syllabusUrl && (
                  <a
                    href={syllabusUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 underline"
                  >
                    Abrir arquivo da ementa <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </details>
          )}
        </div>

        {!active ? (
          <div className="rounded-2xl bg-white/90 backdrop-blur-md shadow-xl border border-white/40 p-4 sm:p-6 md:p-8">
            <ModuleGrid onSelect={setActive} role={isTeacher ? "teacher" : "student"} accentColor={headerColor} disciplineId={discipline.id} />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActive(null)}
                className="text-white hover:bg-white/15 hover:text-white"
              >
                <ArrowLeft className="h-4 w-4 mr-2" /> Todos os módulos
              </Button>
              <div className="text-sm font-medium text-white">{activeModule?.label}</div>
            </div>
            <Suspense fallback={<ModuleSkeleton />}>
            {active === "students" && isTeacher && <StudentsModule disciplineId={discipline.id} />}
            {active === "students" && !isTeacher && (
              <ModulePlaceholder
                title="Alunos"
                description="Apenas o(a) professor(a) da disciplina pode gerenciar a lista de alunos."
              />
            )}
            {active === "attendance" && (
              <AttendanceModule disciplineId={discipline.id} isTeacher={isTeacher} />
            )}
            {active === "materials" && (
              <MaterialsModule disciplineId={discipline.id} isTeacher={isTeacher} />
            )}
            {active === "exercises" && (
              <ExercisesModule disciplineId={discipline.id} isTeacher={isTeacher} />
            )}
            {active === "activities" && (
              <ActivitiesModule disciplineId={discipline.id} isTeacher={isTeacher} />
            )}
            {active === "academic_works" && (
              <WorksModule disciplineId={discipline.id} isTeacher={isTeacher} />
            )}
            {active === "group_management" && isTeacher && (
              <GroupManagementModule disciplineId={discipline.id} isTeacher={isTeacher} />
            )}
            {active === "group_management" && !isTeacher && (
              <ModulePlaceholder
                title="Gestão de Grupos"
                description="A gestão de grupos está disponível somente para professores."
              />
            )}
            {active === "rubrics" && isTeacher && <RubricsModule />}
            {active === "rubrics" && !isTeacher && (
              <ModulePlaceholder
                title="Rubricas"
                description="As rubricas ficam disponíveis para alunos dentro de cada atividade ou trabalho publicado."
              />
            )}
            {active === "grades" && (
              <GradesModule disciplineId={discipline.id} isTeacher={isTeacher} />
            )}
            {active === "calendar" && (
              <CalendarModule
                disciplineId={discipline.id}
                isTeacher={isTeacher}
                onOpenClinicalCases={() => setActive("simulsaude")}
              />
            )}
            {active === "chat" && (
              <ChatModule
                disciplineId={discipline.id}
                isTeacher={isTeacher}
                teacherId={discipline.teacher_id}
              />
            )}
            {active === "ai" && <AIAssistantModule disciplineId={discipline.id} />}
            {active === "diary" && <MyDiaryModule disciplineId={discipline.id} />}
            {active === "assessments" && isTeacher && (
              <AssessmentsModule disciplineId={discipline.id} />
            )}
            {active === "assessments" && !isTeacher && (
              <StudentAssessmentsModule disciplineId={discipline.id} />
            )}
            {active === "online_exams" && isTeacher && (
              <OnlineExamsModule disciplineId={discipline.id} />
            )}
            {active === "virtual_lab" && (
              <VirtualLabModule disciplineId={discipline.id} isTeacher={isTeacher} />
            )}
            {active === "analytics" && (
              <AnalyticsModule disciplineId={discipline.id} isTeacher={isTeacher} />
            )}
            {active === "simulsaude" && (
              <SimulSaudeModule 
                disciplineId={discipline.id} 
                isTeacher={isTeacher} 
                teacherId={discipline.teacher_id}
              />
            )}

            {active === "data_tables" && (
              <DataTablesModule
                disciplineId={discipline.id}
                isTeacher={isTeacher}
                studentId={user?.id ?? null}
              />
            )}
            {![
              "students",
              "attendance",
              "materials",
              "exercises",
              "activities",
              "academic_works",
              "group_management",
              "rubrics",
              "grades",
              "calendar",
              "ai",
              "chat",
              "diary",
              "assessments",
              "virtual_lab",
              "data_tables",
              "simulsaude",
              "analytics",

              
            ].includes(active) &&

              activeModule && (
                <ModulePlaceholder
                  title={activeModule.label}
                  description={activeModule.description}
                />
              )}
            </Suspense>
          </div>
        )}
      </main>
    </div>
  );
}
