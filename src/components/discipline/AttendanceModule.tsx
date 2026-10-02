import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import {
  createAttendanceSession,
  confirmAttendance,
  getAttendanceServerTime,
  submitJustification,
  reviewJustification,
  updateDisciplineSettings,
  updateAttendanceSession,
  deleteAttendanceSession,
  revealAttendanceCode,
  finalizeAttendanceSession,
  exportAttendanceCsv,
  cycleAttendanceStatus,
  markNoClassDates,
  bulkUpdateAttendance,
} from "@/backend/attendance.functions";
import { AttendanceGrid } from "./AttendanceGrid";
import { parseBRDate, toISODate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Loader2,
  Plus,
  CalendarCheck,
  Clock,
  Check,
  X,
  FileWarning,
  KeyRound,
  AlertTriangle,
  Eye,
  EyeOff,
  Pencil,
  Trash2,
  Download,
  CalendarOff,
} from "lucide-react";
import { toast } from "sonner";
import { WifiOff, RefreshCw } from "lucide-react";
import { CurrentPresencePanel } from "./CurrentPresencePanel";

interface Session {
  id: string;
  discipline_id: string;
  topic: string | null;
  programmatic_content?: string | null;
  pedagogical_observations?: string | null;
  session_date: string;
  window_hours: number;
  code_window_minutes: number;
  created_at: string;
  starts_at: string;
  finalized_at: string | null;
  finalized_by: string | null;
  closed_at: string | null;
  code?: string | null;
}

interface AttRecord {
  id: string;
  session_id: string;
  student_id: string;
  status: "present" | "absent" | "justified" | "no_class";
  confirmed_at: string | null;
}

interface Justification {
  id: string;
  session_id: string;
  student_id: string;
  reason: string;
  description: string | null;
  attachment_url: string | null;
  status: "pending" | "approved" | "rejected";
  review_note: string | null;
}

const REASONS: { [k: string]: string } = {
  work_shift: "Plantão de trabalho",
  student_illness: "Doença do aluno",
  family_illness: "Acompanhamento de familiar doente",
  variable_schedule: "Turno de trabalho variável",
  personal_emergency: "Imprevisto pessoal",
};

const APP_TIME_ZONE = "America/Sao_Paulo";

function partsInAppZone(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

function dateInAppZone(date: Date): string {
  const p = partsInAppZone(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function appLocalInputToIso(value: string): string {
  return new Date(`${value}:00-03:00`).toISOString();
}

function startMs(s: Session) {
  return new Date(s.starts_at ?? s.created_at).getTime();
}
function closedMs(s: Session) {
  return s.closed_at ? new Date(s.closed_at).getTime() : Infinity;
}
function notYetStarted(s: Session, nowMs = Date.now()) {
  return nowMs < startMs(s);
}
function codeEndMs(s: Session) {
  const naturalEnd = startMs(s) + (s.code_window_minutes ?? 15) * 60 * 1000;
  return s.closed_at ? Math.min(new Date(s.closed_at).getTime(), naturalEnd) : naturalEnd;
}
function isOpen(s: Session, nowMs = Date.now()) {
  const end = codeEndMs(s);
  return nowMs >= end && nowMs - end < 72 * 60 * 60 * 1000;
}
function isCodeOpen(s: Session, nowMs = Date.now()) {
  const mins = s.code_window_minutes ?? 15;
  const elapsed = nowMs - startMs(s);
  return elapsed >= 0 && elapsed < mins * 60 * 1000 && nowMs < closedMs(s);
}
function isCodeEnded(s: Session, nowMs = Date.now()) {
  return nowMs >= Math.min(startMs(s) + (s.code_window_minutes ?? 15) * 60 * 1000, closedMs(s));
}
function sessionStatus(s: Session, nowMs = Date.now()): "scheduled" | "open" | "closed" | "finalized" {
  if (s.finalized_at) return "finalized";
  if (notYetStarted(s, nowMs)) return "scheduled";
  if (isCodeOpen(s, nowMs)) return "open";
  return "closed";
}
function codeRemaining(s: Session, nowMs = Date.now()): string {
  const mins = s.code_window_minutes ?? 15;
  const elapsed = nowMs - startMs(s);
  if (elapsed < 0) {
    const ms = -elapsed;
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `Abre em ${h > 0 ? `${h}h` : ""}${m}m`;
  }
  const ms = mins * 60 * 1000 - elapsed;
  if (ms <= 0) return "Código expirado";
  const m = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${m}m${String(sec).padStart(2, "0")}s para inserir o código`;
}
function timeRemaining(s: Session, nowMs = Date.now()): string {
  const end = codeEndMs(s);
  if (nowMs < end) return `Justificativa abre ao encerrar o código`;
  const ms = 72 * 60 * 60 * 1000 - (nowMs - end);
  if (ms <= 0) return "Justificativa encerrada";
  const h = Math.floor(ms / (60 * 60 * 1000));
  const m = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  return `${h}h${m}m para justificar falta`;
}
function formatStart(s: Session): string {
  return new Date(s.starts_at ?? s.created_at).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: APP_TIME_ZONE,
  });
}

export const AttendanceModule = ({
  disciplineId,
  isTeacher,
}: {
  disciplineId: string;
  isTeacher: boolean;
}) => {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [records, setRecords] = useState<AttRecord[]>([]);
  const [justifications, setJustifications] = useState<Justification[]>([]);
  const [studentProfiles, setStudentProfiles] = useState<Record<string, { name: string; matricula: string }>>({});
  const [loading, setLoading] = useState(true);
  const [minPercent, setMinPercent] = useState<number>(75);
  const [justifiedCounts, setJustifiedCounts] = useState<boolean>(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmingSession, setConfirmingSession] = useState<Session | null>(null);
  const [justifyingSession, setJustifyingSession] = useState<Session | null>(null);
  const [reviewingJust, setReviewingJust] = useState<Justification | null>(null);
  const [serverClockOffsetMs, setServerClockOffsetMs] = useState<number | null>(null);
  // Tick every second to keep countdowns live
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    let cancelled = false;
    const syncServerClock = async () => {
      try {
        const before = Date.now();
        const { now } = await getAttendanceServerTime();
        const after = Date.now();
        if (!cancelled) setServerClockOffsetMs(new Date(now).getTime() - (before + after) / 2);
      } catch {
        if (!cancelled) setServerClockOffsetMs(0);
      }
    };
    const fallback = setTimeout(() => {
      if (!cancelled) setServerClockOffsetMs((current) => current ?? 0);
    }, 5000);
    syncServerClock();
    const id = setInterval(syncServerClock, 60_000);
    return () => {
      cancelled = true;
      clearTimeout(fallback);
      clearInterval(id);
    };
  }, []);
  const [revealedCodes, setRevealedCodes] = useState<Record<string, string>>({});
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    topic: string;
    presentCount: number;
    justificationCount: number;
  } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [noClassDialogOpen, setNoClassDialogOpen] = useState(false);
  const nowMs = Date.now() + (serverClockOffsetMs ?? 0);

  const toggleReveal = async (sessionId: string) => {
    if (revealedCodes[sessionId]) {
      const next = { ...revealedCodes };
      delete next[sessionId];
      setRevealedCodes(next);
      return;
    }
    try {
      const res = await revealAttendanceCode({ data: { session_id: sessionId } });
      setRevealedCodes((r) => ({ ...r, [sessionId]: res.code }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao revelar código");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await deleteAttendanceSession({
        data: { session_id: deleteTarget.id, force: true },
      });
      toast.success("Chamada excluída");
      setDeleteTarget(null);
      load(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleOpenNow = async (session: Session) => {
    try {
      const startsAt = new Date();
      const updated = await updateAttendanceSession({
        data: {
          session_id: session.id,
          topic: session.topic,
          starts_at: startsAt.toISOString(),
          session_date: dateInAppZone(startsAt),
          code_window_minutes: session.code_window_minutes,
        },
      });
      toast.success("Chamada aberta");
      handleSessionUpdated(updated as Session);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao abrir chamada");
    }
  };

  const handleFinalize = async (sessionId: string) => {
    try {
      await finalizeAttendanceSession({ data: { session_id: sessionId } });
      toast.success("Chamada finalizada");
      load(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao finalizar chamada");
    }
  };

  const handleSessionUpdated = (updated?: Session) => {
    if (updated) setSessions((current) => current.map((s) => (s.id === updated.id ? updated : s)));
    setEditingSession(null);
    load(false);
  };

  const load = useCallback(async (isInitial = false) => {
    try {
      if (isInitial) setLoading(true);
      
      const { data: settings } = await supabase
        .from("discipline_settings")
        .select("min_attendance_percent, justified_counts_as_presence")
        .eq("discipline_id", disciplineId)
        .maybeSingle();

      if (settings) {
        setMinPercent(Number(settings.min_attendance_percent));
        setJustifiedCounts(!!settings.justified_counts_as_presence);
      }

      // Load students
      const { data: enrollments } = await supabase
        .from("discipline_students")
        .select("student_id, profiles(id, name, full_name, enrollment_number)")
        .eq("discipline_id", disciplineId)
        .eq("status", "active");
      
      const profilesMap: Record<string, { name: string; matricula: string }> = {};
      (enrollments ?? []).forEach((e: any) => {
        if (e.profiles) {
          profilesMap[e.student_id] = {
            name: e.profiles.full_name || e.profiles.name || "Sem Nome",
            matricula: e.profiles.enrollment_number || "---"
          };
        }
      });
      setStudentProfiles(profilesMap);

      // Load sessions
      const { data: ss } = await supabase
        .from("attendance_sessions_view")
        .select("*")
        .eq("discipline_id", disciplineId)
        .order("starts_at", { ascending: false });
      
      setSessions((ss ?? []) as Session[]);
      const sessionIds = (ss ?? []).map((s: any) => s.id).filter((id: any): id is string => !!id);
      
      if (sessionIds.length) {
        const { data: rs } = await supabase
          .from("attendance_records")
          .select("*")
          .in("session_id", sessionIds);
        
        const { data: js } = await supabase
          .from("justifications")
          .select("*")
          .in("session_id", sessionIds);
        setRecords((rs ?? []) as AttRecord[]);
        setJustifications((js ?? []) as Justification[]);
      } else {
        setRecords([]);
        setJustifications([]);
      }
    } catch (e) {
      toast.error("Erro ao carregar dados do diário");
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [disciplineId]);



  useEffect(() => {
    load(true);
  }, [load]);

  const sessionIds = sessions.map((s: Session) => s.id);
  

  useEffect(() => {
    setConfirmingSession((current) =>
      current ? (sessions.find((s) => s.id === current.id) ?? current) : null,
    );
    setJustifyingSession((current) =>
      current ? (sessions.find((s) => s.id === current.id) ?? current) : null,
    );
  }, [sessions]);

  // Realtime: refresca quando presenças/justificativas/sessões mudam nesta disciplina
  useEffect(() => {
    const channel = supabase
      .channel(`attendance:${disciplineId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance_records" }, () =>
        load(false),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "attendance_sessions",
          filter: `discipline_id=eq.${disciplineId}`,
        },
        () => load(false),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "justifications" }, () =>
        load(false),
      )
      .subscribe();
    
    // Fallback polling REMOVED as requested to prevent auto-refresh loop
    /*
    const interval = setInterval(() => {
      load(false);
    }, 5000);
    */


    return () => {
      supabase.removeChannel(channel);
    };
  }, [disciplineId, load]);

  const handleCreate = async (
    topic: string,
    codeWindowMinutes: number,
    startsAt?: string,
    sessionDate?: string,
    programmatic?: string,
    observations?: string,
  ) => {
    try {
      const created = await createAttendanceSession({
        data: {
          discipline_id: disciplineId,
          topic: topic || undefined,
          code_window_minutes: codeWindowMinutes,
          starts_at: startsAt,
          session_date: sessionDate,
          programmatic_content: programmatic,
          pedagogical_observations: observations,
        },
      });
      if (!created) {
        toast.error("Não foi possível criar a chamada. Tente novamente.");
        return;
      }
      toast.success("Chamada criada");
      setCreateOpen(false);
      load(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  const handleBulkUpdate = async (sessionId: string, status: "present" | "absent" | "justified") => {
    const tId = toast.loading("Atualizando presença em massa...");
    try {
      await bulkUpdateAttendance({ data: { session_id: sessionId, status } });
      toast.success("Presenças atualizadas com sucesso", { id: tId });
      load(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao atualizar presenças", { id: tId });
    }
  };

  const myRecord = (sessionId: string) =>
    records.find((r) => r.session_id === sessionId && r.student_id === user?.id);

  // Compute current student's attendance percentage
  const myStats = (() => {
    if (isTeacher || !user) return null;
    const closed = sessions.filter((s) => isCodeEnded(s, nowMs));
    if (closed.length === 0) return null;
    let present = 0;
    for (const s of closed) {
      const r = records.find((x) => x.session_id === s.id && x.student_id === user.id);
      if (r?.status === "present") present += 1;
      else if (r?.status === "justified" && justifiedCounts) present += 1;
    }
    const pct = Math.round((present / closed.length) * 100);
    return { pct, present, total: closed.length };
  })();

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Diário Digital</h2>
      
      
      {myStats && (
        <div
          className={`rounded-xl border p-3 flex items-start gap-3 ${
            myStats.pct < minPercent
              ? "bg-red-50 border-red-200 text-red-800"
              : myStats.pct < minPercent + 10
                ? "bg-yellow-50 border-yellow-200 text-yellow-800"
                : "bg-green-50 border-green-200 text-green-800"
          }`}
        >
          {myStats.pct < minPercent ? (
            <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
          ) : (
            <CalendarCheck className="h-5 w-5 mt-0.5 shrink-0" />
          )}
          <div className="text-sm">
            <div className="font-medium">
              Sua frequência: {myStats.pct}% ({myStats.present}/{myStats.total} aulas)
            </div>
          </div>
        </div>
      )}

      <Tabs defaultValue="diary" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="diary">Diário de Chamada</TabsTrigger>
          <TabsTrigger value="grid">Frequência (Grade)</TabsTrigger>
          <TabsTrigger value="justifications">Justificativas Pendentes</TabsTrigger>
        </TabsList>
        
        <TabsContent value="diary" className="space-y-6 pt-4">
          {/* Aba 1: Diário de Chamada - Formulário e listagem */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Sessões de Aula</h2>
              <p className="text-sm text-muted-foreground">{sessions.length} aula(s) registrada(s)</p>
            </div>
            {isTeacher && (
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setSettingsOpen(true)}>
                  Configurações
                </Button>
                <Button variant="outline" onClick={() => setExportOpen(true)}>
                  <Download className="h-4 w-4 mr-2" /> Baixar CSV
                </Button>
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" /> Nova chamada
                </Button>
              </div>
            )}
          </div>
          {!loading && serverClockOffsetMs !== null && (
        <CurrentPresencePanel
          disciplineId={disciplineId}
          isTeacher={isTeacher}
          userId={user?.id}
          sessions={sessions}
          records={records}
          nowMs={nowMs}
          onChanged={() => load(false)}
          onOpenNew={() => setCreateOpen(true)}
        />
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : serverClockOffsetMs === null ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="border-2 border-dashed rounded-xl py-12 text-center">
          <CalendarCheck className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhuma chamada registrada ainda.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.filter(s => {
            const sessionRecords = records.filter((r) => r.session_id === s.id);
            // Hide if all student records for this session are 'no_class' OR if the teacher marked it as 'no_class' (future/scheduled sessions might not have records yet)
            // But usually 'no_class' sessions are finalized immediately in markNoClassDates.
            // Requirement says: "NÃO exibir as sessões que estão marcadas como 'Sem Aula'"
            // In markNoClassDates, topic is set to "Sem Aula / Feriado"
            const isNoClass = s.topic === "Sem Aula / Feriado" || (sessionRecords.length > 0 && sessionRecords.every(r => r.status === "no_class"));
            return !isNoClass;
          }).map((s) => {
            const codeOpen = isCodeOpen(s, nowMs);
            const justificationOpen = !codeOpen && !s.finalized_at && isOpen(s, nowMs);
            const status = sessionStatus(s, nowMs);
            const canEditOrDelete = isTeacher && status !== "finalized";
            const canFinalize = isTeacher && status === "closed" && !isOpen(s, nowMs);
            const sessionRecords = records.filter((r) => r.session_id === s.id);
            const present = sessionRecords.filter(
              (r) => r.status === "present" || r.status === "justified",
            ).length;
            const total = sessionRecords.filter(r => r.status !== 'no_class').length;
            const mine = myRecord(s.id);
            const effectiveMineStatus = mine?.status ?? (isCodeEnded(s, nowMs) ? "absent" : undefined);
            const myJust = justifications.find(
              (j) => j.session_id === s.id && j.student_id === user?.id,
            );
            return (
              <div
                key={s.id}
                className="rounded-xl border bg-card p-4"
                style={{ boxShadow: "var(--shadow-card)" }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{s.topic || "Aula sem tópico"}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>Início: {formatStart(s)}</span>
                      {status === "scheduled" ? (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Clock className="h-3 w-3" /> {codeRemaining(s, nowMs)}
                        </span>
                      ) : codeOpen ? (
                        <span className="inline-flex items-center gap-1 text-primary font-medium">
                          <Clock className="h-3 w-3" /> {codeRemaining(s, nowMs)}
                        </span>
                      ) : justificationOpen ? (
                        <span className="inline-flex items-center gap-1 text-amber-700">
                          <Clock className="h-3 w-3" /> {timeRemaining(s, nowMs)}
                        </span>
                      ) : status === "finalized" ? (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Clock className="h-3 w-3" /> Finalizada
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" /> Encerrada
                        </span>
                      )}
                    </div>
                    {(s.programmatic_content || s.pedagogical_observations) && (
                      <div className="mt-2 grid gap-1">
                        {s.programmatic_content && (
                          <div className="text-xs">
                            <span className="font-semibold">Conteúdo: </span>
                            <span className="text-muted-foreground">{s.programmatic_content}</span>
                          </div>
                        )}
                        {s.pedagogical_observations && (
                          <div className="text-xs">
                            <span className="font-semibold">Observações: </span>
                            <span className="text-muted-foreground">{s.pedagogical_observations}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {isTeacher &&
                      codeOpen &&
                      (revealedCodes[s.id] ? (
                        <button
                          type="button"
                          onClick={() => toggleReveal(s.id)}
                          title="Ocultar código"
                          className="font-mono text-base bg-primary/10 text-primary px-3 py-1 rounded-lg flex items-center gap-1 hover:bg-primary/20"
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                          {revealedCodes[s.id]}
                          <EyeOff className="h-3.5 w-3.5 ml-1" />
                        </button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => toggleReveal(s.id)}>
                          <Eye className="h-3.5 w-3.5 mr-1" /> Mostrar código
                        </Button>
                      ))}
                    {isTeacher && status === "scheduled" && (
                      <Button size="sm" variant="outline" onClick={() => handleOpenNow(s)}>
                        Abrir agora
                      </Button>
                    )}
                    {canFinalize && (
                      <Button size="sm" onClick={() => handleFinalize(s.id)}>
                        Finalizar
                      </Button>
                    )}
                    {canEditOrDelete && (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Editar chamada"
                          onClick={() => setEditingSession(s)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Excluir chamada"
                          onClick={() => {
                            const presentInSession = sessionRecords.filter(
                              (r) => r.status !== "absent",
                            ).length;
                            const justInSession = justifications.filter(
                              (j) => j.session_id === s.id,
                            ).length;
                            setDeleteTarget({
                              id: s.id,
                              topic: s.topic ?? "Chamada",
                              presentCount: presentInSession,
                              justificationCount: justInSession,
                            });
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    <span
                      className={`text-xs px-2 py-1 rounded-full ${
                        status === "open"
                          ? "bg-green-100 text-green-700"
                          : status === "closed"
                            ? "bg-amber-100 text-amber-700"
                            : status === "scheduled"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {status === "scheduled"
                        ? "Agendada"
                        : status === "open"
                          ? "Aberta"
                          : status === "closed"
                            ? "Encerrada"
                            : "Finalizada"}
                    </span>
                  </div>
                </div>

                {isTeacher ? (
                  <div className="mt-3 text-sm text-muted-foreground">
                    Presentes:{" "}
                    <span className="font-medium text-foreground">
                      {present}/{total}
                    </span>
                    {total > 0 && ` (${Math.round((present / total) * 100)}%)`}
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {effectiveMineStatus === "present" && (
                      <span className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 inline-flex items-center gap-1">
                        <Check className="h-3 w-3" /> Presença confirmada
                      </span>
                    )}
                    {effectiveMineStatus === "justified" && (
                      <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700">
                        Falta justificada
                      </span>
                    )}
                    {effectiveMineStatus === "absent" && (
                      <span className="text-xs px-2 py-1 rounded bg-red-100 text-red-700">
                        Falta
                      </span>
                    )}
                    {codeOpen && mine?.status !== "present" && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setConfirmingSession(s);
                        }}
                        className="h-9 px-3 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md flex items-center justify-center font-medium text-sm transition-colors cursor-pointer"
                        style={{ opacity: 1, pointerEvents: 'auto' }}
                      >
                        Inserir código
                      </button>
                    )}
                    {justificationOpen && mine?.status !== "present" && !myJust && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setJustifyingSession(s);
                          }}
                          className="h-9 px-3 border border-input bg-background hover:bg-accent hover:text-accent-foreground rounded-md flex items-center justify-center font-medium text-sm transition-colors cursor-pointer"
                          style={{ opacity: 1, pointerEvents: 'auto' }}
                        >
                          <FileWarning className="h-3.5 w-3.5 mr-1" /> Justificar falta
                        </button>
                        <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                          <Clock className="h-3 w-3" /> {timeRemaining(s, nowMs)}
                        </span>
                      </div>
                    )}
                    {myJust && (
                      <span
                        className={`text-xs px-2 py-1 rounded ${
                          myJust.status === "approved"
                            ? "bg-green-100 text-green-700"
                            : myJust.status === "rejected"
                              ? "bg-red-100 text-red-700"
                              : "bg-yellow-100 text-yellow-700"
                        }`}
                      >
                        Justificativa:{" "}
                        {myJust.status === "approved"
                          ? "aprovada"
                          : myJust.status === "rejected"
                            ? "rejeitada"
                            : "pendente"}
                      </span>
                    )}
                  </div>
                )}

                {isTeacher && (
                  <div className="mt-3">
                    <details className="text-sm">
                      <summary className="cursor-pointer text-primary">
                        Ver justificativas pendentes
                      </summary>
                      <div className="mt-2 space-y-2">
                        {justifications.filter((j) => j.session_id === s.id).length === 0 ? (
                          <p className="text-xs text-muted-foreground">Nenhuma justificativa.</p>
                        ) : (
                          justifications
                            .filter((j) => j.session_id === s.id)
                            .map((j) => (
                              <div
                                key={j.id}
                                className="border rounded p-2 flex items-center justify-between"
                              >
                                <div className="text-xs">
                                  <div className="font-medium">{REASONS[j.reason]}</div>
                                  <div className="text-muted-foreground">
                                    {j.description ?? "—"}
                                  </div>
                                </div>
                                {j.status === "pending" ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setReviewingJust(j)}
                                  >
                                    Revisar
                                  </Button>
                                ) : (
                                  <span
                                    className={`text-xs px-2 py-1 rounded ${j.status === "approved" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}
                                  >
                                    {j.status === "approved" ? "Aprovada" : "Rejeitada"}
                                  </span>
                                )}
                              </div>
                            ))
                        )}
                      </div>
                    </details>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </TabsContent>

        <TabsContent value="grid" className="pt-4">
          <div className="flex justify-end mb-4">
            {isTeacher && (
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setNoClassDialogOpen(true)}
              >
                <CalendarOff className="h-4 w-4 mr-2" /> Marcar Datas Sem Aula
              </Button>
            )}
          </div>
            <AttendanceGrid
              disciplineId={disciplineId}
              sessions={sessions}
              records={records}
              onChanged={() => load(false)}
              onEditSession={isTeacher ? (s) => setEditingSession(s) : undefined}
              onDeleteSession={isTeacher ? (s) => {
                const sessionRecords = records.filter(r => r.session_id === s.id);
                const presents = sessionRecords.filter(r => r.status === 'present').length;
                const justs = sessionRecords.filter(r => r.status === 'justified').length;
                setDeleteTarget({
                  id: s.id,
                  topic: s.topic || "Aula",
                  presentCount: presents,
                  justificationCount: justs
                });
              } : undefined}
              onBulkUpdate={isTeacher ? handleBulkUpdate : undefined}
              editable={isTeacher}
            />
        </TabsContent>

        <TabsContent value="justifications" className="pt-4">
          {isTeacher ? (
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Justificativas Aguardando Revisão</h3>
              {justifications.filter(j => j.status === "pending").length === 0 ? (
                <div className="border-2 border-dashed rounded-xl py-12 text-center">
                  <FileWarning className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">Nenhuma justificativa pendente.</p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {justifications.filter(j => j.status === "pending").map(j => {
                    const session = sessions.find(s => s.id === j.session_id);
                    const profile = studentProfiles[j.student_id];
                    return (
                      <Card key={j.id}>
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-sm font-medium">
                              {REASONS[j.reason]}
                            </CardTitle>
                            <Badge variant="outline">Pendente</Badge>
                          </div>
                          <div className="mt-1 space-y-1">
                            <p className="text-xs font-semibold text-primary">
                              Estudante: {profile ? `${profile.name} (${profile.matricula})` : "Carregando..."}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Aula: {session?.topic || "Sem tópico"} ({session ? formatStart(session) : "—"})
                            </p>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-muted-foreground mb-4">
                            {j.description || "Sem descrição adicional."}
                          </p>
                          <Button size="sm" onClick={() => setReviewingJust(j)}>
                            Revisar Agora
                          </Button>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Minhas Justificativas</h3>
              {justifications.filter(j => j.student_id === user?.id).length === 0 ? (
                <div className="border-2 border-dashed rounded-xl py-12 text-center">
                  <FileWarning className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">Você não possui justificativas enviadas.</p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {justifications.filter(j => j.student_id === user?.id).map(j => {
                    const session = sessions.find(s => s.id === j.session_id);
                    return (
                      <Card key={j.id}>
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-sm font-medium">
                              {REASONS[j.reason]}
                            </CardTitle>
                            <Badge className={
                              j.status === "approved" ? "bg-green-100 text-green-700" :
                              j.status === "rejected" ? "bg-red-100 text-red-700" :
                              "bg-yellow-100 text-yellow-700"
                            }>
                              {j.status === "approved" ? "Aprovada" : j.status === "rejected" ? "Rejeitada" : "Pendente"}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Aula: {session?.topic || "Sem tópico"} ({session ? formatStart(session) : "—"})
                          </p>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-muted-foreground">
                            {j.description || "Sem descrição adicional."}
                          </p>
                          {j.review_note && (
                            <div className="mt-2 p-2 bg-muted rounded text-xs">
                              <strong>Nota do professor:</strong> {j.review_note}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <CreateSessionDialog open={createOpen} onOpenChange={setCreateOpen} onSubmit={handleCreate} />
      {confirmingSession && (
        <ConfirmAttendanceDialog
          session={confirmingSession}
          nowMs={nowMs}
          onClose={() => setConfirmingSession(null)}
          onDone={() => {
            setConfirmingSession(null);
            load(false);
          }}
        />
      )}
      {justifyingSession && (
        <JustifyDialog
          session={justifyingSession}
          nowMs={nowMs}
          onClose={() => setJustifyingSession(null)}
          onDone={() => {
            setJustifyingSession(null);
            load(false);
          }}
        />
      )}
      {reviewingJust && (
        <ReviewDialog
          justification={reviewingJust}
          studentProfile={studentProfiles[reviewingJust.student_id]}
          onClose={() => setReviewingJust(null)}
          onDone={() => {
            setReviewingJust(null);
            load(false);
          }}
        />
      )}
      {isTeacher && (
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          disciplineId={disciplineId}
        />
      )}
      {editingSession && (
        <EditSessionDialog
          session={editingSession}
          nowMs={nowMs}
          onClose={() => setEditingSession(null)}
          onDone={handleSessionUpdated}
        />
      )}
      {isTeacher && (
        <ExportCsvDialog
          open={exportOpen}
          onOpenChange={setExportOpen}
          disciplineId={disciplineId}
        />
      )}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o && !deleteBusy) setDeleteTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta chamada?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  Você está prestes a excluir <strong>{deleteTarget.topic}</strong>.
                  {(deleteTarget.presentCount > 0 || deleteTarget.justificationCount > 0) && (
                    <>
                      {" "}Esta chamada possui{" "}
                      {deleteTarget.presentCount > 0 && (
                        <strong>
                          {deleteTarget.presentCount} presença(s)/falta(s) registrada(s)
                        </strong>
                      )}
                      {deleteTarget.presentCount > 0 && deleteTarget.justificationCount > 0 && " e "}
                      {deleteTarget.justificationCount > 0 && (
                        <strong>
                          {deleteTarget.justificationCount} justificativa(s)
                        </strong>
                      )}
                      {" "}que também serão excluídas.
                    </>
                  )}
                  {" "}Esta ação não pode ser desfeita.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmDelete(); }}
              disabled={deleteBusy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteBusy ? "Excluindo..." : "Excluir chamada"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <NoClassDatesDialog
        open={noClassDialogOpen}
        onOpenChange={setNoClassDialogOpen}
        disciplineId={disciplineId}
        onSuccess={() => load(false)}
      />
    </div>
  );
}

function NoClassDatesDialog({
  open,
  onOpenChange,
  disciplineId,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  disciplineId: string;
  onSuccess: () => void;
}) {
  const [datesInput, setDatesInput] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) setDatesInput("");
  }, [open]);

  const handleSubmit = async () => {
    if (!datesInput.trim()) {
      toast.error("Insira ao menos uma data");
      return;
    }

    const rawDates = datesInput.split(",").map((d) => d.trim());
    const validDates: string[] = [];
    const invalidDates: string[] = [];

    for (const d of rawDates) {
      const parsed = parseBRDate(d);
      if (parsed) {
        validDates.push(toISODate(parsed));
      } else {
        invalidDates.push(d);
      }
    }

    if (invalidDates.length > 0) {
      toast.error(`Formato inválido: ${invalidDates.join(", ")}. Use DD/MM/YYYY.`);
      return;
    }

    setLoading(true);
    try {
      await markNoClassDates({ data: { discipline_id: disciplineId, dates: validDates } });
      toast.success("Datas marcadas como Sem Aula");
      onOpenChange(false);
      onSuccess();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao marcar datas");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Marcar Datas Sem Aula</DialogTitle>
          <DialogDescription>
            Insira as datas em que não haverá aula. Elas serão marcadas como "SA" no diário.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="dates">Datas (DD/MM/YYYY)</Label>
            <Input
              id="dates"
              placeholder="Ex: 03/08/2026, 04/08/2026"
              value={datesInput}
              onChange={(e) => setDatesInput(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">
              Separe múltiplas datas por vírgula.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function toLocalInput(d: Date): string {
  const p = partsInAppZone(d);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function CreateSessionDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (
    topic: string,
    codeWindowMinutes: number,
    startsAt?: string,
    sessionDate?: string,
    programmatic?: string,
    observations?: string,
  ) => Promise<void>;
}) {
  const [topic, setTopic] = useState("");
  const [programmatic, setProgrammatic] = useState("");
  const [observations, setObservations] = useState("");
  const [codeWindow, setCodeWindow] = useState<number>(15);
  const [startNow, setStartNow] = useState<boolean>(true);
  const [startsAtLocal, setStartsAtLocal] = useState<string>(toLocalInput(new Date()));
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (open) {
      setTopic("");
      setProgrammatic("");
      setObservations("");
      setCodeWindow(15);
      setStartNow(true);
      setStartsAtLocal(toLocalInput(new Date()));
    }
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova chamada</DialogTitle>
          <DialogDescription>
            O sistema gera um código de 6 letras (A-Z) que você revela em aula. Defina o horário de
            início da chamada e por quantos minutos o código será válido. Após esse período, os
            alunos só poderão enviar justificativa de falta (até 72h contadas a partir do
            encerramento do código/diário).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Label htmlFor="topic">Tópico da aula (opcional)</Label>
          <Input
            id="topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            maxLength={200}
          />

          <div className="space-y-1.5">
            <Label htmlFor="programmatic">Conteúdo Programático</Label>
            <Textarea
              id="programmatic"
              value={programmatic}
              onChange={(e) => setProgrammatic(e.target.value)}
              placeholder="Descreva o que foi abordado na aula"
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="observations">Observações Pedagógicas</Label>
            <Textarea
              id="observations"
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
              placeholder="Notas sobre o desempenho da turma ou ocorrências"
              rows={2}
            />
          </div>

          <div className="flex items-center justify-between pt-2">
            <div>
              <Label>Iniciar agora</Label>
              <p className="text-xs text-muted-foreground">
                Desative para agendar um horário específico de início.
              </p>
            </div>
            <Switch checked={startNow} onCheckedChange={setStartNow} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="startsAt">Início da chamada</Label>
            <Input
              id="startsAt"
              type="datetime-local"
              value={startsAtLocal}
              disabled={startNow}
              onChange={(e) => setStartsAtLocal(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {startNow
                ? "A chamada abrirá imediatamente ao criar."
                : "Defina a data e o horário de abertura da chamada."}
            </p>
          </div>

          <Label htmlFor="codew">Janela do código (minutos)</Label>
          <Select value={String(codeWindow)} onValueChange={(v) => setCodeWindow(Number(v))}>
            <SelectTrigger id="codew">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="5">5 minutos</SelectItem>
              <SelectItem value="10">10 minutos</SelectItem>
              <SelectItem value="15">15 minutos</SelectItem>
              <SelectItem value="20">20 minutos</SelectItem>
              <SelectItem value="30">30 minutos</SelectItem>
              <SelectItem value="45">45 minutos</SelectItem>
              <SelectItem value="60">60 minutos</SelectItem>
              <SelectItem value="120">120 minutos</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={submitting}
            onClick={async () => {
              setSubmitting(true);
              const startsAtIso = startNow ? undefined : appLocalInputToIso(startsAtLocal);
              const sessionDate = startNow ? dateInAppZone(new Date()) : startsAtLocal.slice(0, 10);
              await onSubmit(topic, codeWindow, startsAtIso, sessionDate, programmatic, observations);
              setSubmitting(false);
            }}
          >
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditSessionDialog({
  session,
  nowMs,
  onClose,
  onDone,
}: {
  session: Session;
  nowMs: number;
  onClose: () => void;
  onDone: (updated?: Session) => void;
}) {
  const [topic, setTopic] = useState(session.topic ?? "");
  const [programmatic, setProgrammatic] = useState(session.programmatic_content ?? "");
  const [observations, setObservations] = useState(session.pedagogical_observations ?? "");
  const [codeWindow, setCodeWindow] = useState<number>(session.code_window_minutes ?? 15);
  const [startsAtLocal, setStartsAtLocal] = useState<string>(
    toLocalInput(new Date(session.starts_at ?? session.created_at)),
  );
  const [submitting, setSubmitting] = useState(false);
  const started = !notYetStarted(session, nowMs);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar chamada</DialogTitle>
          <DialogDescription>
            {started
              ? "Esta chamada já foi iniciada: apenas o tópico pode ser editado."
              : "Ajuste o tópico, o horário de início ou a duração da janela do código."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="etopic">Tópico</Label>
            <Input
              id="etopic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              maxLength={200}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eprogrammatic">Conteúdo Programático</Label>
            <Textarea
              id="eprogrammatic"
              value={programmatic}
              onChange={(e) => setProgrammatic(e.target.value)}
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eobservations">Observações Pedagógicas</Label>
            <Textarea
              id="eobservations"
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="estart">Início da chamada</Label>
            <Input
              id="estart"
              type="datetime-local"
              value={startsAtLocal}
              disabled={started}
              onChange={(e) => setStartsAtLocal(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ecode">Janela do código (minutos)</Label>
            <Select
              value={String(codeWindow)}
              onValueChange={(v) => setCodeWindow(Number(v))}
              disabled={started}
            >
              <SelectTrigger id="ecode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[5, 10, 15, 20, 30, 45, 60, 120].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} minutos
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={submitting}
            onClick={async () => {
              setSubmitting(true);
              try {
                const updated = await updateAttendanceSession({
                  data: started
                    ? { 
                        session_id: session.id, 
                        topic: topic || null,
                        programmatic_content: programmatic || null,
                        pedagogical_observations: observations || null
                      }
                    : {
                        session_id: session.id,
                        topic: topic || null,
                        starts_at: appLocalInputToIso(startsAtLocal),
                        session_date: startsAtLocal.slice(0, 10),
                        code_window_minutes: codeWindow,
                        programmatic_content: programmatic || null,
                        pedagogical_observations: observations || null
                      },
                });
                toast.success("Chamada atualizada");
                onDone(updated as Session);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Erro");
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExportCsvDialog({
  open,
  onOpenChange,
  disciplineId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  disciplineId: string;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [downloading, setDownloading] = useState(false);
  useEffect(() => {
    if (open) {
      setFrom("");
      setTo("");
    }
  }, [open]);
  const handleDownload = async () => {
    if (from && to && from > to) {
      toast.error("A data inicial deve ser anterior à data final.");
      return;
    }
    setDownloading(true);
    try {
      const res = await exportAttendanceCsv({
        data: {
          discipline_id: disciplineId,
          from: from || undefined,
          to: to || undefined,
        },
      });
      if (res.sessionCount === 0) {
        toast.error("Nenhuma chamada encontrada no período selecionado.");
        return;
      }
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const suffix = from || to ? `_${from || "inicio"}_${to || "fim"}` : "";
      a.download = `frequencia${suffix}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`CSV gerado (${res.studentCount} aluno(s), ${res.sessionCount} chamada(s)).`);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar CSV");
    } finally {
      setDownloading(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Baixar frequência (CSV)</DialogTitle>
          <DialogDescription>
            Gera uma planilha com a presença de cada aluno por aula. Deixe o período em branco
            para exportar todas as chamadas.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="csvFrom">De</Label>
            <Input
              id="csvFrom"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="csvTo">Até</Label>
            <Input
              id="csvTo"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={downloading} onClick={handleDownload}>
            {downloading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Baixar CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmAttendanceDialog({
  session,
  nowMs,
  onClose,
  onDone,
}: {
  session: Session;
  nowMs: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirmar presença</DialogTitle>
          <DialogDescription>
            Insira o código de 6 letras anunciado pelo professor.
            <span className="block mt-1 text-primary font-medium">
              {codeRemaining(session, nowMs)}
            </span>
          </DialogDescription>
        </DialogHeader>
        <Input
          value={code}
          onChange={(e) =>
            setCode(
              e.target.value
                .toUpperCase()
                .replace(/[^A-Z]/g, "")
                .slice(0, 6),
            )
          }
          className="font-mono text-center text-2xl tracking-widest"
          placeholder="ABCDEF"
          disabled={false}
          maxLength={6}
        />

        <DialogFooter>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              onClose();
            }}
            className="h-10 px-4 border border-input bg-background hover:bg-accent hover:text-accent-foreground rounded-md transition-colors text-sm font-medium mr-2 cursor-pointer"
            style={{ opacity: 1, pointerEvents: 'auto' }}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="h-10 px-4 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md transition-colors text-sm font-medium cursor-pointer"
            style={{ opacity: 1, pointerEvents: 'auto' }}
            onClick={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              
              if (code.length !== 6) {
                toast.error("Insira o código de 6 letras");
                return;
              }


              setSubmitting(true);
              try {
                await confirmAttendance({ data: { session_id: session.id, code } });
                toast.success("Presença confirmada");
                onDone();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Erro");
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Confirmar
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JustifyDialog({
  session,
  nowMs,
  onClose,
  onDone,
}: {
  session: Session;
  nowMs: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { user } = useAuth();
  const [reason, setReason] = useState<string>("student_illness");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!user) return;
    setSubmitting(true);
    try {
      let attachment_url: string | undefined;
      if (file) {
        const path = `${user.id}/${session.id}-${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
        const { error: upErr } = await supabase.storage
          .from("justifications")
          .upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        attachment_url = path;
      }
      await submitJustification({
        data: {
          session_id: session.id,
          reason: reason as "student_illness",
          description: description || undefined,
          attachment_url,
        },
      });
      toast.success("Justificativa enviada");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao enviar justificativa");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Justificar falta</DialogTitle>
          <DialogDescription>{timeRemaining(session, nowMs)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Motivo</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(REASONS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="desc">Descrição</Label>
            <Textarea
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="att">Comprovante (PDF, JPG, PNG, doc)</Label>
            <Input
              id="att"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              onClose();
            }}
            className="h-10 px-4 border border-input bg-background hover:bg-accent hover:text-accent-foreground rounded-md transition-colors text-sm font-medium mr-2 cursor-pointer"
            style={{ opacity: 1, pointerEvents: 'auto' }}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="h-10 px-4 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md transition-colors text-sm font-medium cursor-pointer"
            style={{ opacity: 1, pointerEvents: 'auto' }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              submit();
            }}
          >
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Enviar
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewDialog({
  justification,
  studentProfile,
  onClose,
  onDone,
}: {
  justification: Justification;
  studentProfile?: { name: string; matricula: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const decide = async (decision: "approved" | "rejected") => {
    setSubmitting(true);
    try {
      await reviewJustification({
        data: { justification_id: justification.id, decision, note: note || undefined },
      });
      toast.success(decision === "approved" ? "Aprovada" : "Rejeitada");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revisar justificativa</DialogTitle>
          <div className="flex items-center gap-3 py-2 border-b mb-2">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
              {studentProfile?.name?.charAt(0) || "?"}
            </div>
            <div>
              <p className="text-sm font-bold leading-tight">{studentProfile?.name || "Estudante"}</p>
              <p className="text-xs text-muted-foreground">Matrícula: {studentProfile?.matricula || "---"}</p>
            </div>
          </div>
          <DialogDescription>Motivo: {REASONS[justification.reason]}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          {justification.description && (
            <p className="bg-muted/50 p-2 rounded">{justification.description}</p>
          )}
          {justification.attachment_url && (
            <p className="text-xs text-muted-foreground">Comprovante anexado.</p>
          )}
          <Label htmlFor="note">Observação (opcional)</Label>
          <Textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={1000}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => decide("rejected")} disabled={submitting}>
            <X className="h-4 w-4 mr-2" /> Rejeitar
          </Button>
          <Button onClick={() => decide("approved")} disabled={submitting}>
            <Check className="h-4 w-4 mr-2" /> Aprovar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog({
  open,
  onOpenChange,
  disciplineId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  disciplineId: string;
}) {
  const [counts, setCounts] = useState(true);
  const [minPct, setMinPct] = useState(75);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase
        .from("discipline_settings")
        .select("*")
        .eq("discipline_id", disciplineId)
        .maybeSingle();
      if (data) {
        setCounts(data.justified_counts_as_presence);
        setMinPct(Number(data.min_attendance_percent));
      }
    })();
  }, [open, disciplineId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configurações de frequência</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Falta justificada conta como presença</Label>
              <p className="text-xs text-muted-foreground">
                Se desativado, a falta justificada aparece na história mas não conta como presença.
              </p>
            </div>
            <Switch checked={counts} onCheckedChange={setCounts} />
          </div>
          <div className="space-y-1.5">
            <Label>Frequência mínima (%)</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={minPct}
              onChange={(e) => setMinPct(Number(e.target.value))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={submitting}
            onClick={async () => {
              setSubmitting(true);
              try {
                await updateDisciplineSettings({
                  data: {
                    discipline_id: disciplineId,
                    justified_counts_as_presence: counts,
                    min_attendance_percent: minPct,
                  },
                });
                toast.success("Configurações salvas");
                onOpenChange(false);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Erro");
              } finally {
                setSubmitting(false);
              }
            }}
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
