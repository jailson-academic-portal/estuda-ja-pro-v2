import React, { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pencil, CheckCircle2, Loader2, X, FileText, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getExamClassificationBadgeProps } from "@/lib/utils";

interface Props {
  title: string;
  instructions: string;
  onApprove: (finalInstructions: string) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
}

export const ActivitySyllabusDraftReview: React.FC<Props> = ({
  title,
  instructions,
  onApprove,
  onCancel,
  isSubmitting,
}) => {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(instructions);

  return (
    <div className="space-y-6 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Badge variant="outline" className="mb-2">Visualização do Aluno (Rascunho)</Badge>
          <h2 className="text-xl font-bold">{title}</h2>
          <p className="text-sm text-muted-foreground">
            Revise como a atividade aparecerá na tela do aluno antes de publicar.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isSubmitting}>
          <X className="h-4 w-4 mr-1" /> Descartar
        </Button>
      </div>

      <Card className="border-2 border-primary/20">
        <CardHeader className="py-3 px-4 flex flex-row items-center justify-between space-y-0 border-b bg-muted/30">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> 
            {editing ? "Editando Estrutura" : "Prévia da Interface do Aluno"}
          </CardTitle>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setEditing(!editing)}
            disabled={isSubmitting}
          >
            <Pencil className="h-3.5 w-3.5 mr-1.5" />
            {editing ? "Visualizar Prévia" : "Editar Texto"}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {editing ? (
            <Textarea
              className="min-h-[400px] font-mono text-sm border-0 rounded-none focus-visible:ring-0 resize-none p-4"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Edite o markdown aqui..."
            />
          ) : (
            <div className="p-8 overflow-y-auto max-h-[70vh] bg-background">
              <div className="max-w-4xl mx-auto space-y-8 pb-12">
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
                    {content.replace(/\\n/g, "\n").replace(/^!\[Logo\].*$/gm, "")}
                  </ReactMarkdown>
                </div>

                {/* Renderizar campos de resposta baseados nas questões detectadas */}
                <div className="mt-12 space-y-8 pt-8 border-t border-dashed">
                  {content.match(/Questão \d+:.+/g)?.map((q, idx) => (
                    <div key={idx} className="space-y-3">
                      <label className="text-sm font-bold text-foreground flex items-center gap-2">
                        <span className="bg-primary/10 text-primary w-6 h-6 rounded-full flex items-center justify-center text-[10px]">{idx + 1}</span>
                        {q.replace(/Questão \d+:\s*/, "")}
                      </label>
                      <div className="h-32 w-full rounded-md border-2 border-dashed border-muted bg-muted/5 flex items-center justify-center text-muted-foreground italic text-sm">
                        Área de resposta do aluno {idx + 1}
                      </div>
                    </div>
                  )) || (
                    <div className="text-center py-6 text-muted-foreground text-sm italic">
                      Nenhuma questão específica detectada no texto.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end bg-background/95 backdrop-blur pt-4 border-t">
        <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Voltar
        </Button>
        <Button onClick={() => onApprove(content)} disabled={isSubmitting}>
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4 mr-2" />
          )}
          Aprovar e Publicar
        </Button>
      </div>
    </div>
  );
};
