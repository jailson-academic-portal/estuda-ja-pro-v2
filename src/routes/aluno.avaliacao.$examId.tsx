import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Clock, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  StudentOnlineExamRoom,
  type ExamAnswerState,
  type ExamQuestionView,
} from "@/components/assessment/StudentOnlineExamRoom";
import { PresenceGate } from "@/components/assessment/PresenceGate";
import {
  getOnlineExamAccess,
  getOnlineExamForStudent,
  submitOnlineExamForStudent,
} from "@/backend/online-exams.student.functions";
import type {
  AttendanceSessionRef,
  OnlineExamForStudentSession,
  OnlineExamQuestionForStudent,
} from "@/integrations/supabase/online-exams.types";

/**
 * Rota dinâmica `/aluno/avaliacao/$examId` — sala de prova real.
 *
 * Fluxo:
 *  1. Inspeção leve (`getOnlineExamAccess`) para decidir se a sala pode
 *     ser liberada. Verifica três coisas:
 *      - matrícula do aluno na disciplina;
 *      - janela de horário (server-side defense in depth);
 *      - PRESENÇA confirmada no Diário Digital (attendance_records com
 *        status='present') em uma aula cuja `starts_at` cai dentro da
 *        janela da prova. Se a sessão já foi submetida/graded/invalidated
 *        antes, a presença original é suficiente e a sala é liberada
 *        direto para visualização.
 *  2. Se a presença está OK (ou prova já concluída), carrega
 *     `exam + session + questions` via `getOnlineExamForStudent`
 *     (que cria/retoma a sessão).
 *  3. Mostra sala de prova (modo controlado: respostas persistidas aqui).
 *  4. Auto-envio: quando o cronômetro visual zera OU o `expires_at` da
 *     sessão já passou, o `StudentOnlineExamRoom` dispara `onAutoSubmit`,
 *     que envia as respostas marcadas ao servidor e mostra a tela de
 *     conclusão — sem perder o que já foi marcado.
 *  5. Ao finalizar manualmente (botão "Finalizar"), o mesmo envio
 *     acontece, idêntico ao auto-submit.
 *
 * Importante: o gabarito NUNCA é retornado pelo servidor (`correct_answer`
 * é filtrado em `getOnlineExamForStudent`).
 */
export const Route = createFileRoute("/aluno/avaliacao/$examId")({
  head: () => ({
    meta: [
      { title: "Avaliação Online — EstudaJá Pro" },
      {
        name: "description",
        content: "Sala de prova online para o aluno.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: OnlineExamRoomRoute,
});

function OnlineExamRoomRoute() {
  const { examId } = Route.useParams();
  const { user, profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const accessFn = useServerFn(getOnlineExamAccess);
  const loadFn = useServerFn(getOnlineExamForStudent);
  const submitFn = useServerFn(submitOnlineExamForStudent);

  const [answers, setAnswers] = useState<Record<string, ExamAnswerState>>({});
  const [submitting, setSubmitting] = useState(false);
  const [finished, setFinished] = useState(false);
  /** True apos o aluno clicar "Finalizar" ou o cronometro zerar (auto-submit). */
  const submittedRef = useRef(false);

  // Guard de auth — mesmo padrao do resto do app.
  useEffect(() => {
    if (!authLoading && (!user || !profile)) {
      void navigate({ to: "/login", search: { tab: "matricula" } });
    }
  }, [user, profile, authLoading, navigate]);

  // Passo 1: inspeção leve. NAO cria sessao ainda.
  const accessQuery = useQuery({
    queryKey: ["online-exam-access", examId, user?.id],
    enabled: Boolean(user?.id && examId),
    staleTime: 0,
    retry: 1,
    queryFn: async () => {
      const res = (await accessFn({ data: { examId } })) as {
        exam_id: string;
        title: string;
        has_attendance: boolean;
        attendance_session: AttendanceSessionRef | null;
        session_status: string | null;
      };
      return res;
    },
  });

  // Sessao ja fechada (submetida/graded/invalidated) -> libera sala direto.
  const sessionClosedForReview =
    accessQuery.data?.session_status === "submitted" ||
    accessQuery.data?.session_status === "graded" ||
    accessQuery.data?.session_status === "invalidated";

  // Decisao: carrega a prova (sala) ou trava na PresenceGate.
  const canLoadRoom = sessionClosedForReview || accessQuery.data?.has_attendance === true;

  // Passo 2: carregar prova (cria/retoma a sessao) somente com sala liberada.
  const { data, isPending, error } = useQuery({
    queryKey: ["online-exam-student", examId, user?.id],
    enabled: Boolean(user?.id && examId && canLoadRoom),
    staleTime: 0,
    retry: 1,
    queryFn: async (): Promise<OnlineExamForStudentSession> => {
      const result = (await loadFn({ data: { examId } })) as OnlineExamForStudentSession;
      // Inicializa mapa de respostas com o que ja estava gravado (resume)
      const initial: Record<string, ExamAnswerState> = {};
      for (const a of result.session.existing_answers) {
        initial[a.question_id] = {
          questionId: a.question_id,
          selectedOptionId: a.selected_option_id,
          flagged: a.flagged,
        };
      }
      setAnswers(initial);
      // Se ja estava submetida/graded, mostra tela de sucesso direto.
      if (
        result.session.status === "submitted" ||
        result.session.status === "graded" ||
        result.session.status === "invalidated"
      ) {
        setFinished(true);
      }
      return result;
    },
  });

  // Envia as respostas marcadas ate o momento. Usado tanto pelo
  // "Finalizar" manual quanto pelo auto-submit. Idempotente: se ja
  // submetido, nao faz nada.
  const submitNow = async () => {
    if (submittedRef.current) return;
    if (!data) return;
    submittedRef.current = true;
    setSubmitting(true);
    const t = toast.loading("Enviando respostas...");
    try {
      const payload = data.questions.map((q) => ({
        questionId: q.id,
        selectedOptionId: answers[q.id]?.selectedOptionId ?? null,
        flagged: answers[q.id]?.flagged ?? false,
      }));
      await submitFn({
        data: {
          sessionId: data.session.session_id,
          examId: data.exam.id,
          answers: payload,
        },
      });
      toast.success("Avaliação enviada com sucesso!", { id: t });
      setFinished(true);
      void queryClient.invalidateQueries({ queryKey: ["online-exam-student"] });
      void queryClient.invalidateQueries({ queryKey: ["online-exams-for-student"] });
      void queryClient.invalidateQueries({ queryKey: ["online-exam-access"] });
    } catch (e) {
      submittedRef.current = false; // permite tentar de novo
      toast.error(e instanceof Error ? e.message : "Falha ao enviar", { id: t });
    } finally {
      setSubmitting(false);
    }
  };

  const onSelectOption = (questionId: string, optionId: string) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: {
        questionId,
        selectedOptionId: optionId,
        flagged: prev[questionId]?.flagged ?? false,
      },
    }));
  };

  const onToggleFlag = (questionId: string) => {
    setAnswers((prev) => {
      const existing = prev[questionId];
      const nextFlag = !(existing?.flagged ?? false);
      return {
        ...prev,
        [questionId]: {
          questionId,
          selectedOptionId: existing?.selectedOptionId ?? null,
          flagged: nextFlag,
        },
      };
    });
  };

  if (authLoading || accessQuery.isPending) {
    return (
      <div className="min-h-screen academic-bg flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (accessQuery.error) {
    const message =
      accessQuery.error instanceof Error ? accessQuery.error.message : "Avaliação indisponível";
    return (
      <div className="min-h-screen academic-bg flex flex-col items-center justify-center gap-4 px-4 text-center">
        <ShieldAlert className="h-10 w-10 text-amber-500" />
        <h2 className="text-lg font-semibold text-white">Não foi possível carregar a prova</h2>
        <p className="text-sm text-white/80 max-w-md">{message}</p>
        <Button variant="outline" onClick={() => void navigate({ to: "/aluno" })}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Voltar ao Painel
        </Button>
      </div>
    );
  }

  // Gate de presenca (passo 2). Soma-se ao caso de prova ja fechada,
  // que e' liberada direto (canLoadRoom == true via sessionClosedForReview).
  if (!canLoadRoom && accessQuery.data) {
    return (
      <div className="min-h-screen academic-bg flex items-center justify-center px-4 py-10">
        <PresenceGate
          examId={accessQuery.data.exam_id}
          examTitle={accessQuery.data.title}
          disciplineId={data?.exam.discipline_id ?? ""}
          attendanceSession={accessQuery.data.attendance_session}
          refreshing={accessQuery.isFetching}
          onRefresh={() => {
            void accessQuery.refetch();
          }}
        />
      </div>
    );
  }

  // Carregamento da prova apos liberar a sala.
  if (isPending) {
    return (
      <div className="min-h-screen academic-bg flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    const message = error instanceof Error ? error.message : "Avaliação indisponível";
    return (
      <div className="min-h-screen academic-bg flex flex-col items-center justify-center gap-4 px-4 text-center">
        <ShieldAlert className="h-10 w-10 text-amber-500" />
        <h2 className="text-lg font-semibold text-white">Não foi possível carregar a prova</h2>
        <p className="text-sm text-white/80 max-w-md">{message}</p>
        <Button variant="outline" onClick={() => void navigate({ to: "/aluno" })}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Voltar ao Painel
        </Button>
      </div>
    );
  }

  const examView = data.exam;
  const questionsForRoom: ExamQuestionView[] = data.questions.map(
    (q: OnlineExamQuestionForStudent, idx: number) => ({
      id: q.id,
      number: idx + 1,
      prompt: q.prompt,
      options: q.options,
    }),
  );

  const initialAnswers: ExamAnswerState[] = data.questions.map((q) => ({
    questionId: q.id,
    selectedOptionId: answers[q.id]?.selectedOptionId ?? null,
    flagged: answers[q.id]?.flagged ?? false,
  }));

  const sessionClosed =
    data.session.status === "submitted" ||
    data.session.status === "graded" ||
    data.session.status === "invalidated";

  return (
    <div className="min-h-screen academic-bg">
      <div className="mx-auto max-w-7xl px-3 py-3 sm:px-6 sm:py-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-white">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void navigate({ to: "/aluno" })}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Painel
            </Button>
            <h1 className="text-base sm:text-lg font-semibold truncate">{examView.title}</h1>
            {sessionClosed && (
              <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-100">
                {data.session.status === "invalidated" ? "Sessão invalidada" : "Concluída"}
              </Badge>
            )}
            <Badge variant="outline" className="border-white/30 text-white/80">
              <Clock className="h-3 w-3 mr-1" />
              {examView.time_limit_minutes} min
            </Badge>
          </div>
        </div>

        <StudentOnlineExamRoom
          exam={{
            title: examView.title,
            disciplineName: examView.discipline_name ?? undefined,
            durationMinutes: examView.time_limit_minutes,
            totalQuestions: data.questions.length,
            instructions: examView.instructions ?? null,
          }}
          questions={questionsForRoom}
          initialAnswers={initialAnswers}
          finished={finished || sessionClosed}
          onSelectOption={onSelectOption}
          onToggleFlag={onToggleFlag}
          onFinishAttempt={() => {
            if (!submitting && !submittedRef.current) void submitNow();
          }}
          onAutoSubmit={() => {
            if (!submitting && !submittedRef.current) void submitNow();
          }}
        />
      </div>
    </div>
  );
}
