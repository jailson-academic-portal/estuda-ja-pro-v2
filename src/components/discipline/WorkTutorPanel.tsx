import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bot, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { getWorkTutorGuidance } from "@/backend/works.functions";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export type TutorSection =
  | "capa"
  | "resumo"
  | "introducao"
  | "desenvolvimento"
  | "metodologia"
  | "consideracoes"
  | "finalizar";

const SECTION_LABELS: Record<TutorSection, string> = {
  capa: "Capa e identificação",
  resumo: "Resumo e palavras-chave",
  introducao: "Introdução",
  desenvolvimento: "Desenvolvimento / Revisão de Literatura",
  metodologia: "Metodologia",
  consideracoes: "Considerações finais e referências",
  finalizar: "Revisão final e envio",
};

interface WorkTutorPanelProps {
  /** Painel aberto (reduz a largura da área principal de texto). */
  open: boolean;
  /** Fecha o painel (botão X). */
  onClose: () => void;
  section: TutorSection;
  text: string;
  title?: string;
  instructions?: string | null;
}

/**
 * Tutor IA do Assistente de Trabalho ABNT — painel lateral (sidebar) à direita.
 * Não é modal: ao abrir, ocupa a lateral do assistente e empurra/reduz a área de
 * leitura e edição, permitindo comparar o texto com a devolutiva lado a lado.
 * Usa o system prompt dinâmico do backend (persona base fixa + instruções da aba
 * ativa) e devolve a orientação no formato do sanduíche, sem escrever o texto
 * pelo estudante.
 */
export function WorkTutorPanel({
  open,
  onClose,
  section,
  text,
  title,
  instructions,
}: WorkTutorPanelProps) {
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState("");

  // A devolutiva é específica da etapa: ao trocar de aba o painel é limpo.
  useEffect(() => {
    setFeedback("");
  }, [section]);

  const handleAsk = async () => {
    const body = (text ?? "").trim();
    if (body.length < 20) {
      toast.error(
        "Preencha esta etapa com um pouco mais de conteúdo antes de pedir a orientação do Tutor IA.",
      );
      return;
    }
    setLoading(true);
    try {
      const result = await getWorkTutorGuidance({
        data: {
          section,
          text: body.slice(0, 50000),
          title: title ? title.slice(0, 300) : undefined,
          instructions: instructions ? instructions.slice(0, 8000) : undefined,
        },
      });
      const content =
        typeof result === "string"
          ? result
          : String((result as { content?: string } | null)?.content ?? "");
      if (!content.trim()) {
        throw new Error("O Tutor IA não retornou orientações. Tente novamente.");
      }
      setFeedback(content.trim());
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Não foi possível falar com o Tutor IA agora.",
      );
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <aside
      aria-label="Painel do Tutor IA"
      className="absolute inset-y-0 right-0 z-20 flex min-h-0 w-[86vw] max-w-[400px] flex-col border-l bg-background shadow-xl sm:static sm:z-auto sm:w-[360px] sm:max-w-none sm:shrink-0 sm:bg-muted/20 sm:shadow-none lg:w-[400px]"
    >
      <div className="flex items-start justify-between gap-2 border-b bg-background px-4 py-3">
        <div className="flex min-w-0 items-start gap-2">
          <span className="shrink-0 rounded-lg bg-primary/10 p-1.5">
            <Bot className="h-4 w-4 text-primary" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-tight">Tutor IA</h3>
            <p className="truncate text-xs text-muted-foreground">
              {SECTION_LABELS[section]}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={onClose}
          aria-label="Fechar painel do Tutor IA"
          title="Fechar painel"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Analisa a etapa “{SECTION_LABELS[section]}” e devolve pontos fortes, o que
          melhorar e os próximos passos — sem escrever o texto por você.
        </p>

        <Button
          size="sm"
          onClick={handleAsk}
          disabled={loading}
          className="w-full gap-2"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : feedback ? (
            <RefreshCw className="h-4 w-4" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {loading ? "Analisando..." : feedback ? "Analisar novamente" : "Pedir orientação"}
        </Button>

        {feedback ? (
          <div className="space-y-3 rounded-lg border bg-background p-4">
            <Badge variant="outline" className="text-[10px]">
              {SECTION_LABELS[section]}
            </Badge>
            <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{feedback}</ReactMarkdown>
            </div>
            <p className="text-[11px] italic text-muted-foreground mt-4 border-t pt-2">
              A orientação é pedagógica e não substitui a correção do professor.
            </p>
          </div>
        ) : (
          <p className="text-xs italic text-muted-foreground">
            A devolutiva aparece aqui, ao lado do seu texto — você lê e continua
            editando sem fechar nada.
          </p>
        )}
      </div>
    </aside>
  );
}
