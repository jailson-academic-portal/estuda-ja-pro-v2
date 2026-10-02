import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AnalyticsPayload = {
  settings: { min_attendance_percent: number; justified_counts_as_presence: boolean };
  discipline: { name: string | null; start_date: string | null; end_date: string | null };
  timeline: {
    grades: { at: string; score: number }[];
    deliveries: { at: string; on_time: boolean }[];
    ai: { at: string }[];
  };
  structure: {
    assessments: { id: string; name: string; weight: number; max_score: number; sub_items?: { id: string; name: string }[] }[];
    passing_average: number;
    grade_scale: number;
  } | null;
  students: { id: string; name: string; enrollment_number: string | null; email: string | null }[];
  entries: { student_id: string; assessment_id: string; score: number | null; updated_at?: string | null }[];
  sessions: { id: string; session_date: string; topic: string | null }[];
  records: { session_id: string; student_id: string; status: string }[];
  deliveries: { student_id: string; count: number }[];
  module_stats: {
    partial: number;
    final: number;
    exercises: number;
    assessments: number;
  };
  expected_deliveries: number;
  ai_interactions: number;
};

export async function buildAnalytics(disciplineId: string, onlyStudentId?: string): Promise<AnalyticsPayload> {
  const [settingsRes, structRes, enrollRes, sessionsRes, discRes] = await Promise.all([
    supabaseAdmin
      .from("discipline_settings")
      .select("min_attendance_percent, justified_counts_as_presence")
      .eq("discipline_id", disciplineId)
      .maybeSingle(),
    supabaseAdmin
      .from("grade_structures")
      .select("assessments, passing_average, grade_scale")
      .eq("discipline_id", disciplineId)
      .maybeSingle(),
    supabaseAdmin
      .from("discipline_students")
      .select("student_id")
      .eq("discipline_id", disciplineId),
    supabaseAdmin
      .from("attendance_sessions")
      .select("id, session_date, topic")
      .eq("discipline_id", disciplineId)
      .order("session_date", { ascending: true }),
    supabaseAdmin
      .from("disciplines")
      .select("name, start_date, end_date, created_at")
      .eq("id", disciplineId)
      .maybeSingle(),
  ]);

  let studentIds = (enrollRes.data ?? []).map((r) => r.student_id as string);
  if (onlyStudentId) studentIds = studentIds.filter((id) => id === onlyStudentId);

  const profilesRes = studentIds.length
    ? await supabaseAdmin.from("profiles").select("id, name, enrollment_number, email").in("id", studentIds)
    : { data: [] as { id: string; name: string; enrollment_number: string | null; email: string | null }[] };

  const sessions = (sessionsRes.data ?? []) as { id: string; session_date: string; topic: string | null }[];
  const sessionIds = sessions.map((s) => s.id);

  const [recordsRes, entriesRes, actRes, workRes, exRes, aiRes] = await Promise.all([
    sessionIds.length && studentIds.length
      ? supabaseAdmin
          .from("attendance_records")
          .select("session_id, student_id, status")
          .in("session_id", sessionIds)
          .in("student_id", studentIds)
      : Promise.resolve({ data: [] as never[] }),
    studentIds.length
      ? supabaseAdmin
          .from("grade_entries")
          .select("student_id, assessment_id, score, updated_at")
          .eq("discipline_id", disciplineId)
          .in("student_id", studentIds)
      : Promise.resolve({ data: [] as never[] }),
    supabaseAdmin.from("activities").select("id, due_at").eq("discipline_id", disciplineId).eq("status", "published"),
    supabaseAdmin.from("academic_works").select("id, due_at").eq("discipline_id", disciplineId).eq("status", "published"),
    supabaseAdmin.from("exercises").select("id, due_at").eq("discipline_id", disciplineId).eq("status", "published"),
    supabaseAdmin.from("ai_generations").select("created_at").eq("discipline_id", disciplineId),
  ]);

  type Pub = { id: string; due_at: string | null };
  const acts = (actRes.data ?? []) as Pub[];
  const works = (workRes.data ?? []) as Pub[];
  const exs = (exRes.data ?? []) as Pub[];
  const activityIds = acts.map((r) => r.id);
  const workIds = works.map((r) => r.id);
  const exerciseIds = exs.map((r) => r.id);
  const dueMap = new Map<string, string | null>();
  for (const p of [...acts, ...works, ...exs]) dueMap.set(p.id, p.due_at);

  const [actSubs, workSubs, exSubs] = await Promise.all([
    activityIds.length
      ? supabaseAdmin.from("activity_submissions").select("student_id, submitted_at, activity_id").in("activity_id", activityIds)
      : Promise.resolve({ data: [] as never[] }),
    workIds.length
      ? supabaseAdmin.from("academic_work_submissions").select("student_id, submitted_at, work_id").in("work_id", workIds)
      : Promise.resolve({ data: [] as never[] }),
    exerciseIds.length
      ? supabaseAdmin.from("exercise_submissions").select("student_id, submitted_at, exercise_id").in("exercise_id", exerciseIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const counter = new Map<string, number>();
  const deliveryPoints: { at: string; on_time: boolean }[] = [];
  const allSubs = [
    ...((actSubs.data ?? []) as { student_id: string; submitted_at: string; activity_id: string }[]).map((r) => ({
      student_id: r.student_id,
      submitted_at: r.submitted_at,
      source_id: r.activity_id,
    })),
    ...((workSubs.data ?? []) as { student_id: string; submitted_at: string; work_id: string }[]).map((r) => ({
      student_id: r.student_id,
      submitted_at: r.submitted_at,
      source_id: r.work_id,
    })),
    ...((exSubs.data ?? []) as { student_id: string; submitted_at: string; exercise_id: string }[]).map((r) => ({
      student_id: r.student_id,
      submitted_at: r.submitted_at,
      source_id: r.exercise_id,
    })),
  ];
  for (const row of allSubs) {
    if (!studentIds.includes(row.student_id)) continue;
    counter.set(row.student_id, (counter.get(row.student_id) ?? 0) + 1);
    if (row.submitted_at) {
      const due = dueMap.get(row.source_id) ?? null;
      deliveryPoints.push({
        at: row.submitted_at,
        on_time: !due || new Date(row.submitted_at).getTime() <= new Date(due).getTime(),
      });
    }
  }

  const struct = structRes.data as
    | { assessments: unknown; passing_average: number; grade_scale: number }
    | null;

  // Calcular médias reais baseadas na estrutura do diário
  // Média Parcial: Prova 1, Prova 2, Estudo de Caso 1, Estudo de Caso 2
  // Média Final: Prova 3, Estudo de Caso 3, Trabalho Acadêmico, Caso Clínico
  const assessments = (struct?.assessments as any[]) || [];
  const entries = (entriesRes.data ?? []) as { assessment_id: string; score: number | null }[];

  const getAvgForLabels = (labels: string[]) => {
    const relevantIds = assessments
      .filter(a => labels.some(l => a.name.toLowerCase().includes(l.toLowerCase())))
      .map(a => a.id);
    
    if (!relevantIds.length) return 0;
    
    const relevantEntries = entries.filter(e => e.score !== null && relevantIds.includes(e.assessment_id));
    if (!relevantEntries.length) return 0;

    return (relevantEntries.reduce((acc, curr) => acc + Number(curr.score || 0), 0) / relevantEntries.length) * 10;
  };

  const partialAvg = getAvgForLabels(['Prova 1', 'Prova 2', 'Estudo de Caso 1', 'Estudo de Caso 2']);
  const finalAvg = getAvgForLabels(['Prova 3', 'Estudo de Caso 3', 'Trabalho Acadêmico', 'Caso Clínico']);

  const activityEntries = entries.filter(e => e.score !== null);
  const assessmentAvg = activityEntries.length 
    ? (activityEntries.reduce((acc, curr) => acc + Number(curr.score || 0), 0) / activityEntries.length) * 10
    : 0;

  const exerciseSubsRes = exerciseIds.length
    ? await supabaseAdmin.from("exercise_submissions").select("score").in("exercise_id", exerciseIds).not("score", "is", null)
    : { data: [] };
  const exerciseAvg = (exerciseSubsRes.data ?? []).length
    ? (exerciseSubsRes.data ?? []).reduce((acc, curr) => acc + Number(curr.score || 0), 0) / (exerciseSubsRes.data ?? []).length
    : 0;

  return {
    settings: {
      min_attendance_percent: Number(settingsRes.data?.min_attendance_percent ?? 75),
      justified_counts_as_presence: Boolean(settingsRes.data?.justified_counts_as_presence ?? true),
    },
    discipline: {
      name: (discRes.data?.name as string | null) ?? null,
      start_date: (discRes.data?.start_date as string | null) ?? null,
      end_date: (discRes.data?.end_date as string | null) ?? null,
    },
    timeline: {
      grades: ((entriesRes.data ?? []) as { updated_at?: string | null; score: number | null }[])
        .filter((e) => e.updated_at && e.score != null)
        .map((e) => ({ at: e.updated_at as string, score: Number(e.score) })),
      deliveries: deliveryPoints,
      ai: ((aiRes.data ?? []) as { created_at: string }[]).map((r) => ({ at: r.created_at })),
    },
    structure: struct
      ? {
          assessments: Array.isArray(struct.assessments) ? (struct.assessments as NonNullable<AnalyticsPayload["structure"]>["assessments"]) : [],
          passing_average: Number(struct.passing_average ?? 7),
          grade_scale: Number(struct.grade_scale ?? 10),
        }
      : null,
    students: (profilesRes.data ?? []) as AnalyticsPayload["students"],
    entries: (entriesRes.data ?? []) as AnalyticsPayload["entries"],
    sessions,
    records: (recordsRes.data ?? []) as AnalyticsPayload["records"],
    deliveries: [...counter.entries()].map(([student_id, count]) => ({ student_id, count })),
    module_stats: {
      partial: partialAvg,
      final: finalAvg,
      assessments: assessmentAvg,
      exercises: exerciseAvg * 10,
    },
    expected_deliveries: activityIds.length + workIds.length + exerciseIds.length,
    ai_interactions: (aiRes.data ?? []).length,
  };
}

