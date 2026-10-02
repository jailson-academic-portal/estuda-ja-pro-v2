import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Database, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  Trash2, 
  Sparkles,
  ChevronRight,
  Eye,
  FileText,
  Clock,
  Pencil,
  ArrowLeft,
  Users,
  AlertCircle,
  FlaskConical,
  Activity,
  Droplet,
  Microscope,
  Stethoscope,
  TestTube2,
  Biohazard,
  Send
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { getLabConfig, LAB_MODULE_LABELS, generateLabCase, getLabSimulations, gradeLabSubmission } from "@/backend/virtual-lab.functions";
import { LabDialogs } from "./LabDialogs";
import { updateLabSimulation, getLabSubmissions, deleteLabSimulation } from "@/backend/virtual-lab-management.functions";
import { getDiaryColumns } from "@/backend/diary-release.functions";
import { useServerFn } from "@tanstack/react-start";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const MODULE_ICONS: Record<string, React.ElementType> = {
  biosseguranca: Biohazard,
  pre_analitica: Activity,
  hematologia: Droplet,
  urinalise_fisica_quimica: TestTube2,
  urinalise_microscopica: Microscope,
  microbiologia: FlaskConical,
  bioquímica: FlaskConical,
  mega_caso_integrador: Stethoscope,
};

const MODULE_COLORS: Record<string, string> = {
  biosseguranca: "text-red-500 bg-red-50",
  pre_analitica: "text-blue-500 bg-blue-50",
  hematologia: "text-rose-500 bg-rose-50",
  urinalise_fisica_quimica: "text-amber-500 bg-amber-50",
  urinalise_microscopica: "text-emerald-500 bg-emerald-50",
  microbiologia: "text-indigo-500 bg-indigo-50",
  bioquímica: "text-cyan-500 bg-cyan-50",
  mega_caso_integrador: "text-purple-500 bg-purple-50",
};

export function VirtualLabModule({ disciplineId, isTeacher }: { disciplineId: string; isTeacher: boolean }) {
  const [configs, setConfigs] = useState<any[]>([]);
  const [simulations, setSimulations] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);
  const [selectedModule, setSelectedModule] = useState<string | null>(null);
  
  // Interface States
  const [activeView, setActiveView] = useState<"grid" | "module">("grid");
  const [deletingSimId, setDeletingSimId] = useState<string | null>(null);
  const [viewingSim, setViewingSim] = useState<any | null>(null);
  const [editingSim, setEditingSim] = useState<any | null>(null);
  const [rubricSim, setRubricSim] = useState<any | null>(null);
  
  // Data States
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [selectedSimIdForSubmissions, setSelectedSimIdForSubmissions] = useState<string | null>(null);

  const fetchConfig = useServerFn(getLabConfig);
  const generateCase = useServerFn(generateLabCase);
  const fetchSimulations = useServerFn(getLabSimulations);
  const fetchSubmissions = useServerFn(getLabSubmissions);
  const deleteSim = useServerFn(deleteLabSimulation);
  const updateSim = useServerFn(updateLabSimulation);
  const fetchDiaryColumns = useServerFn(getDiaryColumns);

  useEffect(() => {
    load();
  }, [disciplineId]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchConfig({ data: { disciplineId } });
      setConfigs(res || []);
      
      const simsMap: Record<string, any[]> = {};
      if (Array.isArray(res)) {
        for (const config of res) {
          // Carrega simulações se o módulo estiver ativo OU se for professor (para ver rascunhos em módulos ainda não ativados)
          if (config.is_active || isTeacher) {
            try {
              const sims = await fetchSimulations({ data: { disciplineId, moduleType: config.module_type } });
              simsMap[config.module_type] = Array.isArray(sims) ? sims : [];
            } catch (e) {
              console.error(`Erro ao carregar simulações para ${config.module_type}`, e);
            }
          }
        }
      }
      setSimulations(simsMap);
    } catch (e) {
      console.error("Erro ao carregar laboratório:", e);
      toast.error("Erro ao carregar laboratório");
    } finally {
      setLoading(false);
    }
  };

  const handleModuleClick = (type: string) => {
    setSelectedModule(type);
    setActiveView("module");
    setSelectedSimIdForSubmissions(null);
    setSubmissions([]);
  };

  const handleGenerateAI = async () => {
    if (!selectedModule) return;
    setGenerating(selectedModule);
    try {
      const simulation = await generateCase({ data: { disciplineId, moduleType: selectedModule } });
      if (!simulation) throw new Error("Falha na geração");
      toast.success("Caso simulado gerado como rascunho!");
      load();
      setEditingSim(simulation);
    } catch (e) {
      console.error("Erro ao gerar caso com IA:", e);
      toast.error("Erro ao gerar caso com IA.");
    } finally {
      setGenerating(null);
    }
  };

  const handleDelete = async () => {
    if (!deletingSimId) return;
    try {
      await deleteSim({ data: { simulationId: deletingSimId } });
      toast.success("Caso excluído com sucesso");
      load();
    } catch (e) {
      console.error("Erro ao excluir:", e);
      toast.error("Erro ao excluir o caso");
    } finally {
      setDeletingSimId(null);
    }
  };

  const loadSubmissions = async (simId: string) => {
    setLoadingSubmissions(true);
    setSelectedSimIdForSubmissions(simId);
    try {
      const res = await fetchSubmissions({ data: { simulationId: simId } });
      setSubmissions(res || []);
    } catch (e) {
      console.error("Erro ao carregar submissões:", e);
      toast.error("Erro ao carregar submissões");
    } finally {
      setLoadingSubmissions(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-white">Carregando Laboratório Virtual...</div>;

  if (activeView === "grid") {
    return (
      <div className="space-y-6">
        <div className="text-white">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <FlaskConical className="h-6 w-6" />
            Laboratório Virtual Simulado
          </h2>
          <p className="text-sm opacity-80">Selecione um módulo para gerenciar casos e submissões.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Object.keys(LAB_MODULE_LABELS)
            .filter((type) => {
              if (isTeacher) return true;
              const simsCount = (simulations[type] || []).filter((s) => !s.is_draft).length;
              return simsCount > 0;
            })
            .map((type) => {
              const config = configs.find((c) => c.module_type === type);
              const isActive = config?.is_active ?? false;
              const simsCount = (simulations[type] || []).length;
              const Icon = MODULE_ICONS[type] || FlaskConical;
              const colorClass = MODULE_COLORS[type] || "text-slate-500 bg-slate-50";

              return (
                <Card
                  key={type}
                  className="bg-white border-white/40 shadow-sm hover:shadow-md transition-all cursor-pointer group flex flex-col items-center p-6 rounded-2xl relative"
                  onClick={() => handleModuleClick(type)}
                >
                  <div
                    className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform ${colorClass}`}
                  >
                    <Icon className="w-8 h-8" />
                  </div>

                  <h3 className="text-sm font-bold text-center text-slate-800 uppercase tracking-tight mb-3">
                    {LAB_MODULE_LABELS[type]}
                  </h3>

                  <div className="flex items-center gap-2 mt-auto">
                    <Badge
                      variant="secondary"
                      className={
                        isActive
                          ? "bg-green-100 text-green-700 hover:bg-green-100 border-none"
                          : "bg-slate-100 text-slate-500 hover:bg-slate-100 border-none"
                      }
                    >
                      {isActive ? "Ativo" : "Inativo"}
                    </Badge>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      {simsCount} casos
                    </span>
                  </div>

                  <ChevronRight className="absolute bottom-4 right-4 h-4 w-4 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                </Card>
              );
            })}
        </div>
      </div>
    );
  }

  // MODULE DETAIL VIEW (2 COLUMNS)
  const sims = simulations[selectedModule!] || [];
  const filteredSims = sims.filter(s => isTeacher || !s.is_draft);
  const moduleLabel = LAB_MODULE_LABELS[selectedModule!];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div className="text-white">
          <Button variant="ghost" size="sm" className="text-white mb-2 p-0 hover:bg-transparent" onClick={() => setActiveView("grid")}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Voltar aos Módulos
          </Button>
          <h2 className="text-2xl font-bold">{moduleLabel}</h2>
        </div>
        {isTeacher && (
          <Button 
            className="bg-teal-600 hover:bg-teal-700 text-white font-bold shadow-lg shadow-teal-900/20"
            onClick={handleGenerateAI}
            disabled={!!generating}
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Gerar Caso com IA
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN: SUBMISSIONS */}
        <div className="lg:col-span-5 space-y-4">
          <Card className="bg-white border-slate-200 shadow-sm min-h-[500px] flex flex-col rounded-xl overflow-hidden">
            <CardHeader className="border-b bg-slate-50/80 py-4">
              <CardTitle className="text-xs font-black text-slate-600 flex items-center gap-2 uppercase tracking-widest">
                <Users className="h-4 w-4 text-teal-600" />
                Fila de Submissões Pendentes
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1">
              <ScrollArea className="h-[500px]">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-slate-100 bg-slate-50/30">
                      <TableHead className="text-[10px] font-black uppercase text-slate-400 tracking-tighter">Aluno</TableHead>
                      <TableHead className="text-[10px] font-black uppercase text-slate-400 tracking-tighter">Status</TableHead>
                      <TableHead className="text-right text-[10px] font-black uppercase text-slate-400 tracking-tighter">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingSubmissions ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center py-12">
                          <Loader2 className="h-6 w-6 animate-spin mx-auto text-teal-600" />
                        </TableCell>
                      </TableRow>
                    ) : submissions.length > 0 ? (
                      submissions.map((sub) => (
                        <TableRow key={sub.id} className="hover:bg-slate-50 transition-colors">
                          <TableCell className="font-bold text-slate-700 text-xs truncate max-w-[120px]">
                            {sub.profiles?.full_name || "Aluno"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-[9px] font-black uppercase tracking-tighter ${sub.grade !== null ? "bg-green-50 text-green-600 border-green-100" : "bg-blue-50 text-blue-600 border-blue-100"}`}>
                              {sub.grade !== null ? "Corrigido" : "Pendente"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" className="h-7 text-[10px] font-black text-teal-600 hover:bg-teal-50 uppercase tracking-tighter">
                              Corrigir
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center py-12 text-slate-400 text-xs italic">
                          {selectedSimIdForSubmissions ? "Nenhuma submissão encontrada." : "Selecione um caso para ver as submissões"}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT COLUMN: CASES */}
        <div className="lg:col-span-7 space-y-4">
          <Card className="bg-white border-slate-200 shadow-sm min-h-[500px] flex flex-col rounded-xl overflow-hidden">
            <CardHeader className="border-b bg-slate-50/80 py-4">
              <CardTitle className="text-xs font-black text-slate-600 flex items-center gap-2 uppercase tracking-widest">
                <FileText className="h-4 w-4 text-teal-600" />
                Casos Simulados Publicados
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 flex-1">
              <div className="grid grid-cols-1 gap-4">
                {filteredSims.length === 0 ? (
                  <div className="text-center py-20 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                    <AlertCircle className="h-10 w-10 text-slate-300 mx-auto mb-2" />
                    <p className="text-slate-400 text-sm font-bold uppercase tracking-tight">Nenhum caso simulado disponível.</p>
                  </div>
                ) : (
                  filteredSims.map(sim => (
                    <Card key={sim.id} className={`border-slate-100 hover:border-teal-200 transition-all ${selectedSimIdForSubmissions === sim.id ? 'ring-2 ring-teal-500/20 border-teal-200 bg-teal-50/10' : 'bg-slate-50/30'}`}>
                      <CardContent className="p-4">
                      <div className="flex justify-between items-start mb-2">
                        <div className="space-y-1">
                          <h3 className="font-bold text-slate-900 tracking-tight">{sim.title}</h3>
                          <div className="flex items-center gap-2 flex-wrap">
                            {sim.is_draft ? (
                              <Badge variant="outline" className="text-[10px] font-black uppercase bg-amber-50 text-amber-600 border-amber-200">Rascunho</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] font-black uppercase bg-green-50 text-green-600 border-green-200">Publicado</Badge>
                            )}
                            {sim.deadline && !sim.is_draft && (
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-[10px] font-black uppercase bg-amber-100 text-amber-700 border-amber-200 flex gap-1 items-center">
                                  <Clock className="h-3 w-3" />
                                  {(() => {
                                    const diff = new Date(sim.deadline).getTime() - new Date().getTime();
                                    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
                                    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                                    if (diff < 0) return "Prazo Encerrado";
                                    return `Faltam ${days}d ${hours}h`;
                                  })()}
                                </Badge>
                                {sim.late_rule && (
                                  <Badge variant="outline" className="text-[10px] font-black uppercase bg-rose-50 text-rose-600 border-rose-200 flex gap-1 items-center">
                                    <AlertCircle className="h-3 w-3" />
                                    Entrega após o prazo: -{sim.late_rule} por dia
                                  </Badge>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      <p className="text-sm text-slate-600 line-clamp-2 mb-4 leading-relaxed">
                        {sim.content}
                      </p>

                      <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-slate-100">
                        {isTeacher ? (
                          <>
                            {sim.is_draft && (
                              <Button 
                                size="sm" 
                                className="h-8 text-[11px] font-black uppercase tracking-tighter bg-green-600 hover:bg-green-700 text-white border-none shadow-sm"
                                onClick={async () => {
                                  try {
                                    await updateSim({ data: { 
                                      simulationId: sim.id,
                                      title: sim.title,
                                      content: sim.content,
                                      isDraft: false,
                                      disciplineId: disciplineId,
                                      moduleType: selectedModule || sim.module_type,
                                      imageUrl: sim.image_url,
                                      lateRule: sim.late_rule,
                                      deadline: sim.deadline,
                                      diaryColumnId: sim.diary_column_id,
                                      questions: Array.isArray(sim.questions) ? sim.questions : []
                                    } });
                                    toast.success("Caso publicado com sucesso!");
                                    load();
                                  } catch (e) {
                                    toast.error("Erro ao publicar caso");
                                  }
                                }}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Publicar para Alunos
                              </Button>
                            )}
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="h-8 text-[11px] font-black uppercase tracking-tighter text-teal-700 border-teal-200 hover:bg-teal-50"
                              onClick={() => setViewingSim(sim)}
                            >
                              <Eye className="h-3.5 w-3.5 mr-1" /> Ver Caso
                            </Button>
                          </>
                        ) : (
                          <Button 
                            className="h-8 text-[11px] font-black uppercase tracking-widest text-white bg-teal-600 hover:bg-teal-700 shadow-sm px-4"
                            onClick={() => setViewingSim(sim)}
                          >
                            <Send className="h-3.5 w-3.5 mr-1" /> Responder Atividade
                          </Button>
                        )}
                        {isTeacher && (
                          <>
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="h-8 text-[11px] font-black uppercase tracking-tighter text-slate-700"
                              onClick={() => setRubricSim(sim)}
                            >
                              <FileText className="h-3.5 w-3.5 mr-1" /> Rubrica
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="h-8 text-[11px] font-black uppercase tracking-tighter text-slate-700"
                              onClick={() => setEditingSim(sim)}
                            >
                              <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                            </Button>
                            <Button 
                              variant={selectedSimIdForSubmissions === sim.id ? "default" : "outline"} 
                              size="sm" 
                              className={`h-8 text-[11px] font-black uppercase tracking-tighter ${selectedSimIdForSubmissions === sim.id ? 'bg-teal-600 hover:bg-teal-700' : 'text-slate-700'}`}
                              onClick={() => loadSubmissions(sim.id)}
                            >
                              Submissões ({submissions.length})
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="h-8 text-[11px] font-black uppercase tracking-tighter text-red-500 hover:text-red-600 hover:bg-red-50 ml-auto"
                              onClick={() => setDeletingSimId(sim.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog open={!!deletingSimId} onOpenChange={() => setDeletingSimId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tem certeza que deseja excluir?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Todos os dados e submissões vinculados a este caso serão removidos permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <LabDialogs 
        disciplineId={disciplineId}
        viewingSim={viewingSim} setViewingSim={setViewingSim}
        editingSim={editingSim} setEditingSim={setEditingSim}
        rubricSim={rubricSim} setRubricSim={setRubricSim}
        fetchDiaryColumns={fetchDiaryColumns}
        isTeacher={isTeacher}
        onSave={async (sim: any) => {
          await updateSim({
            data: {
              simulationId: sim.simulationId || sim.id,
              title: sim.title,
              content: sim.content,
              questions: sim.questions,
              isDraft: sim.isDraft,
              deadline: sim.deadline,
              lateRule: sim.lateRule,
              diaryColumnId: sim.diaryColumnId,
              imageUrl: sim.imageUrl,
              disciplineId: sim.disciplineId,
              moduleType: sim.moduleType
            }
          });
          setEditingSim(null);
          load();
        }}
      />
    </div>
  );
}