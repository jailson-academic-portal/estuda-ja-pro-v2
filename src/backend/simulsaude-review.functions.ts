import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { callAIJson } from "./ai.server";
import { assertTeacherOrAdmin } from "./discipline-access.server";
import {
  flattenDiaryAssessmentOptions,
  isLaunchableDiaryAssessmentId,
  type DiaryAssessmentSource,
} from "@/lib/diary-assessments";

/** Desconto padrão por dia de atraso quando o professor não configura um valor próprio. */
const DEFAULT_LATE_PENALTY_PER_DAY = 0.5;

export const reviewClinicalSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({
      submissionId: z.string().uuid(),
      reset: z.boolean().optional(),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    // 1. Fetch submission and case data
    const { data: sub, error: subErr } = await supabaseAdmin
      .from("student_submissions")
      .select("*, clinical_cases(*)")
      .eq("id", data.submissionId)
      .single();

    if (subErr || !sub) throw new Error("Submissão não encontrada");

    const caseData = sub.clinical_cases as any;
    await assertTeacherOrAdmin(caseData.discipline_id, context.userId);

    // 2. Fetch other submissions for similarity check (Plagiarism)
    const { data: others } = await supabaseAdmin
      .from("student_submissions")
      .select("id, answers, profiles(name)")
      .eq("case_id", sub.case_id)
      .neq("id", sub.id);

    const subAnswers = sub.answers as any;
    const answersText = subAnswers?.text || "";

    // 3. Simple local similarity check for high confidence matches
    let similarityAlert = null;
    if (others) {
      for (const other of others) {
        const otherAnswers = (other as any).answers as any;
        const otherText = otherAnswers?.text || "";
        if (otherText && otherText.length > 20) {
          if (otherText.trim() === answersText.trim()) {
            similarityAlert = `⚠️ Alta similaridade detectada com a submissão do aluno ${(other as any).profiles?.name || 'outro aluno'}`;
            break;
          }
        }
      }
    }

    // 4. Penalidade por atraso: desconto de (dias de atraso × 0,5) sobre a nota,
    //    respeitando a nota mínima zero. Se o professor configurar outro valor/tipo
    //    no caso clínico (late_penalty_per_day / late_penalty_type), o valor configurado prevalece.
    const conduct = subAnswers?.conduct || {};
    const baseScore = conduct.score || 0;

    let latePenalty = 0;
    let daysLate = 0;
    let penaltyPerDay = 0;
    let penaltyType: "fixed" | "percentage" = "fixed";
    let dueAt: Date | null = null;
    let submittedAt: Date | null = null;

    if (caseData.due_date && sub.submitted_at) {
      const dueDatePart = String(caseData.due_date).split("T")[0];
      const dueTimePart = String(caseData.due_time || "23:59:59").slice(0, 8) || "23:59:59";
      dueAt = new Date(`${dueDatePart}T${dueTimePart}`);
      submittedAt = new Date(sub.submitted_at);

      if (!Number.isNaN(dueAt.getTime()) && !Number.isNaN(submittedAt.getTime())) {
        const diffMs = submittedAt.getTime() - dueAt.getTime();
        if (diffMs > 0) {
          const configured = caseData.late_penalty_per_day;
          // Penalidade explicitamente zerada pelo professor = nenhum desconto.
          if (configured == null || Number(configured) > 0) {
            daysLate = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
            penaltyPerDay = Number(configured) > 0 ? Number(configured) : DEFAULT_LATE_PENALTY_PER_DAY;
            penaltyType = caseData.late_penalty_type === "percentage" ? "percentage" : "fixed";
            const rawPenalty =
              penaltyType === "fixed"
                ? penaltyPerDay * daysLate
                : baseScore * (penaltyPerDay / 100) * daysLate;
            latePenalty = Number(Math.max(0, rawPenalty).toFixed(2));
          }
        }

      }
    }

    // 5 rubricas clínicas fixas para avaliação de simulações de saúde
const CLINICAL_RUBRIC_5 = [
  { id: "c1", name: "Análise de Dados e Identificação", max_score: 2.0 },
  { id: "c2", name: "Raciocínio Clínico e Diagnóstico", max_score: 2.5 },
  { id: "c3", name: "Conduta Terapêutica e Manejo", max_score: 3.0 },
  { id: "c4", name: "Justificativa e Base Científica", max_score: 1.5 },
  { id: "c5", name: "Segurança do Paciente e Visão Holística", max_score: 1.0 },
];

// 5. Correção por IA com as 5 rubricas clínicas (não usa rubricas dinâmicas do caso).
    const rubric = CLINICAL_RUBRIC_5;

    const lateContext =
      daysLate > 0
        ? `\nA entrega ocorreu com ${daysLate} dia(s) de atraso (desconto de ${latePenalty.toFixed(2)} ponto(s), aplicado pelo sistema — NÃO desconte novamente). Mencione o atraso educadamente no feedback.`
        : "";

    const decisionOptions = JSON.stringify(caseData.decision_tree?.options ?? caseData.decision_tree ?? {}).slice(0, 6000);
    const patientData = JSON.stringify(caseData.patient_data ?? caseData.pep_data ?? {}).slice(0, 8000);

    const ai = await callAIJson<{
      scores: Array<{ id: string; score: number; comment: string }>;
      feedback: string;
    }>({
      system: [
        "Você é um(a) preceptor(a) clínico(a) universitário(a) rigoroso(a) e imparcial corrigindo a resolução de um caso clínico simulado.",
        "Avalie PASSO A PASSO: (1) leia o caso e os dados do paciente; (2) analise se a conduta escolhida é adequada; (3) analise a justificativa do aluno contra os dados do prontuário; (4) pontue cada critério da rubrica de forma independente.",
        "Avalie SOMENTE o texto real do aluno. Nunca dê nota máxima por padrão: notas altas exigem evidência concreta citada no comentário.",
        "Justificativas vazias, genéricas, muito curtas (ex.: 'resposta teste') ou tecnicamente incorretas devem receber notas baixas em todos os critérios de conteúdo.",
        "Não avalie identificação, cabeçalho ou ABNT — a resposta foi feita na plataforma.",
        "Para CADA critério retorne id (exato), score (0 a max_score, até 2 casas) e comment (pt-BR, 2-4 frases com evidências).",
        "Retorne também 'feedback': relatório pedagógico em Markdown com as seções ## Análise da Conduta, ## Avaliação da Justificativa, ## Pontos Fortes, ## Oportunidades de Melhoria.",
        "Responda APENAS em JSON válido: {\"scores\": [...], \"feedback\": \"...\"}.",
      ].join(" "),
      user:
        `CASO: ${caseData.title}\n` +
        `CONTEXTO: ${String(caseData.description ?? "").slice(0, 8000)}\n` +
        `DADOS DO PACIENTE (JSON): ${patientData}\n` +
        `ÁRVORE DE DECISÃO / OPÇÕES (JSON): ${decisionOptions}\n` +
        `RUBRICA (respeite ids e max_score): ${JSON.stringify(rubric)}${lateContext}\n\n` +
        `CONDUTA ESCOLHIDA PELO ALUNO: "${conduct.label || "Não selecionada"}" (pontuação de referência da conduta no caso: ${baseScore}/10)\n` +
        `JUSTIFICATIVA DO ALUNO:\n${String(answersText).slice(0, 30000) || "(vazia)"}`,
      temperature: 0.2,
    });

    const byId = new Map(rubric.map((c) => [c.id, c]));
    const rubricScores = rubric.map((crit) => {
      const found = (ai.scores ?? []).find((s) => String(s?.id) === crit.id);
      const raw = Number(found?.score);
      const score = Number.isFinite(raw) ? Math.max(0, Math.min(crit.max_score, raw)) : 0;
      return {
        id: crit.id,
        name: crit.name,
        max_score: crit.max_score,
        score: Number(score.toFixed(2)),
        comment: String(found?.comment ?? "").trim(),
      };
    });
    void byId;
    if (!ai.scores?.length) throw new Error("A IA não retornou a avaliação da rubrica. Tente novamente.");

    const rubricTotal = rubricScores.reduce((acc, r) => acc + r.score, 0);
    const finalScore = Number(Math.max(0, Math.min(10, rubricTotal - latePenalty)).toFixed(2));
    const aiFeedback = String(ai.feedback ?? "").replace(/\\n/g, "\n").trim();

    const penaltyBlock =
      daysLate > 0
        ? [
            "> ⚠️ **ALERTA DE ATRASO NA ENTREGA**",
            `> Prazo: ${dueAt ? dueAt.toLocaleString("pt-BR") : "—"} · Entregue em: ${submittedAt ? submittedAt.toLocaleString("pt-BR") : "—"}`,
            `> Dias de atraso: ${daysLate} · Penalidade: −${latePenalty.toFixed(2)} (${penaltyPerDay.toFixed(2)} ${
              penaltyType === "fixed" ? "ponto(s) por dia" : "% da nota por dia"
            })`,
          ].join("\n")
        : "";

    const rubricTable = [
      "## Rubrica",
      "| Critério | Nota | Comentário |",
      "| --- | --- | --- |",
      ...rubricScores.map(
        (r) => `| ${r.name} | ${r.score.toFixed(2)} / ${r.max_score.toFixed(2)} | ${r.comment.replace(/\|/g, "/").replace(/\n/g, " ")} |`,
      ),
    ].join("\n");

    const reportParts: string[] = [];
    if (penaltyBlock) reportParts.push(penaltyBlock);
    reportParts.push(
      aiFeedback,
      rubricTable,
      `**Composição da nota:** rubrica ${rubricTotal.toFixed(2)}${latePenalty > 0 ? ` − atraso ${latePenalty.toFixed(2)}` : ""} = **${finalScore.toFixed(2)}**`,
    );
    const fullReport = reportParts.join("\n\n");

    const updateData: any = { 
      feedback: fullReport, 
      score: finalScore 
    };
    
    if (similarityAlert) {
      updateData.teacher_comment = similarityAlert;
    }

    // Apenas salvamos o rascunho da correção IA, não mudamos para 'released' ainda.
    // O professor fará a liberação manual no modal de revisão.
    // Rascunho pendente de revisão docente: nunca finaliza automaticamente.
    // Envios já publicados não são tocados (o professor confirma no passo 5).
    const alreadyPublished = ["released", "teacher_reviewed", "corrected"].includes(String(sub.status));
    if (!alreadyPublished || data.reset) {
      updateData.status = "ai_corrected";
      await supabaseAdmin
        .from("student_submissions")
        .update(updateData)
        .eq("id", sub.id);
    }

    return { 
      feedback: fullReport, 
      similarityAlert, 
      score: finalScore,
      daysLate,
      latePenalty,
      rubricScores,
    };
  });

export const publishClinicalSubmissionGrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({
      submissionId: z.string().uuid(),
      disciplineId: z.string().uuid(),
      diaryAssessmentId: z.string().min(1),
      score: z.coerce.number().min(0).max(100),
      feedback: z.string().max(60000),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertTeacherOrAdmin(data.disciplineId, context.userId);
    // Usa a sessão do professor (RLS) — o cliente administrativo pode estar sem chave de serviço
    // e gravar silenciosamente nada.
    const db = context.supabase;

    const { data: submission, error: submissionError } = await db
      .from("student_submissions")
      .select("id, student_id, case_id, clinical_cases!inner(id, title, discipline_id)")
      .eq("id", data.submissionId)
      .eq("clinical_cases.discipline_id", data.disciplineId)
      .maybeSingle();

    if (submissionError || !submission) {
      throw new Error("Submissão não encontrada nesta disciplina");
    }

    const clinicalCase = submission.clinical_cases as unknown as {
      id: string;
      title: string;
      discipline_id: string;
    };

    // Roteamento SimulSaúde: valida o campo do diário na estrutura de notas da disciplina
    // (mesma regra usada por Estudo de Caso) e normaliza a nota para a escala 0–10.
    const { data: gs } = await db
      .from("grade_structures")
      .select("assessments")
      .eq("discipline_id", data.disciplineId)
      .maybeSingle();
    const assessments = (gs?.assessments as unknown as DiaryAssessmentSource[]) ?? [];
    const options = flattenDiaryAssessmentOptions(assessments);
    const targetDiaryAssessmentId = isLaunchableDiaryAssessmentId(assessments, data.diaryAssessmentId)
      ? data.diaryAssessmentId
      : options.find((o) => o.id.endsWith(`#${data.diaryAssessmentId}`) || o.id.split("#")[0] === data.diaryAssessmentId)?.id ?? "";
    if (!targetDiaryAssessmentId) {
      throw new Error("Campo do diário inválido. Configure a estrutura de notas primeiro.");
    }
    const rawScore = Number.isFinite(data.score) ? data.score : 0;
    const finalScore = Number(Math.max(0, Math.min(10, rawScore > 10 ? rawScore / 10 : rawScore)).toFixed(2));

    const { data: gradeRows, error: gradeError } = await db.from("grade_entries").upsert(
      {
        discipline_id: data.disciplineId,
        student_id: submission.student_id,
        assessment_id: targetDiaryAssessmentId,
        score: finalScore,
        metadata: {
          activity_id: clinicalCase.id,
          activity_type: "simulsaude",
          activity_title: clinicalCase.title || "Simulação Clínica",
          released_at: new Date().toISOString(),
        },
      },
      { onConflict: "discipline_id,student_id,assessment_id" },
    ).select("id");

    if (gradeError) throw new Error(gradeError.message);
    if (!gradeRows || gradeRows.length === 0) throw new Error("A nota não foi gravada no diário (permissão negada).");

    const { data: updated, error: updateError } = await db
      .from("student_submissions")
      .update({
        status: "released",
        score: finalScore,
        feedback: data.feedback,
        teacher_comment: data.feedback,
        graded_at: new Date().toISOString(),
        diary_assessment_id: targetDiaryAssessmentId,
      })
      .eq("id", submission.id)
      .select("id");

    if (updateError) throw new Error(updateError.message);
    if (!updated || updated.length === 0) throw new Error("Não foi possível atualizar a submissão (permissão negada).");

    return { ok: true, releasedScore: finalScore, diaryAssessmentId: targetDiaryAssessmentId };
  });


/**
 * Cancela o envio de um aluno: remove a submissão e a nota lançada no diário
 * (quando já publicada), permitindo que o aluno reenvie o caso clínico.
 */
export const cancelClinicalSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({
      submissionId: z.string().uuid(),
      disciplineId: z.string().uuid(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertTeacherOrAdmin(data.disciplineId, context.userId);

    const { data: submission, error: submissionError } = await supabaseAdmin
      .from("student_submissions")
      .select("id, student_id, case_id, diary_assessment_id, clinical_cases!inner(id, discipline_id)")
      .eq("id", data.submissionId)
      .eq("clinical_cases.discipline_id", data.disciplineId)
      .maybeSingle();

    if (submissionError || !submission) {
      throw new Error("Submissão não encontrada nesta disciplina");
    }

    // Remove a nota do diário vinculada a este envio, se já foi publicada.
    if (submission.diary_assessment_id) {
      const { error: gradeError } = await supabaseAdmin
        .from("grade_entries")
        .delete()
        .eq("discipline_id", data.disciplineId)
        .eq("student_id", submission.student_id)
        .eq("assessment_id", submission.diary_assessment_id);

      if (gradeError) throw new Error(gradeError.message);
    }

    const { error: deleteError } = await supabaseAdmin
      .from("student_submissions")
      .delete()
      .eq("id", submission.id);

    if (deleteError) throw new Error(deleteError.message);

    return { ok: true };
  });
