import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertTeacherOrAdmin } from "./discipline-access.server";
import { callAIJson, callAIVisionText } from "./ai.server";

/* ============================================================================
 * CORRETOR DE AVALIAÇÕES — leitura de QR + correção objetiva
 * ========================================================================== */

function normalizeFB(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function roundTwo(n: number) { return Math.round(n * 100) / 100; }

async function recomputeAndSaveTotals(submissionId: string) {
  const { data: sub } = await supabaseAdmin
    .from("assessment_submissions")
    .select("id, per_question_scores, assignment_id, status")
    .eq("id", submissionId)
    .maybeSingle();
  if (!sub) return null;
  const scores = (sub.per_question_scores ?? {}) as Record<string, { obtained: number; max: number; correct: boolean | null }>;
  let total = 0;
  let pending = false;
  for (const k of Object.keys(scores)) {
    const it = scores[k];
    if (it.correct === null) pending = true;
    total += Number(it.obtained || 0);
  }
  total = roundTwo(total);
  // Nunca rebaixar uma prova já lançada no diário ("posted").
  const isPosted = (sub as { status?: string }).status === "posted";
  const status: "graded_objective" | "awaiting_review" | "posted" = isPosted
    ? "posted"
    : pending
      ? "awaiting_review"
      : "graded_objective";
  await supabaseAdmin
    .from("assessment_submissions")
    .update({ total_score: total, status })
    .eq("id", submissionId);
  return { total, pending, status };
}

// ---------- LOOKUP BY QR TOKEN ---------------------------------------------
export const lookupAssignmentByToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ token: z.string().min(4).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const token = data.token.trim();
    const { data: asg, error } = await supabaseAdmin
      .from("assessment_assignments")
      .select("id, assessment_id, version_id, student_id, copy_index, qr_token, bubble_layout, question_order, option_orders")
      .eq("qr_token", token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!asg) throw new Error("QR Code não reconhecido para esta plataforma.");

    const { data: a } = await supabaseAdmin
      .from("assessments")
      .select("id, discipline_id, title, max_score, module_name")
      .eq("id", asg.assessment_id)
      .maybeSingle();
    if (!a) throw new Error("Avaliação não encontrada.");
    await assertTeacherOrAdmin(a.discipline_id, context.userId);

    const [{ data: version }, { data: questions }, { data: student }, { data: submission }] = await Promise.all([
      supabaseAdmin
        .from("assessment_versions")
        .select("id, version_label, question_order, option_orders")
        .eq("id", asg.version_id)
        .maybeSingle(),
      supabaseAdmin
        .from("assessment_questions")
        .select("id, position, qtype, prompt, options, weight")
        .eq("assessment_id", a.id)
        .order("position", { ascending: true }),
      supabaseAdmin.from("profiles").select("id, name, email").eq("id", asg.student_id).maybeSingle(),
      supabaseAdmin
        .from("assessment_submissions")
        .select("id, objective_answers, per_question_scores, total_score, status, teacher_comment")
        .eq("assignment_id", asg.id)
        .maybeSingle(),
    ]);
    if (!version) throw new Error("Versão não encontrada.");

    // O arranjo do aluno (assignment) tem prioridade sobre o padrão da versão,
    // para que a correção/exibição mapeie as marcações às alternativas corretas
    // de cada folha individual.
    const asgOrder = asg.question_order as string[] | null;
    const asgOpts = asg.option_orders as Record<string, number[]> | null;
    const mergedVersion = {
      ...version,
      question_order: asgOrder && asgOrder.length ? asgOrder : version.question_order,
      option_orders: (asgOpts && Object.keys(asgOpts).length ? asgOpts : version.option_orders) as typeof version.option_orders,
    } as typeof version;

    return {
      assignment: asg,
      assessment: a,
      version: mergedVersion,
      questions: questions ?? [],
      student: student ?? null,
      submission: submission ?? null,
    };
  });

// ---------- LIST GRADER QUEUE (per assessment) ------------------------------
export const listGraderQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ assessment_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: a } = await supabaseAdmin
      .from("assessments")
      .select("id, discipline_id, title")
      .eq("id", data.assessment_id)
      .maybeSingle();
    if (!a) throw new Error("Avaliação não encontrada.");
    await assertTeacherOrAdmin(a.discipline_id, context.userId);

    const { data: assignments } = await supabaseAdmin
      .from("assessment_assignments")
      .select("id, student_id, version_id, copy_index")
      .eq("assessment_id", a.id);
    const ids = (assignments ?? []).map((x) => x.id);
    const stIds = (assignments ?? []).map((x) => x.student_id);

    const [{ data: subs }, { data: profs }, { data: versions }] = await Promise.all([
      ids.length > 0
        ? supabaseAdmin
            .from("assessment_submissions")
            .select("assignment_id, status, total_score")
            .in("assignment_id", ids)
        : Promise.resolve({ data: [] as Array<{ assignment_id: string; status: string; total_score: number | null }> }),
      stIds.length > 0
        ? supabaseAdmin.from("profiles").select("id, name, email").in("id", stIds)
        : Promise.resolve({ data: [] as Array<{ id: string; name: string | null; email: string | null }> }),
      supabaseAdmin
        .from("assessment_versions")
        .select("id, version_label")
        .eq("assessment_id", a.id),
    ]);
    const subMap = new Map((subs ?? []).map((s) => [s.assignment_id, s]));
    const profMap = new Map((profs ?? []).map((p) => [p.id, p]));
    const verMap = new Map((versions ?? []).map((v) => [v.id, v.version_label]));

    const rows = (assignments ?? []).map((asg) => {
      const sub = subMap.get(asg.id);
      const p = profMap.get(asg.student_id);
      return {
        assignment_id: asg.id,
        student_id: asg.student_id,
        student_name: p?.name || p?.email || "Aluno(a)",
        version_label: verMap.get(asg.version_id) || "?",
        copy_index: asg.copy_index,
        status: sub?.status ?? "pending",
        total_score: sub?.total_score ?? null,
      };
    });
    rows.sort((a, b) => a.student_name.localeCompare(b.student_name));
    return { items: rows };
  });

// ---------- GRADE OBJECTIVE -------------------------------------------------
const GradeInput = z.object({
  assignment_id: z.string().uuid(),
  objective_answers: z.record(z.string(), z.union([z.string(), z.boolean(), z.array(z.string())])),
  teacher_comment: z.string().max(30000).optional().nullable(),
});

export const gradeObjectiveSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => GradeInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: asg } = await supabaseAdmin
      .from("assessment_assignments")
      .select("id, assessment_id, version_id, student_id, answer_key, question_order")
      .eq("id", data.assignment_id)
      .maybeSingle();
    if (!asg) throw new Error("Folha não encontrada.");
    const { data: a } = await supabaseAdmin
      .from("assessments")
      .select("id, discipline_id, max_score")
      .eq("id", asg.assessment_id)
      .maybeSingle();
    if (!a) throw new Error("Avaliação não encontrada.");
    await assertTeacherOrAdmin(a.discipline_id, context.userId);

    const [{ data: version }, { data: questions }] = await Promise.all([
      supabaseAdmin
        .from("assessment_versions")
        .select("answer_key, question_order")
        .eq("id", asg.version_id)
        .maybeSingle(),
      supabaseAdmin
        .from("assessment_questions")
        .select("id, qtype, weight")
        .eq("assessment_id", a.id),
    ]);
    if (!version) throw new Error("Versão não encontrada.");

    // Prioriza o gabarito ÚNICO do aluno (assignment) sobre o padrão da versão.
    const asgKey = asg.answer_key as Record<string, unknown> | null;
    const asgOrder = asg.question_order as string[] | null;
    const key = (
      (asgKey && Object.keys(asgKey).length ? asgKey : version.answer_key) ?? {}
    ) as Record<string, unknown>;
    const orderArr =
      Array.isArray(asgOrder) && asgOrder.length
        ? asgOrder
        : Array.isArray((version as { question_order?: string[] }).question_order)
          ? (version as { question_order: string[] }).question_order
          : [];
    // Pontue somente as questões pertencentes a esta folha (via question_order /
    // answer_key específicos do aluno).
    const versionIds = new Set<string>(orderArr.length ? orderArr : Object.keys(key));
    const perQuestion: Record<string, { obtained: number; max: number; correct: boolean | null }> = {};
    let total = 0;
    let pendingEssay = false;

    for (const q of questions ?? []) {
      if (versionIds.size > 0 && !versionIds.has(q.id)) continue;
      const max = Number(q.weight) || 0;
      const userAns = data.objective_answers[q.id];
      if (q.qtype === "essay") {
        perQuestion[q.id] = { obtained: 0, max, correct: null };
        pendingEssay = true;
        continue;
      }
      let correct = false;
      if (q.qtype === "multiple_choice") {
        const expected = String(key[q.id] ?? "").trim().toUpperCase();
        const given = String(userAns ?? "").trim().toUpperCase();
        correct = !!expected && expected === given;
      } else if (q.qtype === "true_false") {
        const expectedRaw = key[q.id];
        const expected =
          typeof expectedRaw === "boolean"
            ? expectedRaw
            : String(expectedRaw ?? "").toLowerCase().startsWith("v") || String(expectedRaw) === "true";
        const givenRaw = userAns;
        const given =
          typeof givenRaw === "boolean"
            ? givenRaw
            : String(givenRaw ?? "").toLowerCase().startsWith("v") || String(givenRaw) === "true";
        correct = expected === given;
      } else if (q.qtype === "fill_blank") {
        const expectedArr = Array.isArray(key[q.id])
          ? (key[q.id] as unknown[]).map((x) => normalizeFB(x))
          : [normalizeFB(key[q.id])];
        const givenArr = Array.isArray(userAns)
          ? userAns.map((x) => normalizeFB(x))
          : [normalizeFB(userAns)];
        // require all blanks correct in order; tolerate extra spaces
        correct =
          expectedArr.length === givenArr.length &&
          expectedArr.every((e, i) => e && e === givenArr[i]);
      }
      const obtained = correct ? max : 0;
      perQuestion[q.id] = { obtained, max, correct };
      total += obtained;
    }

    total = Math.round(total * 100) / 100;
    const status: "graded_objective" | "awaiting_review" = pendingEssay ? "awaiting_review" : "graded_objective";

    // upsert by assignment_id (UNIQUE)
    const { data: existing } = await supabaseAdmin
      .from("assessment_submissions")
      .select("id, status")
      .eq("assignment_id", data.assignment_id)
      .maybeSingle();
    if (existing && (existing as { status?: string }).status === "posted") {
      throw new Error("Esta prova já foi enviada para o diário e não pode ser corrigida novamente.");
    }

    const payload = {
      assignment_id: data.assignment_id,
      objective_answers: data.objective_answers as never,
      per_question_scores: perQuestion as never,
      total_score: total,
      teacher_comment: data.teacher_comment ?? null,
      status,
      graded_at: new Date().toISOString(),
    };

    if (existing) {
      const { error } = await supabaseAdmin
        .from("assessment_submissions")
        .update(payload)
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("assessment_submissions").insert(payload);
      if (error) throw new Error(error.message);
    }

    return {
      total_score: total,
      max_score: Number(a.max_score),
      per_question: perQuestion,
      status,
      pending_essay: pendingEssay,
    };
  });
// ---------- AI ESSAY GRADING ------------------------------------------------
const EssayInput = z.object({
  assignment_id: z.string().uuid(),
  question_id: z.string().uuid(),
  student_answer: z.string().min(1).max(30000),
});

export const gradeEssayWithAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => EssayInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: asg } = await supabaseAdmin
      .from("assessment_assignments")
      .select("id, assessment_id")
      .eq("id", data.assignment_id)
      .maybeSingle();
    if (!asg) throw new Error("Folha não encontrada.");
    const { data: a } = await supabaseAdmin
      .from("assessments")
      .select("id, discipline_id, max_score")
      .eq("id", asg.assessment_id)
      .maybeSingle();
    if (!a) throw new Error("Avaliação não encontrada.");
    await assertTeacherOrAdmin(a.discipline_id, context.userId);

    const { data: q } = await supabaseAdmin
      .from("assessment_questions")
      .select("id, prompt, weight, explanation, qtype, rubric")
      .eq("id", data.question_id)
      .maybeSingle();
    if (!q || q.qtype !== "essay") throw new Error("Questão dissertativa inválida.");

    const maxPoints = Number(q.weight) || 0;
    const system = `Você é um corretor pedagógico rigoroso e justo em pt-BR. Avalie a resposta DISSERTATIVA do aluno comparando ao gabarito comentado e à pergunta. Atribua nota de 0 a ${maxPoints} (decimal com 2 casas), justifique brevemente e dê feedback construtivo.

    CRITÉRIOS DE ESTRUTURA (IMPORTANTE):
    - Esta é uma atividade de ESTUDO DE CASO preenchida via FORMULÁRIO WEB.
    - É PROIBIDO realizar qualquer validação de identidade, verificar cabeçalhos ou tentar confirmar o nome do autor/aluno.
    - O critério "Estrutura" deve avaliar 100% o conteúdo técnico: coesão, clareza e organização lógica do texto digitado.


    FALLBACK DE SEGURANÇA: Se a resposta do aluno estiver ilegível, totalmente fora de contexto ou incompleta ao ponto de impossibilitar a avaliação, responda com uma devolutiva orientação pedagógica solicitando a reentrega, sem inventar nota ou alucinar critérios (mantenha score como 0 nesse caso de fallback).

    Retorne JSON ESTRITO:
{"score": <0..${maxPoints}>, "feedback": "Critérios técnicos atendidos...", "highlights": {"strengths": ["..."], "improvements": ["..."]}}`;
    const user = `[CONTEXTO DA DISCIPLINA]
ENUNCIADO:
${q.prompt}

[ENUNCIADO E CRITÉRIOS DO PROFESSOR]
GABARITO COMENTADO:
${q.explanation ?? "(não fornecido — avalie por coerência conceitual)"}

[RESPOSTA SUBMETIDA PELO ESTUDANTE]
RESPOSTA DO ALUNO:
${data.student_answer}`;
    const ai = await callAIJson<{ score: number; feedback: string; highlights?: { strengths?: string[]; improvements?: string[] } }>({
      system, user, model: "google/gemini-2.5-pro",
    });
    const score = Math.max(0, Math.min(maxPoints, Number(ai.score) || 0));

    // Upsert submission
    const { data: existing } = await supabaseAdmin
      .from("assessment_submissions")
      .select("id, essay_answers, per_question_scores, ai_feedback, status")
      .eq("assignment_id", data.assignment_id)
      .maybeSingle();
    if (existing && (existing as { status?: string }).status === "posted") {
      throw new Error("Esta prova já foi enviada para o diário e não pode ser corrigida novamente.");
    }

    const essayAnswers = { ...(existing?.essay_answers as Record<string, string> | null ?? {}), [data.question_id]: data.student_answer };
    const perQ = { ...(existing?.per_question_scores as Record<string, { obtained: number; max: number; correct: boolean | null }> | null ?? {}) };
    perQ[data.question_id] = { obtained: roundTwo(score), max: maxPoints, correct: score >= maxPoints * 0.6 };
    const aiFeedback = { ...(existing?.ai_feedback as Record<string, unknown> | null ?? {}), [data.question_id]: ai };

    if (existing) {
      const { error } = await supabaseAdmin.from("assessment_submissions").update({
        essay_answers: essayAnswers as never,
        per_question_scores: perQ as never,
        ai_feedback: aiFeedback as never,
      }).eq("id", existing.id);
      if (error) throw new Error(error.message);
      await recomputeAndSaveTotals(existing.id);
    } else {
      const { error } = await supabaseAdmin.from("assessment_submissions").insert({
        assignment_id: data.assignment_id,
        essay_answers: essayAnswers as never,
        per_question_scores: perQ as never,
        ai_feedback: aiFeedback as never,
        total_score: roundTwo(score),
        status: "awaiting_review",
      });
      if (error) throw new Error(error.message);
    }

    return { score: roundTwo(score), max: maxPoints, feedback: ai.feedback, highlights: ai.highlights ?? null };
  });

// ---------- OCR ESSAY IMAGE -------------------------------------------------
const OcrEssayInput = z.object({
  assignment_id: z.string().uuid(),
  question_id: z.string().uuid(),
  image_data_url: z.string().min(50).max(10_000_000),
});

export const ocrEssayImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => OcrEssayInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: asg } = await supabaseAdmin
      .from("assessment_assignments")
      .select("id, assessment_id")
      .eq("id", data.assignment_id)
      .maybeSingle();
    if (!asg) throw new Error("Folha não encontrada.");
    const { data: a } = await supabaseAdmin
      .from("assessments")
      .select("id, discipline_id")
      .eq("id", asg.assessment_id)
      .maybeSingle();
    if (!a) throw new Error("Avaliação não encontrada.");
    await assertTeacherOrAdmin(a.discipline_id, context.userId);

    const system =
      "Você é um sistema de OCR especializado em transcrever respostas manuscritas de alunos em pt-BR. Devolva APENAS o texto transcrito, preservando quebras de linha, sem comentários, marcações ou explicações. Se algo for ilegível, indique entre colchetes [ilegível].";
    const user =
      "Transcreva fielmente a resposta dissertativa escrita à mão nesta imagem. Não corrija ortografia nem reescreva. Retorne somente o texto.";
    const text = await callAIVisionText({
      system,
      user,
      imageDataUrl: data.image_data_url,
      model: "google/gemini-2.5-pro",
    });
    return { text: (text ?? "").trim() };
  });

// ---------- SAVE EDITED ESSAY FEEDBACK --------------------------------------
const SaveFeedbackInput = z.object({
  assignment_id: z.string().uuid(),
  question_id: z.string().uuid(),
  feedback: z.string().max(30000),
});

export const saveEssayFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => SaveFeedbackInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: asg } = await supabaseAdmin
      .from("assessment_assignments")
      .select("id, assessment_id")
      .eq("id", data.assignment_id)
      .maybeSingle();
    if (!asg) throw new Error("Folha não encontrada.");
    const { data: a } = await supabaseAdmin
      .from("assessments")
      .select("id, discipline_id")
      .eq("id", asg.assessment_id)
      .maybeSingle();
    if (!a) throw new Error("Avaliação não encontrada.");
    await assertTeacherOrAdmin(a.discipline_id, context.userId);

    const { data: existing } = await supabaseAdmin
      .from("assessment_submissions")
      .select("id, ai_feedback, status")
      .eq("assignment_id", data.assignment_id)
      .maybeSingle();
    if (!existing) throw new Error("Submissão não encontrada. Corrija com a IA antes de editar o feedback.");
    if ((existing as { status?: string }).status === "posted") {
      throw new Error("Esta prova já foi enviada para o diário e não pode ser alterada.");
    }

    const current = (existing.ai_feedback as Record<string, { feedback?: string; teacher_edited?: boolean } & Record<string, unknown>> | null) ?? {};
    const prev = current[data.question_id] ?? {};
    const next = { ...current, [data.question_id]: { ...prev, feedback: data.feedback, teacher_edited: true } };

    const { error } = await supabaseAdmin
      .from("assessment_submissions")
      .update({ ai_feedback: next as never })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);

    return { ok: true };
  });

// ---------- POST TO DIARY ---------------------------------------------------
export const postAssessmentSubmissionToDiary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({
    assignment_id: z.string().uuid(),
    override_score: z.number().min(0).max(100).optional().nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: asg } = await supabaseAdmin
      .from("assessment_assignments")
      .select("id, assessment_id, student_id")
      .eq("id", data.assignment_id)
      .maybeSingle();
    if (!asg) throw new Error("Folha não encontrada.");
    const { data: a } = await supabaseAdmin
      .from("assessments")
      .select("id, discipline_id, diary_assessment_id, max_score, title")
      .eq("id", asg.assessment_id)
      .maybeSingle();
    if (!a) throw new Error("Avaliação não encontrada.");
    await assertTeacherOrAdmin(a.discipline_id, context.userId);
    if (!a.diary_assessment_id) throw new Error("Esta avaliação não está vinculada a uma coluna do diário.");

    const { data: sub } = await supabaseAdmin
      .from("assessment_submissions")
      .select("id, total_score, status, per_question_scores")
      .eq("assignment_id", data.assignment_id)
      .maybeSingle();
    if (!sub) throw new Error("Folha ainda não corrigida.");
    const perQ = (sub.per_question_scores ?? {}) as Record<string, { correct: boolean | null }>;
    const pending = Object.values(perQ).some((x) => x.correct === null);
    if (pending && data.override_score == null) {
      throw new Error("Existem dissertativas pendentes. Corrija-as antes de lançar no diário.");
    }
    const score = data.override_score != null ? Number(data.override_score) : Number(sub.total_score ?? 0);

    const { data: entry, error: gErr } = await supabaseAdmin.from("grade_entries").upsert({
      discipline_id: a.discipline_id,
      student_id: asg.student_id,
      assessment_id: a.diary_assessment_id,
      score: roundTwo(score),
    }, { onConflict: "discipline_id,student_id,assessment_id" }).select("id").single();
    if (gErr) throw new Error(gErr.message);

    const { error: uErr } = await supabaseAdmin.from("assessment_submissions").update({
      status: "posted",
      posted_at: new Date().toISOString(),
      posted_grade_entry_id: entry?.id ?? null,
      total_score: roundTwo(score),
    }).eq("id", sub.id);
    if (uErr) throw new Error(uErr.message);

    return { ok: true, score: roundTwo(score), diary_column: a.diary_assessment_id };
  });
