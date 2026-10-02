import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getInstitutionAnalytics } from "@/backend/analytics.functions";
import { closeSemester } from "@/backend/semester-control.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, BarChart3, Download, Lock, Users, Bot } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { InstitutionAnalyticsCharts } from "./InstitutionAnalyticsCharts";

export function InstitutionAnalyticsTab() {
  const { profile } = useAuth();
  const fetchAnalytics = useServerFn(getInstitutionAnalytics);
  const lockSemester = useServerFn(closeSemester);

  const { data, isLoading } = useQuery({
    queryKey: ["institution-analytics"],
    queryFn: () => fetchAnalytics(),
  });

  const handleCloseSemester = async () => {
    if (!profile?.institution_id) return;
    if (!confirm("Tem certeza que deseja fechar o semestre? Isso impedirá novas alterações de notas.")) return;
    
    try {
      await lockSemester({ data: { institution_id: profile.institution_id } });
      toast.success("Semestre consolidado com sucesso!");
    } catch (err: any) {
      toast.error("Erro ao fechar semestre: " + err.message);
    }
  };

  if (isLoading) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Média Global</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(data?.globalAverage ?? 0).toFixed(2).replace(".", ",")}</div>
            <p className="text-xs text-muted-foreground">Média acadêmica da instituição</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Aderência IA</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-2">
              <Bot className="h-5 w-5 text-teal-600" />
              {data?.aiInteractions ?? 0}
            </div>
            <p className="text-xs text-muted-foreground">Interações com Tutor Virtual</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-red-50/50">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-red-800">Alerta de Evasão</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-700 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              {data?.lowAttendanceCount ?? 0}
            </div>
            <p className="text-xs text-red-600">Alunos abaixo de 75% frequência</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Ações</CardTitle></CardHeader>
          <CardContent className="flex gap-2">
            <Button variant="outline" size="sm" className="w-full gap-2"><Download className="h-4 w-4" /> Exportar</Button>
            <Button variant="destructive" size="sm" className="w-full gap-2" onClick={handleCloseSemester}><Lock className="h-4 w-4" /> Consolidar</Button>
          </CardContent>
        </Card>
      </div>
      <InstitutionAnalyticsCharts data={data} />
      <Card className="border-0 shadow-sm">
        <CardHeader><CardTitle className="text-lg">Status de Diários & Frequências</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Disciplina</TableHead>
                <TableHead>Professor</TableHead>
                <TableHead>Alunos</TableHead>
                <TableHead>Sessões</TableHead>
                <TableHead>Preenchimento</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.consolidated.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell>{item.teacher}</TableCell>
                  <TableCell>{item.students_count}</TableCell>
                  <TableCell>{item.sessions_count}</TableCell>
                  <TableCell>{item.completion_rate.toFixed(1)}%</TableCell>
                  <TableCell>
                    {item.completion_rate > 90 ? (
                      <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Em dia</Badge>
                    ) : item.completion_rate > 50 ? (
                      <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Pendente</Badge>
                    ) : (
                      <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Atrasado</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
