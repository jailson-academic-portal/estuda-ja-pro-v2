import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock,
  Flag,
  Home,
  ListChecks,
  Loader2,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Esqueleto visual da sala de prova online do aluno.
 *
 * Este componente é INTENCIONALMENTE isolado:
 *  - Não lê dados de tabelas, hooks ou integrações.
 *  - Não está conectado a nenhuma rota nem botão existente.
 *  - Aceita apenas dados estáticos via `exam`, `questions` e `initialIndex`.
 *  - Cronômetro e navegação são puramente visuais (useState local).
 *
 * Próximos passos (fora do escopo deste passo):
 *  - Buscar `online_exams`, `assessment_questions` e `exam_sessions` reais.
 *  - Persistir em `exam_answers` ao navegar/finalizar.
 *  - Integrar checagem biométrica e telemetria de integridade.
 */

type ExamQuestionOption = {
  id: string;
  label: string;
};

export type ExamQuestionView = {
  id: string;
  number: number;
  prompt: string;
  options: ExamQuestionOption[];
  selectedOptionId?: string | null;
  flagged?: boolean;
};

export type ExamHeaderView = {
  title: string;
  disciplineName?: string;
  durationMinutes: number;
  totalQuestions: number;
  instructions?: string | null;
};

/** Resposta atual persistida (uma por questão). */
export type ExamAnswerState = {
  questionId: string;
  selectedOptionId: string | null;
  flagged: boolean;
};

export type StudentOnlineExamRoomProps = {
  exam: ExamHeaderView;
  questions: ExamQuestionView[];
  initialIndex?: number;
  className?: string;
  /**
   * Respostas iniciais (usado para retomar uma prova em progresso ou
   * visualizar uma prova já enviada). Se omitido, o componente parte em branco.
   */
  initialAnswers?: ExamAnswerState[];
  /**
   * Quando fornecido, o pai assume controle do estado de "finalizado".
   * Útil para mostrar a tela de sucesso em provas já submetidas após reload.
   */
  finished?: boolean;
  /** Callback puramente visual — não persiste nada. */
  onNavigate?: (nextIndex: number) => void;
  /** Disparado quando uma alternativa é escolhida. */
  onSelectOption?: (questionId: string, optionId: string) => void;
  /** Disparado quando o aluno marca/desmarca para revisão. */
  onToggleFlag?: (questionId: string) => void;
  /** Disparado quando o aluno clica em Finalizar e confirma. */
  onFinishAttempt?: () => void;
  /**
   * Disparado AUTOMATICAMENTE quando o cronômetro visual chega a zero.
   * O pai (rota) é responsável por submeter as respostas ao servidor
   * e mostrar a tela de conclusão. Disparado no máximo uma vez por
   * montagem do componente. Se não for fornecido, nada acontece
   * (mantém o comportamento original de cronômetro puramente visual).
   */
  onAutoSubmit?: () => void;
};

function formatRemaining(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

export function StudentOnlineExamRoom({
  exam,
  questions,
  initialIndex = 0,
  className,
  initialAnswers,
  finished,
  onNavigate,
  onSelectOption,
  onToggleFlag,
  onFinishAttempt,
  onAutoSubmit,
}: StudentOnlineExamRoomProps) {
  const safeQuestions = useMemo(() => questions ?? [], [questions]);
  const total = safeQuestions.length;
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(initialIndex, 0), Math.max(total - 1, 0)),
  );

  // Cronômetro puramente visual (não persiste em lugar nenhum).
  const [remainingSeconds, setRemainingSeconds] = useState(
    () => Math.max(exam.durationMinutes, 0) * 60,
  );

  // Modo "controlado" para finished: se a prop vier, ela prevalece.
  // Caso contrário, o componente tem estado interno.
  const [localFinished, setLocalFinished] = useState(false);
  const isFinished = finished ?? localFinished;

  useEffect(() => {
    setRemainingSeconds(Math.max(exam.durationMinutes, 0) * 60);
    setLocalFinished(false);
  }, [exam.durationMinutes]);

  useEffect(() => {
    // Para o tick ao finalizar ou quando o tempo já acabou.
    if (isFinished || remainingSeconds <= 0) return;
    const id = window.setInterval(() => {
      setRemainingSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [remainingSeconds > 0, isFinished]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-submit: quando o cronômetro visual zera, dispara o callback
  // uma unica vez. O pai cuida de persistir e fechar a sessao. Guardado
  // por uma ref para sobreviver a renders e nao disparar de novo em
  // caso de StrictMode double-effect.
  const autoSubmittedRef = useRef(false);
  useEffect(() => {
    if (!onAutoSubmit) return;
    if (isFinished) return;
    if (remainingSeconds > 0) return;
    if (autoSubmittedRef.current) return;
    autoSubmittedRef.current = true;
    onAutoSubmit();
  }, [remainingSeconds, isFinished, onAutoSubmit]);

  const current = safeQuestions[index];

  const goTo = (next: number) => {
    if (total === 0) return;
    const clamped = Math.min(Math.max(next, 0), total - 1);
    setIndex(clamped);
    onNavigate?.(clamped);
  };

  const handleSelectOption = (questionId: string, optionId: string) => {
    onSelectOption?.(questionId, optionId);
  };

  const handleToggleFlag = (questionId: string) => {
    onToggleFlag?.(questionId);
  };

  const confirmFinish = () => {
    setLocalFinished(true);
    onFinishAttempt?.();
  };

  const goToDashboard = () => {
    // Apenas visual por enquanto — o redirecionamento real será
    // conectado pelo backend/integração em outro passo.
  };

  // Calcula respostas/flags efetivas: prioriza initialAnswers (controlado),
  // depois cai pra `selectedOptionId`/`flagged` injetados em cada questão.
  const effectiveSelection = (q: ExamQuestionView): string | null => {
    if (initialAnswers) {
      const a = initialAnswers.find((x) => x.questionId === q.id);
      if (a) return a.selectedOptionId;
    }
    return q.selectedOptionId ?? null;
  };
  const effectiveFlag = (q: ExamQuestionView): boolean => {
    if (initialAnswers) {
      const a = initialAnswers.find((x) => x.questionId === q.id);
      if (a) return a.flagged;
    }
    return q.flagged ?? false;
  };

  const answeredCount = safeQuestions.filter((q) => {
    const s = effectiveSelection(q);
    return s != null && s !== "";
  }).length;

  const flaggedCount = safeQuestions.filter((q) => effectiveFlag(q)).length;

  const progressPct = total === 0 ? 0 : Math.round((answeredCount / total) * 100);

  const timeLow = remainingSeconds > 0 && remainingSeconds <= 5 * 60;

  return (
    <TooltipProvider delayDuration={150}>
      <div
        className={cn(
          "flex min-h-[calc(100vh-4rem)] w-full flex-col gap-4 bg-muted/30 p-4 md:p-6",
          className,
        )}
        aria-label="Sala de prova online"
      >
        {/* Cabeçalho: título + cronômetro + resumo */}
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="flex flex-col gap-3 pb-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="font-medium">
                  <ListChecks className="mr-1 h-3.5 w-3.5" />
                  Avaliação Online
                </Badge>
                {exam.disciplineName && <Badge variant="outline">{exam.disciplineName}</Badge>}
              </div>
              <h1 className="text-xl font-semibold leading-tight md:text-2xl">{exam.title}</h1>
            </div>

            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-2 font-mono text-base md:text-lg",
                  timeLow
                    ? "border-destructive/50 bg-destructive/10 text-destructive"
                    : "border-border bg-background text-foreground",
                )}
                aria-live="polite"
                aria-label="Tempo restante"
              >
                <Clock className="h-4 w-4" aria-hidden />
                <span>{formatRemaining(remainingSeconds)}</span>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={confirmFinish}
                    disabled={total === 0 || isFinished}
                  >
                    <Send className="mr-2 h-4 w-4" />
                    Finalizar
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Encerra a tentativa atual (apenas visual por enquanto).
                </TooltipContent>
              </Tooltip>
            </div>
          </CardHeader>

          <Separator />

          <CardContent className="grid gap-3 pt-4 md:grid-cols-[1fr_auto] md:gap-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  Respondidas <span className="font-medium text-foreground">{answeredCount}</span>{" "}
                  de <span className="font-medium text-foreground">{total}</span>
                </span>
                {flaggedCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-amber-600">
                    <Flag className="h-3.5 w-3.5" />
                    {flaggedCount} marcada(s) para revisão
                  </span>
                )}
              </div>
              <Progress value={progressPct} aria-label="Progresso de respostas" />
            </div>

            {exam.instructions && (
              <p className="max-w-md text-sm text-muted-foreground md:text-right">
                {exam.instructions}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Área principal: tela de sucesso OU questão + mapa lateral */}
        {isFinished ? (
          <Card
            className="border-emerald-200/60 bg-emerald-50/30 shadow-sm"
            aria-label="Avaliação finalizada"
          >
            <CardContent className="flex flex-col items-center justify-center gap-6 py-16 text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 shadow-inner">
                <CheckCircle2 className="h-12 w-12" aria-hidden />
              </div>

              <div className="space-y-2">
                <h2 className="text-2xl font-semibold text-foreground md:text-3xl">
                  Avaliação enviada com sucesso!
                </h2>
                <p className="mx-auto max-w-md text-sm text-muted-foreground md:text-base">
                  Suas respostas foram registradas. A nota e o gabarito serão disponibilizados após
                  a liberação pelo professor.
                </p>
              </div>

              <div
                role="status"
                aria-live="polite"
                className="w-full max-w-xl rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm"
              >
                <p className="font-medium">
                  Sua nota e o gabarito estarão disponíveis assim que o professor realizar a
                  liberação.
                </p>
              </div>

              <Button
                type="button"
                variant="default"
                size="lg"
                onClick={goToDashboard}
                className="mt-2"
              >
                <Home className="mr-2 h-4 w-4" />
                Voltar ao Painel
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid flex-1 gap-4 lg:grid-cols-[1fr_18rem]">
            {/* Leitura da questão */}
            <Card className="border-border/70 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono">
                    Questão {total === 0 ? 0 : index + 1} / {total}
                  </Badge>
                  {current && effectiveFlag(current) && (
                    <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                      <Flag className="mr-1 h-3.5 w-3.5" />
                      Marcada
                    </Badge>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => current && handleToggleFlag(current.id)}
                  disabled={!current}
                  aria-pressed={current ? effectiveFlag(current) : false}
                >
                  <Flag
                    className={cn(
                      "mr-1.5 h-4 w-4",
                      current && effectiveFlag(current) && "fill-amber-500 text-amber-500",
                    )}
                  />
                  {current && effectiveFlag(current) ? "Desmarcar" : "Marcar para revisão"}
                </Button>
              </CardHeader>

              <Separator />

              <CardContent className="space-y-5 py-6">
                {current ? (
                  <>
                    <p className="whitespace-pre-line text-base leading-relaxed md:text-lg">
                      {current.prompt}
                    </p>

                    <fieldset
                      className="space-y-2"
                      aria-label={`Alternativas da questão ${current.number}`}
                    >
                      <legend className="sr-only">Alternativas da questão {current.number}</legend>
                      {current.options.length === 0 && (
                        <p className="text-sm italic text-muted-foreground">
                          Esta questão ainda não possui alternativas (esqueleto visual).
                        </p>
                      )}
                      {current.options.map((opt, optIdx) => {
                        const checked = effectiveSelection(current) === opt.id;
                        const letter = String.fromCharCode(65 + optIdx);
                        return (
                          <label
                            key={opt.id}
                            className={cn(
                              "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                              checked
                                ? "border-primary bg-primary/5"
                                : "border-border hover:border-primary/50 hover:bg-muted/40",
                            )}
                          >
                            <input
                              type="radio"
                              name={`q-${current.id}`}
                              value={opt.id}
                              checked={checked}
                              onChange={() => handleSelectOption(current.id, opt.id)}
                              className="mt-1 h-4 w-4 accent-primary"
                            />
                            <span className="flex w-full items-start gap-3">
                              <span
                                className={cn(
                                  "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                                  checked
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-border bg-background text-muted-foreground",
                                )}
                              >
                                {letter}
                              </span>
                              <span className="text-sm leading-relaxed md:text-base">
                                {opt.label}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </fieldset>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin" />
                    <p>Nenhuma questão disponível (esqueleto visual).</p>
                  </div>
                )}
              </CardContent>

              <Separator />

              <CardFooter className="flex items-center justify-between gap-2 py-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => goTo(index - 1)}
                  disabled={index <= 0}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Anterior
                </Button>

                <div className="hidden text-xs text-muted-foreground sm:block">
                  Use Próxima para avançar; Finalizar encerra a tentativa.
                </div>

                <Button type="button" onClick={() => goTo(index + 1)} disabled={index >= total - 1}>
                  Próxima
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </CardFooter>
            </Card>

            {/* Mapa lateral de navegação */}
            <Card className="border-border/70 shadow-sm lg:sticky lg:top-4 lg:h-fit">
              <CardHeader className="pb-3">
                <h2 className="text-sm font-semibold">Mapa de questões</h2>
                <p className="text-xs text-muted-foreground">
                  Clique para ir direto a uma questão.
                </p>
              </CardHeader>
              <Separator />
              <CardContent className="py-4">
                {total === 0 ? (
                  <p className="text-xs italic text-muted-foreground">Sem questões no esqueleto.</p>
                ) : (
                  <div className="grid grid-cols-5 gap-2">
                    {safeQuestions.map((q, i) => {
                      const isCurrent = i === index;
                      const answered =
                        effectiveSelection(q) != null && effectiveSelection(q) !== "";
                      const flagged = effectiveFlag(q);
                      return (
                        <button
                          key={q.id}
                          type="button"
                          onClick={() => goTo(i)}
                          className={cn(
                            "relative flex h-9 w-9 items-center justify-center rounded-md border text-xs font-medium transition-colors",
                            isCurrent
                              ? "border-primary bg-primary text-primary-foreground"
                              : answered
                                ? "border-emerald-500/60 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                : "border-border bg-background text-muted-foreground hover:bg-muted",
                          )}
                          aria-current={isCurrent ? "true" : undefined}
                          aria-label={`Ir para questão ${i + 1}${answered ? " (respondida)" : ""}${flagged ? " (marcada)" : ""}`}
                        >
                          {i + 1}
                          {flagged && (
                            <Flag
                              className="absolute -right-1 -top-1 h-3 w-3 fill-amber-500 text-amber-500"
                              aria-hidden
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="mt-4 space-y-1.5 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 rounded-sm border border-emerald-500/60 bg-emerald-50" />
                    Respondida
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 rounded-sm border border-border bg-background" />
                    Não respondida
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 rounded-sm border border-primary bg-primary" />
                    Atual
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

export default StudentOnlineExamRoom;
