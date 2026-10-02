import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function fetchDisciplineById(disciplineId: string, userId: string) {
  // 1. Fetch discipline with admin client to bypass standard RLS for initial existence check
  const { data: disc, error: discErr } = await supabaseAdmin
    .from("disciplines")
    .select("*")
    .eq("id", disciplineId)
    .maybeSingle();

  if (discErr) {
    console.error("[fetchDisciplineById] Database error:", discErr);
    return null;
  }
  
  if (!disc) return null;

  // 2. Security Check: Is the user the teacher or an enrolled student?
  const isTeacher = disc.teacher_id === userId;
  if (isTeacher) return disc;

  const { data: enrollment } = await supabaseAdmin
    .from("discipline_students")
    .select("id")
    .eq("discipline_id", disciplineId)
    .eq("student_id", userId)
    .maybeSingle();

  if (enrollment) return disc;

  // 3. Admin Check (Optional but good for multi-tenancy)
  const { data: adminRole } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();

  if (adminRole) return disc;

  return null;
}
