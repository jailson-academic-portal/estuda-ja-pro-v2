import React, { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, BookOpen, BrainCircuit } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getExamClassificationBadgeProps } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { submitActivity } from "@/backend/activities.functions";
import { stripDocumentHeaderMetadata, stripLeadingStandardHeader } from "@/lib/document-header";

interface Activity {
  id: string;
  title: string;
  instructions: string | null;
  subtype: string;
}

interface InlineSubmissionDialogProps {
  activity: Activity;
  onClose: () => void;
  onSuccess: () => void;
}

export function InlineSubmissionDialog({
  activity,
  onClose,
  onSuccess,
}: InlineSubmissionDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState("context");

  // Enunciado limpo para o aluno: sem metadados internos (<!-- estudaja-header -->),
  // sem cabeçalho institucional duplicado e sem linhas de logo.
  const cleanInstructions = useMemo(() => {
    const raw = activity.instructions ?? "";
    return stripLeadingStandardHeader(stripDocumentHeaderMetadata(raw))
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/^!\[Logo\].*$/gm, "")
      .replace(/\\n/g, "\n")
      .trim();
  }, [activity.instructions]);

  // Parser de questões: prioriza a seção "Perguntas para Análise" do padrão de
  // Estudo de Caso; depois linhas numeradas/interrogativas; por fim, fallback.
  const getQuestions = () => {
    const text = cleanInstructions;
    const stripPrefix = (q: string) =>
      q
        .replace(/^\s*(?:\*\*)?(?:quest[ãa]o|pergunta)\s*\d+\s*[:.)-]?(?:\*\*)?\s*/i, "")
        .replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "")
        .replace(/^\*\*(.+?)\*\*\s*$/, "$1")
        .trim();

    // 1) Seção dedicada às perguntas (## 5. Perguntas para Análise / Questões / Resolução).
    const lines = text.split(/\r?\n/);
    const headingIdx = lines.findIndex((l) =>
      /^#{1,6}\s*(?:\d+[.)]\s*)?(perguntas|quest[õo]es|resolu[çc][ãa]o)/i.test(l.trim()),
    );
    if (headingIdx >= 0) {
      const level = (lines[headingIdx].match(/^#+/) ?? ["##"])[0].length;
      const section: string[] = [];
      for (let i = headingIdx + 1; i < lines.length; i++) {
        const m = lines[i].match(/^(#{1,6})\s/);
        if (m && m[1].length <= level) break;
        section.push(lines[i]);
      }
      const numbered = section
        .filter((l) => /^\s*(?:\d+[.)]|[-*•]|\*?\*?(?:quest[ãa]o|pergunta)\s*\d+)/i.test(l))
        .map(stripPrefix)
        .filter((q) => q.length > 5);
      if (numbered.length > 0) return numbered;
    }

    // 2) Linhas numeradas / "Questão N" / interrogativas no texto inteiro.
    const detected =
      text.match(/^\s*(?:\d+[.)]|\*?\*?(?:Quest[ãa]o|Pergunta)\s+\d+:?\*?\*?)\s*(.+\?)\s*$/gm) ||
      text.match(/^(?:\d+\.|\*?\*?Questão\s+\d+:?\*?\*?)\s*(.+)$/gm) ||
      text.match(/^.+?\?$/gm) ||
      [];
    const cleaned = detected.map(stripPrefix).filter((q) => q.length > 5);

    // 3) Fallback se nada detectado.
    if (cleaned.length === 0) {
      return [
        "Identificação dos Problemas Principais do Caso",
        "Análise dos Dados e Tabelas Apresentados",
        "Proposta de Conduta e Resolução",
        "Justificativa Técnica e Embasamento",
      ];
    }

    return cleaned;
  };

  const normalizedQuestions = getQuestions();
  const [answers, setAnswers] = useState<Record<number, string>>(() => {
    const saved = localStorage.getItem(`draft_activity_${activity.id}`);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return {};
      }
    }
    return {};
  });

  // Auto-save drafts every 10 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      if (Object.keys(answers).length > 0) {
        localStorage.setItem(`draft_activity_${activity.id}`, JSON.stringify(answers));
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [answers, activity.id]);

  const handleSubmit = async () => {
    // 1. VALIDAÇÃO DE CAMPOS OBRIGATÓRIOS (PRE-CHECK)
    if (!activity.title || activity.title.trim().length < 2) {
      toast.error("Por favor, preencha todos os campos da atividade/resposta antes de solicitar a análise da IA.");
      return;
    }

    const instructionsText = cleanInstructions;
    if (instructionsText.length < 5) {
      toast.error("Por favor, preencha todos os campos da atividade/resposta antes de solicitar a análise da IA.");
      return;
    }

    if (normalizedQuestions.length > 0) {
      const missing = normalizedQuestions.some((_, idx) => !answers[idx]?.trim());
      if (missing) {
        toast.error("Por favor, preencha todos os campos da atividade/resposta antes de solicitar a análise da IA.");
        setActiveTab("questions");
        return;
      }
    } else if (!answers[0]?.trim()) {
      toast.error("Por favor, preencha todos os campos da atividade/resposta antes de solicitar a análise da IA.");
      return;
    }

    setSubmitting(true);
    try {
      // Garantir que temos o usuário atualizado para o student_id
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) throw new Error("Usuário não autenticado.");

      await submitActivity({
        data: {
          activity_id: activity.id,
          answers: Object.fromEntries(
            Object.entries(answers).map(([idx, text]) => [idx, text])
          ),
          questions: normalizedQuestions.length > 0 ? normalizedQuestions : ["Resposta Geral"],
        }
      });
      toast.success("Resolução enviada com sucesso!");
      localStorage.removeItem(`draft_activity_${activity.id}`);
      onSuccess();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao enviar resolução");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !submitting && onClose()}>
      <DialogContent className="max-w-5xl h-[90vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 border-b bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              {activity.subtype === "case_study" ? (
                <BrainCircuit className="h-5 w-5 text-primary" />
              ) : (
                <BookOpen className="h-5 w-5 text-primary" />
              )}
            </div>
            <div>
              <DialogTitle className="text-xl">{activity.title}</DialogTitle>
              <p className="text-sm text-muted-foreground">
                {activity.subtype === "case_study" ? "Estudo de Caso Interativo" : "Atividade Prática"}
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
            <div className="px-6 border-b">
              <TabsList className="w-full justify-start h-12 bg-transparent gap-6">
                <TabsTrigger 
                  value="context" 
                  className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0"
                >
                  1. Contexto e Dados
                </TabsTrigger>
                <TabsTrigger 
                  value="questions"
                  className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0"
                >
                  2. Resolução Interativa
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="context" className="flex-1 overflow-y-auto p-8 mt-0 bg-background">
              <div className="max-w-4xl mx-auto">
                <div className="prose prose-blue dark:prose-invert max-w-none 
                  [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:text-primary [&_h2]:border-b [&_h2]:pb-4 [&_h2]:mt-0
                  [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-8 [&_h3]:mb-4 [&_h3]:flex [&_h3]:items-center [&_h3]:gap-2
                  [&_table]:my-8 [&_table]:w-full [&_table]:border-collapse [&_table]:rounded-xl [&_table]:overflow-hidden [&_table]:border-hidden [&_table]:shadow-md
                  [&_th]:bg-primary/10 [&_th]:text-primary [&_th]:font-bold [&_th]:border [&_th]:px-5 [&_th]:py-4 [&_th]:text-left
                  [&_td]:border [&_td]:px-5 [&_td]:py-4 [&_tr:nth-child(even)]:bg-muted/30
                  [&_p]:leading-relaxed [&_p]:text-base [&_p]:text-foreground/90">
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm]}
                    components={{
                      td: ({ node, children, ...props }) => {
                        const content = String(children);
                        const isClassification = content.match(/^(Normal|Alterado|Crítico|Elevado|Baixo)$/i);
                        if (isClassification) {
                          const badgeProps = getExamClassificationBadgeProps(content);
                          return (
                            <td {...props} className="border px-5 py-4">
                              <Badge variant="outline" className={`${badgeProps.className} border-2`}>
                                {content}
                              </Badge>
                            </td>
                          );
                        }
                        return <td {...props} className="border px-5 py-4">{children}</td>;
                      }
                    }}
                  >
                    {cleanInstructions}
                  </ReactMarkdown>
                </div>
                <div className="mt-12 flex justify-center">
                  <Button onClick={() => setActiveTab("questions")} className="gap-2 px-8 py-6 text-lg">
                    Ir para as Questões <Send className="h-5 w-5" />
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="questions" className="flex-1 overflow-y-auto p-8 mt-0 bg-muted/10">
              <div className="max-w-4xl mx-auto space-y-10 pb-12">
                {normalizedQuestions.length > 0 ? (
                  normalizedQuestions.map((q, idx) => (
                    <div key={idx} className="bg-background rounded-xl border shadow-sm p-6 space-y-4">
                      <div className="flex items-start gap-4">
                        <span className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center text-sm">
                          {idx + 1}
                        </span>
                        <div className="space-y-4 flex-1">
                          <label className="text-base font-semibold text-foreground leading-snug block">
                            Questão {idx + 1}: {q}
                          </label>
                          <Textarea
                            placeholder="Digite sua resposta detalhada aqui..."
                            className="min-h-[120px] resize-none focus-visible:ring-primary/30 text-base leading-relaxed"
                            value={answers[idx] || ""}
                            onChange={(e) => setAnswers(prev => ({ ...prev, [idx]: e.target.value }))}
                          />
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="bg-background rounded-xl border shadow-sm p-6 space-y-4 flex flex-col items-center justify-center py-12 text-center">
                    <BrainCircuit className="h-12 w-12 text-muted-foreground/30 mb-4" />
                    <h3 className="text-lg font-medium text-foreground">Nenhuma questão detectada</h3>
                    <p className="text-sm text-muted-foreground max-w-xs">
                      Este estudo de caso não possui perguntas estruturadas. 
                      Verifique o contexto ou entre em contato com o professor.
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="p-6 border-t bg-muted/20">
          <div className="flex w-full items-center justify-between">
            <p className="text-xs text-muted-foreground italic">
              * Suas respostas serão salvas e analisadas pela IA e pelo professor.
            </p>
            <div className="flex gap-3">
              <Button variant="outline" onClick={onClose} disabled={submitting}>
                Cancelar
              </Button>
              <Button onClick={handleSubmit} disabled={submitting} className="gap-2 min-w-[160px]">
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Enviando...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" /> Submeter Atividade
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
