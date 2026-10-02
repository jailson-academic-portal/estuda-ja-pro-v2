import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Cell } from "recharts";

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-slate-900 border border-white/10 p-3 rounded-lg shadow-xl backdrop-blur-md">
        <p className="text-white font-bold text-sm mb-1">{label}</p>
        <p className="text-teal-400 font-bold text-lg mb-2">
          {typeof payload[0].value === 'number' ? payload[0].value.toFixed(1) : payload[0].value}
          {data.isPercentage ? '%' : ''}
        </p>
        <div className="space-y-1">
          <p className="text-white/60 text-[10px] uppercase font-bold border-t border-white/5 pt-1 mt-1">Status Interno:</p>
          <ul className="text-[11px] text-white/80 list-disc list-inside">
            {data.details.map((d: string, i: number) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }
  return null;
};

export function InstitutionAnalyticsCharts({ data }: { data: any }) {
  const moduleLabels = [
    { key: 'partial', name: 'Média Parcial', details: ['Prova 1', 'Prova 2', 'Estudo de Caso 1', 'Estudo de Caso 2'] },
    { key: 'final', name: 'Média Final', details: ['Prova 3', 'Estudo de Caso 3', 'Trabalho Acadêmico', 'Caso Clínico'] }
  ];

  const hasRealModuleData = data.module_stats && (data.module_stats.partial > 0 || data.module_stats.final > 0);

  const moduleData = hasRealModuleData ? moduleLabels.map(m => {
    let score = 0;
    if (m.key === 'partial') score = data.module_stats?.partial || 0;
    else if (m.key === 'final') score = data.module_stats?.final || 0;
    
    return {
      name: m.name,
      media: Math.min(100, score),
      details: m.details,
      isPercentage: true
    };
  }) : moduleLabels.map((m, i) => ({
    name: m.name,
    media: i === 0 ? 58 : 62, // Dados mockados didáticos para quando não houver notas
    details: m.details,
    isPercentage: true
  }));

  // Mapeia médias da turma por avaliação do diário (alinhado com a visão do aluno)
  const gradesData = data.structure?.assessments?.map((a: any) => {
    // Calcula média da turma para esta avaliação
    const scores = data.entries?.filter((e: any) => e.assessment_id === a.id && e.score !== null) || [];
    const avg = scores.length > 0 
      ? scores.reduce((acc: number, curr: any) => acc + Number(curr.score), 0) / scores.length
      : 0;

    return {
      name: a.name,
      nota: avg,
      media: data.structure?.passing_average || 7,
      details: a.sub_items?.map((s: any) => s.name) || [],
      isPercentage: false
    };
  }) || [];

  // Dados para o gráfico de consolidado (mesmo layout da visão do aluno)
  const chartData = gradesData.length > 0 ? gradesData : [
    { name: 'Prova 1', nota: 5.5, media: 7.0, details: [] },
    { name: 'Estudo de Caso 1', nota: 6.8, media: 7.0, details: [] },
    { name: 'Prova 2', nota: 4.2, media: 7.0, details: [] },
    { name: 'Estudo de Caso 2', nota: 7.5, media: 7.0, details: [] },
    { name: 'Caso Clínico', nota: 6.0, media: 7.0, details: [] },
  ];

  return (
    <div className="grid grid-cols-1 gap-6 print:gap-4">
      {/* Gráfico de Módulos */}
      <Card className="border-0 shadow-sm bg-slate-900/50 backdrop-blur border-white/5 print:bg-white print:border print:border-slate-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-semibold text-white/60 uppercase tracking-wider print:text-slate-900">
            Desempenho da Turma (Médias por Módulo Principal)
          </CardTitle>
        </CardHeader>
        <CardContent className="h-80 print:h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={moduleData} layout="vertical" margin={{ left: 40, right: 40, top: 10 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="rgba(255,255,255,0.1)" />
              <XAxis type="number" fontSize={10} domain={[0, 100]} stroke="rgba(255,255,255,0.4)" />
              <YAxis dataKey="name" type="category" fontSize={10} stroke="rgba(255,255,255,0.4)" width={70} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
              <Bar dataKey="media" name="% Médio" radius={[0, 4, 4, 0]} barSize={32}>
                {moduleData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#0f766e' : '#14b8a6'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Gráfico de Médias por Avaliação (Alinhado com visão do aluno) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-0 shadow-sm bg-slate-900/50 backdrop-blur border-white/5 md:col-span-2 print:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-white/60 uppercase tracking-wider">
              Médias por Avaliação (Diário - Turma)
            </CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="name" fontSize={9} stroke="rgba(255,255,255,0.4)" tick={{fill: 'rgba(255,255,255,0.6)'}} />
                <YAxis fontSize={10} domain={[0, 10]} stroke="rgba(255,255,255,0.4)" />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                  itemStyle={{ color: '#fff' }}
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-slate-900 border border-white/10 p-3 rounded-lg shadow-xl backdrop-blur-md">
                          <p className="text-white font-bold text-sm mb-1">{label}</p>
                          <div className="flex items-baseline gap-2">
                            <span className="text-blue-400 font-bold text-2xl">
                              {Number(payload[0].value).toFixed(1)}
                            </span>
                            <span className="text-white/40 text-xs">Média Turma</span>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="nota" fill="#0ea5e9" name="Média Turma" radius={[4, 4, 0, 0]} barSize={24} />
                <Bar dataKey="media" fill="rgba(255,255,255,0.15)" name="Meta" radius={[4, 4, 0, 0]} barSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Placeholder para manter o equilíbrio visual da grid de 3 colunas similar ao aluno */}
        <Card className="border-0 shadow-sm bg-slate-900/50 backdrop-blur border-white/5 flex items-center justify-center p-6 text-center">
          <div className="space-y-2">
            <p className="text-white/40 text-xs uppercase font-bold tracking-widest">Resumo Consolidado</p>
            <p className="text-white text-sm">Esta visão exibe a média aritmética de todos os alunos matriculados para cada componente de avaliação do diário.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
