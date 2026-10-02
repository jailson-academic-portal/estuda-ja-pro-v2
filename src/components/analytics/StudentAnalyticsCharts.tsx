import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, LineChart, Line, CartesianGrid } from "recharts";

export function StudentAnalyticsCharts({ data }: { data: any }) {
  const attendanceVal = data.attendance != null ? Number(data.attendance) : 0;
  const attendanceData = [
    { name: 'Presentes', value: attendanceVal },
    { name: 'Ausentes', value: Math.max(0, 100 - attendanceVal) },
  ];

  // Mapeia todas as colunas de avaliações configuradas no diário
  const gradesData = data.assessments?.map((a: any) => {
    const score = data.scores?.[a.id];
    const isFilled = score !== undefined && score !== null;
    
    return {
      name: a.name,
      nota: isFilled ? Number(score) : 0,
      media: data.passing_average != null ? Number(data.passing_average) : 7,
      subnotas: a.sub_items || [],
      isFilled
    };
  }) || [];

  // Verificamos se há pelo menos UMA nota lançada
  const hasRealData = gradesData.some((g: any) => g.isFilled);

  // Se NÃO houver dados reais, usamos o mock didático solicitado pelo usuário
  const chartData = hasRealData ? gradesData : [
    { name: 'Prova 1', nota: 5.0, media: 7.0 },
    { name: 'Estudo de Caso 1', nota: 7.0, media: 7.0 },
    { name: 'Prova 2', nota: 2.0, media: 7.0 },
    { name: 'Estudo de Caso 2', nota: 8.0, media: 7.0 },
    { name: 'Prova 3', nota: 5.0, media: 7.0 },
    { name: 'Estudo de Caso 3', nota: 6.0, media: 7.0 },
    { name: 'Trabalho Acadêmico', nota: 9.0, media: 7.0 },
    { name: 'Caso Clínico', nota: 5.0, media: 7.0 },
  ];

  const timelineData = data.timeline?.deliveries?.map((d: any, i: number) => ({
    name: `Ativ ${i + 1}`,
    entregas: i + 1,
    ia: data.timeline.ai?.filter((a: any) => new Date(a.at).getTime() <= new Date(d.at).getTime()).length || 0
  })) || [{ name: 'Início', entregas: 0, ia: 0 }];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 print:grid-cols-2">
      <Card className="border-0 shadow-sm bg-slate-900/50 backdrop-blur border-white/5 print:bg-white print:border-slate-200">
        <CardHeader className="pb-2"><CardTitle className="text-xs font-semibold text-white/60 uppercase tracking-wider print:text-slate-900">Frequência (%)</CardTitle></CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={attendanceData} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                <Cell fill="#10b981" />
                <Cell fill="#334155" />
              </Pie>
              <Tooltip 
                contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                itemStyle={{ color: '#fff' }}
                formatter={(val: any) => `${Number(val || 0).toFixed(1)}%`} 
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="text-center mt-[-40px]">
            <span className="text-2xl font-bold text-white print:text-slate-900">{attendanceVal.toFixed(1)}%</span>
          </div>
        </CardContent>
      </Card>
      
      <Card className="border-0 shadow-sm bg-slate-900/50 backdrop-blur border-white/5 print:bg-white print:border-slate-200 md:col-span-1 print:col-span-1">
        <CardHeader className="pb-2"><CardTitle className="text-xs font-semibold text-white/60 uppercase tracking-wider print:text-slate-900">Médias por Avaliação (Diário)</CardTitle></CardHeader>
        <CardContent className="h-64">
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
                     const assessment = chartData.find((g: any) => g.name === label);
                     return (
                       <div className="bg-slate-900 border border-white/10 p-3 rounded-lg shadow-xl backdrop-blur-md min-w-[180px]">
                         <p className="text-white font-bold text-sm mb-1">{label}</p>
                         <div className="flex items-baseline gap-2 mb-2">
                           <span className="text-blue-400 font-bold text-2xl">
                             {typeof payload[0].value === 'number' ? payload[0].value.toFixed(1) : payload[0].value}
                           </span>
                           <span className="text-white/40 text-xs">/ 10.0</span>
                         </div>
                         
                         {assessment?.subnotas?.length > 0 && (
                           <div className="mt-2 pt-2 border-t border-white/10 space-y-2">
                             <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider">Subnotas Cadastradas:</p>
                             <div className="grid grid-cols-1 gap-1.5">
                               {assessment.subnotas.map((sub: any, i: number) => (
                                 <div key={i} className="flex justify-between items-center text-[11px]">
                                   <span className="text-white/80">{sub.name}</span>
                                   <span className="text-blue-400/80 font-mono font-medium">Lançado</span>
                                 </div>
                               ))}
                             </div>
                           </div>
                         )}
                       </div>
                     );
                   }
                   return null;
                }}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
              <Bar dataKey="nota" fill="#0ea5e9" name="Nota" radius={[4, 4, 0, 0]} barSize={24} />
              <Bar dataKey="media" fill="rgba(255,255,255,0.15)" name="Meta" radius={[4, 4, 0, 0]} barSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm bg-slate-900/50 backdrop-blur border-white/5 print:bg-white print:border-slate-200">
        <CardHeader className="pb-2"><CardTitle className="text-xs font-semibold text-white/60 uppercase tracking-wider print:text-slate-900">Engajamento da Disciplina</CardTitle></CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={timelineData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="name" fontSize={10} stroke="rgba(255,255,255,0.4)" />
              <YAxis fontSize={10} stroke="rgba(255,255,255,0.4)" />
              <Tooltip 
                contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                itemStyle={{ color: '#fff' }}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
              <Line type="monotone" dataKey="entregas" stroke="#f59e0b" name="Entregas" strokeWidth={2} dot={{ r: 4, fill: '#f59e0b' }} />
              <Line type="monotone" dataKey="ia" stroke="#8b5cf6" name="IA Hub" strokeWidth={2} dot={{ r: 4, fill: '#8b5cf6' }} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
