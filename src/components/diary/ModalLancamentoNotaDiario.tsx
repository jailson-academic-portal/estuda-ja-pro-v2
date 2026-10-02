import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { Loader2, CheckCircle2 } from "lucide-react";
import { getDiaryColumns, releaseGradeToDiary } from "@/backend/diary-release.functions";

interface ModalLancamentoNotaDiarioProps {
  open: boolean;
  onClose: () => void;
  disciplineId: string;
  studentId: string;
  studentName?: string;
  obtainedScore: number;
  maxScore: number;
  activityRef: {
    id: string;
    type: string;
    title: string;
  };
  /** Coluna do diário já vinculada à avaliação/atividade (pré-seleção) */
  defaultColumnId?: string | null;
  onSuccess?: () => void;
}

export function ModalLancamentoNotaDiario({
  open,
  onClose,
  disciplineId,
  studentId,
  studentName,
  obtainedScore,
  maxScore,
  activityRef,
  defaultColumnId,
  onSuccess,
}: ModalLancamentoNotaDiarioProps) {
  const [columns, setColumns] = useState<{ id: string; name: string; max_score: number }[]>([]);
  const [selectedColumnId, setSelectedColumnId] = useState<string>("");
  const [mode, setMode] = useState<"replace" | "sum">("replace");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setLoading(true);
      getDiaryColumns({ data: { discipline_id: disciplineId } })
        .then((res) => {
          setColumns(res);
          const preset = defaultColumnId && res.some((c) => c.id === defaultColumnId)
            ? defaultColumnId
            : null;
          if (preset) setSelectedColumnId(preset);
          else if (res.length > 0) setSelectedColumnId(res[0].id);
        })
        .catch((err) => toast.error("Erro ao carregar colunas do diário"))
        .finally(() => setLoading(false));
    }
  }, [open, disciplineId, defaultColumnId]);

  const handleRelease = async () => {
    if (!selectedColumnId) {
      toast.error("Selecione uma coluna do diário");
      return;
    }

    setSubmitting(true);
    try {
      await releaseGradeToDiary({
        data: {
          discipline_id: disciplineId,
          student_id: studentId,
          assessment_id: selectedColumnId,
          score: obtainedScore,
          mode,
          activity_ref: activityRef,
        },
      });
      toast.success("Nota lançada no diário com sucesso!");
      onSuccess?.();
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Erro ao lançar nota");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            Lançamento de Nota no Diário
          </DialogTitle>
          <DialogDescription>
            Atividade concluída. Escolha onde lançar esta nota no diário de classe.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {studentName && (
            <div className="space-y-1">
              <Label className="text-muted-foreground">Aluno(a)</Label>
              <div className="font-medium">{studentName}</div>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-muted-foreground">Atividade</Label>
            <div className="font-medium">{activityRef.title}</div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-muted-foreground">Nota Obtida</Label>
              <div className="text-xl font-bold text-primary">
                {obtainedScore.toFixed(2).replace(".", ",")}
              </div>
            </div>
            <div className="space-y-1 text-right">
              <Label className="text-muted-foreground">Nota Máxima</Label>
              <div className="text-xl font-bold">
                {maxScore.toFixed(2).replace(".", ",")}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Coluna do Diário</Label>
            <Select
              value={selectedColumnId}
              onValueChange={setSelectedColumnId}
              disabled={loading}
            >
              <SelectTrigger>
                <SelectValue placeholder={loading ? "Carregando..." : "Selecione a coluna"} />
              </SelectTrigger>
              <SelectContent>
                {columns.map((col) => (
                  <SelectItem key={col.id} value={col.id}>
                    {col.name} (Máx: {col.max_score})
                  </SelectItem>
                ))}
                {columns.length === 0 && !loading && (
                  <SelectItem value="none" disabled>
                    Nenhuma coluna configurada
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <Label>Forma de Lançamento</Label>
            <RadioGroup
              value={mode}
              onValueChange={(v: any) => setMode(v)}
              className="flex flex-col space-y-2"
            >
              <div className="flex items-center space-x-2 rounded-lg border p-3 hover:bg-muted/50 transition-colors">
                <RadioGroupItem value="replace" id="replace" />
                <Label htmlFor="replace" className="flex-1 cursor-pointer font-normal">
                  <strong>Substituir</strong>
                  <span className="block text-xs text-muted-foreground">
                    Substitui qualquer nota já lançada nesta coluna.
                  </span>
                </Label>
              </div>
              <div className="flex items-center space-x-2 rounded-lg border p-3 hover:bg-muted/50 transition-colors">
                <RadioGroupItem value="sum" id="sum" />
                <Label htmlFor="sum" className="flex-1 cursor-pointer font-normal">
                  <strong>Somar</strong>
                  <span className="block text-xs text-muted-foreground">
                    Soma o valor atual ao valor já existente na coluna.
                  </span>
                </Label>
              </div>
            </RadioGroup>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleRelease} disabled={submitting || columns.length === 0}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar Lançamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
