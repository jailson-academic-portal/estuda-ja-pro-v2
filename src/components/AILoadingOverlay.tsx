import { useEffect, useState } from "react";
import owl from "@/assets/owl-logo.png";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

const DEFAULT_STEPS = [
  "Lendo a ementa…",
  "Organizando os tópicos…",
  "Gerando o conteúdo…",
  "Refinando os detalhes…",
  "Finalizando o material…",
];

interface Props {
  open: boolean;
  steps?: string[];
  onCancel?: () => void;
}

export function AILoadingOverlay({ open, steps = DEFAULT_STEPS, onCancel }: Props) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!open) { setIdx(0); return; }
    const t = setInterval(() => setIdx((i) => (i + 1) % steps.length), 2400);
    return () => clearInterval(t);
  }, [open, steps.length]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <div
        className="rounded-2xl bg-card p-8 shadow-xl max-w-sm w-[90%] text-center"
        style={{ boxShadow: "var(--shadow-soft)" }}
      >
        <div className="flex justify-center mb-4">
          <img
            src={owl}
            alt="Assistente IA trabalhando"
            width={96}
            height={96}
            className="animate-owl-bounce"
          />
        </div>
        <h3 className="font-semibold text-lg mb-1">Assessor IA em ação</h3>
        <p className="text-sm text-muted-foreground min-h-[1.25rem] transition-opacity">
          {steps[idx]}
        </p>
        <div className="flex justify-center gap-1.5 mt-4">
          {steps.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === idx ? "w-6 bg-primary" : "w-1.5 bg-muted"}`}
            />
          ))}
        </div>
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel} className="mt-4">
            <X className="h-4 w-4 mr-1" /> Cancelar
          </Button>
        )}
      </div>
    </div>
  );
}