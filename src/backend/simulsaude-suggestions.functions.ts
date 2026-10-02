import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { callAIText } from "./ai.server";

export const getDynamicCaseSuggestions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data) => z.object({ 
    disciplineId: z.string(),
    selectedLesson: z.string().optional(),
    apostilaIds: z.array(z.string()).optional()
  }).parse(data))
  .handler(async ({ data }) => {
    // 1. Get Discipline Name
    const { data: disc } = await supabaseAdmin
      .from("disciplines")
      .select("name, group_name")
      .eq("id", data.disciplineId)
      .maybeSingle();

    if (!disc) return [];

    // Check if the discipline is pharmaceutical/health-medication related
    const pharmaKeywords = [
      'farmacologia', 'farmácia', 'farmacia', 'medicamento', 'terapêutica', 
      'terapeutica', 'química farmacêutica', 'quimica farmaceutica', 
      'atenção farmacêutica', 'atencao farmaceutica', 'farmácia clínica', 
      'farmacia clinica', 'farmacovigilância', 'farmacovigilancia'
    ];
    const isPharmaDiscipline = pharmaKeywords.some(kw => 
      disc.name.toLowerCase().includes(kw) || 
      (disc.group_name && disc.group_name.toLowerCase().includes(kw))
    );

    let lessonContext = "";
    
    // 2. Fetch specific content from the apostilas/modules if selected
    if (data.apostilaIds && data.apostilaIds.length > 0 && data.selectedLesson) {
      const { data: apostilas } = await supabaseAdmin
        .from("ai_generations")
        .select("id, result")
        .in("id", data.apostilaIds);
        
      if (apostilas && apostilas.length > 0) {
        const selectedLessonsList = data.selectedLesson.split(",").map(s => s.trim());
        let extractedSections = "";

        for (const apostila of apostilas) {
          const content = typeof apostila.result === 'string' ? apostila.result : JSON.stringify(apostila.result);
          
          for (const lessonTitle of selectedLessonsList) {
            const escapedTitle = lessonTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`# ${escapedTitle}(.*?)(?=\\n# |$)`, 's');
            const match = content.match(regex);
            if (match && match[1]) {
              extractedSections += `\nCONTEÚDO DA AULA "${lessonTitle}":\n${match[1].substring(0, 800)}\n`;
            }
          }
        }
        
        if (extractedSections) {
          lessonContext = `\nUse como base técnica os seguintes conteúdos das aulas selecionadas:\n${extractedSections}`;
        }
      }
    }

    // 3. AI Generation
    try {
      let system = `Você é um especialista pedagógico em simulação clínica e educação superior.
A disciplina atual é "${disc.name}" do curso "${disc.group_name || 'Saúde'}".

REGRAS CRÍTICAS:
1. Gere EXATAMENTE 4 sugestões de temas para Casos Clínicos ou Simulações Práticas.
2. FOCO EXCLUSIVO: As sugestões devem ser baseadas APENAS nas aulas selecionadas: "${data.selectedLesson || 'Geral'}".
3. Retorne APENAS a lista simples, uma sugestão por linha, sem introdução, números ou explicações.
4. NÃO use frases genéricas como "Aplicação Prática". Seja específico ao conteúdo.`;

      if (isPharmaDiscipline) {
        system += `\n\nDIRETRIZ DE SAÚDE/FARMÁCIA:
Esta disciplina é da área de medicamentos/saúde. Suas sugestões DEVEM focar em 'Avaliação Medicamento/Paciente'.
Proponha cenários práticos de:
- Avaliação da adequação posológica e segurança para o perfil (idoso, pediátrico, gestante, doente renal/hepático).
- Identificação de Reações Adversas a Medicamentos (RAM) e Farmacovigilância.
- Análise de Interações Medicamentosa (Fármaco-Fármaco, Fármaco-Alimento e Quelação).
- Erros de administração, horários inadequados e falta de adesão.
Os casos gerados a partir desses temas devem permitir o preenchimento total de tabelas de farmacoterapia com princípios ativos e horários.`;
      } else {
        system += `\n5. Se o conteúdo for "Fundamentos/História", os casos devem ser de ética, conceitos ou evolução.
6. Se o conteúdo for técnico/prático, os casos devem envolver cálculos, métodos de preparo ou controle de qualidade.`;
      }

      system += `\n\n${lessonContext}`;

      const response = await callAIText({
        system,
        user: `Gere 4 temas práticos curtos e específicos para as aulas: ${data.selectedLesson || 'Geral'} na disciplina ${disc.name}.`
      });

      const suggestions = response
        .split('\n')
        .map(s => s.replace(/^\d+[\.\)\-]\s*/, '').trim())
        .filter(s => s.length > 5)
        .slice(0, 4);
      
      if (suggestions.length > 0) return suggestions;
    } catch (e) {
      console.error("AI Error for suggestions:", e);
    }

    // 4. Fallback (Improved to be less static)
    const firstLesson = data.selectedLesson?.split(',')[0] || disc.name;
    return [
      `Estudo de Caso sobre ${firstLesson}`,
      `Simulação Prática: ${firstLesson}`,
      `Manejo e Condutas em ${firstLesson}`,
      `Protocolos Aplicados a ${firstLesson}`
    ];
  });