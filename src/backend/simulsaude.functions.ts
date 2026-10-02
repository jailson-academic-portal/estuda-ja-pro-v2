import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getClinicalCases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data) => z.object({ disciplineId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    // Check if student is enrolled OR if user is teacher/admin
    const { data: enrollment } = await supabaseAdmin
      .from("discipline_students")
      .select("id")
      .eq("discipline_id", data.disciplineId)
      .eq("student_id", context.userId)
      .maybeSingle();

    const { data: discipline } = await supabaseAdmin
      .from("disciplines")
      .select("teacher_id")
      .eq("id", data.disciplineId)
      .maybeSingle();

    const isAdmin = context.userId && await (async () => {
      const { data: role } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId)
        .eq("role", "admin")
        .maybeSingle();
      return !!role;
    })();

    if (!enrollment && discipline?.teacher_id !== context.userId && !isAdmin) {
      return [];
    }

    const { data: cases, error } = await supabaseAdmin
      .from("clinical_cases")
      .select("*")
      .eq("discipline_id", data.disciplineId)
      .eq("status", "published")
      .order("created_at", { ascending: false });
    
    if (error) throw error;
    return cases || [];
  });

export const submitCaseResolution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => z.object({
    caseId: z.string().uuid(),
    studentId: z.string().uuid(),
    answers: z.any()
  }).parse(data))
  .handler(async ({ data, context }) => {
    if (data.studentId !== context.userId) {
      throw new Response("Unauthorized", { status: 401 });
    }

    const { data: result, error } = await supabaseAdmin
      .from("student_submissions")
      .insert({
        case_id: data.caseId,
        student_id: data.studentId,
        answers: data.answers,
        status: "submitted",
        submitted_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error("[submitCaseResolution] error:", error);
      throw error;
    }
    return result;
  });

export const getCaseSubmission = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data) => z.object({ caseId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: submission, error } = await supabaseAdmin
      .from("student_submissions")
      .select("*")
      .eq("case_id", data.caseId)
      .eq("student_id", context.userId)
      .maybeSingle();
    
    if (error) throw error;
    return submission;
  });
