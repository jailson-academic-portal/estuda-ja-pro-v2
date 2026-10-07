import { useNavigate } from "@tanstack/react-router";
import { CalendarCheck2, Loader2, NotebookPen, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AttendanceSessionRef } from "@/integrations/supabase/online-exams.types";

/**
 * Gate de presença (Diário Digital).
 *
 * Renderizado ANTES da sala de prova quando o aluno ainda não confirmou
 * presença em uma aula (attendance_session) da disciplina que caia
 * dentro da janela da prova. A checagem é feita por `getOnlineExamAccess`
 * no servidor; este componente é puramente visual.
 *
 * Ações disponíveis:
 *  - "Marcar presença agora" → leva à página da disciplina (onde fica
 *    o painel "Presença Atual" / QR / código de 6 letras).
 *  - "Atualizar" → re-executa a query `getOnlineExamAccess` (o pai passa
 *    `onRefresh`).
 */
export function PresenceGate({
  examId,
  examTitle,
  disciplineId,
  attendanceSession,
  onRefresh,
  refreshing = false,
}: {
  examId: string;
  examTitle: string;
  disciplineId: string;
  attendanceSession: AttendanceSessionRef | null;
  onRefresh: () => void;
  refreshing?: boolean;
}) {
  const navigate = useNavigate();
  void examId;

  // Link direto para o painel de Presença Atual dentro da disciplina.
  // (Nao usamos deep-link "?attend=" porque o aluno precisa primeiro
  // abrir uma chamada — depende do professor.)
  const goToDiscipline = () => {
    void navigate({ to: "/disciplines/$disciplineId", params: { disciplineId } });
  };

  const hasAttendance = !!attendanceSession;
  // Slot "liberado" — quando a presenca foi confirmada, mostramos um card
  // verde perguntando se o aluno quer entrar. O pai (rota) detecta
  // `has_attendance` e pula o gate, mas mantemos o caminho manual via
  // este componente caso o pai prefira mostrar a confirmacao antes.
  if (hasAttendance) {
    return (
      <Card className="mx-auto max-w-md border-white/10 bg-white/5 text-white shadow-lg">
        <CardHeader>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
              <UserCheck className="h-4 w-4" aria-hidden />
            </span>
            <CardTitle className="text-base sm:text-lg">Presença confirmada</CardTitle>
          </div>
          <CardDescription className="text-white/70">
            Sua presença em{" "}
            <strong className="text-white">{attendanceSession?.topic || "esta aula"}</strong> já foi
            registrada. Você já pode iniciar a prova.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-xs text-white/60 space-y-1">
          <div className="flex items-center gap-2">
            <CalendarCheck2 className="h-3.5 w-3.5" />
            <span>
              {attendanceSession
                ? new Date(attendanceSession.starts_at).toLocaleString("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })
                : ""}
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-md border-white/10 bg-white/5 text-white shadow-lg">
      <CardHeader>
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/20 text-amber-300">
            <NotebookPen className="h-4 w-4" aria-hidden />
          </span>
          <CardTitle className="text-base sm:text-lg">Presença necessária</CardTitle>
        </div>
        <CardDescription className="text-white/70">
          Para iniciar a prova <strong className="text-white">{examTitle}</strong>, é preciso que
          sua presença esteja confirmada no <strong className="text-white">Diário Digital</strong>{" "}
          {attendanceSession ? (
            <>na chamada vinculada abaixo</>
          ) : (
            <>em uma aula (chamada) desta disciplina</>
          )}
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-white/80 space-y-2">
        <p>
          {attendanceSession
            ? "O professor vinculou esta prova a uma chamada específica. Vá até o Diário Digital, leia o QR Code ou digite o código de 6 letras mostrado no quadro para registrar sua presença. A prova será destravada automaticamente assim que o banco confirmar a sua presença nesta chamada."
            : "O professor precisa abrir a chamada na sala (via QR Code ou código de 6 letras) e você confirma a presença. Depois, é só voltar aqui e atualizar."}
        </p>
      </CardContent>
      <CardFooter className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" className="w-full sm:flex-1" onClick={goToDiscipline}>
          <NotebookPen className="h-4 w-4 mr-2" />
          Ir para o Diário Digital
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full sm:flex-1"
          onClick={onRefresh}
          disabled={refreshing}
        >
          {refreshing ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Verificando…
            </>
          ) : (
            "Já confirmei — atualizar"
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
