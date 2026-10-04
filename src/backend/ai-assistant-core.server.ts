import { extractAIContent } from "@/lib/ai-content";
import { sanitizeConceptTopic } from "@/lib/text-sanitize";
import { QUESTION_FACTORY_RULES } from "./question-factory.server";
import { DIFFICULTY_CALIBRATION_RULES } from "./difficulty-guard.server";

export { ensureLessonPlanStandardHeader, normalizeLessonPlanMarkdown } from "@/lib/lesson-plan-markdown";


export function sanitizeLessonPlanMarkdown(input: string): string {
  let md = String(input ?? "").replace(/\r\n/g, "\n").trim();
  const planMatch = md.match(/^##\s+Plano de Aula[^\n]*/im);
  if (planMatch && planMatch.index !== undefined && planMatch.index > 0) {
    md = md.slice(planMatch.index);
  }
  md = md.replace(/^(\s*[-*]\s*\*\*Carga Hor[áa]ria[^*]*\*\*)\s*:?[^\n]*$/gim, "$1:");
  md = md.replace(/^(\s*[-*]\s*\*\*(?:Lan[çc]amento|Entrega|Data\s+Sugerida)\*\*\s*:)[^\n]*$/gim, "$1 A definir");
  md = md.replace(/(###\s+Refer[êe]ncias Bibliogr[áa]ficas[^\n]*\n)([\s\S]*?)(?=\n###\s|\n##\s|$)/i, (_full, header: string, body: string) => {
    const out = body.split("\n").map((line) => {
      const m = line.match(/^(\s*[-*]\s+)(.*)$/);
      if (!m) return line;
      const rest = m[2].trim();
      if (!rest || rest.startsWith("**")) return line;
      const am = rest.match(/^([^,.]+)([,.].*)$/);
      if (!am) return line;
      return `${m[1]}**${am[1].trim()}**${am[2]}`;
    });
    return header + out.join("\n");
  });
  const sectionRe = /(###\s+Banco de Temas Sugeridos[^\n]*\n)([\s\S]*?)(?=\n###\s|\n##\s|$)/i;
  md = md.replace(sectionRe, (_full, header: string, body: string) => {
    const counters: Record<string, number> = {};
    const out: string[] = [];
    for (const rawLine of body.split("\n")) {
      const line = rawLine.replace(/\s+$/g, "");
      if (!line.trim()) { out.push(line); continue; }
      const bullet = line.match(/^(\s*[-*]\s+)(.*)$/);
      if (!bullet) { out.push(line); continue; }
      let text = bullet[2].trim();
      let m = text.match(/^\[\s*Trabalho\s+Acad[êe]mico[^\]]*\]\s*[:\-–—]?\s*(.+)$/i);
      if (m) { out.push(`**Trabalho Acadêmico:** ${m[1].trim()}`); continue; }
      m = text.match(/^Trabalho\s+Acad[êe]mico(?:\s*[-–—]\s*Trabalho\s+Acad[êe]mico[^:]*)?\s*[:\-–—]?\s*(.+)$/i);
      if (m) { out.push(`**Trabalho Acadêmico:** ${m[1].trim()}`); continue; }
      m = text.match(/^\[\s*(?:Atividade\s+Extra\s*[-–—]\s*)?([^\]]+?)\s*\]\s*[:\-–—]?\s*(.+)$/i);
      if (m) {
        const typeName = normalizeActivityTypeName(m[1]);
        const key = typeName.toLowerCase();
        counters[key] = (counters[key] ?? 0) + 1;
        out.push(`**${typeName} ${counters[key]}:** ${m[2].trim()}`);
        continue;
      }
      text = text.replace(/^\*\*(.+?)\*\*\s*:?\s*(.*)$/i, (_all, label: string, rest: string) => `${label.replace(/\s*:+\s*$/g, "")}: ${rest.replace(/^\s*:+\s*/g, "")}`.trim());
      m = text.match(/^([A-Za-zÀ-ÿ ]+?)(?:\s+\d+)?\s*[:\-–—]\s*(.+)$/i);
      if (m) {
        const typeName = normalizeActivityTypeName(m[1]);
        if (KNOWN_ACTIVITY_CATEGORIES.has(typeName.toLowerCase())) {
          const key = typeName.toLowerCase();
          counters[key] = (counters[key] ?? 0) + 1;
          out.push(`**${typeName} ${counters[key]}:** ${m[2].trim()}`);
          continue;
        }
      }
      out.push(line);
    }
    return header + out.join("\n");
  });
  return md;
}

const KNOWN_ACTIVITY_CATEGORIES = new Set([
  "estudo de caso", "seminário", "seminario", "debate", "visita técnica", "visita tecnica",
  "aula prática", "aula pratica", "workshop", "redação", "redacao", "atividade prática", "atividade pratica",
]);

export function normalizeActivityTypeName(raw: string): string {
  const s = raw.trim().replace(/\s+/g, " ").replace(/\s+\d+\s*:?\s*$/g, "").replace(/:+$/g, "");
  const lowerWords = new Set(["de", "da", "do", "dos", "das", "e"]);
  return s.split(" ").map((w, i) => {
    const lw = w.toLowerCase();
    if (i > 0 && lowerWords.has(lw)) return lw;
    return lw.charAt(0).toUpperCase() + lw.slice(1);
  }).join(" ");
}

export function stripPredefinedDates(md: string): string {
  if (!md) return md;
  const dateLabel = /(data\s+(?:de\s+)?(?:lan[çc]amento|entrega|sugerida|prevista|in[íi]cio|t[ée]rmino|aplica[çc][ãa]o|realiza[çc][ãa]o|publica[çc][ãa]o)|prazo(?:\s+(?:de\s+entrega|final|sugerido))?|cronograma|calend[áa]rio(?:\s+de\s+entrega| sugerido)?|per[íi]odo\s+de\s+entrega|deadline)/i;
  const lines = md.split("\n");
  const out: string[] = [];
  for (const raw of lines) {
    if (dateLabel.test(raw)) continue;
    let line = raw;
    line = line.replace(/\s*[\(\[\-–—]\s*\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?\s*[\)\]]?/g, "");
    line = line.replace(/\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/g, "");
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function stripApostilaSections(md: string): string {
  if (!md) return md;
  const removeRe = /^(?:exerc[íi]cios?(?:\s+propostos?|\s+de\s+fixa[çc][ãa]o|\s+resolvidos?)?|atividades?(?:\s+(?:de\s+fixa[çc][ãa]o|propostas?|de\s+aprendizagem|extras?|complementares?))?|estudos?\s+de\s+caso|trabalhos?\s+acad[êe]micos?|avalia[çc][õo]es\s+e\s+trabalhos|avalia[çc][õo]es)\s*$/i;
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let skipUntilLevel = 0;
  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (h) {
      const level = h[1].length;
      const text = h[2].replace(/\*+/g, "").trim();
      if (skipUntilLevel) {
        if (level <= skipUntilLevel) skipUntilLevel = 0;
        else continue;
      }
      if (removeRe.test(text)) {
        skipUntilLevel = level;
        continue;
      }
      out.push(line);
      continue;
    }
    if (skipUntilLevel) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export const TOOL_KEYS = ["lesson_plan","apostila","slides","exercise_list","syllabus","rubric","case_study","summary","quiz","essay_prompt","concept_map","study_guide","feedback_template","activity_syllabus"] as const;
export type ToolKey = (typeof TOOL_KEYS)[number];
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const MARKDOWN_SYSTEM_PREFIX = `You must always respond in plain markdown text. Never wrap your response in JSON, never use curly braces, never use keys like markdown or content. Start your response directly with the content. Use ## for main titles, ### for subtitles, and regular paragraphs for body text. Respond in Brazilian Portuguese.`;

export function normalizeAssessmentNumbering(markdown: string) {
  let next = 1;
  return markdown.replace(/^(\s*)(?:\*\*)?(?:(?:\d+(?:\.\d+)?|N)[.)]\s*)?(?:\*\*)?(Questão\s+de\s+[^:\n]+:\s*)(?:\*\*)?/gim, (_match, indent: string, label: string) => `${indent}${next++}. ${label.replace(/\*\*/g, "")}`);
}

export function normalizeAssessmentMaterialOutput(markdown: string, fallback: { institutionName: string; disciplineName: string; teacherName: string; modules: string[]; themes: string[]; materialTitle: string; }) {
  const normalized = normalizeAssessmentNumbering(markdown)
    .replace(/---\s*IN[ÍI]CIO\s+(?:DA\s+)?(?:AVALIA[ÇC][ÃA]O|EXERC[ÍI]CIOS|DO\s+MATERIAL)\s*---/gi, "---INÍCIO DO MATERIAL---")
    .replace(/---\s*FIM\s+(?:DA\s+)?(?:AVALIA[ÇC][ÃA]O|EXERC[ÍI]CIOS|DO\s+MATERIAL)\s*---/gi, "---FIM DO MATERIAL---")
    .replace(/^#{1,6}\s+/gm, "").replace(/^\s*(?:Questões\s+(?:de|Discursivas|do)|Seção\s+de\s+Questões|Tipo\s+de\s+Questão).*$/gim, "").replace(/^\s*[-*]\s+(?=[a-e]\))/gim, "").replace(/\*\*(Instituição|Disciplina|Professor|Módulo\(s\)|Tema\(s\)(?: do Material| da Avaliação| dos Exercícios)?|Resposta correta|Gabarito):\*\*/gi, "$1:").replace(/\*\*/g, "").trim();
  const withStart = normalized.includes("---INÍCIO DO MATERIAL---") ? normalized : `---INÍCIO DO MATERIAL---\n${normalized}`;
  const withEnd = withStart.includes("---FIM DO MATERIAL---") ? withStart : `${withStart}\n---FIM DO MATERIAL---`;
  const stripMarkers = (s: string) => s.replace(/^\s*---\s*INÍCIO DO MATERIAL\s*---\s*$/gim, "").replace(/^\s*---\s*FIM DO MATERIAL\s*---\s*$/gim, "").replace(/\n{3,}/g, "\n\n").trim();
  if (/Instituição:\s*.+/i.test(withEnd) && /Questões:/i.test(withEnd)) return stripMarkers(withEnd);
  const content = withEnd.replace("---INÍCIO DO MATERIAL---", "").replace("---FIM DO MATERIAL---", "").trim();
  const cleanModules = fallback.modules.map(sanitizeConceptTopic).filter(Boolean);
  const cleanThemes = fallback.themes.map(sanitizeConceptTopic).filter(Boolean);
  return stripMarkers(`Instituição: ${fallback.institutionName}\nDisciplina: ${fallback.disciplineName}\nProfessor: ${fallback.teacherName}\nMódulo(s): ${cleanModules.join("; ")}\nTema(s) do Material: ${cleanThemes.length ? cleanThemes.join("; ") : "Todos os temas dos módulos selecionados"}\n\n${fallback.materialTitle} de ${fallback.disciplineName}\n\nInstruções:\n\nLeia atentamente todas as questões.\n\nUtilize caneta azul ou preta para as respostas.\n\nNão é permitido o uso de materiais de consulta, salvo autorização expressa.\n\nQuestões:\n\n${content}`);
}


export const RAW_SYSTEMS: Record<ToolKey, string> = {
  lesson_plan: `Você é um(a) professor(a) experiente. Gere um plano de aula completo e prático em pt-BR.

REGRAS INVIOLÁVEIS:
1. QUANTIDADE EXATA: respeite rigorosamente o número de módulos e o número de aulas por módulo informados pelo usuário. Se foram pedidos X módulos com Y aulas cada, o plano deve conter exatamente X módulos e X*Y aulas, com numeração contínua. NUNCA crie aulas ou módulos adicionais para "fechar" carga horária teórica.
2. LIMITE DE DATAS: todas as aulas devem ocorrer entre a data inicial e a data final do período letivo informado. Nenhuma data pode ultrapassar a data final nem preceder a data inicial. Pule feriados e a semana acadêmica informada.
3. RODAPÉ/ASSINATURA: use a data de geração informada no pedido ou a data inicial do período. Nunca escreva anos anteriores ou datas fictícias.`,

  apostila: `Você cria apostilas didáticas completas, aprofundadas e prontas para uso em pt-BR, a partir de um Plano de Aula.

FONTE OBRIGATÓRIA: use a ementa, os módulos, as aulas selecionadas, os objetivos e os conteúdos do plano informado. Nunca invente módulos ou aulas que não estejam no escopo enviado. Gere conteúdo APENAS para as aulas selecionadas.

ESTRUTURA OBRIGATÓRIA (markdown, nesta ordem):
1. Capa/identificação: título da apostila, Curso, Disciplina, Professor(a) e Módulo.
2. "## Apresentação" — texto motivacional (2 a 4 parágrafos) situando a importância prática do módulo.
3. "## Objetivos" — um único bloco contínuo e compacto, na MESMA seção: primeiro o "Objetivo Geral" (1 parágrafo curto) e depois "Objetivos Específicos" como uma lista numerada contínua (1., 2., 3., ...), um item por aula, sem subtítulos extras, sem tabelas e sem quebras de seção entre eles.
4. "## Sumário" — uma única lista hierárquica, limpa e sem duplicações: cada "Módulo X: Nome" no nível principal, suas aulas como itens recuados no formato "Aula Y: Tema", e ao final "Referências Bibliográficas Expandidas". Não invente números de página; o exportador calculará as páginas reais.
5. Para CADA módulo selecionado, escreva UMA VEZ o separador "## Módulo X: Nome do Módulo". Nunca repita "Módulo X" no título individual das aulas.
6. Dentro do respectivo módulo, para CADA aula selecionada, escreva "### Aula Y: Tema da Aula", copiando fielmente o TEMA da aula cadastrado no Plano de Aula. O título da aula é sempre o tema (ex.: "Aula 1: Importância e Aplicação da Imunologia Clínica; Revisão do Sistema Imune") e NUNCA o texto de um objetivo de aprendizagem (não comece o título com verbos como Compreender, Identificar, Analisar, Aplicar). Imediatamente após esse título, sem nenhum texto intermediário, escreva "#### Objetivos de Aprendizagem:" e liste em bullets os objetivos específicos daquela aula. Depois, inclua nesta ordem:
   - "#### Contextualização" — situação real que introduz o tema.
   - "#### Fundamentação Teórica" — desenvolvimento denso e técnico (mínimo 4 parágrafos), com definições completas, mecanismos, classificações, valores de referência quando pertinentes, e sugestões de recursos visuais indicadas como "> Sugestão visual: ...".
   - "#### Exemplos Aplicados" — aplicação à rotina profissional/laboratorial da área, com dados concretos.
   - "#### Para Refletir" — 2 a 3 perguntas reflexivas abertas.
   - "#### Conexões com Outras Áreas" — integração com outras disciplinas/campos.
   - "#### Síntese" — fechamento em tópicos curtos.
7. "## Referências Bibliográficas Expandidas" com quatro subseções:
   - "### Livros (ABNT, comentados)" — referência ABNT completa seguida de comentário de 1 a 2 linhas.
   - "### Artigos e Diretrizes de Sociedades Especializadas".
   - "### Recursos Online".
   - "### Para Ir Além" — sugestões de aprofundamento.

REGRAS: linguagem didática e técnica, sem metalinguagem sobre "este material"; nunca use tabelas para o corpo teórico; não invente datas; não repita o Sumário no meio do texto; nunca combine Módulo e Aula no mesmo título.`,
  slides: `Você gera o roteiro completo de slides de aula em pt-BR a partir do conteúdo e dos objetivos da aula selecionada no Plano de Aula/Apostila.

FORMATO OBRIGATÓRIO (respeite literalmente os rótulos; um bloco por slide):
SLIDE 1:
Tipo de Slide: Capa
Título do Slide: [Título da Apresentação = Tema da Aula]
Conteúdo Principal:
- Disciplina: [nome]
- Professor(a): [nome]
- Módulo [nº]: [nome do módulo]
- Aula [nº]: [tema da aula]
Notas do Professor: [3 a 5 frases de roteiro de fala]

SEQUÊNCIA OBRIGATÓRIA DO DECK:
1. SLIDE 1 — Tipo de Slide: Capa (conforme acima). Este slide já contém Módulo e Aula, NÃO crie slides separados para módulo ou aula.
2. SLIDE 2 em diante — Tipo de Slide: Conteúdo, nesta ordem pedagógica:
   a) Contextualização da área/tema;
   b) Fundamentação Teórica aprofundada, dividida em vários slides com tópicos claros em bullet points;
   c) Exemplos Práticos e Casos de Rotina Laboratorial/Clínica (após cada bloco conceitual);
   d) Síntese, Conexões Multidisciplinares e Desafios Atuais.
3. ÚLTIMO SLIDE — Tipo de Slide: Encerramento.
   - Título do Slide: MENSAGEM DO PROFESSOR (exatamente assim).
   - Conteúdo Principal: um parágrafo reflexivo e inspirador ligando o conteúdo da aula ao compromisso com o diagnóstico correto, a ética profissional e o cuidado com o paciente.
   - Última linha do Conteúdo Principal: a assinatura iniciada por "—" com o nome do docente em maiúsculas (ex.: "— PROF. JAÍLSON RESENDE").
   - PROIBIDO incluir referências bibliográficas neste slide (nem em nenhum outro slide de encerramento).
   - Notas do Professor: mensagem cordial de agradecimento e incentivo ao estudo contínuo.

REGRAS DE CONTEÚDO:
4. Baseie cada slide exclusivamente nos conteúdos, conceitos e objetivos da aula selecionada. Não invente temas fora do escopo.
5. TODOS os slides, sem exceção, terminam com "Notas do Professor:" seguido de 3 a 5 frases didáticas de roteiro de fala (explicação, analogia, erro comum e pergunta para a turma).
6. Bullets curtos e objetivos, respeitando a densidade de texto informada; no máximo 6 bullets por slide.
7. Quando o conteúdo pedir suporte visual (esquemas, vias bioquímicas/imunológicas, tubos de coleta, fluxogramas diagnósticos, lâminas, gráficos), inclua a linha:
   "Sugestão de Recurso Visual: [descrição detalhada do diagrama, fluxograma, lâmina ou ilustração recomendada]".
8. Respeite rigorosamente o número máximo de slides informado (padrão 20), preenchendo os slides intermediários com fundamentação teórica e exemplos aplicados. Sem metalinguagem sobre apostila ou material no corpo dos slides.

REGRAS DE EXEMPLOS PRÁTICOS E IMAGENS:
9. OBRIGATORIEDADE DE EXEMPLO PRÁTICO: TODO slide de conteúdo (exceto Capa e Encerramento) deve conter OBRIGATORIAMENTE uma seção "Exemplo Prático:" com um exemplo curto e direto relacionado ao tema do slide. O exemplo deve ter 2 a 4 bullets que ilustrem a aplicação prática do conceito. Esta seção NÃO é opcional.
10. GERAÇÃO DE IMAGEM: Para cada slide de conteúdo, inclua OBRIGATORIAMENTE uma linha com a URL de uma imagem gratuita gerada por IA usando Pollinations:
    - Use o formato: "Imagem: https://image.pollinations.ai/prompt/[descrição-em-inglês-sem-espaços]?width=800&height=450&nologo=true"
    - PROIBIDO usar termos abstratos como: "abstract", "concept", "conceptual", "diagram", "flowchart", "infographic", "illustration", "schematic", "symbol", "icon", "3d render", "digital art", "fantasy", "surreal"
    - OBRIGATÓRIO usar descrições de CENA REALISTA E CONCRETA: pessoas reais, locais reais, objetos reais em situações práticas. Descreva uma cena que você poderia fotografar na vida real.
    - Formato obrigatório da descrição: [substantivos concretos] + [verbo de ação] + [contexto/espaço] + "realistic photography, 4k"
    - Exemplo CORRETO: "pharmacist talking to patient in modern pharmacy realistic photography 4k"
    - Exemplo CORRETO: "microscope laboratory technician examining blood sample realistic photography 4k"
    - Exemplo INCORRETO (PROIBIDO): "microscope cells diagram illustration"
    - Para slides teóricos: descreva uma cena concreta mostrando o conceito (ex: "doctor examining patient in clinic realistic photography 4k" para falar de exame físico)
    - Para slides de exemplos práticos: descreva o cenário real da rotina profissional/laboratorial
    - Extraia 2-4 palavras-chave concretas do título/conteúdo do slide e traduza para inglês (ex: "farmacêutico" → "pharmacist", "paciente" → "patient", "farmácia" → "pharmacy")
    - Use apenas letras, números e hífens (sem espaços) na URL
    - SEMPRE inclua a linha de imagem em todos os slides de conteúdo (é obrigatória)
11. FALLBACK: Se não encontrar palavras-chave adequadas, use uma imagem genérica de cenário real relacionado à disciplina. SEMPRE inclua a linha de imagem em todos os slides de conteúdo.`,


  exercise_list: `VOCÊ É UM CRIADOR DE EXERCÍCIOS DE FIXAÇÃO PEDAGÓGICA.

OBJETIVO:
Elaborar questões práticas e de fixação que reforcem a aprendizagem sem recorrer a vícios metatextuais.

REGRAS DE REDAÇÃO DO ENUNCIADO:

1. PROIBIÇÃO ABSOLUTA DE VÍCIOS E METALINGUAGEM:
   - NUNCA use: "A respeito de [Tema]...", "Considerando o conteúdo de [Tema]...", "De acordo com a aula/apostila...", "Em relação a [Tema]...".
   - O enunciado DEVE iniciar diretamente com uma situação prática, um caso curto ou uma afirmação técnica afirmativa.
   - PROIBIDO usar rótulos estruturais genéricos como "Disciplina", "Módulo" ou fragmentos com pontuação malformada (ex: "Gestão,?"). Toda questão deve focar em fatos técnicos, mecanismos e conceitos aplicados.
   - Formule a questão de forma direta e técnica, sem referenciar a estrutura do curso (não use termos como "no módulo", "nesta aula", "na apostila").

2. ESTRUTURA DO ENUNCIADO:
   - Apresente um contexto prático ou problema conceitual direto (1 a 3 frases).
   - Finalize com um comando claro e inequívoco (ex.: "Nesse contexto, a conduta correta é:", "O mecanismo responsável por esse processo é:").

3. DISTRATORES E GABARITO (OPTIONS):
   - Cada questão deve conter exatamente 4 ou 5 alternativas plausíveis.
   - Apenas 1 alternativa correta.
   - Alternativas com extensão e nível de detalhe homogêneos.

4. FEEDBACK PEDAGÓGICO (EXPLANATION):
   - Forneça uma explicação clara demonstrando por que a alternativa correta é a verdadeira e por que os distratores estão incorretos, auxiliando no estudo do aluno.
   - PROIBIDO citar a letra da alternativa no texto da explicação (ex: "A alternativa correta é a C", "Alternativa correta: B"). Escreva apenas a explicação técnica conceitual — a letra correta será atribuída dinamicamente pelo sistema após a randomização das versões.

DIRETRIZES OBRIGATÓRIAS PARA AS ALTERNATIVAS:

1. PROIBIDO USAR META-LINGUAGEM: Nunca escreva nas opções frases como "Apresenta a definição correta", "Contradiz a literatura", "Afirmação incorreta sobre", "Descreve de forma tecnicamente imprecisa".

2. CONTEÚDO TÉCNICO REAL (UNIVERSAL): Cada uma das alternativas deve ser uma afirmação completa, factual e plausível da área da disciplina — qualquer que seja o campo (Saúde, Humanas, Exatas ou Biológicas) — contendo conceitos nomeados, mecanismos, processos, teorias, autores, leis, dados ou aplicações reais extraídas do conteúdo.

3. CONCEITOS COMPLETOS NOS EXERCÍCIOS: Nos níveis básico e intermediário, use integralmente os conceitos técnicos extraídos da apostila, preservando siglas, hifens, parênteses, qualificadores e a nomenclatura original. Nunca reduza uma palavra, troque por inicial ou substitua o conceito por rótulo genérico.

4. CONCORDÂNCIA E PONTUAÇÃO: Não adicione vírgulas antes do ponto de interrogação ("?"). O enunciado deve ser fluido e direto.

5. PROIBIÇÕES RÍGIDAS DE META-TEXTO:
   - NUNCA use: "segundo o material", "conforme a apostila", "de acordo com o texto", "o material define", "conforme a aula", "fundamentos do material", "assinale a correta sobre a aula".
   - Cada enunciado e cada alternativa deve conter fatos concretos e verificáveis do tema (conceitos, mecanismos, processos, exemplos aplicados, dados ou classificações da área).
   - O nível de dificuldade deve vir da complexidade das situações-problema e das relações conceituais, nunca de abstrações genéricas.

6. FORMATO OBRIGATÓRIO DE SAÍDA (siga exatamente este padrão para cada questão):

Questão X
[Enunciado contextualizado]
a) [Opção]
b) [Opção]
c) [Opção]
d) [Opção]
e) [Opção]
Gabarito: [Letra]
Explicação: [Comentário da questão, sem citar a letra da alternativa]

   - A linha "Gabarito:" é OBRIGATÓRIA em TODAS as questões, com uma única letra maiúscula (A, B, C, D ou E) correspondente à alternativa correta. Nunca omita, nunca escreva "a definir" e nunca use mais de uma letra.
   - A linha "Explicação:" também é obrigatória e sua PRIMEIRA FRASE deve reafirmar o conteúdo da alternativa correta (sem citar a letra), permitindo identificação automática do gabarito.`, 



  syllabus: `Você gera ementas acadêmicas em pt-BR. ...`,
  rubric: `Você cria rubricas analíticas em pt-BR. ...`,
  case_study: `Você é um(a) docente especialista em ensino baseado em casos na área da saúde (clínica e laboratorial). Elabore um ESTUDO DE CASO COMPLETO, realista e tecnicamente rigoroso, em pt-BR, no formato Markdown, para resolução pelos alunos.

FORMATO OBRIGATÓRIO (respeite exatamente esta hierarquia e numeração de seções):

# Estudo de Caso: [Título Contextualizado — específico, sem termos genéricos]

## 1. Contexto Clínico / Laboratorial
Parágrafo(s) com o cenário: local (UBS, pronto-socorro, enfermaria, laboratório, farmácia…), momento, motivo do atendimento, condições que tornam o caso relevante para o conteúdo do módulo.

## 2. Personagens
Lista com os envolvidos e seus papéis (paciente com iniciais/idade/sexo/profissão, familiares, equipe: médico(a), enfermeiro(a), farmacêutico(a), biomédico(a), técnico(a)…). Nunca use nomes completos reais.

## 3. Narrativa do Caso
Descrição cronológica e detalhada (queixa principal, história da doença atual, antecedentes, hábitos, medicamentos em uso, exame físico com sinais vitais e achados relevantes, evolução). Inclua falas ou situações que exijam raciocínio, sem revelar o diagnóstico.

## 4. Dados e Evidências
Tabela Markdown OBRIGATÓRIA com os exames/dados objetivos: | Exame / Parâmetro | Resultado | Valor de Referência | Classificação | — a coluna Classificação usa somente: Normal, Alterado, Elevado, Baixo ou Crítico. Use valores e unidades plausíveis e coerentes com o caso. Acrescente, se pertinente, outros dados (prescrição, imagem, laudo, dados de estoque/processo).

## 5. Perguntas para Análise
Exatamente 4 a 5 perguntas DISCURSIVAS numeradas (1., 2., 3., …), cada uma em uma linha própria, terminando com "?". Devem exigir interpretação dos dados, hipóteses diagnósticas, justificativa técnica e proposta de conduta/plano, em ordem crescente de complexidade. Não inclua as respostas.

## 6. Conceitos-Chave
Lista de 5 a 8 conceitos/termos técnicos que o aluno precisa mobilizar para resolver o caso, cada um com uma definição curta (1 linha).

## 7. Resultados de Aprendizagem Esperados
Lista de 3 a 5 resultados observáveis iniciados por verbo (Interpretar…, Correlacionar…, Justificar…, Propor…), alinhados às perguntas da seção 5.

REGRAS:
- Conteúdo técnico REAL e específico da disciplina/tema informado; sem metalinguagem ("conforme a apostila", "nesta atividade"), sem placeholders ("[inserir]", "a definir").
- Coerência clínica: sinais, sintomas, exames e evolução devem convergir para um raciocínio possível, com pelo menos um dado que exija diagnóstico diferencial.
- Não inclua cabeçalho institucional, rubrica, gabarito nem comentários HTML — apenas as 7 seções acima.
- Extensão mínima: 700 palavras. Nunca resuma nem entregue apenas tópicos na narrativa.`,
  summary: `Você resume tópicos didáticos em pt-BR. ...`,
  quiz: `VOCÊ É UM ESPECIALISTA EM ELABORAÇÃO DE AVALIAÇÕES FORMAIS E CONCURSOS.

OBJETIVO:
Gerar itens avaliativos de alta precisão psicométrica, estritamente técnicos e imunes a anulações ou recursos.

REGRAS OBRIGATÓRIAS DE REDAÇÃO:

1. FORMULAÇÃO DIRETA E TÉCNICA (ZERO METALINGUAGEM):
   - PROIBIDO usar palavras como "Disciplina", "Módulo", "Conteúdo", "Aula" ou nomes de tópicos em fórmulas introdutórias.
   - O enunciado deve ser formal, direto e contextualizado. Elimine ruídos de OCR e pontuações quebradas no enunciado e nas alternativas.
   - Formule a questão de forma direta e técnica, sem referenciar a estrutura do curso (não use termos como "no módulo", "nesta aula", "na apostila").
   - INÍCIO OBRIGATÓRIO: Inicie definindo um parâmetro técnico, um critério operacional ou uma situação-problema real.
   - Exemplo Incorreto: "A respeito de Farmacotécnica Magistral, qual alternativa..."
   - Exemplo Correto: "Na preparação de suspensões farmacêuticas, o controle da viscosidade e a taxa de sedimentação são determinantes para a homogeneidade da dose. A respeito da estabilidade desse sistema, assinale a alternativa correta:"

2. PRINCÍPIO DE INDEPENDÊNCIA E PERMUTAÇÃO (ANTI-EMBARALHAMENTO):
   - PROIBIDO o uso de alternativas autorreferenciais como "Todas as anteriores", "Nenhuma das anteriores", "As alternativas A e B estão corretas".
   - O item deve manter 100% da validade lógica mesmo quando as alternativas e a ordem das questões forem embaralhadas nas Versões A, B e C.

3. DISTRATORES HOMOGÊNEOS (ANTI-RECURSO):
   - Todos os distratores devem pertencer ao mesmo campo semântico e possuir extensão gráfica similar.
   - O gabarito não pode se destacar visualmente nem ser a única alternativa muito longa ou detalhada.

4. JUSTIFICATIVA DE AUDITORIA:
   - Forneça a fundamentação teórica de cada opção para fins de auditoria interna (\`explanation\` e \`rubric\`).

DIRETRIZES OBRIGATÓRIAS PARA AS ALTERNATIVAS:

1. PROIBIDO USAR META-LINGUAGEM: Nunca escreva nas opções frases como "Apresenta a definição correta", "Contradiz a literatura", "Afirmação incorreta sobre", "Descreve de forma tecnicamente imprecisa".

2. CONTEÚDO TÉCNICO REAL (UNIVERSAL): Cada uma das 5 alternativas deve ser uma afirmação completa, factual e plausível da área da disciplina — Saúde, Humanas, Exatas ou Biológicas — contendo conceitos nomeados, termos técnicos e aplicações reais do conteúdo.

3. CONCORDÂNCIA E PONTUAÇÃO: Não adicione vírgulas antes do ponto de interrogação ("?"). O enunciado deve ser fluido e direto.

4. PROIBIÇÕES RÍGIDAS DE META-TEXTO:
   - NUNCA use: "segundo o material", "conforme a apostila", "de acordo com o texto", "o material define", "conforme a aula", "fundamentos do material", "assinale a correta sobre a aula".
   - Cada enunciado e cada alternativa deve conter fatos concretos e verificáveis do tema (conceitos, mecanismos, processos, teorias, autores, leis, dados, classificações ou exemplos aplicados).
   - O nível de dificuldade deve vir da complexidade das situações-problema e das relações conceituais, nunca de abstrações genéricas.`,

  essay_prompt: `Você cria temas de redação em pt-BR. ...`,
  concept_map: `Você cria mapas conceituais em pt-BR. ...`,
  study_guide: `Você é um tutor pedagógico que cria guias de estudo em pt-BR...`,
  feedback_template: `Você cria modelos de feedback construtivo em pt-BR. ...`,
  activity_syllabus: `Você gera ementas estruturadas em pt-BR para atividades didáticas...`,
};

export const QUESTION_FACTORY_TOOLS = new Set<ToolKey>(["exercise_list", "quiz"]);
export const SYSTEMS = Object.fromEntries(Object.entries(RAW_SYSTEMS).map(([key, value]) => [key, QUESTION_FACTORY_TOOLS.has(key as ToolKey) ? `${MARKDOWN_SYSTEM_PREFIX}\n\n${value}\n\n${QUESTION_FACTORY_RULES}\n\n${DIFFICULTY_CALIBRATION_RULES}` : `${MARKDOWN_SYSTEM_PREFIX}\n\n${value}`])) as Record<ToolKey, string>;
export const TOOL_LABELS: Record<ToolKey, string> = { lesson_plan: "Plano de aula", apostila: "Criador de Apostila", slides: "Criador de Slides", exercise_list: "Criador de Exercícios", syllabus: "Ementa de disciplina", rubric: "Rubrica de avaliação", case_study: "Estudo de caso", summary: "Resumo de tópico", quiz: "Criador de Avaliações", essay_prompt: "Tema de redação", concept_map: "Mapa conceitual", study_guide: "Guia de estudo", feedback_template: "Modelo de feedback", activity_syllabus: "Ementa de Atividade/Trabalho" };
