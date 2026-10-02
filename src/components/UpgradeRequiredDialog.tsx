import { Link } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Crown, Check } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the user just tried to do, used in the headline. */
  reason: "discipline" | "students";
}

const COPY = {
  discipline: {
    title: "Limite do plano Gratuito atingido",
    description: "O plano Gratuito permite apenas 1 disciplina ativa. Faça upgrade para o Professor Pro e crie disciplinas ilimitadas.",
  },
  students: {
    title: "Limite do plano Gratuito atingido",
    description: "O plano Gratuito permite no máximo 30 alunos por disciplina. Faça upgrade para o Professor Pro e adicione alunos sem limite.",
  },
} as const;

export function UpgradeRequiredDialog({ open, onOpenChange, reason }: Props) {
  const copy = COPY[reason];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-amber-500" /> {copy.title}
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border p-4 bg-muted/40 space-y-2 text-sm">
          <div className="font-semibold flex items-baseline gap-2">
            Professor Pro
            <span className="text-2xl font-bold">R$ 40</span>
            <span className="text-xs text-muted-foreground">/mês</span>
          </div>
          <ul className="space-y-1 text-sm">
            <li className="flex items-start gap-2"><Check className="h-4 w-4 text-green-600 mt-0.5" /> Disciplinas ilimitadas</li>
            <li className="flex items-start gap-2"><Check className="h-4 w-4 text-green-600 mt-0.5" /> Alunos ilimitados</li>
            <li className="flex items-start gap-2"><Check className="h-4 w-4 text-green-600 mt-0.5" /> 7 dias de teste grátis</li>
          </ul>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Agora não</Button>
          <Button asChild>
            <Link to="/billing" onClick={() => onOpenChange(false)}>
              <Crown className="h-4 w-4 mr-1" /> Fazer upgrade
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}