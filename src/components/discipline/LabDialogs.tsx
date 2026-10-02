import React, { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Upload, Plus, Trash2, Clock, AlertCircle, FileText, Send, Loader2, CheckCircle2, History, ShieldAlert, FlaskConical, Maximize2 } from "lucide-react";
import { toast } from "sonner";
import { submitLabResponse } from "@/backend/virtual-lab.functions";
import { useServerFn } from "@tanstack/react-start";

const isValidImageUrl = (url: any) =>
  typeof url === "string" && /^(https?:\/\/|data:image\/|\/)/i.test(url.trim());

function CaseMedia({ url, mediaUrl }: { url?: any; mediaUrl?: any }) {
  const [failed, setFailed] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  
  const finalUrl = (url || mediaUrl);
  if (!isValidImageUrl(finalUrl) || failed) return null;
  
  const imageUrl = String(finalUrl).trim();
  
  return (
    <div className="space-y-2">
      <figure className="relative group rounded-2xl overflow-hidden border border-slate-200 shadow-sm bg-slate-50 flex flex-col items-center">
        <img
          src={imageUrl}
          className="w-full h-auto object-contain max-h-[420px] mx-auto transition-transform duration-300 group-hover:scale-[1.01]"
          alt="Imagem de apoio do caso"
          loading="lazy"
          onError={() => setFailed(true)}
        />
        <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button 
            variant="secondary" 
            size="icon" 
            className="rounded-full bg-white/90 backdrop-blur shadow-md hover:bg-white"
            onClick={() => setIsMaximized(true)}
          >
            <Maximize2 className="h-4 w-4 text-slate-700" />
          </Button>
        </div>
        <figcaption className="w-full text-center text-[10px] font-black uppercase tracking-widest text-slate-400 py-2 bg-white/70 border-t">
          Mídia de Apoio / Evidência Clínica
        </figcaption>
      </figure>

      <Dialog open={isMaximized} onOpenChange={setIsMaximized}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 overflow-hidden border-none bg-black/90">
          <div className="relative w-full h-full flex items-center justify-center p-4">
            <img src={imageUrl} className="max-w-full max-h-[90vh] object-contain shadow-2xl" alt="Mídia ampliada" />
            <Button 
              className="absolute top-4 right-4 bg-white/10 hover:bg-white/20 text-white border-white/20" 
              variant="outline" 
              size="sm"
              onClick={() => setIsMaximized(false)}
            >
              Fechar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CaseSection({ title, icon: Icon, children, variant = "default" }: any) {
  const variants: any = {
    default: "bg-slate-50 border-slate-200 text-slate-700",
    blue: "bg-blue-50/50 border-blue-100 text-blue-900",
    amber: "bg-amber-50/50 border-amber-100 text-amber-900",
    green: "bg-green-50/50 border-green-100 text-green-900",
  };

  const iconColors: any = {
    default: "text-slate-500",
    blue: "text-blue-600",
    amber: "text-amber-600",
    green: "text-green-600",
  };

  return (
    <div className={`p-5 rounded-2xl border transition-all hover:shadow-md ${variants[variant]}`}>
      <h4 className="text-[11px] font-black uppercase tracking-widest mb-3 flex items-center gap-2 opacity-80">
        <Icon className={`h-4 w-4 ${iconColors[variant]}`} />
        {title}
      </h4>
      <div className="text-[14px] leading-relaxed whitespace-pre-line font-medium">
        {children}
      </div>
    </div>
  );
}

function CaseStatement({ content }: { content: any }) {
  const text = String(content || "");
  
  // Tentar extrair blocos baseados nas tags da IA
  const extract = (tag: string) => {
    const regex = new RegExp(`\\[${tag}\\]([\\s\\S]*?)(?=\\[|$)`, "i");
    const match = text.match(regex);
    return match ? match[1].trim() : null;
  };

  const context = extract("CONTEXTO");
  const incident = extract("OCORRENCIA");
  const technical = extract("DADOS_TECNICOS");

  // Fallback se não encontrar as tags (para casos antigos)
  if (!context && !incident && !technical) {
    const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    
    // Tentar encontrar blocos por palavras-chave se não houver tags [TAG]
    const findByKeyword = (keywords: string[]) => {
      const found = paragraphs.find(p => keywords.some(k => p.toUpperCase().includes(k)));
      return found || null;
    };

    const fbContext = findByKeyword(["HISTÓRICO", "CONTEXTO", "PACIENTE", "ANAMNESE"]);
    const fbIncident = findByKeyword(["INCIDENTE", "OCORRÊNCIA", "FALHA", "ERRO", "CONTAMINAÇÃO"]);
    const fbTechnical = findByKeyword(["DADOS TÉCNICOS", "CONDUTA", "PROCEDIMENTO", "AMOSTRA", "EQUIPAMENTO", "LABORATÓRIO"]);

    if (fbContext || fbIncident || fbTechnical) {
      return (
        <div className="space-y-5">
          {fbContext && (
            <CaseSection title="📌 Contexto e Histórico Clínico" icon={History} variant="blue">
              {fbContext}
            </CaseSection>
          )}
          {fbIncident && (
            <CaseSection title="⚠️ O Incidente / Ocorrência de Biossegurança" icon={ShieldAlert} variant="amber">
              {fbIncident}
            </CaseSection>
          )}
          {fbTechnical && (
            <CaseSection title="🔬 Dados Técnicos / Conduta Adotada" icon={FlaskConical} variant="green">
              {fbTechnical}
            </CaseSection>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <CaseSection title="HISTÓRICO E ENUNCIADO" icon={History} variant="blue">
          {paragraphs.join("\n\n")}
        </CaseSection>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {context && (
        <CaseSection title="📌 Contexto e Histórico Clínico" icon={History} variant="blue">
          {context}
        </CaseSection>
      )}
      {incident && (
        <CaseSection title="⚠️ O Incidente / Ocorrência de Biossegurança" icon={ShieldAlert} variant="amber">
          {incident}
        </CaseSection>
      )}
      {technical && (
        <CaseSection title="🔬 Dados Técnicos / Conduta Adotada" icon={FlaskConical} variant="green">
          {technical}
        </CaseSection>
      )}
    </div>
  );
}

export function LabDialogs({ 
  disciplineId,
  viewingSim, setViewingSim,
  editingSim, setEditingSim,
  rubricSim, setRubricSim,
  fetchDiaryColumns,
  onSave,
  isTeacher
}: any) {
  const [diaryColumns, setDiaryColumns] = useState<any[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitResponse = useServerFn(submitLabResponse);

  useEffect(() => {
    if (editingSim && disciplineId) {
      fetchDiaryColumns({ data: { discipline_id: disciplineId } })
        .then((res: any) => setDiaryColumns(res || []))
        .catch(console.error);
    }
  }, [editingSim, disciplineId, fetchDiaryColumns]);

  useEffect(() => {
    if (viewingSim?.questions) {
      setAnswers(new Array(viewingSim.questions.length).fill(""));
    }
  }, [viewingSim]);

  const handleAnswerChange = (index: number, value: string) => {
    const newAnswers = [...answers];
    newAnswers[index] = value;
    setAnswers(newAnswers);
  };

  const handleSubmitResponse = async () => {
    if (!viewingSim) return;
    setIsSubmitting(true);
    try {
      await submitResponse({
        data: {
          simulationId: viewingSim.id,
          answers: answers.map((text, i) => ({
            question_index: i,
            answer: text
          }))
        }
      });
      toast.success("Resposta enviada com sucesso!");
      setViewingSim(null);
    } catch (error) {
      console.error(error);
      toast.error("Erro ao enviar resposta");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveWithToast = async (data: any) => {
    try {
      await onSave(data);
      toast.success("Alterações salvas com sucesso!");
    } catch (error: any) {
      toast.error(error.message || "Erro ao salvar alterações");
    }
  };

  const buildPayload = (sim: any, isDraft: boolean) => {
    // Garantir que os campos correspondam ao que o backend espera
    return {
      id: sim.id,
      simulationId: sim.id,
      isDraft: isDraft,
      status: isDraft ? 'draft' : 'published',
      title: sim.title,
      content: sim.content,
      deadline: sim.deadline || sim.deadline_date || null,
      lateRule: sim.late_rule || sim.lateRule || null,
      diaryColumnId: sim.diary_column_id || sim.diaryColumnId || null,
      imageUrl: (sim.image_url || sim.imageUrl || "").trim() || null,
      questions: Array.isArray(sim.questions) ? sim.questions : [],
      disciplineId,
      moduleType: sim.module_type || sim.moduleType
    };
  };

  return (
    <>
      {/* View Caso */}
      <Dialog open={!!viewingSim && !isTeacher} onOpenChange={() => setViewingSim(null)}>
        <DialogContent className="max-w-3xl rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-slate-900 tracking-tight">
              {viewingSim?.title}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] pr-4">
            <div className="space-y-6">
              {(viewingSim?.media_url || viewingSim?.image_url) && (
                <img 
                  src={viewingSim.media_url || viewingSim.image_url} 
                  className="w-full max-h-72 object-cover rounded-lg mb-4 border" 
                  alt="Imagem do caso" 
                />
              )}
              <CaseStatement content={viewingSim?.content} />

              <div className="bg-slate-50 p-6 rounded-xl border border-slate-100">
                <h4 className="text-sm font-black uppercase tracking-widest text-teal-600 mb-4 flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Perguntas do Caso
                </h4>
                <div className="space-y-6">
                  {viewingSim?.questions?.map((q: any, i: number) => (
                    <div key={i} className="space-y-3">
                      <Card className="p-4 border-slate-200 bg-white">
                        <p className="text-sm font-bold text-slate-800 flex gap-3">
                          <span className="text-teal-600">{i + 1}.</span>
                          {q.question}
                        </p>
                      </Card>
                      {!isTeacher && (
                        <div className="space-y-2">
                          <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Resposta da Questão {i + 1}</Label>
                          <Textarea 
                            placeholder="Digite sua resposta aqui..."
                            className="text-xs border-slate-200 focus-visible:ring-teal-500 min-h-[100px] bg-white"
                            value={answers[i] || ""}
                            onChange={(e) => handleAnswerChange(i, e.target.value)}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {!isTeacher && (
                <div className="pt-4 pb-2">
                  <Button 
                    onClick={handleSubmitResponse}
                    disabled={isSubmitting}
                    className="w-full bg-teal-600 hover:bg-teal-700 text-white font-black uppercase tracking-widest py-6 h-auto shadow-lg shadow-teal-900/20 group"
                  >
                    {isSubmitting ? (
                      <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    ) : (
                      <Send className="h-5 w-5 mr-2 group-hover:translate-x-1 transition-transform" />
                    )}
                    Enviar Resposta para Correção
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Ver Caso (Professor) / Publicar */}
      <Dialog open={!!viewingSim && isTeacher} onOpenChange={() => setViewingSim(null)}>
        <DialogContent className="max-w-3xl rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-slate-900 tracking-tight flex items-center justify-between">
              {viewingSim?.title}
              {viewingSim?.is_draft && (
                <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-none">Rascunho</Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] pr-4">
            <div className="space-y-6">
              <CaseMedia url={viewingSim?.image_url} mediaUrl={viewingSim?.media_url} />
              <CaseStatement content={viewingSim?.content} />

              <div className="bg-slate-50 p-6 rounded-xl border border-slate-100">
                <h4 className="text-sm font-black uppercase tracking-widest text-teal-600 mb-4 flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Perguntas do Caso
                </h4>
                <div className="space-y-4">
                  {viewingSim?.questions?.map((q: any, i: number) => (
                    <Card key={i} className="p-4 border-slate-200 bg-white">
                      <p className="text-sm font-bold text-slate-800 flex gap-3">
                        <span className="text-teal-600">{i + 1}.</span>
                        {q.question}
                      </p>
                    </Card>
                  ))}
                </div>
              </div>

              {viewingSim?.is_draft && (
                <div className="pt-4 border-t border-slate-100">
                  <Button 
                    className="w-full bg-green-600 hover:bg-green-700 text-white font-black uppercase tracking-widest py-6 h-auto shadow-lg shadow-green-900/20"
                    onClick={async () => {
                      try {
                        await onSave(buildPayload(viewingSim, false));
                        setViewingSim(null);
                      } catch (e) {
                        // Toast handled by LabDialogs logic
                      }
                    }}
                  >
                    <CheckCircle2 className="h-5 w-5 mr-2" />
                    Aprovar e Publicar para os Alunos
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Editar Caso */}
      <Dialog open={!!editingSim} onOpenChange={() => setEditingSim(null)}>
        <DialogContent className="max-w-4xl rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-slate-900 tracking-tight">Editar Caso Simulado</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[75vh] pr-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-4">
              <div className="space-y-6">
                <div className="space-y-2">
                  <Label className="text-xs font-black uppercase tracking-widest text-slate-500">Título do Caso</Label>
                  <Input 
                    value={editingSim?.title || ""} 
                    onChange={(e) => setEditingSim({...editingSim, title: e.target.value})} 
                    className="border-slate-200 focus-visible:ring-teal-500"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label className="text-xs font-black uppercase tracking-widest text-slate-500">Enunciado Clínico</Label>
                  <Textarea 
                    value={editingSim?.content || ""} 
                    className="h-64 border-slate-200 focus-visible:ring-teal-500 text-sm leading-relaxed" 
                    onChange={(e) => setEditingSim({...editingSim, content: e.target.value})} 
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-black uppercase tracking-widest text-slate-500">Mídia do Caso (URL)</Label>
                  <div className="flex gap-2">
                    <Input 
                      placeholder="URL da imagem (lâmina, laudo...)" 
                      value={editingSim?.image_url || ""} 
                      onChange={(e) => setEditingSim({...editingSim, image_url: e.target.value})}
                      className="border-slate-200"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0 border-slate-200"
                      onClick={() => {
                        const url = (editingSim?.image_url || "").trim();
                        if (!url) {
                          setEditingSim({ ...editingSim, image_url: "" });
                          toast.info("Nenhuma URL informada — a imagem será removida ao salvar.");
                          return;
                        }
                        if (!isValidImageUrl(url)) {
                          toast.error("URL inválida. Use um endereço http(s) de imagem.");
                          return;
                        }
                        setEditingSim({ ...editingSim, image_url: url });
                        toast.success("URL da mídia validada. Salve para gravar.");
                      }}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="mt-4">
                    <CaseMedia url={editingSim?.image_url} mediaUrl={editingSim?.media_url} />
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <div className="flex justify-between items-center mb-2">
                    <Label className="text-xs font-black uppercase tracking-widest text-slate-500">Configurações de Entrega</Label>
                  </div>
                  <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <div className="space-y-2">
                      <Label className="text-[10px] font-bold text-slate-400 uppercase">Data Limite</Label>
                      <Input 
                        type="date" 
                        value={editingSim?.deadline?.split('T')[0] || ""} 
                        onChange={(e) => setEditingSim({...editingSim, deadline: e.target.value})}
                        className="h-8 text-xs border-slate-200"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[10px] font-bold text-slate-400 uppercase">Atraso (pts/dia)</Label>
                      <Input 
                        type="number" 
                        placeholder="-1.0"
                        value={editingSim?.late_rule || ""} 
                        onChange={(e) => setEditingSim({...editingSim, late_rule: e.target.value})}
                        className="h-8 text-xs border-slate-200"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-black uppercase tracking-widest text-slate-500">Vínculo com o Diário</Label>
                  <Select 
                    value={editingSim?.diary_column_id || ""} 
                    onValueChange={(val) => setEditingSim({...editingSim, diary_column_id: val})}
                  >
                    <SelectTrigger className="border-slate-200">
                      <SelectValue placeholder="Selecione uma coluna do diário" />
                    </SelectTrigger>
                    <SelectContent>
                      {diaryColumns.map(col => (
                        <SelectItem key={col.id} value={col.id}>{col.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <Label className="text-xs font-black uppercase tracking-widest text-slate-500">Questões do Caso</Label>
                    <Button variant="ghost" size="sm" className="h-7 text-[10px] font-black uppercase tracking-tighter text-teal-600">
                      <Plus className="h-3 w-3 mr-1" /> Add Questão
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {editingSim?.questions?.map((q: any, i: number) => (
                      <div key={i} className="group relative">
                        <Textarea 
                          value={q.question} 
                          className="min-h-[60px] pr-8 text-xs border-slate-100 bg-slate-50/50 focus:bg-white"
                          onChange={(e) => {
                            const newQuestions = [...editingSim.questions];
                            newQuestions[i] = {...q, question: e.target.value};
                            setEditingSim({...editingSim, questions: newQuestions});
                          }}
                        />
                        <button className="absolute top-2 right-2 text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>
          <DialogFooter className="mt-6 border-t pt-4">
            <Button variant="ghost" onClick={() => setEditingSim(null)} className="font-bold uppercase tracking-widest text-xs">Cancelar</Button>
            <Button 
              onClick={async () => {
                await handleSaveWithToast(buildPayload(editingSim, false));
                setEditingSim(null);
              }} 
              className="bg-green-600 hover:bg-green-700 text-white font-bold uppercase tracking-widest text-xs px-8"
            >
              <CheckCircle2 className="h-3 w-3 mr-1.5" />
              Aprovar e Publicar
            </Button>
            <Button
              onClick={() => handleSaveWithToast(buildPayload(editingSim, editingSim.is_draft ?? editingSim.isDraft ?? true))}
              className="bg-teal-600 hover:bg-teal-700 text-white font-bold uppercase tracking-widest text-xs px-8"
            >
              Salvar Alterações
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rubrica */}
      <Dialog open={!!rubricSim} onOpenChange={() => setRubricSim(null)}>
        <DialogContent className="rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <FileText className="h-5 w-5 text-teal-600" />
              Rubrica de Avaliação
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-6">
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
              <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3">Contexto</h4>
              <p className="text-sm font-bold text-slate-700">{rubricSim?.title}</p>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="h-6 w-6 rounded-full bg-teal-100 text-teal-600 flex items-center justify-center shrink-0 mt-1 font-bold text-xs">1</div>
                <div className="space-y-1">
                  <p className="text-sm font-bold text-slate-800 tracking-tight">Qualidade da Resposta Técnica</p>
                  <p className="text-xs text-slate-500 leading-relaxed">Avalia a precisão dos termos técnicos utilizados e a coerência do laudo/conclusão conforme os padrões laboratoriais.</p>
                </div>
                <Badge variant="outline" className="ml-auto text-[10px] bg-slate-50">40 pts</Badge>
              </div>

              <div className="flex items-start gap-4">
                <div className="h-6 w-6 rounded-full bg-teal-100 text-teal-600 flex items-center justify-center shrink-0 mt-1 font-bold text-xs">2</div>
                <div className="space-y-1">
                  <p className="text-sm font-bold text-slate-800 tracking-tight">Raciocínio Diagnóstico</p>
                  <p className="text-xs text-slate-500 leading-relaxed">Avalia a capacidade de correlacionar os achados clínicos com as possíveis patologias descritas no caso.</p>
                </div>
                <Badge variant="outline" className="ml-auto text-[10px] bg-slate-50">30 pts</Badge>
              </div>

              <div className="flex items-start gap-4">
                <div className="h-6 w-6 rounded-full bg-teal-100 text-teal-600 flex items-center justify-center shrink-0 mt-1 font-bold text-xs">3</div>
                <div className="space-y-1">
                  <p className="text-sm font-bold text-slate-800 tracking-tight">Normas de Biossegurança e Coleta</p>
                  <p className="text-xs text-slate-500 leading-relaxed">Avalia o conhecimento sobre o fluxo pré-analítico e analítico, garantindo a integridade da amostra.</p>
                </div>
                <Badge variant="outline" className="ml-auto text-[10px] bg-slate-50">30 pts</Badge>
              </div>
            </div>

            <div className="bg-amber-50 p-4 rounded-xl border border-amber-100 flex gap-3">
              <AlertCircle className="h-5 w-5 text-amber-500 shrink-0" />
              <div className="space-y-1">
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Regra de Atraso</p>
                <p className="text-xs text-amber-600 font-medium">A submissão após o prazo sofrerá um desconto fixo de <span className="font-bold">{rubricSim?.late_rule || "1.0"}</span> ponto(s) por cada dia de atraso.</p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
