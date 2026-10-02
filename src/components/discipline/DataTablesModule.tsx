import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import { getDisciplineAnalytics, getMyAnalytics, auditGradeChanges } from "@/backend/analytics.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, ArrowLeft, BarChart3, Bot, CheckCircle2, Download, Percent, Users, History } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";

type Analytics = Awaited<ReturnType<typeof getDisciplineAnalytics>>;
type Assessment = Analytics["structure"] extends infer S
  ? S extends { assessments: (infer A)[] }
    ? A
    : never
  : never;

export const fmt = (n: number | null | undefined) =>
  n == null || Number.isNaN(Number(n)) ? "—" : Number(n).toFixed(2).replace(".", ",");
const pct = (n: number | null | undefined) =>
  n == null || Number.isNaN(Number(n)) ? "—" : `${Number(n).toFixed(1).replace(".", ",")}%`;
const clr = (n: number | null | undefined) => {
  if (n == null || Number.isNaN(Number(n))) return "";
  return n < 7 ? "text-red-600 font-semibold" : "text-blue-600 font-semibold";
};

export function fmtValue(n: number | null | undefined) {
  return n == null || Number.isNaN(Number(n)) ? "—" : Number(n).toFixed(2).replace(".", ",");
}

function subKey(a: string, s: string) {
  return `${a}#${s}`;
}

type Bucket = { key: string; label: string; start: number; end: number };

function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

/** Constrói os períodos (semanas/meses) a partir das datas da disciplina. */
function buildBuckets(data: Analytics, mode: "week" | "month"): Bucket[] {
  const stamps: number[] = [
    ...data.timeline.grades.map((g) => new Date(g.at).getTime()),
    ...data.timeline.deliveries.map((g) => new Date(g.at).getTime()),
    ...data.timeline.ai.map((g) => new Date(g.at).getTime()),
    ...data.sessions.map((s) => new Date(`${s.session_date}T12:00:00`).getTime()),
  ].filter((n) => Number.isFinite(n));

  const startRaw = data.discipline.start_date
    ? new Date(`${data.discipline.start_date}T00:00:00`)
    : stamps.length
      ? new Date(Math.min(...stamps))
      : null;
  const endRaw = data.discipline.end_date
    ? new Date(`${data.discipline.end_date}T23:59:59`)
    : stamps.length
      ? new Date(Math.max(...stamps))
      : null;
  if (!startRaw || !endRaw || endRaw.getTime() < startRaw.getTime()) return [];

  const buckets: Bucket[] = [];
  if (mode === "week") {
    let cursor = startOfWeek(startRaw);
    let i = 1;
    while (cursor.getTime() <= endRaw.getTime() && buckets.length < 60) {
      const next = new Date(cursor);
      next.setDate(next.getDate() + 7);
      buckets.push({
        key: cursor.toISOString(),
        label: `S${i}`,
        start: cursor.getTime(),
        end: next.getTime(),
      });
      cursor = next;
      i += 1;
    }
  } else {
    let cursor = new Date(startRaw.getFullYear(), startRaw.getMonth(), 1);
    while (cursor.getTime() <= endRaw.getTime() && buckets.length < 36) {
      const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      buckets.push({
        key: cursor.toISOString(),
        label: cursor.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
        start: cursor.getTime(),
        end: next.getTime(),
      });
      cursor = next;
    }
  }
  return buckets;
}

type Series = { name: string; valor: number | null }[];

/** Séries temporais dos 4 KPIs distribuídas nos períodos selecionados. */
function buildKpiSeries(data: Analytics, buckets: Bucket[]) {
  const inBucket = (at: string, b: Bucket) => {
    const t = new Date(at).getTime();
    return t >= b.start && t < b.end;
  };

  const average: Series = buckets.map((b) => {
    const vals = data.timeline.grades.filter((g) => inBucket(g.at, b)).map((g) => g.score);
    return { name: b.label, valor: vals.length ? vals.reduce((s, n) => s + n, 0) / vals.length : null };
  });

  const totalStudents = Math.max(data.students.length, 1);
  let cumPresent = 0;
  let cumSlots = 0;
  const attendance: Series = buckets.map((b) => {
    const sessions = data.sessions.filter((s) => inBucket(`${s.session_date}T12:00:00`, b));
    for (const s of sessions) {
      cumSlots += totalStudents;
      for (const r of data.records.filter((x) => x.session_id === s.id)) {
        if (r.status === "present" || (r.status === "justified" && data.settings.justified_counts_as_presence)) {
          cumPresent += 1;
        }
      }
    }
    return { name: b.label, valor: cumSlots ? (cumPresent / cumSlots) * 100 : null };
  });

  const delivery: Series = buckets.map((b) => {
    const subs = data.timeline.deliveries.filter((d) => inBucket(d.at, b));
    return {
      name: b.label,
      valor: subs.length ? (subs.filter((s) => s.on_time).length / subs.length) * 100 : null,
    };
  });

  const ai: Series = buckets.map((b) => ({
    name: b.label,
    valor: data.timeline.ai.filter((a) => inBucket(a.at, b)).length,
  }));

  return { average, attendance, delivery, ai };
}

function KpiCard({
  label,
  value,
  icon: Icon,
  tone,
  series,
  format,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone: "teal" | "green" | "purple" | "orange";
  series: Series;
  format: (n: number) => string;
}) {
  const toneVar: Record<string, string> = {
    teal: "var(--color-card-teal)",
    green: "var(--color-card-green)",
    purple: "var(--color-card-purple)",
    orange: "var(--color-card-orange)",
  };
  const hasData = series.some((p) => p.valor != null);
  return (
    <Card className="overflow-hidden border-0" style={{ boxShadow: "var(--shadow-card)" }}>
      <CardContent className="p-5 space-y-2">
        <div className="flex items-center gap-4">
          <div
            className="h-12 w-12 rounded-xl flex items-center justify-center text-white shrink-0"
            style={{ backgroundColor: toneVar[tone] }}
          >
            <Icon className="h-6 w-6" />
          </div>
          <div>
            <div className="text-2xl font-bold leading-tight">{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        </div>
        <div className="h-16 -mx-1">
          {hasData ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <XAxis dataKey="name" hide />
                <YAxis hide domain={["auto", "auto"]} />
                <Tooltip
                  formatter={(v) => format(Number(v))}
                  labelFormatter={(l) => `Período ${l}`}
                  contentStyle={{ fontSize: 12 }}
                />
                <Area
                  type="monotone"
                  dataKey="valor"
                  connectNulls
                  stroke={toneVar[tone]}
                  fill={toneVar[tone]}
                  fillOpacity={0.18}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-[11px] text-muted-foreground">
              Sem dados no período
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function effectiveScore(entries: Analytics["entries"], studentId: string, a: Assessment): number | null {
  const asmt = a as { id: string; sub_items?: { id: string; name: string }[] };
  if (asmt.sub_items?.length) {
    const scores = asmt.sub_items
      .map((s) => entries.find((e) => e.student_id === studentId && e.assessment_id === subKey(asmt.id, s.id))?.score)
      .filter((v): v is number => v != null)
      .map(Number);
    if (!scores.length) return null;
    return scores.reduce((s, n) => s + n, 0) / scores.length;
  }
  const e = entries.find((x) => x.student_id === studentId && x.assessment_id === asmt.id);
  return e?.score ?? null;
}

function averageOf(data: Analytics, studentId: string): number | null {
  const assessments = data.structure?.assessments ?? [];
  let sum = 0;
  let weights = 0;
  for (const a of assessments) {
    const s = effectiveScore(data.entries, studentId, a);
    if (s == null) continue;
    const w = Number((a as { weight?: number }).weight ?? 0) || 0;
    sum += s * w;
    weights += w;
  }
  return weights > 0 ? sum / weights : null;
}

function attendanceOf(data: Analytics, studentId: string): number | null {
  if (!data.sessions.length) return null;
  let present = 0;
  for (const s of data.sessions) {
    const r = data.records.find((x) => x.session_id === s.id && x.student_id === studentId);
    if (!r) continue;
    if (r.status === "present") present += 1;
    else if (r.status === "justified" && data.settings.justified_counts_as_presence) present += 1;
  }
  return (present / data.sessions.length) * 100;
}

function deliveriesOf(data: Analytics, studentId: string): number {
  return data.deliveries.find((d) => d.student_id === studentId)?.count ?? 0;
}

function engagement(data: Analytics, studentId: string): { label: string; tone: string } {
  const att = attendanceOf(data, studentId) ?? 0;
  const min = data.settings.min_attendance_percent;
  const delivered = data.expected_deliveries
    ? (deliveriesOf(data, studentId) / data.expected_deliveries) * 100
    : 100;
  const score = (att + delivered) / 2;
  if (att < min || score < 50) return { label: "Atenção", tone: "bg-red-100 text-red-800 border-red-200" };
  if (score < 75) return { label: "Regular", tone: "bg-amber-100 text-amber-800 border-amber-200" };
  return { label: "Engajado", tone: "bg-green-100 text-green-800 border-green-200" };
}

/** Ficha individual com gráficos de evolução acadêmica e assiduidade. */
function StudentKpis({ data, studentId }: { data: Analytics; studentId: string }) {
  const att = attendanceOf(data, studentId) ?? 0;
  const avg = averageOf(data, studentId) ?? 0;
  const delivered = deliveriesOf(data, studentId);
  const totalExpected = data.expected_deliveries;
  const deliveryPct = totalExpected ? (delivered / totalExpected) * 100 : 0;
  const minPct = data.settings.min_attendance_percent;
  const belowMin = att < minPct;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground uppercase">Média Parcial</CardTitle></CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${clr(avg)}`}>{fmt(avg)}</div>
          <p className="text-[10px] text-muted-foreground mt-1">Sua nota atual vs Média de aprovação {fmt(data.structure?.passing_average)}</p>
        </CardContent>
      </Card>
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground uppercase">Frequência</CardTitle></CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${belowMin ? "text-red-600" : "text-teal-600"}`}>{pct(att)}</div>
          <p className="text-[10px] text-muted-foreground mt-1">Mínimo exigido: {pct(minPct)}</p>
        </CardContent>
      </Card>
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground uppercase">Atividades</CardTitle></CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-slate-700">{delivered}/{totalExpected}</div>
          <p className="text-[10px] text-muted-foreground mt-1">{pct(deliveryPct)} das entregas concluídas</p>
        </CardContent>
      </Card>
    </div>
  );
}

function StudentSheet({ data, studentId }: { data: Analytics; studentId: string }) {
  const student = data.students.find((s) => s.id === studentId);
  const passing = data.structure?.passing_average ?? 7;
  const minPct = data.settings.min_attendance_percent;

  const gradeSeries = (data.structure?.assessments ?? []).map((a) => {
    const studentScore = effectiveScore(data.entries, studentId, a);
    const validScores = data.entries.filter(e => e.assessment_id === (a as any).id && e.score != null).map(e => e.score as number);
    const classAvg = validScores.length ? validScores.reduce((s, n) => s + n, 0) / validScores.length : null;
    
    return {
      name: String((a as { name: string }).name),
      nota: studentScore,
      media_turma: classAvg
    };
  });

  let acc = 0;
  const attSeries = data.sessions.map((s, i) => {
    const r = data.records.find((x) => x.session_id === s.id && x.student_id === studentId);
    const ok = r?.status === "present" || (r?.status === "justified" && data.settings.justified_counts_as_presence);
    if (ok) acc += 1;
    return {
      name: new Date(`${s.session_date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
      frequencia: Number((((acc / (i + 1)) * 100)).toFixed(1)),
    };
  });

  const finalAtt = attendanceOf(data, studentId);
  const belowMin = finalAtt != null && finalAtt < minPct;

  return (
    <div className="space-y-4">
      <Card className="border-0" style={{ boxShadow: "var(--shadow-card)" }}>
        <CardHeader className="pb-2"><CardTitle className="text-lg">{student?.name ?? "Aluno"}</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-4 text-sm">
          <div><div className="text-xs text-muted-foreground">Matrícula</div><div className="font-mono">{student?.enrollment_number ?? "—"}</div></div>
          <div><div className="text-xs text-muted-foreground">E-mail</div><div className="truncate">{student?.email ?? "—"}</div></div>
          <div><div className="text-xs text-muted-foreground">Média atual</div><div className={`font-semibold ${clr(averageOf(data, studentId))}`}>{fmt(averageOf(data, studentId))}</div></div>
          <div>
            <div className="text-xs text-muted-foreground">Frequência</div>
            <div className={`font-semibold ${belowMin ? "text-destructive" : ""}`}>{pct(finalAtt)}</div>
            <div className="w-full bg-slate-100 h-1.5 rounded-full mt-1 overflow-hidden">
              <div 
                className={`h-full ${belowMin ? "bg-red-500" : "bg-teal-500"}`} 
                style={{ width: `${Math.min(finalAtt ?? 0, 100)}%` }} 
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0" style={{ boxShadow: "var(--shadow-card)" }}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Evolução acadêmica (Individual vs Turma)</CardTitle>
        </CardHeader>
        <CardContent>
          {gradeSeries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Configure a composição de notas no módulo Notas.</p>
          ) : (
            <>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={gradeSeries} margin={{ top: 8, right: 16, bottom: 8, left: -16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={60} />
                    <YAxis domain={[0, data.structure?.grade_scale ?? 10]} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => fmt(Number(v))} />
                    <ReferenceLine
                      y={passing}
                      stroke="hsl(var(--destructive))"
                      strokeDasharray="4 4"
                      label={{ value: `Aprovação ${fmt(passing)}`, position: "insideTopRight", fontSize: 11 }}
                    />
                    <Line type="monotone" dataKey="nota" name="Sua nota" stroke="hsl(var(--primary))" strokeWidth={3} connectNulls dot={{ r: 4 }} />
                    <Line type="monotone" dataKey="media_turma" name="Média da turma" stroke="hsl(var(--muted-foreground))" strokeWidth={2} strokeDasharray="5 5" connectNulls dot={{ r: 3 }} />
                    <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: 11 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {gradeSeries.length > 0 && (
                <div className="mt-4 p-3 bg-teal-50 rounded-lg border border-teal-100">
                  <div className="flex items-center gap-2 text-teal-800 font-medium text-sm mb-1">
                    <Bot className="h-4 w-4" /> Diagnóstico do Tutor IA
                  </div>
                  <p className="text-xs text-teal-700 leading-relaxed">
                    {gradeSeries.some(s => s.nota != null && s.nota < (data.structure?.passing_average ?? 7)) 
                      ? "Identificamos tópicos com desempenho abaixo da média. Recomendo revisar os materiais de apoio e realizar novos exercícios de fixação."
                      : "Excelente desempenho! Você está mantendo uma média consistente acima da meta da turma. Continue explorando os casos avançados."}
                  </p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-0" style={{ boxShadow: "var(--shadow-card)" }}>
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Frequência e assiduidade</CardTitle>
          {belowMin && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3.5 w-3.5" /> Abaixo de {pct(minPct)}
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          {attSeries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma chamada registrada ainda.</p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={attSeries} margin={{ top: 8, right: 16, bottom: 8, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => pct(Number(v))} />
                  <ReferenceLine y={minPct} stroke="hsl(var(--destructive))" strokeDasharray="4 4" />
                  <Area type="monotone" dataKey="frequencia" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.2)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function DataTablesModule({
  disciplineId,
  isTeacher,
  studentId,
}: {
  disciplineId: string;
  isTeacher: boolean;
  studentId?: string | null;
}) {
  const fetchTeacher = useServerFn(getDisciplineAnalytics);
  const fetchStudent = useServerFn(getMyAnalytics);
  const [selected, setSelected] = useState<string | null>(null);
  const [period, setPeriod] = useState<"week" | "month">("week");

  const { data, isPending, error } = useQuery({
    queryKey: ["analytics", disciplineId, isTeacher],
    staleTime: 1000 * 60,
    queryFn: async () =>
      isTeacher
        ? await fetchTeacher({ data: { discipline_id: disciplineId } })
        : await fetchStudent({ data: { discipline_id: disciplineId } }),
  });

  const kpis = useMemo(() => {
    if (!data) return null;
    const avgs = data.students.map((s) => averageOf(data, s.id)).filter((v): v is number => v != null);
    const atts = data.students.map((s) => attendanceOf(data, s.id)).filter((v): v is number => v != null);
    const totalExpected = data.expected_deliveries * data.students.length;
    const totalDelivered = data.deliveries.reduce((s, d) => s + d.count, 0);
    return {
      average: avgs.length ? avgs.reduce((s, n) => s + n, 0) / avgs.length : null,
      attendance: atts.length ? atts.reduce((s, n) => s + n, 0) / atts.length : null,
      delivery: totalExpected ? (totalDelivered / totalExpected) * 100 : null,
      ai: data.ai_interactions,
    };
  }, [data]);

  const buckets = useMemo(() => (data ? buildBuckets(data, period) : []), [data, period]);
  const kpiSeries = useMemo(() => (data ? buildKpiSeries(data, buckets) : null), [data, buckets]);

  if (isPending) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full bg-white/30" />)}
        </div>
        <Skeleton className="h-64 w-full bg-white/20" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-0"><CardContent className="py-8 text-center text-sm text-muted-foreground">
        {error instanceof Error ? error.message : "Não foi possível carregar os dados."}
      </CardContent></Card>
    );
  }

  // Visão do aluno: apenas o painel individual de desempenho.
  if (!isTeacher) {
    const me = studentId ?? data.students[0]?.id ?? null;
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-white">Painel individual de desempenho</h2>
          <p className="text-sm text-white/90">Seu histórico de notas, frequência e entregas nesta disciplina.</p>
        </div>
        {me ? (
          <div className="space-y-6">
            <StudentKpis data={data} studentId={me} />
            <StudentSheet data={data} studentId={me} />
          </div>
        ) : (
          <Card className="border-0"><CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhum dado disponível ainda.
          </CardContent></Card>
        )}
      </div>
    );
  }

  const exportPdf = async () => {
    const element = document.getElementById("analytics-overview-report");
    if (!element) return;

    // Atraso curto para garantir que os gráficos Recharts renderizem completamente se houver animações
    await new Promise((resolve) => setTimeout(resolve, 300));

    const html2pdf = (await import("html2pdf.js")).default;
    const opt: any = {
      margin: [10, 10, 10, 10],
      filename: `relatorio-${data.discipline.name || "disciplina"}.pdf`,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { 
        scale: 2, 
        useCORS: true, 
        letterRendering: true,
        logging: false 
      },
      jsPDF: { unit: "mm", format: "a4", orientation: "landscape" },
      pagebreak: { mode: ["avoid-all", "css", "legacy"] }
    };

    html2pdf().from(element).set(opt).save();
  };

  const exportCsv = () => {
    const header = ["Matrícula", "Aluno", "Frequência (%)", "Média", "Entregas", "Engajamento"];
    const rows = data.students.map((s) => [
      s.enrollment_number ?? "",
      s.name,
      attendanceOf(data, s.id)?.toFixed(1).replace(".", ",") ?? "",
      averageOf(data, s.id)?.toFixed(2).replace(".", ",") ?? "",
      `${deliveriesOf(data, s.id)}/${data.expected_deliveries}`,
      engagement(data, s.id).label,
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";"))
      .join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "relatorio-turma.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-white">Tabelas de Dados</h2>
        <p className="text-sm text-white/90">Central analítica da disciplina: notas, frequência, entregas e uso de IA.</p>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview">Visão geral da turma</TabsTrigger>
          <TabsTrigger value="student">Ficha individual</TabsTrigger>
          <TabsTrigger value="audit">Log de Auditoria</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div id="analytics-overview-report" className="space-y-4 p-1">
            {/* Cabeçalho do Relatório (visível apenas no PDF/Print se necessário, ou sempre para contexto) */}
            <div className="bg-white rounded-lg p-6 border border-slate-200 shadow-sm space-y-2 mb-4 hidden pdf-only">
              <div className="flex justify-between items-start">
                <div>
                  <h1 className="text-2xl font-bold text-slate-900">{data.discipline.name || "Relatório de Disciplina"}</h1>
                  <p className="text-slate-500 text-sm">Painel de Analítico da Turma · Semestre Atual</p>
                </div>
                <div className="text-right text-xs text-slate-400">
                  Gerado em: {new Date().toLocaleString("pt-BR")}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 pt-2 text-sm border-t border-slate-100">
                <div><span className="text-slate-400">Professor:</span> <span className="text-slate-700 font-medium">{isTeacher ? "Docente Logado" : "Visualização Analítica"}</span></div>
                <div className="text-right"><span className="text-slate-400">Total de Alunos:</span> <span className="text-slate-700 font-medium">{data.students.length}</span></div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 no-pdf">
              <p className="text-xs text-white/85">
                {buckets.length
                  ? `Linha do tempo do período da disciplina · ${buckets.length} ${period === "week" ? "semanas" : "meses"}`
                  : "Defina data inicial e final da disciplina para ver a evolução temporal."}
              </p>
              <ToggleGroup
                type="single"
                value={period}
                onValueChange={(v) => v && setPeriod(v as "week" | "month")}
                className="bg-white/80 rounded-md p-0.5"
              >
                <ToggleGroupItem value="week" className="text-xs px-3 h-8">Ver por semanas</ToggleGroupItem>
                <ToggleGroupItem value="month" className="text-xs px-3 h-8">Ver por meses</ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard label="Média geral da turma" value={fmt(kpis?.average)} icon={BarChart3} tone="orange" series={kpiSeries?.average ?? []} format={(n) => fmt(n)} />
              <KpiCard label="Frequência média" value={pct(kpis?.attendance)} icon={Percent} tone="teal" series={kpiSeries?.attendance ?? []} format={(n) => pct(n)} />
              <KpiCard label="Taxa de entrega no prazo" value={pct(kpis?.delivery)} icon={CheckCircle2} tone="green" series={kpiSeries?.delivery ?? []} format={(n) => pct(n)} />
              <KpiCard label="Interações com IA" value={kpis?.ai ?? 0} icon={Bot} tone="purple" series={kpiSeries?.ai ?? []} format={(n) => String(n)} />
            </div>

            <Card className="border-0" style={{ boxShadow: "var(--shadow-card)" }}>
              <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4" /> Alunos matriculados ({data.students.length})
                </CardTitle>
                <div className="flex gap-2 no-pdf">
                  <Button size="sm" variant="outline" onClick={exportCsv} disabled={!data.students.length} className="hidden sm:flex">
                    <Download className="h-4 w-4 mr-1" /> CSV
                  </Button>
                  <Button size="sm" variant="default" onClick={exportPdf} disabled={!data.students.length} className="bg-teal-600 hover:bg-teal-700">
                    <Download className="h-4 w-4 mr-1" /> Exportar relatório
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {data.students.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">Nenhum aluno matriculado.</p>
                ) : (
                  <div className="overflow-x-auto border rounded-md">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="py-2 px-3 text-left">Aluno</th>
                          <th className="px-2 text-center">Frequência</th>
                          <th className="px-2 text-center">Média</th>
                          <th className="px-2 text-center">Entregas</th>
                          <th className="px-2 text-center">Engajamento</th>
                          <th className="px-2 no-pdf" />
                        </tr>
                      </thead>
                      <tbody>
                        {[...data.students]
                          .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
                          .map((s) => {
                            const att = attendanceOf(data, s.id);
                            const eng = engagement(data, s.id);
                            const below = att != null && att < data.settings.min_attendance_percent;
                            return (
                              <tr key={s.id} className="border-t">
                                <td className="py-1.5 px-3">
                                  <div className="font-medium text-slate-800">{s.name}</div>
                                  <div className="text-xs text-muted-foreground font-mono">{s.enrollment_number ?? "—"}</div>
                                </td>
                                <td className={`px-2 text-center ${below ? "text-destructive font-semibold" : ""}`}>{pct(att)}</td>
                                <td className={`px-2 text-center ${clr(averageOf(data, s.id))}`}>{fmt(averageOf(data, s.id))}</td>
                                <td className="px-2 text-center">{deliveriesOf(data, s.id)}/{data.expected_deliveries}</td>
                                <td className="px-2 text-center">
                                  <Badge variant="outline" className={eng.tone}>{eng.label}</Badge>
                                </td>
                                <td className="px-2 text-center no-pdf">
                                  <Button size="sm" variant="ghost" onClick={() => setSelected(s.id)}>Ver ficha</Button>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="student" className="space-y-4">
          {!selected ? (
            <Card className="border-0" style={{ boxShadow: "var(--shadow-card)" }}>
              <CardContent className="py-6 space-y-2">
                <p className="text-sm text-muted-foreground">Selecione um aluno para ver a ficha individual:</p>
                <div className="flex flex-wrap gap-2">
                  {[...data.students]
                    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
                    .map((s) => (
                      <Button key={s.id} size="sm" variant="outline" onClick={() => setSelected(s.id)}>
                        {s.name}
                      </Button>
                    ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => setSelected(null)} className="text-white hover:bg-white/15 hover:text-white">
                <ArrowLeft className="h-4 w-4 mr-1" /> Trocar aluno
              </Button>
              <StudentSheet data={data} studentId={selected} />
            </>
          )}
        </TabsContent>
        <TabsContent value="audit" className="space-y-4">
          <AuditLogTab disciplineId={disciplineId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AuditLogTab({ disciplineId }: { disciplineId: string }) {
  const fetchAudit = useServerFn(auditGradeChanges);
  const { data, isLoading } = useQuery({
    queryKey: ["audit-log", disciplineId],
    queryFn: () => fetchAudit({ data: { discipline_id: disciplineId } }),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <History className="h-5 w-5" /> Histórico de Alterações de Notas
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!data?.length ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Nenhum registro de alteração encontrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 px-3 text-left">Data/Hora</th>
                  <th className="px-3 text-left">Aluno ID</th>
                  <th className="px-3 text-left">Avaliação</th>
                  <th className="px-3 text-right">Novo Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map((log, i) => (
                  <tr key={i} className="hover:bg-slate-50/50">
                    <td className="py-2 px-3 text-xs text-slate-600">
                      {new Date(log.updated_at).toLocaleString("pt-BR")}
                    </td>
                    <td className="px-3 text-xs font-mono text-slate-500">{log.student_id.split("-")[0]}...</td>
                    <td className="px-3">{log.assessment_id}</td>
                    <td className="px-3 text-right font-semibold text-teal-700">
                      {fmt(log.score)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
