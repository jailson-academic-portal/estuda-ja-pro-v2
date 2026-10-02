import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertTeacherOrAdmin } from "./discipline-access.server";

const matriculaToEmail = (m: string) => `${m.trim().toLowerCase()}@students.estudaja.local`;

const MATRICULA_REGEX = /^[A-Za-z]{2}\d{1,9}$/;

const studentInput = z.object({
  name: z.string().trim().min(2).max(120),
  enrollment_number: z.string().trim().min(2).max(40).toUpperCase().refine(v => MATRICULA_REGEX.test(v), {
    message: "A matrícula deve conter 2 letras seguidas de até 9 números"
  }),
});

const enrollInput = z.object({
  discipline_id: z.string().uuid(),
  students: z.array(studentInput).min(1).max(500),
});

/**
 * Verify caller is the teacher of the discipline.
 */
async function assertTeacherOwnsDiscipline(disciplineId: string, userId: string) {
  await assertTeacherOrAdmin(disciplineId, userId);
}

/**
 * Enrolls students into a discipline. Creates auth users + profiles for new matrículas,
 * reuses existing ones, then inserts into discipline_students.
 */
export const enrollStudents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => enrollInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await assertTeacherOwnsDiscipline(data.discipline_id, userId);

    const results = {
      created: 0,
      reused: 0,
      already_enrolled: 0,
      errors: [] as { enrollment_number: string; message: string }[],
    };

    for (const s of data.students) {
      try {
        const matricula = s.enrollment_number.trim();
        // 1. Find existing profile by matricula
        const { data: existing } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("enrollment_number", matricula)
          .maybeSingle();

        let studentId: string;
        if (existing?.id) {
          studentId = existing.id;
          results.reused++;
        } else {
          // 2. Create auth user with synthetic email.
          // Initial password = matricula (first-access flow). Supabase requires
          // a minimum of 6 chars; pad short matriculas deterministically so the
          // student can still sign in with just their matricula.
          const email = matriculaToEmail(matricula);
          const initialPassword = matricula.length >= 6 ? matricula : `${matricula}${"0".repeat(6 - matricula.length)}`;
          const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
            email,
            password: initialPassword,
            email_confirm: true,
            user_metadata: {
              name: s.name,
              enrollment_number: matricula,
              profile_type: "student",
            },
          });
          if (createErr || !created.user) {
            results.errors.push({ enrollment_number: matricula, message: createErr?.message ?? "Falha ao criar" });
            continue;
          }
          studentId = created.user.id;

          // Forçar a senha inicial no auth.users para garantir que o login funcione imediatamente
          await supabaseAdmin.auth.admin.updateUserById(studentId, {
            password: initialPassword,
          });

          // Mark password_set=false and status=active
          await supabaseAdmin.from("profiles").update({ 
            password_set: false,
            status: "active"
          }).eq("id", studentId);
          results.created++;
        }


        // 3. Insert into discipline_students (ignore if already enrolled)
        const { error: enrollErr } = await supabaseAdmin
          .from("discipline_students")
          .insert({ discipline_id: data.discipline_id, student_id: studentId });
        if (enrollErr) {
          if (enrollErr.code === "23505") {
            results.already_enrolled++;
          } else {
            results.errors.push({ enrollment_number: matricula, message: enrollErr.message });
          }
        }
      } catch (e) {
        results.errors.push({
          enrollment_number: s.enrollment_number,
          message: e instanceof Error ? e.message : "Erro desconhecido",
        });
      }
    }

    return results;
  });

/**
 * Removes a student from a discipline (does NOT delete the user account).
 */
export const unenrollStudent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({ discipline_id: z.string().uuid(), student_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertTeacherOwnsDiscipline(data.discipline_id, context.userId);
    const { error } = await supabaseAdmin
      .from("discipline_students")
      .delete()
      .eq("discipline_id", data.discipline_id)
      .eq("student_id", data.student_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Activates/deactivates one or more enrollments in a SINGLE discipline.
 * Never touches the global profile, so the student keeps access to other disciplines.
 */
export const setEnrollmentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({
      discipline_id: z.string().uuid(),
      student_ids: z.array(z.string().uuid()).min(1),
      status: z.enum(["active", "inactive"]),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertTeacherOwnsDiscipline(data.discipline_id, context.userId);
    const { error } = await supabaseAdmin
      .from("discipline_students")
      .update({ status: data.status })
      .eq("discipline_id", data.discipline_id)
      .in("student_id", data.student_ids);
    if (error) throw new Error(error.message);
    return { ok: true, updated: data.student_ids.length };
  });

/**
 * Resets a student's password back to their enrollment number and clears
 * `password_set` so they're prompted to set a new password on next sign-in.
 * Only the teacher of a discipline the student is enrolled in (or an admin)
 * may call this.
 */
export const resetStudentPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({
      discipline_id: z.string().uuid(),
      student_id: z.string().uuid(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertTeacherOwnsDiscipline(data.discipline_id, context.userId);

    // Confirm enrollment in this discipline
    const { data: enrollment } = await supabaseAdmin
      .from("discipline_students")
      .select("id")
      .eq("discipline_id", data.discipline_id)
      .eq("student_id", data.student_id)
      .maybeSingle();
    if (!enrollment) throw new Error("Aluno não está matriculado nesta disciplina");

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("enrollment_number, profile_type")
      .eq("id", data.student_id)
      .maybeSingle();
    if (!profile?.enrollment_number) throw new Error("Aluno sem matrícula cadastrada");
    if (profile.profile_type !== "student") throw new Error("Apenas alunos podem ter senha resetada");

    const newPassword = profile.enrollment_number;
    const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(data.student_id, {
      password: newPassword,
    });
    if (updErr) throw new Error(updErr.message);

    await supabaseAdmin.from("profiles").update({ password_set: false }).eq("id", data.student_id);

    return { ok: true, enrollment_number: profile.enrollment_number };
  });

/**
 * Synchronizes students already enrolled in a discipline but missing from the
 * global registry (profiles/auth).
 */
export const syncDisciplineStudents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ discipline_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await assertTeacherOwnsDiscipline(data.discipline_id, userId);

    // Fetch discipline institution to link students correctly
    const { data: discipline } = await supabaseAdmin
      .from("disciplines")
      .select("institution_id")
      .eq("id", data.discipline_id)
      .maybeSingle();

    // 1. Get ALL enrollments for this discipline
    const { data: enrollments } = await supabaseAdmin
      .from("discipline_students")
      .select("student_id")
      .eq("discipline_id", data.discipline_id);

    if (!enrollments?.length) return { synced: 0, errors: [] };

    const studentIds = enrollments.map((e) => e.student_id);
    const results = {
      synced: 0,
      errors: [] as string[],
    };

    for (const sid of studentIds) {
      try {
        // Check if profile exists
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("id, enrollment_number, name, institution_id")
          .eq("id", sid)
          .maybeSingle();

        if (!profile) {
          results.errors.push(`Aluno ID ${sid} não possui perfil e não pôde ser sincronizado automaticamente.`);
          continue;
        }

        if (!profile.enrollment_number) {
          results.errors.push(`Aluno ${profile.name || sid} não possui matrícula cadastrada.`);
          continue;
        }

        const matricula = profile.enrollment_number.trim();
        
        // 2. Ensure profile is active
        await supabaseAdmin.from("profiles").update({
          status: "active",
          institution_id: profile.institution_id || discipline?.institution_id || null
        }).eq("id", sid);


        // 3. Check if Auth user exists
        const { data: authUser, error: authErr } = await supabaseAdmin.auth.admin.getUserById(sid);
        
        if (authErr || !authUser.user) {
          // Missing Auth: create it while preserving the profile ID
          const email = matriculaToEmail(matricula);
          const initialPassword = matricula.length >= 6 ? matricula : `${matricula}${"0".repeat(6 - matricula.length)}`;
          
          const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
            id: sid,
            email,
            password: initialPassword,
            email_confirm: true,
            user_metadata: {
              name: profile.name,
              enrollment_number: matricula,
              profile_type: "student",
            },
          });

          if (createErr) {
            results.errors.push(`Erro ao criar Auth para ${profile.name}: ${createErr.message}`);
            continue;
          }

          // Force correct password
          await supabaseAdmin.auth.admin.updateUserById(sid, {
            password: initialPassword,
          });

          // Update profile to mark password as not set and ensure institution
          await supabaseAdmin.from("profiles").update({ 
            password_set: false,
            institution_id: profile.institution_id || discipline?.institution_id
          }).eq("id", sid);

          results.synced++;
        }
      } catch (err) {
        results.errors.push(`Falha ao sincronizar ID ${sid}: ${err instanceof Error ? err.message : "Erro desconhecido"}`);
      }
    }

    return results;
  });

/**
 * Removes duplicate enrollments in a discipline.
 * Keeps only the oldest enrollment for each student.
 */
export const cleanupDisciplineDuplicates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ discipline_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await assertTeacherOwnsDiscipline(data.discipline_id, userId);

    // Fetch all enrollments for this discipline ordered by enrollment date
    const { data: enrollments } = await supabaseAdmin
      .from("discipline_students")
      .select("id, student_id, enrolled_at")
      .eq("discipline_id", data.discipline_id)
      .order("enrolled_at", { ascending: true });

    if (!enrollments || enrollments.length === 0) return { deleted: 0 };

    const seen = new Set<string>();
    const idsToDelete: string[] = [];

    for (const e of enrollments) {
      if (seen.has(e.student_id)) {
        idsToDelete.push(e.id);
      } else {
        seen.add(e.student_id);
      }
    }

    if (idsToDelete.length > 0) {
      const { error } = await supabaseAdmin
        .from("discipline_students")
        .delete()
        .in("id", idsToDelete);
      
      if (error) throw new Error(`Falha ao remover duplicidades: ${error.message}`);
    }

    return { deleted: idsToDelete.length };
  });