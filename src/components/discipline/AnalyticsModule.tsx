import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDisciplineAnalytics, getMyAnalytics } from "@/backend/analytics.functions";
import { StudentAnalyticsCharts } from "../analytics/StudentAnalyticsCharts";
import { InstitutionAnalyticsCharts } from "../analytics/InstitutionAnalyticsCharts";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, TrendingUp, Users, User, Printer } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export function AnalyticsModule({ disciplineId, isTeacher }: { disciplineId: string; isTeacher: boolean }) {
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const fetchTeacherAnalytics = useServerFn(getDisciplineAnalytics);
  const fetchStudentAnalytics = useServerFn(getMyAnalytics);

  const { data, isLoading, error } = useQuery({
    queryKey: ["discipline-analytics", disciplineId, isTeacher],
    queryFn: () => isTeacher 
      ? fetchTeacherAnalytics({ data: { discipline_id: disciplineId } })
      : fetchStudentAnalytics({ data: { discipline_id: disciplineId } }),
    staleTime: 1000 * 10, // 10 segundos para dados ficarem obsoletos
    refetchOnWindowFocus: true,
  });

  if (isLoading) return <Skeleton className="h-[500px] w-full rounded-xl" />;

  if (error || !data) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Erro ao carregar analytics</AlertTitle>
        <AlertDescription>
          {error instanceof Error ? error.message : "Não foi possível carregar os dados estatísticos."}
        </AlertDescription>
      </Alert>
    );
  }

  const getStudentData = (studentId: string) => {
    const records = data.records.filter(r => r.student_id === studentId);
    const presences = records.filter(r => r.status === 'P' || r.status === 'J').length;
    const totalSessions = data.sessions.length;
    const studentEntries = data.entries.filter(e => e.student_id === studentId);

    return {
      attendance: totalSessions > 0 ? (presences / totalSessions) * 100 : 0,
      assessments: data.structure?.assessments || [],
      scores: studentEntries.reduce((acc: any, e) => ({ ...acc, [e.assessment_id]: e.score }), {}),
      passing_average: data.structure?.passing_average || 7,
      timeline: data.timeline // Simplificado: usa a timeline global filtrada ou geral
    };
  };

  if (!isTeacher) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-white/90 mb-2">
          <TrendingUp className="h-5 w-5" />
          <h2 className="text-xl font-bold tracking-tight">Meu Desempenho</h2>
        </div>
        <StudentAnalyticsCharts data={getStudentData(data.students[0]?.id || '')} />
      </div>
    );
  }

  return (
    <div className="space-y-6 print:space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2">
        <div className="flex items-center gap-2 text-white/90">
          <TrendingUp className="h-5 w-5" />
          <h2 className="text-xl font-bold tracking-tight">Analytics da Disciplina</h2>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => window.print()} 
          className="bg-white/5 border-white/10 text-white hover:bg-white/10 print:hidden"
        >
          <Printer className="h-4 w-4 mr-2" />
          [ 🖨️ Imprimir / Exportar Relatório ]
        </Button>
      </div>

      <div className="hidden print:block mb-8 border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-slate-900">Relatório Acadêmico de Desempenho</h1>
        <p className="text-slate-500">Disciplina: {data.discipline.name}</p>
        <p className="text-slate-500 text-sm">Gerado em: {new Date().toLocaleDateString('pt-BR')}</p>
      </div>

      <Tabs defaultValue="class" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2 bg-white/10 text-white">
          <TabsTrigger value="class" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Visão da Turma
          </TabsTrigger>
          <TabsTrigger value="student" className="flex items-center gap-2">
            <User className="h-4 w-4" />
            Desempenho por Aluno
          </TabsTrigger>
        </TabsList>

        <TabsContent value="class" className="mt-6 space-y-6">
          <InstitutionAnalyticsCharts data={{
            ...data,
            consolidated: data.students.map(s => {
              const studentRecords = data.records.filter(r => r.student_id === s.id);
              const presences = studentRecords.filter(r => r.status === 'P' || r.status === 'J').length;
              const attendanceRate = data.sessions.length > 0 ? (presences / data.sessions.length) * 100 : 0;
              return {
                id: s.id,
                name: s.name,
                completion_rate: attendanceRate
              };
            })
          }} />
          
          <div className="grid grid-cols-1 md:grid-cols-1 gap-6">
            <h3 className="text-sm font-semibold text-white/40 uppercase tracking-widest px-1">Consolidado da Turma</h3>
            <StudentAnalyticsCharts data={{
              attendance: data.records.length > 0 
                ? (data.records.filter(r => r.status === 'P' || r.status === 'J').length / data.records.length) * 100 
                : 0,
              assessments: data.structure?.assessments || [],
              scores: data.structure?.assessments?.reduce((acc: any, a: any) => {
                const assessmentEntries = data.entries.filter(e => e.assessment_id === a.id && e.score !== null);
                const avgScore = assessmentEntries.length > 0 
                  ? assessmentEntries.reduce((sum, e) => sum + Number(e.score), 0) / assessmentEntries.length
                  : 0;
                return { ...acc, [a.id]: avgScore };
              }, {}),
              passing_average: data.structure?.passing_average || 7,
              timeline: data.timeline,
              isClassView: true
            }} />
          </div>
        </TabsContent>

        <TabsContent value="student" className="mt-6 space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 bg-white/5 p-4 rounded-lg border border-white/10">
            <div className="space-y-1">
              <label className="text-xs font-medium text-white/60">Selecionar Aluno</label>
              <Select value={selectedStudentId || undefined} onValueChange={setSelectedStudentId}>
                <SelectTrigger className="w-[300px] bg-slate-950 border-white/20 text-white">
                  <SelectValue placeholder="Busque um aluno..." />
                </SelectTrigger>
                <SelectContent className="bg-slate-950 border-white/20 text-white">
                  {data.students.map((student) => (
                    <SelectItem key={student.id} value={student.id}>
                      {student.name} ({student.enrollment_number})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {selectedStudentId ? (
            <StudentAnalyticsCharts data={getStudentData(selectedStudentId)} />
          ) : (
            <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-white/10 rounded-xl text-white/40">
              <User className="h-12 w-12 mb-2 opacity-20" />
              <p>Selecione um aluno acima para visualizar o analytics individual</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}


