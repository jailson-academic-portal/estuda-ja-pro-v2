import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import { PresenceCodeGate } from "@/components/assessment/PresenceCodeGate";
import {
  getOnlineExamAccessRequirement,
  getOnlineExamForStudent,
  submitOnlineExamForStudent,
} from "@/backend/online-exams.student.functions";
import type {
  OnlineExamForStudentSession,
  OnlineExamQuestionForStudent,
} from "@/integrations/supabase/online-exams.types";

/**
 * Rota dinâmica `/aluno/avaliacao/$examId` — sala de prova real.
 *
 * Fluxo:
 *  1. Inspeção leve (`getOnlineExamAccessRequirement`) para descobrir se a
 *     prova exige Código de Presença, sem ainda criar sessão.
 *  2. Se exige e a prova ainda não foi concluída, mostra o
 *     `PresenceCodeGate` (PIN verificado server-side, constant-time).
 *  3. Quando liberado, carrega `exam + session + questions` via
 *     `getOnlineExamForStudent` (este sim cria/retoma a sessão).
 *  4. Mostra sala de prova (modo controlado: respostas persistidas aqui).
 *  5. Ao finalizar, envia respostas em batch e fecha a sessão no servidor.
 *  6. Após envio, mostra a tela de sucesso (controlada via prop `finished`).
 *
 * Importante: o gabarito NUNCA é retornado pelo servidor (`correct_answer`
 * é filtrado em `getOnlineExamForStudent`). O hash do PIN nunca volta ao
 * cliente (ver `verifyPresenceCode` em online-exams.student.functions.ts).
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

  const accessFn = useServerFn(getOnlineExamAccessRequirement);
  const loadFn = useServerFn(getOnlineExamForStudent);
  const submitFn = useServerFn(submitOnlineExamForStudent);

  const [answers, setAnswers] = useState<Record<string, ExamAnswerState>>({});
  const [submitting, setSubmitting] = useState(false);
  const [finished, setFinished] = useState(false);
  /** Se a prova exige PIN e o aluno ainda não desbloqueou nesta sessão. */
  const [unlocked, setUnlocked] = useState(false);

  // Guard de auth — mesmo padrão do resto do app.
  useEffect(() => {
    if (!authLoading && (!user || !profile)) {
      void navigate({ to: "/login", search: { tab: "matricula" } });
    }
  }, [user, profile, authLoading, navigate]);

  // Passo 1: inspeção leve. NÃO cria sessão ainda.
  const accessQuery = useQuery({
    queryKey: ["online-exam-access", examId, user?.id],
    enabled: Boolean(user?.id && examId),
    staleTime: 0,
    retry: 1,
    queryFn: async () => {
      const res = (await accessFn({ data: { examId } })) as {
        exam_id: string;
        title: string;
        presence_code_required: boolean;
        session_status: string | null;
      };
      // Provas ja submetidas/graded/invalidated NAO exigem codigo de novo.
      const closedSession =
        res.session_status === "submitted" ||
        res.session_status === "graded" ||
        res.session_status === "invalidated";
      if (!res.presence_code_required || closedSession) {
        setUnlocked(true);
      }
      return res;
    },
  });

  // Passo 2: gate de Codigo de Presenca (se exigido).
  const showGate =
    !!accessQuery.data?.presence_code_required &&
    !unlocked &&
    !(
      accessQuery.data?.session_status === "submitted" ||
      accessQuery.data?.session_status === "graded" ||
      accessQuery.data?.session_status === "invalidated"
    );

  // Passo 3: carregar prova so apos unlock.
  const { data, isPending, error } = useQuery({
    queryKey: ["online-exam-student", examId, user?.id],
    enabled: Boolean(user?.id && examId && unlocked && !showGate),
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

  const onFinishAttempt = async () => {
    if (!data) return;
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
      toast.error(e instanceof Error ? e.message : "Falha ao enviar", { id: t });
    } finally {
      setSubmitting(false);
    }
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

  // Gate do Codigo de Presenca (passo 2).
  if (showGate && accessQuery.data) {
    return (
      <div className="min-h-screen academic-bg flex items-center justify-center px-4 py-10">
        <PresenceCodeGate
          examId={accessQuery.data.exam_id}
          examTitle={accessQuery.data.title}
          onUnlocked={() => {
            setUnlocked(true);
            toast.success("Acesso liberado. Boa prova!");
          }}
        />
      </div>
    );
  }

  // Carregamento da prova apos unlock.
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
            if (!submitting) void onFinishAttempt();
          }}
        />
      </div>
    </div>
  );
}
