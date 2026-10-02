import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notifyUsers } from "./notifications.server";

export async function notifyTeacherOfSubmission(opts: {
  disciplineId: string;
  studentId: string;
  kind: "activity" | "work";
  parentTitle: string;
}) {
  const { data: disc } = await supabaseAdmin
    .from("disciplines")
    .select("teacher_id,name")
    .eq("id", opts.disciplineId)
    .maybeSingle();
  if (!disc?.teacher_id) return;
  const { data: prof } = await supabaseAdmin
    .from("profiles")
    .select("name")
    .eq("id", opts.studentId)
    .maybeSingle();
  const label = opts.kind === "activity" ? "Atividade Extra" : "Trabalho Acadêmico";
  await notifyUsers(
    [disc.teacher_id],
    "new_submission",
    `Nova entrega — ${label}`,
    `${prof?.name ?? "Aluno"} enviou "${opts.parentTitle}" em ${disc.name}.`,
    `/disciplines/${opts.disciplineId}`,
  );
}