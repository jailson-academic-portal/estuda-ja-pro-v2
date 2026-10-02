import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notifyEnrolledStudents, notifyUsers } from "./notifications.server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { assertTeacherOrAdmin } from "./discipline-access.server";
import { sanitizeGeneratedQuestionText, dedupeOptionPrefixes } from "@/lib/text-sanitize";
import { validateQuestionContent } from "@/lib/question-quality";

const QuestionSchema = z.object({
  prompt: z.string().min(1).max(30000),
  type: z.enum(["multiple_choice", "true_false", "short_answer"]),
  options: z.array(z.string().max(500)).optional(),
  correct_answer: z.union([z.string(), z.number(), z.array(z.string())]).optional(),
  explanation: z.string().max(30000).optional(),
  points: z.number().min(0.1).max(1000).default(1),
});

function normalizeAnswer(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\*\*/g, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function stripOptionPrefix(value: string) {
  return value.replace(/^\s*[a-e]\s*[).:\-]\s*/i, "");
}

function answerCandidates(value: unknown, options: unknown) {
  const candidates = new Set<string>();
  const opts = Array.isArray(options) ? options.map((opt) => String(opt ?? "")) : [];
  const add = (item: unknown) => {
    const base = normalizeAnswer(item);
    if (base) candidates.add(base);
    const stripped = normalizeAnswer(stripOptionPrefix(String(item ?? "")));
    if (stripped) candidates.add(stripped);
  };
  if (Array.isArray(value)) value.forEach(add);
  else add(value);
  const raw = String(value ?? "").trim();
  const letter = raw.match(/^([a-e])(?:[).:\-])?$/i)?.[1]?.toLowerCase();
  const numeric = /^\d+$/.test(raw) ? Number(raw) : typeof value === "number" ? value : NaN;
  if (letter) add(opts[letter.charCodeAt(0) - 97]);
  if (Number.isFinite(numeric)) {
    add(opts[numeric]);
    add(opts[numeric - 1]);
  }
  return candidates;
}

function answersMatch(answer: unknown, correctAnswer: unknown, options: unknown) {
  if (answer == null || correctAnswer == null) return false;
  const answerSet = answerCandidates(answer, options);
  const correctSet = answerCandidates(correctAnswer, options);
  return [...answerSet].some((candidate) => correctSet.has(candidate));
}

/** Maximum number of times a student may (re)answer the same exercise. */
const MAX_EXERCISE_ATTEMPTS = 5;

async function assertTeacher(disciplineId: string, userId: string) {
  await assertTeacherOrAdmin(disciplineId, userId);
}

export const saveExercise = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    id: z.string().uuid().optional(),
    discipline_id: z.string().uuid(),
    title: z.string().trim().min(1).max(160),
    topic: z.string().trim().max(160).optional(),
    module_label: z.string().trim().max(300).optional(),
    type: z.enum(["multiple_choice", "true_false", "short_answer", "fill_blanks", "column_matching"]).default("multiple_choice"),
    due_at: z.string().optional(),
    questions: z.array(QuestionSchema).min(1).max(50),
    publish: z.boolean().default(false),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertTeacher(data.discipline_id, context.userId);
    const status = data.publish ? "published" : "draft";
    let exerciseId = data.id;
    const payload = {
      discipline_id: data.discipline_id,
      title: data.title,
      topic: data.topic ?? null,
      module_label: data.module_label ?? null,
      type: data.type,
      question_count: data.questions.length,
      due_at: data.due_at ?? null,
      status: status as "published" | "draft",
      created_by: context.userId,
    };
    if (exerciseId) {
      const { data: updated, error } = await supabaseAdmin
        .from("exercises")
        .update(payload)
        .eq("id", exerciseId)
        .eq("created_by", context.userId)
        .select("id");
      if (error) throw new Error(error.message);
      if (!updated || updated.length === 0) throw new Error("Exercício não encontrado ou sem permissão");
      await supabaseAdmin.from("exercise_questions").delete().eq("exercise_id", exerciseId);
    } else {
      const { data: ins, error } = await supabaseAdmin.from("exercises").insert(payload).select().single();
      if (error) throw new Error(error.message);
      exerciseId = ins.id;
    }
    const rows = data.questions.map((q, i) => ({
      exercise_id: exerciseId!,
      position: i,
      prompt: sanitizeGeneratedQuestionText(q.prompt),
      options: Array.isArray(q.options)
        ? q.options.map((o) => dedupeOptionPrefixes(sanitizeGeneratedQuestionText(o)))
        : q.options ?? null,
      correct_answer: q.correct_answer ?? null,
      explanation: q.explanation ? sanitizeGeneratedQuestionText(q.explanation) : null,
      points: q.points,
    }));
    if (rows.length) {
      const { error } = await supabaseAdmin.from("exercise_questions").insert(rows);
      if (error) throw new Error(error.message);
    }
    if (data.publish) {
      await notifyEnrolledStudents(
        data.discipline_id, "new_exercise", "Novo exercício publicado",
        data.title, `/disciplines/${data.discipline_id}`,
      );
    }
    // VALIDADOR DE QUALIDADE: sinaliza questões com meta-texto genérico
    // ("apresenta a definição correta de...", "incorreta segundo...") para que
    // o professor as regenere com afirmações concretas.
    const quality_warnings = rows
      .map((r, i) => {
        const verdict = validateQuestionContent({
          prompt: String(r.prompt ?? ""),
          options: Array.isArray(r.options) ? (r.options as string[]) : null,
          explanation: r.explanation,
        });
        return verdict.rejected ? { position: i + 1, message: verdict.message } : null;
      })
      .filter(Boolean);

    return { id: exerciseId, quality_warnings };
  });

export const deleteExercise = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: e } = await supabaseAdmin.from("exercises").select("discipline_id").eq("id", data.id).maybeSingle();
    if (!e) throw new Error("Exercício não encontrado");
    await assertTeacher(e.discipline_id, context.userId);
    await supabaseAdmin.from("exercises").delete().eq("id", data.id);
    return { ok: true };
  });

/** Student fetches their own submission with answer keys (only after they have submitted). */
export const getStudentExerciseSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ exercise_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: sub } = await supabaseAdmin
      .from("exercise_submissions")
      .select("score, max_score, status, answers, feedback, attempt_count, released_at")
      .eq("exercise_id", data.exercise_id)
      .eq("student_id", context.userId)
      .maybeSingle();
    if (!sub)
      return {
        submission: null,
        attempt_count: 0,
        attempts_remaining: MAX_EXERCISE_ATTEMPTS,
        max_attempts: MAX_EXERCISE_ATTEMPTS,
        answer_keys: {} as Record<string, { correct_answer: string | string[] | null; explanation: string | null }>,
      };
    const isReleased = sub?.status === "released" || !!(sub as { released_at?: string })?.released_at;
    const { data: qs } = await supabaseAdmin
      .from("exercise_questions")
      .select("id, correct_answer, explanation")
      .eq("exercise_id", data.exercise_id);
    const answer_keys: Record<string, { correct_answer: string | string[] | null; explanation: string | null }> = {};
    for (const q of qs ?? []) {
      answer_keys[q.id] = {
        correct_answer: isReleased ? (q.correct_answer ?? null) as string | string[] | null : null,
        explanation: isReleased ? q.explanation ?? null : null,
      };
    }
    const attempt_count = Number((sub as { attempt_count?: number }).attempt_count ?? 0);
    return {
      submission: sub,
      attempt_count,
      attempts_remaining: Math.max(0, MAX_EXERCISE_ATTEMPTS - attempt_count),
      max_attempts: MAX_EXERCISE_ATTEMPTS,
      answer_keys,
    };
  });

/** Student submits answers and gets auto-graded for objective questions. */
export const submitExercise = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    exercise_id: z.string().uuid(),
    answers: z.record(z.string(), z.union([z.string(), z.number(), z.array(z.string())])),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: ex } = await supabaseAdmin
      .from("exercises").select("id, discipline_id, status").eq("id", data.exercise_id).maybeSingle();
    if (!ex || ex.status !== "published") throw new Error("Exercício indisponível");

    const { data: enroll } = await supabaseAdmin
      .from("discipline_students").select("id")
      .eq("discipline_id", ex.discipline_id).eq("student_id", context.userId).maybeSingle();
    if (!enroll) throw new Error("Você não está matriculado");

    const { data: prev } = await supabaseAdmin
      .from("exercise_submissions")
      .select("attempt_count")
      .eq("exercise_id", data.exercise_id)
      .eq("student_id", context.userId)
      .maybeSingle();
    const previousAttempts = Number((prev as { attempt_count?: number } | null)?.attempt_count ?? 0);
    if (previousAttempts >= MAX_EXERCISE_ATTEMPTS) {
      throw new Error(`Você já utilizou todas as ${MAX_EXERCISE_ATTEMPTS} tentativas deste exercício.`);
    }
    const attempt_count = previousAttempts + 1;

    const { data: questions } = await supabaseAdmin
      .from("exercise_questions").select("*").eq("exercise_id", data.exercise_id);

    let score = 0;
    let max = 0;
    const feedback: Array<{ qid: string; correct: boolean | null; points_awarded: number }> = [];
    for (const q of questions ?? []) {
      max += Number(q.points);
      const ans = data.answers[q.id];
      if (q.correct_answer != null && ans != null) {
        const correct = answersMatch(ans, q.correct_answer, q.options);
        if (correct) score += Number(q.points);
        feedback.push({ qid: q.id, correct, points_awarded: correct ? Number(q.points) : 0 });
      } else {
        feedback.push({ qid: q.id, correct: null, points_awarded: 0 });
      }
    }

    const { error } = await supabaseAdmin.from("exercise_submissions").upsert({
      exercise_id: data.exercise_id,
      student_id: context.userId,
      answers: data.answers,
      score,
      max_score: max,
      status: "submitted",
      feedback,
      attempt_count,
      submitted_at: new Date().toISOString(),
      released_at: null,
      reviewed_at: null,
      reviewed_by: null,
    }, { onConflict: "exercise_id,student_id" });
    if (error) throw new Error(error.message);

    // O gabarito só é liberado quando o aluno não pode mais tentar de novo
    // (nota máxima ou tentativas esgotadas). Caso contrário, seria possível
    // enviar em branco, ler as respostas e refazer com 100%.
    const keysReleased = (max > 0 && score >= max) || attempt_count >= MAX_EXERCISE_ATTEMPTS;
    const answer_keys: Record<string, { correct_answer: string | string[] | null; explanation: string | null }> = {};
    for (const q of questions ?? []) {
      answer_keys[q.id] = {
        correct_answer: keysReleased ? ((q.correct_answer ?? null) as string | string[] | null) : null,
        explanation: keysReleased ? (q.explanation ?? null) : null,
      };
    }
    return {
      score,
      max_score: max,
      feedback,
      answer_keys,
      attempt_count,
      attempts_remaining: Math.max(0, MAX_EXERCISE_ATTEMPTS - attempt_count),
      max_attempts: MAX_EXERCISE_ATTEMPTS,
    };
  });

export const releaseExerciseFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ submission_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: sub } = await supabaseAdmin
      .from("exercise_submissions").select("*, exercises!inner(discipline_id)")
      .eq("id", data.submission_id).maybeSingle();
    if (!sub) throw new Error("Submissão não encontrada");
    const ex = sub.exercises as unknown as { discipline_id: string };
    await assertTeacher(ex.discipline_id, context.userId);
    await supabaseAdmin.from("exercise_submissions").update({
      released_at: new Date().toISOString(),
      status: "released",
      reviewed_by: context.userId,
      reviewed_at: new Date().toISOString(),
    }).eq("id", data.submission_id);
    await notifyUsers(
      [sub.student_id], "feedback_available", "Feedback disponível",
      "Seu exercício foi corrigido.", `/disciplines/${ex.discipline_id}`,
    );
    return { ok: true };
  });

/* ----------------------------- Export helpers ---------------------------- */

function bufferToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function sanitizeFilename(name: string) {
  return (name || "exercicio").replace(/[^\w\s.-]/g, "").replace(/\s+/g, "_").slice(0, 80) || "exercicio";
}

// pdf-lib's WinAnsi font can't encode every char (emoji, some unicode). Strip them.
function pdfSafe(text: string) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2022/g, "-")
    .replace(/[^\x09\x0A\x20-\x7E\u00A0-\u00FF]/g, "");
}

// Strip common Markdown formatting so the rendered PDF doesn't show literal
// "**", "*", "_" or list/heading markers. We render plain text in PDF.
function stripMarkdown(text: string) {
  return String(text ?? "")
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/(^|[\s(])_(?!_)([^_\n]+?)_(?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "• ")
    .replace(/`([^`]+)`/g, "$1");
}

async function loadExerciseForExport(id: string) {
  const { data: ex } = await supabaseAdmin
    .from("exercises").select("id, discipline_id, title, topic, status").eq("id", id).maybeSingle();
  if (!ex) throw new Error("Exercício não encontrado");
  const { data: qs } = await supabaseAdmin
    .from("exercise_questions")
    .select("id, prompt, options, correct_answer, explanation, points, position")
    .eq("exercise_id", id).order("position");
  return { exercise: ex, questions: qs ?? [] };
}

type ExportQuestion = {
  prompt: string;
  options: string[] | null;
  correct_answer: unknown;
  explanation: string | null;
  points: number;
};

async function renderExerciseToPDF(opts: {
  title: string;
  topic: string | null;
  questions: ExportQuestion[];
  includeAnswers: boolean;
  header?: { logoUrl: string | null; lines: string[] } | null;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const margin = 50;
  const pageWidth = 595;
  const pageHeight = 842;
  const maxWidth = pageWidth - margin * 2;
  const CM = 28.3465;

  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const wrap = (text: string, size: number, f = font): string[] => {
    const out: string[] = [];
    for (const paragraph of pdfSafe(stripMarkdown(text)).split("\n")) {
      if (!paragraph) { out.push(""); continue; }
      const words = paragraph.split(/\s+/);
      let cur = "";
      for (const w of words) {
        const test = cur ? cur + " " + w : w;
        if (f.widthOfTextAtSize(test, size) > maxWidth) {
          if (cur) out.push(cur);
          cur = w;
        } else cur = test;
      }
      if (cur) out.push(cur);
    }
    return out;
  };

  const newPage = () => { page = pdf.addPage([pageWidth, pageHeight]); y = pageHeight - margin; };

  const drawLine = (text: string, size: number, f = font, color = rgb(0.1, 0.1, 0.15), indent = 0) => {
    if (y < margin + size + 4) newPage();
    page.drawText(pdfSafe(text), { x: margin + indent, y: y - size, size, font: f, color });
    y -= size + 4;
  };

  // Standardized institutional header (logo on the left, metadata lines on the
  // right), identical in layout to the Apostila document header. When present,
  // it replaces the plain title/topic block so the student download carries the
  // same institutional identity.
  if (opts.header) {
    const embedImageFromUrl = async (url: string) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const buf = new Uint8Array(await res.arrayBuffer());
        const isPng = buf[0] === 0x89 && buf[1] === 0x50;
        return isPng ? await pdf.embedPng(buf) : await pdf.embedJpg(buf);
      } catch {
        return null;
      }
    };
    const img = opts.header.logoUrl ? await embedImageFromUrl(opts.header.logoUrl) : null;
    const headerTop = y;
    const logoW = 4 * CM;
    const logoH = 2 * CM;
    const logoGap = 14;
    const logoBottomY = headerTop - logoH;
    if (img) {
      page.drawImage(img, { x: margin, y: logoBottomY, width: logoW, height: logoH });
    }
    const textX = img ? margin + logoW + logoGap : margin;
    let ty = headerTop - 4;
    const headerTextMaxWidth = pageWidth - margin - textX;
    for (const hl of opts.header.lines) {
      // Each line is "Label: value" — render the label bold, value regular.
      const idx = hl.indexOf(":");
      const label = idx >= 0 ? hl.slice(0, idx + 1) : hl;
      const value = idx >= 0 ? hl.slice(idx + 1) : "";
      const labelStr = pdfSafe(label);
      const labelWidth = fontBold.widthOfTextAtSize(labelStr, 12);
      page.drawText(labelStr, { x: textX, y: ty - 12, size: 12, font: fontBold, color: rgb(0.1, 0.1, 0.15) });
      const valueStr = pdfSafe(value).trimStart();
      if (valueStr) {
        // Word-wrap the value: first line sits next to the bold label; continuation
        // lines wrap to the full text column so long titles (e.g. "Exercício: …")
        // no longer get clipped at the right margin.
        const words = valueStr.split(/\s+/);
        let firstLine = "";
        let firstAvail = headerTextMaxWidth - labelWidth;
        let i = 0;
        for (; i < words.length; i++) {
          const test = firstLine ? firstLine + " " + words[i] : " " + words[i];
          if (font.widthOfTextAtSize(test, 12) > firstAvail) break;
          firstLine = test;
        }
        if (firstLine) {
          page.drawText(firstLine, { x: textX + labelWidth, y: ty - 12, size: 12, font, color: rgb(0.1, 0.1, 0.15) });
        }
        // Remaining words wrap onto full-width continuation lines.
        let cur = "";
        const contLines: string[] = [];
        for (; i < words.length; i++) {
          const test = cur ? cur + " " + words[i] : words[i];
          if (font.widthOfTextAtSize(test, 12) > headerTextMaxWidth) {
            if (cur) contLines.push(cur);
            cur = words[i];
          } else cur = test;
        }
        if (cur) contLines.push(cur);
        for (const cl of contLines) {
          ty -= 16;
          page.drawText(cl, { x: textX, y: ty - 12, size: 12, font, color: rgb(0.1, 0.1, 0.15) });
        }
      }
      ty -= 18;
    }
    y = Math.min(ty, img ? logoBottomY : ty) - 6;
    page.drawLine({
      start: { x: margin, y },
      end: { x: pageWidth - margin, y },
      thickness: 1,
      color: rgb(0.7, 0.7, 0.75),
    });
    y -= 12;
  } else {
    for (const l of wrap(opts.title, 18, fontBold)) drawLine(l, 18, fontBold, rgb(0.1, 0.3, 0.6));
    if (opts.topic) {
      for (const l of wrap(opts.topic, 11)) drawLine(l, 11, font, rgb(0.35, 0.35, 0.4));
    }
    y -= 8;
  }

  opts.questions.forEach((q, i) => {
    y -= 4;
    const head = `Questão ${i + 1} (${q.points} pt)`;
    drawLine(head, 12, fontBold);
    for (const l of wrap(q.prompt, 11)) drawLine(l, 11);
    if (Array.isArray(q.options) && q.options.length) {
      q.options.forEach((opt, oi) => {
        const letter = String.fromCharCode(97 + oi);
        const text = `${letter}) ${opt}`;
        const wrapped = wrap(text, 11);
        wrapped.forEach((l, idx) => drawLine(l, 11, font, rgb(0.1, 0.1, 0.15), idx === 0 ? 16 : 28));
      });
    } else {
      drawLine("Resposta: ____________________________________________", 11, font, rgb(0.4, 0.4, 0.45));
    }
    if (opts.includeAnswers) {
      const ca = Array.isArray(q.correct_answer) ? q.correct_answer.join(", ") : String(q.correct_answer ?? "—");
      for (const l of wrap(`Resposta correta: ${ca}`, 11, fontBold)) drawLine(l, 11, fontBold, rgb(0.05, 0.45, 0.2));
      if (q.explanation) {
        for (const l of wrap(`Explicação: ${q.explanation}`, 10)) drawLine(l, 10, font, rgb(0.3, 0.3, 0.35));
      }
    }
  });

  return pdf.save();
}

/** Student or teacher: download exercise as PDF (without answers for students). */
export const exportExercisePDF = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ exercise_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { exercise, questions } = await loadExerciseForExport(data.exercise_id);
    // Authorization: teacher of discipline OR enrolled student (and exercise published)
    const { data: disc } = await supabaseAdmin
      .from("disciplines").select("teacher_id, name, group_name, institution_id").eq("id", exercise.discipline_id).maybeSingle();
    const isTeacher = disc?.teacher_id === context.userId;
    let includeAnswers = false;
    if (isTeacher) {
      includeAnswers = true;
    } else {
      if (exercise.status !== "published") throw new Error("Exercício indisponível");
      const { data: enroll } = await supabaseAdmin
        .from("discipline_students").select("id")
        .eq("discipline_id", exercise.discipline_id).eq("student_id", context.userId).maybeSingle();
      if (!enroll) throw new Error("Sem permissão");
    }
    // Build the standardized institutional header (same as the Apostila),
    // replacing the "Apostila" label with "Exercício".
    const { resolveBrandingLogoUrl } = await import("./branding.server");
    const [logoUrl, teacher] = await Promise.all([
      disc?.teacher_id ? resolveBrandingLogoUrl(disc.teacher_id).catch(() => null) : Promise.resolve(null),
      disc?.teacher_id
        ? supabaseAdmin.from("profiles").select("name").eq("id", disc.teacher_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const headerLines: string[] = [];
    if (disc?.name) headerLines.push(`Disciplina: ${disc.name}`);
    if (disc?.group_name) headerLines.push(`Curso: ${disc.group_name}`);
    if (teacher?.data?.name) headerLines.push(`Professor(a): ${teacher.data.name}`);
    const exercicioLabel =
      (exercise.topic && exercise.topic.trim()) ||
      exercise.title.replace(/^Exerc[íi]cios?\s*[-–—:]\s*/i, "").trim() ||
      exercise.title;
    headerLines.push(`Exercício: ${exercicioLabel}`);
    const bytes = await renderExerciseToPDF({
      title: exercise.title,
      topic: exercise.topic,
      questions: questions.map((q) => ({
        prompt: q.prompt,
        options: Array.isArray(q.options) ? (q.options as string[]) : null,
        correct_answer: q.correct_answer,
        explanation: q.explanation,
        points: Number(q.points),
      })),
      includeAnswers,
      header: { logoUrl, lines: headerLines },
    });
    return {
      filename: `${sanitizeFilename(exercise.title)}.pdf`,
      mime: "application/pdf",
      base64: bufferToBase64(bytes),
    };
  });

/** Teacher only: download exercise as editable DOCX (with answers + explanations). */
export const exportExerciseDOCX = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ exercise_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { exercise, questions } = await loadExerciseForExport(data.exercise_id);
    await assertTeacher(exercise.discipline_id, context.userId);

    const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = await import("docx");
    const children: InstanceType<typeof Paragraph>[] = [];
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: exercise.title, bold: true })] }));
    if (exercise.topic) {
      children.push(new Paragraph({ children: [new TextRun({ text: exercise.topic, italics: true, color: "555555" })] }));
    }
    children.push(new Paragraph({ text: "" }));

    questions.forEach((q, i) => {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: `Questão ${i + 1} (${Number(q.points)} pt)`, bold: true })],
      }));
      String(q.prompt ?? "").split(/\r?\n/).forEach((line) => {
        children.push(new Paragraph({ children: [new TextRun(line)] }));
      });
      if (Array.isArray(q.options) && q.options.length) {
        (q.options as string[]).forEach((opt, oi) => {
          const letter = String.fromCharCode(97 + oi);
          children.push(new Paragraph({ children: [new TextRun(`${letter}) ${opt}`)] }));
        });
      }
      const ca = Array.isArray(q.correct_answer) ? q.correct_answer.join(", ") : String(q.correct_answer ?? "—");
      children.push(new Paragraph({
        children: [
          new TextRun({ text: "Resposta correta: ", bold: true, color: "0E7C2E" }),
          new TextRun({ text: ca, color: "0E7C2E" }),
        ],
      }));
      if (q.explanation) {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: "Explicação: ", bold: true }),
            new TextRun({ text: String(q.explanation) }),
          ],
        }));
      }
      children.push(new Paragraph({ text: "", alignment: AlignmentType.LEFT }));
    });

    const doc = new Document({ sections: [{ children }] });
    const buf = await Packer.toBuffer(doc);
    const bytes = new Uint8Array(buf);
    return {
      filename: `${sanitizeFilename(exercise.title)}.docx`,
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      base64: bufferToBase64(bytes),
    };
  });