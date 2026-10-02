import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** 
 * Fetches disciplines for the current user through their authenticated
 * database session, so this ordinary student read never needs an admin key.
 */
export const getStudentDisciplines = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const uid = context.userId;

    // Optimized fetch with limit and field restriction to avoid timeouts
    const { data: enrollments, error } = await context.supabase
      .from("discipline_students")
      .select(`
        discipline_id,
        disciplines (
          id, name, code, group_name, semester, year, color, status, syllabus_text, start_date, end_date, week_days, class_start_time, class_end_time, sort_order
        )
      `)
      .eq("student_id", uid)
      .eq("status", "active")
      .limit(50);

    if (error) {
      console.error("[getStudentDisciplines] Error:", error);
      throw new Error("Não foi possível carregar suas disciplinas.");
    }

    // Filter out potential nulls and return the discipline objects
    return (enrollments ?? [])
      .map(e => e.disciplines)
      .filter(Boolean);
  });
