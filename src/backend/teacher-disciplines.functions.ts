import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getTeacherDisciplines = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: any) => z.object({
    status: z.enum(["active", "archived"]).default("active")
  }).parse(input))
  .handler(async ({ data, context }) => {
    // Use the request-scoped authenticated client so RLS sees the teacher's session.
    const supabase = context.supabase;
    const uid = context.userId;

    const { data: disciplines, error } = await supabase
      .from("disciplines")
      .select("id,name,code,group_name,semester,year,color,status,syllabus_text,start_date,end_date,week_days,class_start_time,class_end_time,sort_order")
      .eq("status", data.status)
      .eq("teacher_id", uid)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[getTeacherDisciplines] Error:", error);
      throw new Error("Erro ao carregar disciplinas.");
    }

    return disciplines || [];
  });
