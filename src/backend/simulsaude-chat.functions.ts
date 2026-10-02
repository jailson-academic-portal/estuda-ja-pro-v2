import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callAIText } from "./ai.server";

export const chatWithPatient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        caseId: z.string().uuid(),
        message: z.string().min(1),
        history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })),
        caseContext: z.any(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { patient_info, investigation_data, title, description } = data.caseContext;
    
    const historyText = data.history.map(m => `${m.role === 'user' ? 'Aluno' : 'Paciente'}: ${m.content}`).join('\n');

    const system = `Você está simulando o seguinte paciente em um chat:
Nome: ${patient_info?.name || "Desconhecido"}
Idade: ${patient_info?.age || "-"}
Sexo: ${patient_info?.sex || "-"}
Ocupação: ${patient_info?.occupation || "-"}
Queixa Principal: ${patient_info?.chief_complaint || title}
Resumo do Caso: ${description}
Anamnese: ${patient_info?.anamnesis}
Histórico: ${patient_info?.history}

Sinais Vitais: ${JSON.stringify(patient_info?.vital_signs || [])}
Exames: ${JSON.stringify(investigation_data?.lab_exams || [])}

REGRAS DE SIMULAÇÃO:
1. Responda como o PACIENTE, em primeira pessoa.
2. Use linguagem leiga condizente com o perfil (idade/ocupação).
3. Não dê diagnósticos nem use termos técnicos médicos avançados, a menos que o paciente os conheça de seu histórico.
4. Se perguntado sobre algo que não está no prontuário, invente detalhes realistas e coerentes com a queixa.
5. Seja conciso mas natural.
6. Mantenha a personalidade descrita no caso.
7. Responda APENAS como o paciente, sem prefixos.`;

    return callAIText({
      system,
      user: `Histórico da conversa:\n${historyText}\n\nAluno: ${data.message}\n\nPaciente:`,
    });
  });
