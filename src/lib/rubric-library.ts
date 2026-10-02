export type RubricCriterion = {
  id: string;
  name: string;
  description?: string;
  weight: number;
  max_score: number;
};

export type RubricTemplate = {
  key: string;
  name: string;
  criteria: Omit<RubricCriterion, "id">[];
};

const c = (name: string, description: string): Omit<RubricCriterion, "id"> => ({
  name,
  description,
  weight: 0,
  max_score: 10,
});

/** Equal weights summing to 100 */
function eq(items: Omit<RubricCriterion, "id">[]): Omit<RubricCriterion, "id">[] {
  const w = Math.round((100 / items.length) * 100) / 100;
  const out = items.map((it) => ({ ...it, weight: w }));
  // adjust last to make sum exactly 100
  const sum = out.reduce((s, x) => s + x.weight, 0);
  out[out.length - 1].weight = Math.round((out[out.length - 1].weight + (100 - sum)) * 100) / 100;
  return out;
}

/** Activity subtypes (Atividades Extras) */
export const ACTIVITY_RUBRICS: Record<string, RubricTemplate> = {
  redacao: {
    key: "redacao",
    name: "Rubrica sugerida para Redação",
    criteria: eq([
      c("Coerência e Coesão", "Organização lógica das ideias, conexão entre parágrafos e progressão temática."),
      c("Argumentação", "Defesa de ponto de vista, uso de argumentos sólidos e contra-argumentação."),
      c("Domínio da Norma Culta", "Correção gramatical, ortográfica, pontuação, concordância e regência."),
      c("Originalidade e Criatividade", "Abordagem inovadora, riqueza de vocabulário e estilo próprio."),
      c("Atendimento ao Tema", "Compreensão e desenvolvimento do tema sem fuga."),
    ]),
  },
  seminario: {
    key: "seminario",
    name: "Rubrica sugerida para Seminários",
    criteria: eq([
      c("Conteúdo", "Abrangência, profundidade e relevância das informações."),
      c("Apresentação", "Domínio do assunto, fluência, postura e gestão do tempo."),
      c("Interação", "Capacidade de responder perguntas e engajar a plateia."),
      c("Originalidade/Criatividade", "Abordagem inovadora e exemplos pertinentes."),
    ]),
  },
  debate: {
    key: "debate",
    name: "Rubrica sugerida para Debates",
    criteria: eq([
      c("Argumentação", "Coerência, solidez dos argumentos e refutação eficaz."),
      c("Comunicação", "Clareza, fluência verbal, escuta ativa e respeito às regras."),
      c("Conhecimento do Tema", "Demonstração de compreensão aprofundada."),
      c("Postura", "Respeito aos colegas, ética e controle emocional."),
    ]),
  },
  visita_tecnica: {
    key: "visita_tecnica",
    name: "Rubrica sugerida para Visitas Técnicas",
    criteria: eq([
      c("Preparação", "Pesquisa prévia e elaboração de perguntas relevantes."),
      c("Participação", "Engajamento, observação atenta e interação."),
      c("Relatório/Análise", "Síntese das informações e reflexões críticas."),
      c("Comportamento", "Pontualidade, respeito às normas e postura profissional."),
    ]),
  },
  case_study: {
    key: "case_study",
    name: "Rubrica sugerida para Estudos de Caso",
    criteria: eq([
      c("Análise do Caso", "Identificação dos problemas, dados e contexto."),
      c("Proposição de Soluções", "Soluções viáveis, criativas e justificadas."),
      c("Fundamentação Teórica", "Relação com conceitos e teorias da área."),
      c("Estrutura e Clareza", "Organização lógica e clareza na escrita."),
    ]),
  },
  aula_pratica: {
    key: "aula_pratica",
    name: "Rubrica sugerida para Aulas Práticas",
    criteria: eq([
      c("Execução", "Habilidade nos procedimentos, uso correto de equipamentos e segurança."),
      c("Compreensão", "Entendimento dos princípios teóricos e interpretação de resultados."),
      c("Registro/Relatório", "Organização e clareza no registro dos dados."),
      c("Colaboração", "Trabalho em equipe e divisão de tarefas."),
    ]),
  },
  workshop: {
    key: "workshop",
    name: "Rubrica sugerida para Workshops",
    criteria: eq([
      c("Participação Ativa", "Engajamento e contribuição com ideias."),
      c("Aprendizado", "Aquisição de novas habilidades ou conhecimentos."),
      c("Aplicação", "Capacidade de aplicar conceitos aprendidos."),
      c("Colaboração", "Interação construtiva com participantes."),
    ]),
  },
  // Legacy (mantidos por compatibilidade):
  care_plan: {
    key: "care_plan",
    name: "Rubrica sugerida para Plano de Cuidados",
    criteria: eq([
      c("Avaliação", "Coleta de dados e identificação de necessidades."),
      c("Diagnóstico", "Identificação dos problemas com fundamentação."),
      c("Planejamento", "Definição de metas e intervenções adequadas."),
      c("Avaliação dos Resultados", "Monitoramento e ajuste do plano."),
    ]),
  },
  pharmaceutical_plan: {
    key: "pharmaceutical_plan",
    name: "Rubrica sugerida para Plano Farmacêutico",
    criteria: eq([
      c("Análise Farmacoterapêutica", "Identificação de problemas relacionados à farmacoterapia."),
      c("Plano de Cuidado", "Intervenções farmacêuticas adequadas."),
      c("Educação ao Paciente", "Orientações claras e personalizadas."),
      c("Monitoramento", "Acompanhamento dos resultados clínicos."),
    ]),
  },
  practical_report: {
    key: "practical_report",
    name: "Rubrica sugerida para Relatório Prático",
    criteria: eq([
      c("Introdução", "Contextualização e objetivos."),
      c("Metodologia", "Descrição clara dos procedimentos."),
      c("Resultados", "Apresentação objetiva dos dados."),
      c("Discussão e Conclusão", "Análise crítica e síntese."),
    ]),
  },
  free_activity: {
    key: "free_activity",
    name: "Rubrica genérica para Atividade Livre",
    criteria: eq([
      c("Conteúdo", "Pertinência e profundidade."),
      c("Estrutura", "Organização e clareza."),
      c("Originalidade", "Criatividade e contribuição própria."),
    ]),
  },
};

/** Academic work subtypes (Trabalhos Acadêmicos) */
export const WORK_RUBRICS: Record<string, RubricTemplate> = {
  tcc: {
    key: "tcc",
    name: "Rubrica sugerida para TCC",
    criteria: eq([
      c("Relevância do Tema", "Importância e contribuição para a área."),
      c("Metodologia", "Adequação e rigor metodológico."),
      c("Análise e Discussão", "Profundidade na análise dos dados."),
      c("Fundamentação Teórica", "Consistência da revisão de literatura."),
      c("Estrutura e Linguagem", "Organização, clareza e correção gramatical."),
      c("Originalidade/Inovação", "Contribuição original ou diferenciada."),
    ]),
  },
  artigo_cientifico: {
    key: "artigo_cientifico",
    name: "Rubrica sugerida para Artigo Científico",
    criteria: eq([
      c("Relevância e Originalidade", "Importância do tema e ineditismo."),
      c("Metodologia", "Clareza, rigor e adequação."),
      c("Resultados", "Apresentação clara e objetiva."),
      c("Discussão", "Interpretação crítica e implicações."),
      c("Conclusão", "Síntese, resposta aos objetivos e perspectivas."),
      c("Linguagem e Formatação", "Clareza, concisão e adequação às normas."),
    ]),
  },
  revisao_literatura: {
    key: "revisao_literatura",
    name: "Rubrica sugerida para Revisão de Literatura",
    criteria: eq([
      c("Abrangência da Busca", "Rigor na seleção das fontes."),
      c("Análise Crítica", "Síntese e identificação de lacunas."),
      c("Organização e Coerência", "Estrutura lógica e fluidez."),
      c("Clareza e Linguagem", "Correção gramatical e termos técnicos."),
      c("Contribuição", "Tendências, síntese e novas perspectivas."),
    ]),
  },
  estudo_caso_academico: {
    key: "estudo_caso_academico",
    name: "Rubrica sugerida para Estudo de Caso (Acadêmico)",
    criteria: eq([
      c("Descrição do Caso", "Clareza e contextualização."),
      c("Análise e Diagnóstico", "Identificação de problemas, causas e consequências."),
      c("Proposição de Intervenções/Soluções", "Propostas fundamentadas e viáveis."),
      c("Fundamentação Teórica", "Relação com a teoria."),
      c("Estrutura e Linguagem", "Organização e correção gramatical."),
    ]),
  },
  projeto_intervencao: {
    key: "projeto_intervencao",
    name: "Rubrica sugerida para Projeto de Intervenção",
    criteria: eq([
      c("Diagnóstico", "Análise da situação-problema e público-alvo."),
      c("Objetivos", "Clareza e pertinência."),
      c("Metodologia", "Detalhamento das ações, cronograma e recursos."),
      c("Resultados Esperados", "Previsão de impactos e benefícios."),
      c("Viabilidade", "Exequibilidade do projeto."),
      c("Avaliação", "Indicadores e métodos de avaliação."),
    ]),
  },
  relatorio_pesquisa: {
    key: "relatorio_pesquisa",
    name: "Rubrica sugerida para Relatório de Pesquisa",
    criteria: eq([
      c("Introdução", "Contextualização, objetivos e justificativa."),
      c("Metodologia", "Descrição clara dos procedimentos."),
      c("Resultados", "Apresentação objetiva dos dados."),
      c("Discussão", "Interpretação dos resultados."),
      c("Conclusão", "Síntese e resposta aos objetivos."),
      c("Estrutura e Linguagem", "Organização, clareza e formatação."),
    ]),
  },
  resumo_expandido: {
    key: "resumo_expandido",
    name: "Rubrica sugerida para Resumo Expandido",
    criteria: eq([
      c("Clareza e Concisão", "Síntese das informações essenciais."),
      c("Estrutura", "Introdução, metodologia, resultados, discussão e conclusão."),
      c("Relevância", "Destaque dos pontos mais importantes."),
      c("Linguagem", "Correção gramatical e termos técnicos."),
    ]),
  },
  poster_cientifico: {
    key: "poster_cientifico",
    name: "Rubrica sugerida para Pôster Científico",
    criteria: eq([
      c("Clareza Visual", "Organização e uso de recursos visuais."),
      c("Conteúdo", "Síntese dos principais pontos."),
      c("Impacto", "Atrair atenção e transmitir mensagem rapidamente."),
      c("Linguagem", "Concisão e correção gramatical."),
      c("Apresentação Oral", "Domínio do conteúdo e clareza nas respostas."),
    ]),
  },
  tema_predefinido: {
    key: "tema_predefinido",
    name: "Rubrica sugerida para Trabalho com Tema Pré-definido",
    criteria: eq([
      c("Compreensão do Tema", "Entendimento aprofundado do assunto."),
      c("Desenvolvimento", "Abordagem completa e coerente."),
      c("Fundamentação", "Uso de referências pertinentes e atualizadas."),
      c("Estrutura e Linguagem", "Organização, clareza e correção gramatical."),
      c("Originalidade/Análise Crítica", "Reflexões próprias além da reprodução."),
    ]),
  },
};

export const ACTIVITY_SUBTYPE_LABELS: Record<string, string> = {
  redacao: "Redação",
  seminario: "Seminário",
  debate: "Debate",
  visita_tecnica: "Visita técnica",
  case_study: "Estudo de caso",
  aula_pratica: "Aula prática",
  workshop: "Workshop",
  care_plan: "Plano de cuidados",
  pharmaceutical_plan: "Plano farmacêutico",
  practical_report: "Relatório prático",
  free_activity: "Atividade livre",
};

export const WORK_SUBTYPE_LABELS: Record<string, string> = {
  tcc: "Trabalho de Conclusão de Curso (TCC)",
  artigo_cientifico: "Artigo Científico",
  revisao_literatura: "Revisão de Literatura",
  estudo_caso_academico: "Estudo de Caso",
  projeto_intervencao: "Projeto de Intervenção",
  relatorio_pesquisa: "Relatório de Pesquisa",
  resumo_expandido: "Resumo Expandido",
  poster_cientifico: "Pôster Científico",
  tema_predefinido: "Tema Pré-definido pelo Professor",
};

export function templateToRubric(t: RubricTemplate) {
  return t.criteria.map((cr) => ({
    id: crypto.randomUUID(),
    name: cr.name,
    description: cr.description,
    weight: cr.weight,
    max_score: cr.max_score,
  }));
}
