import { createFileRoute } from "@tanstack/react-router";
import {
  StudentOnlineExamRoom,
  type ExamQuestionView,
} from "@/components/assessment/StudentOnlineExamRoom";

/**
 Rota TEMPORÁRIA e puramente demonstrativa. Serve apenas para visualizar o
 esqueleto visual da sala de prova online. Nenhuma rota existente foi alterada.

 Quando a feature estiver madura, esta entrada deve ser removida e substituída
 pela rota definitiva (provavelmente ligada à navegação do aluno autenticado).
 */
export const Route = createFileRoute("/teste-prova")({
  head: () => ({
    meta: [
      { title: "Teste de Prova — EstudaJá Pro" },
      { name: "description", content: "Visualização isolada da sala de prova online (mock)." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: TesteProvaRoute,
});

const MOCK_QUESTIONS: ExamQuestionView[] = [
  {
    id: "q-1",
    number: 1,
    prompt:
      "Em uma reação de combustão completa do metano (CH₄ + 2 O₂ → CO₂ + 2 H₂O), qual é a massa de CO₂ produzida a partir de 16 g de CH₄? (Massas molares: C=12, H=1, O=16)",
    options: [
      { id: "q-1-a", label: "11 g" },
      { id: "q-1-b", label: "22 g" },
      { id: "q-1-c", label: "44 g" },
      { id: "q-1-d", label: "88 g" },
    ],
  },
  {
    id: "q-2",
    number: 2,
    prompt:
      "Sobre o sistema linfático, assinale a alternativa que descreve corretamente a função do baço:",
    options: [
      { id: "q-2-a", label: "Produzir bile para digestão de lipídios." },
      { id: "q-2-b", label: "Filtrar o sangue e remover hemácias envelhecidas." },
      { id: "q-2-c", label: "Secretar insulina em resposta à glicemia." },
      { id: "q-2-d", label: "Armazenar oxigênio para liberação muscular." },
    ],
    selectedOptionId: "q-2-b",
  },
  {
    id: "q-3",
    number: 3,
    prompt:
      "Considere a função f(x) = 3x² − 12x + 7. Qual é o valor mínimo de f(x) e o ponto x em que ele ocorre?",
    options: [
      { id: "q-3-a", label: "f(0) = 7" },
      { id: "q-3-b", label: "f(2) = −5" },
      { id: "q-3-c", label: "f(3) = −2" },
      { id: "q-3-d", label: "f(4) = 7" },
    ],
    flagged: true,
  },
  {
    id: "q-4",
    number: 4,
    prompt:
      "Em relação à divisão celular por meiose, marque a alternativa CORRETA:",
    options: [
      { id: "q-4-a", label: "Produz duas células-filhas idênticas à célula-mãe." },
      { id: "q-4-b", label: "Ocorre somente em células somáticas." },
      { id: "q-4-c", label: "Reduz à metade o número de cromossomos, gerando gametas." },
      { id: "q-4-d", label: "Não apresenta crossing-over na prófase 1." },
    ],
  },
  {
    id: "q-5",
    number: 5,
    prompt:
      "Dissertativa — Explique, com suas palavras, a diferença entre algoritmos de busca em largura (BFS) e busca em profundidade (DFS), citando um caso de uso típico para cada um.",
    options: [],
  },
];

function TesteProvaRoute() {
  return (
    <div className="min-h-screen bg-muted/20">
      <header className="border-b border-border/60 bg-background px-4 py-3 text-sm text-muted-foreground md:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2">
          <span>
            Rota <code className="rounded bg-muted px-1.5 py-0.5">/teste-prova</code>{" "}
            — esqueleto isolado da sala de prova online (mock, sem persistência).
          </span>
          <a
            href="/"
            className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            Voltar
          </a>
        </div>
      </header>

      <StudentOnlineExamRoom
        exam={{
          title: "Simulado de Biologia e Química — 1º Bimestre",
          disciplineName: "Ciências da Natureza",
          durationMinutes: 90,
          totalQuestions: MOCK_QUESTIONS.length,
          instructions:
            "Leia cada questão com atenção. Você pode marcar uma questão para revisão usando o botão próprio no topo da área de leitura. Use o mapa lateral para navegar diretamente.",
        }}
        questions={MOCK_QUESTIONS}
        initialIndex={0}
      />
    </div>
  );
}