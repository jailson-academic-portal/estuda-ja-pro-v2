import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { userIsAdmin } from "./discipline-access.server";

export const importStudentsCSV = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => z.object({
    classId: z.string().uuid(),
    students: z.array(z.object({
      name: z.string(),
      email: z.string().email(),
      matricula: z.string().optional(),
    }))
  }).parse(data))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { classId, students } = data;

    // Verify ownership/role
    const isAdmin = await userIsAdmin(userId);
    if (!isAdmin) {
      // Check if teacher of any discipline in this class
      const { data: ownClass } = await supabaseAdmin
        .from("class_professors" as any)
        .select("id")
        .eq("class_id", classId)
        .eq("teacher_id", userId)
        .limit(1)
        .maybeSingle();

      if (!ownClass) {
        throw new Response("Unauthorized: You do not have permission to import students to this class", { status: 403 });
      }
    }

    const results = { success: 0, failed: 0, errors: [] as string[] };

    for (const student of students) {
      try {
        let profileResult = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("email", student.email)
          .maybeSingle();

        let profileId = (profileResult.data as any)?.id;

        if (!profileId) {
          const matricula = student.matricula || `TMP${Date.now()}${Math.floor(Math.random() * 1000)}`;
          const initialPassword = matricula.length >= 6 ? matricula : `${matricula}${"0".repeat(6 - matricula.length)}`;
          
          const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
            email: student.email,
            password: initialPassword,
            email_confirm: true,
            user_metadata: {
              name: student.name,
              enrollment_number: student.matricula,
              profile_type: "student",
            },
          });

          if (createErr || !created.user) {
            throw new Error(createErr?.message || "Failed to create user");
          }
          profileId = created.user.id;
          
          await supabaseAdmin.from("profiles").update({
            name: student.name,
            enrollment_number: student.matricula,
            status: "active",
            password_set: false
          }).eq("id", profileId);
        }

        const { error: enrollError } = await supabaseAdmin
          .from("class_students" as any)
          .upsert({
            class_id: classId,
            student_id: profileId,
            matricula: student.matricula
          }, { onConflict: "class_id, student_id" });

        if (enrollError) throw enrollError;

        const { data: classDisciplines } = await supabaseAdmin
          .from("class_professors" as any)
          .select("discipline_id")
          .eq("class_id", classId);

        if (classDisciplines && (classDisciplines as any[]).length > 0) {
          for (const d of (classDisciplines as any[])) {
            if (d.discipline_id) {
              await supabaseAdmin
                .from("discipline_students")
                .upsert({
                  student_id: profileId,
                  discipline_id: d.discipline_id
                }, { onConflict: "student_id, discipline_id" });
            }
          }
        }

        results.success++;
      } catch (err: any) {
        results.failed++;
        results.errors.push(`${student.email}: ${err.message}`);
      }
    }

    return results;
  });

export const updateInstitutionBranding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => z.object({
    id: z.string().uuid(),
    unit: z.string().optional(),
    primaryColor: z.string().optional(),
    secondaryColor: z.string().optional(),
    logoUrl: z.string().url().optional(),
  }).parse(data))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { id, ...updates } = data;

    // Verify ownership/role
    const isAdmin = await userIsAdmin(userId);
    if (!isAdmin) {
      const { data: institution } = await supabaseAdmin
        .from("institutions")
        .select("owner_user_id")
        .eq("id", id)
        .maybeSingle();

      if (!institution || (institution as any).owner_user_id !== userId) {
        throw new Response("Unauthorized: You do not have permission to update this institution's branding", { status: 403 });
      }
    }
    
    const mappedUpdates: any = {};
    if (updates.unit) mappedUpdates.unit = updates.unit;
    if (updates.primaryColor) mappedUpdates.primary_color = updates.primaryColor;
    if (updates.secondaryColor) mappedUpdates.secondary_color = updates.secondaryColor;
    if (updates.logoUrl) mappedUpdates.logo_url = updates.logoUrl;

    const { error } = await supabaseAdmin
      .from("institutions")
      .update(mappedUpdates)
      .eq("id", id);

    if (error) throw new Error(error.message);
    return { success: true };
  });
