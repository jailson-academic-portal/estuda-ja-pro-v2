import React from "react";
import { Calendar, AlertTriangle } from "lucide-react";
import { format, isAfter } from "date-fns";
import { ptBR } from "date-fns/locale";

/**
 * Linha compacta (fonte secundária/cinza) com o prazo de entrega do caso
 * clínico e a regra de atraso aplicada.
 *
 * Uso no card do aluno (SimulSaúde), logo abaixo da descrição e acima do botão
 * "Iniciar Simulação Clínica":
 *
 * <CaseDeadlineInfoRow
 *   dueDate={c.due_date}
 *   dueTime={c.due_time}
 *   lateToleranceDate={c.late_tolerance_date}
 *   lateToleranceTime={c.late_tolerance_time}
 *   allowLate={c.allow_late_submission}
 *   penaltyPerDay={c.late_penalty_per_day}
 *   penaltyType={c.late_penalty_type}
 * />
 */
export interface CaseDeadlineInfoRowProps {
  /** Data limite de entrega (ISO ou yyyy-MM-dd). */
  dueDate?: string | null;
  /** Horário limite no formato HH:MM:SS, usado quando a data vem sem hora. */
  dueTime?: string | null;
  /** Início opcional da janela de entrega — quando informado, exibe "até". */
  startDate?: string | null;
  /** Data final da tolerância de atraso (opcional). */
  lateToleranceDate?: string | null;
  /** Horário final da tolerância de atraso (opcional). */
  lateToleranceTime?: string | null;
  /** false = não aceita entrega após o prazo. */
  allowLate?: boolean | null;
  /** Desconto aplicado por dia de atraso. */
  penaltyPerDay?: number | null;
  /** "percentage" (padrão) ou "points". */
  penaltyType?: string | null;
  className?: string;
}

function buildDateTime(dateValue?: string | null, timeValue?: string | null): Date | null {
  if (!dateValue) return null;

  const raw = String(dateValue);
  const hasExplicitTime =
    raw.includes("T") && !/T00:00(:00)?(\.000)?(Z|[+-]\d{2}:?\d{2})?$/.test(raw);
  const parsed = new Date(raw.length <= 10 ? `${raw}T00:00:00` : raw);
  if (Number.isNaN(parsed.getTime())) return null;

  if (!hasExplicitTime && timeValue) {
    const [h = "23", m = "59"] = String(timeValue).split(":");
    parsed.setHours(Number(h) || 0, Number(m) || 0, 0, 0);
  }

  return parsed;
}

export const CaseDeadlineInfoRow: React.FC<CaseDeadlineInfoRowProps> = ({
  dueDate,
  dueTime,
  startDate,
  lateToleranceDate,
  lateToleranceTime,
  allowLate,
  penaltyPerDay,
  penaltyType,
  className,
}) => {
  const started = buildDateTime(startDate, null);
  const deadline = buildDateTime(dueDate, dueTime);
  const tolerance = buildDateTime(lateToleranceDate, lateToleranceTime);
  const endsAt = tolerance ?? deadline;

  if (!started && !endsAt) return null;

  const isOverdue = deadline ? isAfter(new Date(), deadline) : false;

  const deadlineText =
    started && endsAt
      ? `Prazo: ${format(started, "dd/MM/yyyy", { locale: ptBR })} até ${format(endsAt, "dd/MM/yyyy", { locale: ptBR })} às ${format(endsAt, "HH:mm", { locale: ptBR })}`
      : endsAt
        ? `Prazo: ${format(endsAt, "dd/MM/yyyy", { locale: ptBR })} às ${format(endsAt, "HH:mm", { locale: ptBR })}`
        : "Prazo não definido";

  const perDay = penaltyPerDay != null ? Number(penaltyPerDay) : 0;
  const hasPenalty = Number.isFinite(perDay) && perDay > 0;
  const isPoints = String(penaltyType ?? "percentage").toLowerCase().startsWith("point");
  const penaltyValue = perDay.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

  const hasRuleInfo = allowLate === false || allowLate === true || hasPenalty;

  const ruleText =
    allowLate === false
      ? "Não permitido"
      : !hasPenalty
        ? "Sem penalidade por atraso"
        : isPoints
          ? `Atraso: -${penaltyValue} pontos da nota`
          : `Atraso: -${penaltyValue}% da nota`;

  const ruleClass =
    allowLate === false || isOverdue
      ? "text-red-600"
      : hasPenalty
        ? "text-amber-600"
        : "text-muted-foreground";

  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground ${className ?? ""}`}
    >
      <span className="inline-flex items-center gap-1.5">
        <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {deadlineText}
      </span>
      {hasRuleInfo && (
        <span className={`inline-flex items-center gap-1.5 font-medium ${ruleClass}`}>
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {ruleText}
        </span>
      )}
    </div>
  );
};

export default CaseDeadlineInfoRow;
