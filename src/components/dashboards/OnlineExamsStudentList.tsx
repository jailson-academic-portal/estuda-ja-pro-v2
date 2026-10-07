import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Calendar, KeyRound, PlayCircle, RefreshCcw, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listOnlineExamsForStudent } from "@/backend/online-exams.student.functions";
import type { OnlineExamForStudentListItem } from "@/integrations/supabase/online-exams.types";

/**
 * Lista de avaliações online disponíveis para iniciar / ver resultado.
 *
 * É renderizada como uma seção no StudentDashboard. Mostra APENAS provas com
 * `status='open'`. O horário exato (opens_at/closes_at) é avaliado no servidor
 * e exposto via `availability_label` quando a prova ainda não está liberada.
 *
 * A lista tem duas abas:
 *   - "Pendentes / Disponíveis": provas ainda não concluídas (com ou sem
 *     sessão, dentro ou fora da janela). É onde o aluno vai clicar "Iniciar".
 *   - "Concluídas": provas com sessão `submitted`/`graded` (nota pendente
 *     ou já lançada).
 */
type TabValue = "pending" | "done";

export function OnlineExamsStudentList() {
  const navigate = useNavigate();
  const listFn = useServerFn(listOnlineExamsForStudent);
  const [items, setItems] = useState<OnlineExamForStudentListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabValue>("pending");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = (await listFn()) as OnlineExamForStudentListItem[];
        if (alive) setItems(data ?? []);
      } catch (e) {
        if (alive) {
          setError(e instanceof Error ? e.message : "Falha ao carregar provas");
          setItems([]);
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { pending, done } = useMemo(() => {
    const all = items ?? [];
    const doneItems: OnlineExamForStudentListItem[] = [];
    const pendingItems: OnlineExamForStudentListItem[] = [];
    for (const it of all) {
      const isClosed = it.session_status === "submitted" || it.session_status === "graded";
      if (isClosed) doneItems.push(it);
      else pendingItems.push(it);
    }
    return { pending: pendingItems, done: doneItems };
  }, [items]);

  if (items === null && !error) {
    return (
      <Card className="border-white/10 bg-white/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-white text-base flex items-center gap-2">
            <PlayCircle className="h-4 w-4" />
            Avaliações Online
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-14 w-full rounded-md bg-white/10" />
          <Skeleton className="h-14 w-full rounded-md bg-white/10" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    // Falha silenciosa — não polui a tela do aluno; a seção apenas não aparece.
    return null;
  }

  const totalCount = (items ?? []).length;
  if (totalCount === 0) return null;

  const goToExam = (examId: string) =>
    navigate({ to: "/aluno/avaliacao/$examId", params: { examId } });

  return (
    <Card className="border-white/10 bg-white/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-white text-base flex items-center gap-2">
          <PlayCircle className="h-4 w-4" />
          Avaliações Online
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
          <TabsList className="bg-white/10 text-white/80">
            <TabsTrigger
              value="pending"
              className="data-[state=active]:bg-white data-[state=active]:text-foreground"
            >
              Pendentes / Disponíveis
              {pending.length > 0 && (
                <Badge variant="secondary" className="ml-2 bg-white/20 text-white">
                  {pending.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="done"
              className="data-[state=active]:bg-white data-[state=active]:text-foreground"
            >
              Concluídas
              {done.length > 0 && (
                <Badge variant="secondary" className="ml-2 bg-white/20 text-white">
                  {done.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="space-y-2 mt-3">
            {pending.length === 0 ? (
              <p className="text-sm text-white/70 px-1 py-3">
                Nenhuma avaliação disponível no momento.
              </p>
            ) : (
              pending.map((item) => (
                <ExamRow
                  key={item.id}
                  item={item}
                  variant="pending"
                  onStart={() => goToExam(item.id)}
                />
              ))
            )}
          </TabsContent>

          <TabsContent value="done" className="space-y-2 mt-3">
            {done.length === 0 ? (
              <p className="text-sm text-white/70 px-1 py-3">
                Você ainda não concluiu nenhuma avaliação online.
              </p>
            ) : (
              done.map((item) => (
                <ExamRow
                  key={item.id}
                  item={item}
                  variant="done"
                  onStart={() => goToExam(item.id)}
                />
              ))
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function ExamRow({
  item,
  variant,
  onStart,
}: {
  item: OnlineExamForStudentListItem;
  variant: "pending" | "done";
  onStart: () => void;
}) {
  const isInProgress = item.session_status === "in_progress";
  const canStart = item.in_window && variant === "pending";
  const canResume = isInProgress && item.in_window && variant === "pending";

  let button: React.ReactNode;
  if (canStart || canResume) {
    button = (
      <Button size="sm" onClick={onStart}>
        {canResume ? (
          <>
            <RefreshCcw className="h-4 w-4 mr-1.5" />
            Retomar
          </>
        ) : (
          <>
            <PlayCircle className="h-4 w-4 mr-1.5" />
            Iniciar Avaliação
          </>
        )}
      </Button>
    );
  } else if (variant === "done") {
    button = (
      <Button size="sm" variant="outline" onClick={onStart}>
        Ver resultado
      </Button>
    );
  } else {
    button = (
      <Button size="sm" variant="outline" disabled>
        {item.availability_label ?? "Indisponível"}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/5 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-white truncate">{item.title}</p>
          {item.discipline_name && (
            <Badge variant="outline" className="border-white/30 text-white/80">
              {item.discipline_name}
            </Badge>
          )}
          {item.presence_code_required && (
            <Badge
              variant="outline"
              className="border-amber-300/60 text-amber-200"
              title="O professor exige Código de Presença para iniciar esta prova"
            >
              <KeyRound className="h-3 w-3 mr-1" />
              Código de Presença
            </Badge>
          )}
          {variant === "done" && (
            <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-100">
              Concluída
            </Badge>
          )}
          {variant === "pending" && !item.in_window && (
            <Badge variant="outline" className="border-amber-400/50 text-amber-200">
              Aguardando
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-white/70">
          <span className="inline-flex items-center gap-1 text-xs">
            <Clock className="h-3.5 w-3.5" />
            {item.time_limit_minutes} min
          </span>
          {item.question_count > 0 && (
            <span className="text-xs">{item.question_count} questões</span>
          )}
          {item.closes_at && (
            <span className="inline-flex items-center gap-1 text-xs">
              <Calendar className="h-3.5 w-3.5" />
              {variant === "done" ? "Fechou em" : "Fecha em"} {formatDate(item.closes_at)}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">{button}</div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
