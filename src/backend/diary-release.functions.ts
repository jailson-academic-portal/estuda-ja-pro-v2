import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertTeacherOrAdmin } from "./discipline-access.server";

export const getDiaryColumns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ discipline_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: structure } = await supabaseAdmin
      .from("grade_structures")
      .select("assessments")
      .eq("discipline_id", data.discipline_id)
      .maybeSingle();

    if (!structure?.assessments) return [];
    
    // Return flat list of possible columns (main assessments + sub-items)
    const assessments = structure.assessments as any[];
    const columns: { id: string; name: string; max_score: number }[] = [];
    
    assessments.forEach(a => {
      if (a.sub_items?.length) {
        a.sub_items.forEach((sub: any) => {
          columns.push({
            id: `${a.id}#${sub.id}`,
            name: `${a.name} - ${sub.name}`,
            max_score: a.max_score || 10
          });
        });
      } else {
        columns.push({
          id: a.id,
          name: a.name,
          max_score: a.max_score || 10
        });
      }
    });
    
    return columns;
  });

export const releaseGradeToDiary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    discipline_id: z.string().uuid(),
    student_id: z.string().uuid(),
    assessment_id: z.string(), // Column ID in diary
    score: z.number(),
    mode: z.enum(["replace", "sum"]).default("replace"),
    activity_ref: z.object({
      id: z.string(),
      type: z.string(),
      title: z.string()
    }).optional()
  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertTeacherOrAdmin(data.discipline_id, context.userId);
    
    let finalScore = data.score;
    
    if (data.mode === "sum") {
      const { data: existing } = await supabaseAdmin
        .from("grade_entries")
        .select("score")
        .eq("discipline_id", data.discipline_id)
        .eq("student_id", data.student_id)
        .eq("assessment_id", data.assessment_id)
        .maybeSingle();
      
      if (existing?.score != null) {
        finalScore += Number(existing.score);
      }
    }
    
    const { error } = await supabaseAdmin.from("grade_entries").upsert({
      discipline_id: data.discipline_id,
      student_id: data.student_id,
      assessment_id: data.assessment_id,
      score: finalScore,
      metadata: data.activity_ref ? ({
        activity_id: data.activity_ref.id,
        activity_type: data.activity_ref.type,
        activity_title: data.activity_ref.title,
        released_at: new Date().toISOString()
      } as any) : undefined
    } as any, { onConflict: "discipline_id,student_id,assessment_id" });

    if (error) throw new Error(error.message);
    return { ok: true, released_score: finalScore };
  });
