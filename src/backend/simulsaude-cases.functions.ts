import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertTeacherOrAdmin } from "./discipline-access.server";
import { callAIJson } from "./ai.server";

export type VitalSign = { parameter: string; value: string; unit: string; reference: string; classification: string };
export type LabExam = { exam: string; value: string; unit: string; reference: string; classification?: string };

export type Pharmacotherapy = { 
  medication: string; 
  dose_route: string; 
  posology_schedule: string; 
  intake_times: string;
  food_relation: string; 
};

export type ClinicalCaseDraft = {
  title: string;
  description: string;
  patient: {
    name: string;
    age: string;
    sex: string;
    occupation: string;
    chief_complaint: string;
    anamnesis: string;
    history: string;
    pharmacotherapy: Pharmacotherapy[];
    supplements?: string;
  };
  vital_signs: VitalSign[];
  lab_exams: LabExam[];
  expected_conducts: { label: string; feedback: string; score: number }[];
  evaluation_criteria: string[];
  difficulty?: "basico" | "intermediario" | "avancado";
  clinical_questions?: {
    question: string;
    expected_answer: string;
    rubric: { criterion: string; description: string; weight: number }[];
  }[];
};

const draftSchema = z.object({
  title: z.string(),
  description: z.string(),
  patient: z.object({
    name: z.string(),
    age: z.string(),
    sex: z.string(),
    occupation: z.string(),
    chief_complaint: z.string(),
    anamnesis: z.string(),
    history: z.string(),
    pharmacotherapy: z.array(z.object({
      medication: z.string(),
      dose_route: z.string(),
      posology_schedule: z.string(),
      intake_times: z.string(),
      food_relation: z.string(),
    })),
    supplements: z.string().optional(),
  }),
  vital_signs: z.array(
    z.object({ parameter: z.string(), value: z.string(), unit: z.string(), reference: z.string(), classification: z.string() }),
  ),
  lab_exams: z.array(z.object({ exam: z.string(), value: z.string(), unit: z.string(), reference: z.string(), classification: z.string().optional() })),
  expected_conducts: z.array(z.object({ label: z.string(), feedback: z.string(), score: z.number() })),
  evaluation_criteria: z.array(z.string()),
  difficulty: z.enum(["basico", "intermediario", "avancado"]).optional(),
  clinical_questions: z
    .array(
      z.object({
        question: z.string(),
        expected_answer: z.string(),
        rubric: z
          .array(
            z.object({
              criterion: z.string(),
              description: z.string().default(""),
              weight: z.coerce.number().default(2),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

const DIFFICULTY_LABEL = {
  basico: "Básico",
  intermediario: "Intermediário",
  avancado: "Avançado",
} as const;

const DIFFICULTY_RULES = {
  basico: `- Nível Básico: quadro clínico típico, poucos dados alterados, foco em identificação de sinais/sintomas, condutas fundamentais e comunicação com o paciente.
- APLICAÇÃO OBRIGATÓRIA AO NÍVEL BÁSICO:
  * Foco no reconhecimento simples do problema e nos conceitos gerais da área.
  * "expected_answer" (Espelho de Resposta) DEVE usar linguagem simples, direta e acessível, sem exigir jargão técnico sofisticado.
  * Rubricas ALTAMENTE FLEXÍVEIS: pontuem o entendimento básico do problema; é PROIBIDO exigir termos técnicos complexos, cálculo de doses ou posologia exata nos critérios de correção.
  * Descrições de rubrica devem aceitar respostas parafraseadas (ex: "identifica que o paciente apresenta o problema X, mesmo sem nomear tecnicamente").`,
  intermediario:
    `- Nível Intermediário: quadro com comorbidade ou fator complicador, exigindo correlação clínico-laboratorial e escolha justificada de conduta.
- APLICAÇÃO OBRIGATÓRIA AO NÍVEL INTERMEDIÁRIO:
  * Foco no raciocínio clínico, segurança do paciente e identificação de riscos (ex: interações, contraindicações).
  * "expected_answer" NÃO deve exigir a memorização de doses exatas; o que se cobra é a escolha da classe terapêutica correta e segura, com justificativa contextual.
  * Rubricas FLEXÍVEIS: recompensem o aluno que propõe soluções seguras e compreende o contexto; aceitem variações de palavras e sinônimos, sem cobrar terminologia literal.`,
  avancado:
    `- Nível Avançado: caso complexo, com múltiplas comorbidades, interações medicamentosas e/ou dados conflitantes, exigindo priorização, raciocínio diferencial e plano terapêutico detalhado.
- APLICAÇÃO OBRIGATÓRIA AO NÍVEL AVANÇADO:
  * Alto rigor técnico e acadêmico.
  * "expected_answer" DEVE exigir posologia exata, justificativas farmacológicas profundas e manejo de interações complexas.
  * Rubricas ESTRITAS: exijam o uso correto do jargão técnico, protocolos completos e justificativa baseada em evidências; critérios devem ser objetivos e sem tolerância para respostas vagas.`,
} as const;

export const generateClinicalCaseDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        disciplineId: z.string().uuid(),
        theme: z.string().min(3),
        apostilaId: z.string().uuid().optional(),
        lessons: z.array(z.string()).optional(),
        difficulty: z.enum(["basico", "intermediario", "avancado"]).default("intermediario"),
        /** Cenário e objetivos vindos do Plano de Aula (opcional). */
        planScenario: z.string().max(30000).optional(),
        planObjectives: z.string().max(30000).optional(),
        /** Instruções/contexto adicional digitado pelo(a) professor(a) no formulário. */
        extraContext: z.string().max(30000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ClinicalCaseDraft> => {
    await assertTeacherOrAdmin(data.disciplineId, context.userId);

    const { data: disc } = await supabaseAdmin
      .from("disciplines")
      .select("name, group_name")
      .eq("id", data.disciplineId)
      .maybeSingle();

    let lessonContext = "";
    if (data.apostilaId) {
      const { data: apostila } = await supabaseAdmin
        .from("ai_generations")
        .select("result")
        .eq("id", data.apostilaId)
        .maybeSingle();
      if (apostila?.result) {
        const content =
          typeof apostila.result === "string" ? apostila.result : JSON.stringify(apostila.result);
        const lessons = data.lessons ?? [];
        let extracted = "";
        for (const lesson of lessons) {
          const escaped = lesson.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const match = content.match(new RegExp(`# ${escaped}(.*?)(?=\\n# |$)`, "s"));
          if (match?.[1]) extracted += `\n[${lesson}]\n${match[1].substring(0, 1200)}\n`;
        }
        if (extracted) lessonContext = `\nBASE TÉCNICA DO MATERIAL:\n${extracted}`;
      }
    }

    const system = `Você é um especialista em simulação clínica para ensino superior na área da saúde.
Disciplina: "${disc?.name ?? ""}" (curso: ${disc?.group_name ?? "Saúde"}).

REGRAS CRÍTICAS DE GERAÇÃO:
1. ADAPTAÇÃO AO NÍVEL (REGRA PRINCIPAL): O caso DEVE ser compatível com o nível da disciplina.
- Se for uma disciplina introdutória (ex: Introdução, Ética, Fundamentos), foque em atribuições básicas, ética, boas práticas e comunicação.
- NUNCA gere casos complexos de farmacoterapia ou intervenções avançadas para disciplinas de nível básico.
- LEIA E RESPEITE a ementa/base técnica fornecida abaixo.

2. RENDERIZAÇÃO OBRIGATÓRIA DE TABELAS (NÃO USAR TEXTO CORRIDO):
- Para qualquer dado quantitativo, exames, tabelas de sintomas ou parâmetros:
  * Gere o JSON de sinais vitais e exames conforme o esquema.
  * No campo "anamnesis" ou "history", se houver necessidade de exibir tabelas de parâmetros de bancada ou comparações, utilize tabelas Markdown bem estruturadas.
  * É PROIBIDO exibir dados laboratoriais ou sinais vitais como texto corrido ou listas desformatadas no enunciado principal.

3. DIRETRIZES DE EXAMES E HEMOGRAMA (REGRA OBRIGATÓRIA):
- DESMEMBRAMENTO DO HEMOGRAMA: É ESTRITAMENTE PROIBIDO exibir o "Hemograma Completo" como uma única linha de texto genérica (ex: "Valores dentro dos limites", "Normal").
- Se o Hemograma for incluído, ele DEVE ser gerado desmembrado em linhas individuais para cada parâmetro relevante no array "lab_exams":
  * Hemoglobina (g/dL)
  * Hematócrito (%)
  * Leucócitos Totais (/mm³)
  * Eosinófilos (% e /mm³)
  * Neutrófilos (%)
  * Linfócitos (%)
  * Plaquetas (/mm³)
- Cada parâmetro acima DEVE ter seu "value" numérico específico, sua "unit" e seu "reference" (valor de referência) preenchidos individualmente.
- Se o Hemograma for normal, use valores numéricos reais dentro da faixa de referência em cada linha para permitir a interpretação real pelo aluno.
- COERÊNCIA CLÍNICO-LABORATORIAL: Garanta que as alterações de exames reflitam com precisão a fisiopatologia do caso clínico gerado.
- Exemplo: Em quadros alérgicos (rinite, asma, atopia), o leucograma DEVE apresentar eosinofilia relativa/absoluta e, se aplicável, elevação nos níveis de IgE sérica, para que os alunos possam identificar a alteração laboratorial correspondente ao diagnóstico.

4. PRECISÃO TEXTUAL E DIRETRIZ OBRIGATÓRIA DE MEDICAMENTOS:
- Proíba rigorosamente o uso de nomes genéricos/vagos de classes de medicamentos (ex: "um anti-histamínico de 1ª geração", "um anti-hipertensivo", "um analgésico") na geração de Casos Clínicos e Simulações Clínicas.
- Todo medicamento mencionado no caso DEVE conter obrigatoriamente:
  * Nome do Princípio Ativo (ex: Dexclorfeniramina em vez de "anti-histamínico").
  * Forma Farmacêutica e Concentração (ex: Xarope 0,4 mg/mL).
  * Dose administrada, Via e Frequência/Horários (ex: 5 mL de 8/8h às 06h, 14h e 22h).

5. OBRIGATORIEDADE DA TABELA DE FARMACOTERAPIA:
- Todo caso clínico que envolva uso de medicamentos (seja reação adversa, interação, superdosagem ou acompanhamento) DEVE popular a tabela 'Medicamentos em Uso (Farmacoterapia Atual)' (array "pharmacotherapy") com:
  * Medicamento / Princípio Ativo
  * Dose e Forma Farmacêutica
  * Posologia e Horários (ex: 08:00h, 16:00h)
  * Relação com Alimentos / Observações
- Essas informações detalhadas devem permitir ao aluno identificar com precisão reações adversas (RAM), erros de dosagem pediátrica, interações ou horários inadequados.
- Configure o caso focando em uma das 3 grandes categorias de interações:
  1. Interações Fármaco-Fármaco: Alterações entre medicamentos.
  2. Interações Fármaco-Alimento: Alimentos/bebidas que alteram biodisponibilidade.
  3. Interações por Quelação/Absorção: Concorrência com íons (Cálcio, Ferro, Magnésio) ou antiácidos.
- Use o campo "supplements" para listar suplementos ou antiácidos em uso.

6. CASO CLÍNICO: Gere um caso completo, realista e didático. Nunca cite nomes de materiais, apostilas ou aulas.

6.1. OBJETO CENTRAL DE ESTUDO (OBRIGATÓRIO): A IA deve SEMPRE gerar o elemento prático exigido pelo tema/título do caso. O paciente sozinho NÃO basta — o caso precisa conter o documento/objeto que o aluno vai analisar, SEMPRE nos campos estruturados corretos (regra 6.4):
- Se o título/tema envolver "Prescrição", "Receita" ou "Receituário", crie OBRIGATORIAMENTE uma prescrição fictícia completa no array "patient.pharmacotherapy" (todos os medicamentos, doses, vias, posologia e horários — incluindo os erros que o aluno deve identificar).
- Se envolver "Interação", liste OBRIGATORIAMENTE a prescrição completa em "patient.pharmacotherapy" e suplementos/alimentos relevantes em "patient.supplements".
- Se envolver "Laudo", "Exame" ou "Exame Físico", inclua os resultados detalhados com valores no array "lab_exams" (e parâmetros físicos/vitais em "vital_signs").
- Se envolver "Cálculo" (dose, gotejamento, diluição), inclua os dados numéricos em "vital_signs" (peso, altura etc.), "lab_exams" ou "pharmacotherapy", conforme a natureza do dado.
- Regra geral: o aluno deve conseguir resolver a tarefa APENAS com os dados apresentados no caso.

6.2. TAREFA DO ALUNO (OBRIGATÓRIA): As tarefas e perguntas do aluno devem ser enviadas EXCLUSIVAMENTE no array "clinical_questions" (regra 9). É PROIBIDO escrever "TAREFA DO ALUNO", perguntas numeradas ou enunciados de tarefa dentro de "anamnesis", "history", "chief_complaint", "description" ou qualquer outro campo de texto.

6.3. ALINHAMENTO COM A RUBRICA (OBRIGATÓRIO): Os itens de "evaluation_criteria" devem estar 100% conectados aos dados apresentados no caso e às perguntas de "clinical_questions". Cada critério deve avaliar algo que o aluno consegue demonstrar a partir do caso (ex: "Identifica corretamente a interação entre varfarina e AAS presente na prescrição"). É PROIBIDO gerar critérios genéricos desconectados do caso.

6.4. SEPARAÇÃO ESTRITA DE DADOS (TRAVA DE ESTRUTURA — OBRIGATÓRIA):
- Os campos narrativos "patient.chief_complaint", "patient.anamnesis" e "patient.history" devem conter APENAS texto corrido (história clínica em prosa, parágrafos separados por "\\n\\n"). É PROIBIDO incluir neles: tabelas Markdown (linhas com "|"), listas de exames, listas de sinais vitais, listas de medicamentos/prescrições, títulos de seção ou perguntas.
- Sinais vitais e parâmetros do exame físico (PA, FC, FR, Temp, SpO2, peso, altura, glicemia capilar etc.) vão EXCLUSIVAMENTE no array "vital_signs".
- Exames laboratoriais e de imagem vão EXCLUSIVAMENTE no array "lab_exams".
- Medicamentos e prescrição vão EXCLUSIVAMENTE em "patient.pharmacotherapy"; suplementos em "patient.supplements".
- Perguntas e tarefas vão EXCLUSIVAMENTE em "clinical_questions".
- Nunca duplique a mesma informação em texto narrativo e em campo estruturado.

7. TOMADA DE DECISÃO: As opções de "expected_conducts" DEVEM ser geradas dinamicamente. Forneça label, feedback e score (0 a 10). Ao menos uma nota 10.0.

Responda EXCLUSIVAMENTE com o objeto JSON solicitado, seguindo rigorosamente o esquema abaixo. 
NÃO inclua explicações, introduções, conclusões ou blocos de código markdown.
NÃO use quebras de linha reais dentro de valores de string; se precisar de uma quebra de linha, use o caractere de escape literal "\\n".
Certifique-se de que todas as chaves e valores de string estejam entre aspas duplas.
{
  "title": "título curto do caso",
  "description": "resumo do caso em 2-3 frases",
  "patient": {
    "name": "nome fictício",
    "age": "ex: 65 anos",
    "sex": "Feminino ou Masculino",
    "occupation": "profissão",
    "chief_complaint": "queixa principal",
    "anamnesis": "anamnese detalhada",
    "history": "histórico clínico e comorbidades",
    "pharmacotherapy": [{ "medication": "ex: Amoxicilina", "dose_route": "ex: 500mg via oral", "posology_schedule": "ex: De 8 em 8 horas", "intake_times": "ex: 06h, 14h, 22h", "food_relation": "ex: Tomar após as refeições" }],
    "supplements": "suplementos ou antiácidos em uso"
  },
  "vital_signs": [{ "parameter": "", "value": "", "unit": "", "reference": "", "classification": "Normal|Alterado|Crítico" }],
  "lab_exams": [{ "exam": "", "value": "", "unit": "", "reference": "", "classification": "Normal|Alterado|Crítico" }],
  "expected_conducts": [{ "label": "texto da opção", "feedback": "feedback pedagógico detalhado", "score": 8.5 }],
  "evaluation_criteria": ["critério de avaliação 1", "..."]
}
8. NÍVEL DE DIFICULDADE SOLICITADO: ${DIFFICULTY_LABEL[data.difficulty]}.
${DIFFICULTY_RULES[data.difficulty]}

9. PERGUNTAS DISSERTATIVAS DE RESOLUÇÃO CLÍNICA (OBRIGATÓRIO):
- Gere EXATAMENTE 5 perguntas dissertativas SEQUENCIAIS no array "clinical_questions", seguindo o raciocínio clínico:
  1) interpretação dos dados clínicos/anamnese; 2) interpretação dos exames e sinais vitais; 3) hipótese/problema principal e justificativa;
  4) conduta/plano de intervenção detalhado; 5) monitoramento, orientações ao paciente e desfecho esperado.
- ADAPTAÇÃO OBRIGATÓRIA PELO NÍVEL DE DIFICULDADE (regra 8 acima): cada pergunta, cada "expected_answer" (Espelho de Resposta) e cada "rubric" DEVE ser calibrado rigorosamente pelo nível solicitado:
  * Básico → espelhos em linguagem simples e rubricas altamente flexíveis, sem exigir doses ou jargão técnico.
  * Intermediário → espelhos cobrando classe terapêutica correta e segura (NÃO doses exatas) e rubricas flexíveis que aceitem variações de palavras.
  * Avançado → espelhos com posologia exata e justificativa farmacológica profunda e rubricas estritas com jargão e protocolos completos.
- Para cada pergunta gere o ESPELHO DE RESPOSTA em "expected_answer" (resposta modelo completa e técnica, no rigor do nível) e a RUBRICA em "rubric",
  com 3 a 4 critérios objetivos de correção ("criterion"), a descrição do que caracteriza o acerto ("description") e o peso em pontos ("weight").

Adicione também ao JSON:
  "difficulty": "${data.difficulty}",
  "clinical_questions": [{ "question": "", "expected_answer": "", "rubric": [{ "criterion": "", "description": "", "weight": 2 }] }]

Inclua ao menos 5 sinais vitais, 4 exames, 4 condutas e 4 critérios.${lessonContext}`;

    const raw = await callAIJson<unknown>({
      system,
      user: [
        `Tema do caso clínico: ${data.theme}`,
        data.planScenario ? `Cenário previsto no Plano de Aula (respeite como base): ${data.planScenario}` : "",
        data.planObjectives ? `Objetivos de aprendizagem definidos no Plano de Aula: ${data.planObjectives}` : "",
        data.extraContext?.trim() ? `Instruções/contexto adicional do(a) professor(a): ${data.extraContext.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });

    const parsed = draftSchema.parse(raw);
    return { ...parsed, difficulty: parsed.difficulty ?? data.difficulty };
  });

export const publishClinicalCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        disciplineId: z.string().uuid(),
        draft: draftSchema,
        apostilaId: z.string().uuid().optional(),
        lessons: z.array(z.string()).optional(),
        diaryAssessmentId: z.string().optional(),
        dueDate: z.string().optional(),
        dueTime: z.string().optional(),
        allowLateSubmission: z.boolean().optional(),
        latePenaltyPerDay: z.number().optional(),
        latePenaltyType: z.enum(["percentage", "fixed"]).optional(),
        lateToleranceDate: z.string().optional(),
        lateToleranceTime: z.string().optional(),
        /** Rascunho previsto no Plano de Aula que este caso completo substitui. */
        replacePlannedCaseId: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertTeacherOrAdmin(data.disciplineId, context.userId);

    // Herda vínculo com o plano (módulo/origem) quando o caso substitui um rascunho previsto.
    let planned: { id: string; module_number: number | null; source_generation_id: string | null; scenario: string | null; objectives: string | null } | null = null;
    if (data.replacePlannedCaseId) {
      const { data: row } = await supabaseAdmin
        .from("clinical_cases")
        .select("id, status, module_number, source_generation_id, scenario, objectives")
        .eq("id", data.replacePlannedCaseId)
        .eq("discipline_id", data.disciplineId)
        .eq("status", "draft")
        .maybeSingle();
      planned = row ?? null;
    }

    const { data: inserted, error } = await supabaseAdmin
      .from("clinical_cases")
      .insert({
        discipline_id: data.disciplineId,
        teacher_id: context.userId,
        title: data.draft.title,
        description: data.draft.description,
        patient_info: {
          ...data.draft.patient,
          vital_signs: data.draft.vital_signs,
        },
        investigation_data: { lab_exams: data.draft.lab_exams },
        decision_tree: {
          expected_conducts: data.draft.expected_conducts,
          evaluation_criteria: data.draft.evaluation_criteria,
          clinical_questions: data.draft.clinical_questions ?? [],
          difficulty: data.draft.difficulty ?? "intermediario",
          apostila_id: data.apostilaId ?? null,
          lessons: data.lessons ?? [],
          diary_assessment_id: data.diaryAssessmentId ?? null,
        },
        status: "published",
        scenario: planned?.scenario ?? null,
        objectives: planned?.objectives ?? null,
        module_number: planned?.module_number ?? null,
        source_generation_id: planned?.source_generation_id ?? null,
        due_date: data.dueDate ? new Date(data.dueDate).toISOString() : null,
        due_time: data.dueTime || "23:59:59",
        allow_late_submission: data.allowLateSubmission ?? true,
        late_penalty_per_day: data.latePenaltyPerDay ?? 0,
        late_penalty_type: data.latePenaltyType || "percentage",
        late_tolerance_date: data.lateToleranceDate ? new Date(data.lateToleranceDate).toISOString().split('T')[0] : null,
        late_tolerance_time: data.lateToleranceTime || "23:59:59",
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);

    // O rascunho previsto no plano deixa de existir: foi materializado como caso completo.
    if (planned) {
      const { error: delErr } = await supabaseAdmin.from("clinical_cases").delete().eq("id", planned.id);
      if (delErr) console.error("[publishClinicalCase] remove planned draft:", delErr.message);
    }
    return inserted;
  });

export type PlannedClinicalCase = {
  id: string;
  title: string;
  scenario: string | null;
  objectives: string | null;
  module_number: number | null;
  created_at: string;
};

/**
 * Casos clínicos previstos no Plano de Aula (rascunhos incompletos) — visíveis
 * somente para professor/admin, para gerar o caso completo no SimulSaúde.
 * Alunos continuam restritos aos casos publicados (`getClinicalCases`).
 */
export const getPlannedClinicalCases = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ disciplineId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<PlannedClinicalCase[]> => {
    await assertTeacherOrAdmin(data.disciplineId, context.userId);
    const { data: rows, error } = await supabaseAdmin
      .from("clinical_cases")
      .select("id, title, scenario, objectives, module_number, created_at")
      .eq("discipline_id", data.disciplineId)
      .eq("status", "draft")
      .not("source_generation_id", "is", null)
      .order("module_number", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });
    if (error) {
      console.error("[getPlannedClinicalCases]", error.message);
      return [];
    }
    return (rows ?? []) as PlannedClinicalCase[];
  });
