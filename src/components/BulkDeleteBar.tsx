import { Button } from "@/components/ui/button";
import { Loader2, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface BulkDeleteBarProps {
  count: number;
  itemLabel: string; // e.g. "material", "lista", "atividade", "trabalho"
  onClear: () => void;
  onConfirm: () => Promise<void> | void;
}

export function BulkDeleteBar({ count, itemLabel, onClear, onConfirm }: BulkDeleteBarProps) {
  const [busy, setBusy] = useState(false);
  if (count <= 0) return null;
  const plural = count === 1 ? itemLabel : `${itemLabel}s`;

  const handleConfirm = async () => {
    if (!confirm(`Excluir ${count} ${plural} selecionado(s)? Esta ação não pode ser desfeita.`)) return;
    setBusy(true);
    try {
      await onConfirm();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao excluir");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sticky bottom-4 z-30 mt-3 flex justify-center pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border bg-background/95 backdrop-blur px-3 py-2 shadow-lg">
        <span className="text-sm font-medium px-2">
          {count} {plural} selecionado(s)
        </span>
        <Button size="sm" variant="ghost" onClick={onClear} disabled={busy}>
          <X className="h-4 w-4 mr-1" /> Limpar
        </Button>
        <Button size="sm" variant="destructive" onClick={handleConfirm} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
          Excluir selecionados
        </Button>
      </div>
    </div>
  );
}