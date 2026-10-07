import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { DisciplineCard, type DisciplineCardData } from "../DisciplineCard";
import { BookOpen, Loader2, FileText, ClipboardList, Search, ChevronLeft, ChevronRight, GraduationCap, PencilRuler, CheckCircle2 } from "lucide-react";
import { StatCard } from "./StatCard";
import { getStudentStats } from "@/backend/auth.functions";
import { syncStudentProfile } from "@/backend/student-sync.functions";
import { getStudentDisciplines } from "@/backend/student-disciplines.functions";
import {
  joinDisciplineById,
  listEnrollableTeachers,
  listEnrollableDisciplines,
} from "@/backend/disciplines.functions";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { InstallAppButton } from "@/components/InstallAppButton";
import { QuickAttendanceDialog } from "@/components/QuickAttendanceDialog";
import { OnlineExamsStudentList } from "@/components/dashboards/OnlineExamsStudentList";

interface EnrollTeacher {
  id: string;
  name: string;
  institution_name: string | null;
}

interface EnrollDiscipline {
  id: string;
  name: string;
  semester: string;
  year: number;
  group_name: string | null;
}

export function StudentDashboard() {
  const { profile, user, refreshProfile } = useAuth();
  const [items, setItems] = useState<DisciplineCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<{ totalDisciplines: number; materialsCount: number; pendingActivities: number; pendingExercises: number; attendancePercent: number | null; attendanceByDiscipline: Record<string, number> } | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joining, setJoining] = useState(false);
  const [attendOpen, setAttendOpen] = useState(false);

  // Enrollment wizard state
  const [step, setStep] = useState<"teacher" | "discipline" | "confirm">("teacher");
  const [teacherSearch, setTeacherSearch] = useState("");
  const [teachers, setTeachers] = useState<EnrollTeacher[]>([]);
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  const [selectedTeacher, setSelectedTeacher] = useState<EnrollTeacher | null>(null);
  const [teacherDisciplines, setTeacherDisciplines] = useState<EnrollDiscipline[]>([]);
  const [loadingDisciplines, setLoadingDisciplines] = useState(false);
  const [selectedDiscipline, setSelectedDiscipline] = useState<EnrollDiscipline | null>(null);

  const listTeachersFn = useServerFn(listEnrollableTeachers);
  const listDisciplinesFn = useServerFn(listEnrollableDisciplines);
  const joinFn = useServerFn(joinDisciplineById);
  const getStudentStatsFn = useServerFn(getStudentStats);
  const syncProfileFn = useServerFn(syncStudentProfile);
  const getStudentDisciplinesFn = useServerFn(getStudentDisciplines);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await getStudentDisciplinesFn();
      const list: DisciplineCardData[] = (data ?? [])
        .filter((d: any): d is DisciplineCardData => Boolean(d))
        .filter((d: any) => d.status === "active")
        .map((d: any) => ({ 
          ...d, 
          studentCount: 0
        }));
      
      localStorage.setItem("estudaja:student_disciplines", JSON.stringify(list));
      setItems(list);

      const statsData = await getStudentStatsFn({ data: {} });
      setStats(statsData);
      if (statsData) localStorage.setItem("estudaja:student_stats", JSON.stringify(statsData));
    } catch (err) {
      console.warn("[student-dashboard] load failed", err);
      const cached = localStorage.getItem("estudaja:student_disciplines");
      if (cached) {
        try {
          setItems(JSON.parse(cached));
          toast.info("Modo Offline: Usando dados locais.");
        } catch { setItems([]); }
      } else {
        setItems([]);
      }
      
      const cachedStats = localStorage.getItem("estudaja:student_stats");
      if (cachedStats) setStats(JSON.parse(cachedStats));
      
      toast.error("Erro de conexão. Verifique sua internet.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    void load();
  }, [user]);

  // Auto-reparo do primeiro acesso: nome real + adoção dos vínculos de turma.
  useEffect(() => {
    if (!user || !profile) return;
    const placeholder =
      !profile.name || /^estudante\b/i.test(profile.name.trim()) ||
      profile.name.trim().toUpperCase() === (profile.enrollment_number ?? "").toUpperCase();
    if (!placeholder && items.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = (await syncProfileFn()) as { ok?: boolean; migratedEnrollments?: number; name?: string };
        if (cancelled || !res?.ok) return;
        if (placeholder) await refreshProfile();
        if ((res.migratedEnrollments ?? 0) > 0 || placeholder) await load();
      } catch (e) {
        console.warn("[student-dashboard] sync de perfil indisponível", e);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, profile?.id]);

  const openWizard = async () => {
    setStep("teacher");
    setTeacherSearch("");
    setSelectedTeacher(null);
    setSelectedDiscipline(null);
    setTeacherDisciplines([]);
    setJoinOpen(true);
    setLoadingTeachers(true);
    try {
      const data = await listTeachersFn();
      const list = Array.isArray(data) ? (data as EnrollTeacher[]) : [];
      const seen = new Set<string>();
      setTeachers(list.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true))));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar professores");
      setTeachers([]);
    } finally {
      setLoadingTeachers(false);
    }
  };

  const pickTeacher = async (teacher: EnrollTeacher) => {
    setSelectedTeacher(teacher);
    setStep("discipline");
    setLoadingDisciplines(true);
    try {
      const data = await listDisciplinesFn({ data: { teacher_id: teacher.id } });
      setTeacherDisciplines(Array.isArray(data) ? (data as EnrollDiscipline[]) : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar disciplinas");
      setTeacherDisciplines([]);
    } finally {
      setLoadingDisciplines(false);
    }
  };

  const pickDiscipline = (discipline: EnrollDiscipline) => {
    setSelectedDiscipline(discipline);
    setStep("confirm");
  };

  const confirmEnrollment = async () => {
    if (!selectedDiscipline) return;
    setJoining(true);
    try {
      const res = await joinFn({ data: { discipline_id: selectedDiscipline.id } });
      if (res.already_enrolled) {
        toast("Você já está matriculado nessa disciplina");
      } else {
        toast.success("Matrícula realizada");
      }
      setJoinOpen(false);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes("fetch") || msg.toLowerCase().includes("timeout") || msg.toLowerCase().includes("network")) {
        toast.error("Erro de conexão. Verifique sua internet.");
      } else {
        toast.error(msg || "Erro ao matricular");
      }
    } finally {
      setJoining(false);
    }
  };

  const filteredTeachers = teachers.filter((t) =>
    t.name.toLowerCase().includes(teacherSearch.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Olá, {profile?.full_name || profile?.name || "estudante"} 👋</h1>
          <p className="text-white/90 text-sm sm:text-base font-medium">Suas disciplinas atuais.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <InstallAppButton />
          <Button
            onClick={() => setAttendOpen(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <CheckCircle2 className="h-4 w-4 mr-2" /> Marcar presença
          </Button>
          <Button onClick={openWizard}>
            <BookOpen className="h-4 w-4 mr-2" /> Disciplinas
          </Button>
        </div>
      </div>
      <QuickAttendanceDialog
        open={attendOpen}
        onOpenChange={setAttendOpen}
        onMarked={() => void load()}
      />
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Disciplinas" value={stats.totalDisciplines} icon={BookOpen} tone="teal" />
          <StatCard label="Materiais disponíveis" value={stats.materialsCount} icon={FileText} tone="blue" />
          <StatCard label="Atividades e trabalhos pendentes" value={stats.pendingActivities} icon={ClipboardList} tone="orange" />
          <StatCard label="Exercícios pendentes" value={stats.pendingExercises} icon={PencilRuler} tone="pink" />
        </div>
      )}
      <OnlineExamsStudentList />
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl overflow-hidden bg-white/5 border border-white/10 animate-pulse">
              <div className="h-36 bg-white/10" />
              <div className="p-4 space-y-3">
                <div className="h-4 w-3/4 bg-white/10 rounded" />
                <div className="flex justify-between">
                  <div className="h-3 w-1/2 bg-white/5 rounded" />
                  <div className="h-3 w-8 bg-white/5 rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="border-2 border-dashed border-white/40 rounded-xl py-12 text-center">
          <BookOpen className="h-10 w-10 text-white/80 mx-auto mb-3" />
          <p className="text-sm text-white/80">Você ainda não está matriculado em nenhuma disciplina.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((d) => (
            <DisciplineCard
              key={d.id}
              discipline={d}
              canManage={false}
              href={`/disciplines/${d.id}`}
              attendancePercent={stats?.attendanceByDiscipline?.[d.id] ?? null}
            />
          ))}
        </div>
      )}
      <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Matricular em disciplina</DialogTitle></DialogHeader>

          {step === "teacher" && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={teacherSearch}
                  onChange={(e) => setTeacherSearch(e.target.value)}
                  placeholder="Buscar professor por nome"
                  className="pl-9"
                  autoFocus
                />
              </div>
              {loadingTeachers ? (
                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : filteredTeachers.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Nenhum professor com disciplinas ativas.</p>
              ) : (
                <div className="max-h-[55vh] overflow-y-auto space-y-2">
                  {filteredTeachers.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => pickTeacher(t)}
                      className="w-full text-left flex items-center gap-3 rounded-lg border p-3 hover:bg-accent transition-colors"
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted shrink-0">
                        <GraduationCap className="h-4 w-4 text-muted-foreground" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium truncate">{t.name}</span>
                        {t.institution_name && (
                          <span className="block text-xs text-muted-foreground truncate">{t.institution_name}</span>
                        )}
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === "discipline" && (
            <div className="space-y-3">
              <Button variant="ghost" size="sm" className="self-start -ml-2" onClick={() => setStep("teacher")}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Voltar
              </Button>
              <p className="text-sm text-muted-foreground">
                Disciplinas de <strong>{selectedTeacher?.name}</strong>
              </p>
              {loadingDisciplines ? (
                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : teacherDisciplines.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Nenhuma disciplina ativa para este professor.</p>
              ) : (
                <div className="max-h-[55vh] overflow-y-auto space-y-2">
                  {teacherDisciplines.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => pickDiscipline(d)}
                      className="w-full h-auto min-w-0 text-left flex items-center gap-3 rounded-lg border p-3 hover:bg-accent transition-colors whitespace-normal"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium whitespace-normal break-words [overflow-wrap:anywhere] leading-snug">{d.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {d.semester}º · {d.year}{d.group_name ? ` · ${d.group_name}` : ""}
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === "confirm" && selectedDiscipline && (
            <div className="space-y-4">
              <Button variant="ghost" size="sm" className="self-start -ml-2" onClick={() => setStep("discipline")}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Voltar
              </Button>
              <Card className="border">
                <CardContent className="p-4 space-y-1">
                  <p className="font-semibold text-lg whitespace-normal break-words [overflow-wrap:anywhere]">{selectedDiscipline.name}</p>
                  <p className="text-sm text-muted-foreground">Professor(a): {selectedTeacher?.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {selectedDiscipline.semester}º semestre · {selectedDiscipline.year}
                    {selectedDiscipline.group_name ? ` · ${selectedDiscipline.group_name}` : ""}
                  </p>
                </CardContent>
              </Card>
              <Button className="w-full" onClick={confirmEnrollment} disabled={joining}>
                {joining && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Confirmar matrícula
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}