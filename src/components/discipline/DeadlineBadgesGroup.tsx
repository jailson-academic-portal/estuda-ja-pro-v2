import React, { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export interface DeadlineBadgesGroupProps {
  /** Data limite ISO ou yyyy-MM-dd */
  dueDate?: string | null;
  /** Horário limite formato HH:mm */
  dueTime?: string | null;
  /** Permite envio em atraso */
  allowLate?: boolean | null;
  /** Penalidade cobrada por dia de atraso */
  penaltyPerDay?: number | null;
  /** Tipo de penalidade ('percentage' ou 'fixed'/'points') */
  penaltyType?: string | null;
  className?: string;
}

function parseTargetDate(dateVal?: string | null, timeVal?: string | null): Date | null {
  if (!dateVal) return null;
  const raw = String(dateVal);
  const hasTime = raw.includes("T") && !/T00:00(:00)?(\.000)?(Z|[+-]\d{2}:?\d{2})?$/.test(raw);
  const d = new Date(raw.length <= 10 ? `${raw}T00:00:00` : raw);
  if (Number.isNaN(d.getTime())) return null;

  if (!hasTime && timeVal) {
    const [h = "23", m = "59"] = String(timeVal).split(":");
    d.setHours(Number(h) || 0, Number(m) || 0, 0, 0);
  } else if (!hasTime) {
    d.setHours(23, 59, 59, 999);
  }
  return d;
}

export const DeadlineBadgesGroup: React.FC<DeadlineBadgesGroupProps> = ({
  dueDate,
  dueTime,
  allowLate,
  penaltyPerDay,
  penaltyType = "fixed",
  className = "",
}) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const targetDate = parseTargetDate(dueDate, dueTime);

  if (!targetDate) return null;

  const diff = targetDate.getTime() - now;
  const isOverdue = diff <= 0;
  const absDiff = Math.abs(diff);

  const days = Math.floor(absDiff / 86_400_000);
  const hours = Math.floor((absDiff % 86_400_000) / 3_600_000);
  const mins = Math.floor((absDiff % 3_600_000) / 60_000);

  const perDay = penaltyPerDay != null && Number(penaltyPerDay) > 0 ? Number(penaltyPerDay) : 0;
  const isPoints = String(penaltyType ?? "").toLowerCase().startsWith("point") || String(penaltyType ?? "").toLowerCase().startsWith("fixed");
  const penaltyLabel = perDay.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });

  const dateFormatted = format(targetDate, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });

  let statusBadge: React.ReactNode = null;
  let penaltyBadge: React.ReactNode = null;

  if (isOverdue) {
    const lateDays = Math.max(1, Math.ceil(absDiff / 86_400_000));
    const lateStr =
      days > 0 ? `Atrasado há ${days}d ${hours}h` : hours > 0 ? `Atrasado há ${hours}h ${mins}m` : `Atrasado há ${mins}m`;

    statusBadge = (
      <Badge variant="destructive" className="flex items-center gap-1 font-medium text-xs shrink-0">
        <AlertTriangle className="h-3 w-3 shrink-0" />
        {lateStr}
      </Badge>
    );

    if (allowLate === false) {
      penaltyBadge = (
        <Badge
          variant="outline"
          className="flex items-center gap-1 border-destructive/40 bg-destructive/10 text-[10px] text-destructive font-medium shrink-0"
        >
          <AlertTriangle className="h-3 w-3 shrink-0" />
          Não aceita entregas após o prazo
        </Badge>
      );
    } else if (perDay > 0) {
      penaltyBadge = (
        <Badge
          variant="outline"
          className="flex items-center gap-1 border-destructive/40 bg-destructive/10 text-[10px] text-destructive font-medium shrink-0"
        >
          <AlertTriangle className="h-3 w-3 shrink-0" />
          Penalidade: −{penaltyLabel}{isPoints ? " pts" : "%"}/dia ({lateDays}d)
        </Badge>
      );
    }
  } else {
    const timeStr =
      days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${mins}min` : `${mins}min`;

    statusBadge = (
      <Badge
        variant="outline"
        className="flex items-center gap-1 border-amber-500 text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-600 font-medium text-xs shrink-0"
      >
        <Clock className="h-3 w-3 shrink-0" />
        Faltam {timeStr}
      </Badge>
    );

    if (allowLate === false) {
      penaltyBadge = (
        <Badge
          variant="outline"
          className="flex items-center gap-1 border-destructive/40 bg-destructive/10 text-[10px] text-destructive font-medium shrink-0"
        >
          <AlertTriangle className="h-3 w-3 shrink-0" />
          Sem reenvio após prazo
        </Badge>
      );
    } else if (perDay > 0) {
      penaltyBadge = (
        <Badge
          variant="outline"
          className="flex items-center gap-1 border-destructive/40 bg-destructive/10 text-[10px] text-destructive font-medium shrink-0"
        >
          <AlertTriangle className="h-3 w-3 shrink-0" />
          Entrega após o prazo: −{penaltyLabel}{isPoints ? " pts" : "%"} por dia de atraso
        </Badge>
      );
    }
  }

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      <Badge
        variant="outline"
        className="flex items-center gap-1 border-primary/30 text-primary bg-primary/5 font-medium text-xs shrink-0"
      >
        <Calendar className="h-3 w-3 shrink-0" />
        Entrega: {dateFormatted}
      </Badge>
      {statusBadge}
      {penaltyBadge}
    </div>
  );
};

export default DeadlineBadgesGroup;
