import { useState } from "react";
import { HelpCircle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useAuth } from "@/lib/auth-context";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { toast } from "sonner";

type Section = { title: string; body: string };

const TEACHER_SECTIONS: Section[] = [
  {
    title: "Visão geral e navegação",
    body:
      "Ao entrar como professor, você acessa o painel com suas disciplinas. Clique em uma disciplina para abrir seus módulos (Alunos, Chat, Frequência, Assistente IA, Materiais, Exercícios, Atividades, Trabalhos Acadêmicos, Avaliações, Rubricas, Notas, Calendário). Use o cabeçalho para acessar Identidade Visual, Notificações e Sair.",
  },
  {
    title: "Alunos e matrículas",
    body:
      "No módulo Alunos você lista, importa por CSV e matricula estudantes. Você pode gerar convites (menu Convites) para inscrever alunos de forma controlada.",
  },
  {
    title: "Frequência e Justificativas",
    body:
      "Abra Frequência para criar uma sessão de chamada. É gerado um QR Code e um código temporário; o aluno confirma presença pelo aplicativo. Justificativas podem ser aprovadas ou recusadas no mesmo módulo. Sessões antigas podem ser excluídas — o sistema pede confirmação antes de remover os registros.",
  },
  {
    title: "Assistente IA (criador único)",
    body:
      "No Assistente IA você gera: Plano de Aula, Apostila, Slides, Exercícios, Avaliações, Atividades Extras e Trabalhos Acadêmicos. Cada gerador puxa contexto do plano de aula/apostila para manter coerência. Os itens ficam publicados na disciplina e visíveis aos alunos.",
  },
  {
    title: "Materiais (Plano, Apostilas, Aulas)",
    body:
      "Os materiais são organizados em subpastas coloridas. Ao criar/editar um material você pode definir Data e Hora da aula; o sistema publica automaticamente no Calendário da disciplina.",
  },
  {
    title: "Exercícios",
    body:
      "Defina o valor total da nota e a quantidade de questões por dificuldade. O aluno tem até 5 tentativas, com embaralhamento de questões e alternativas. Você pode editar, publicar ou excluir cada lista.",
  },
  {
    title: "Atividades Extras e Trabalhos Acadêmicos",
    body:
      "Crie atividades (estudo de caso, seminário, redação, aula prática, etc.) e trabalhos acadêmicos (TCC, artigo, projeto). Configure prazo, rubrica, coluna de lançamento no diário e (para trabalhos) tamanho máximo do grupo. O grupo é encerrado 7 dias antes da entrega. Você pode anexar um PDF/Word com instruções quando não quiser gerar ementa com IA.",
  },
  {
    title: "Correção de submissões",
    body:
      "Ao abrir uma submissão, a IA gera um rascunho de feedback e pontua a rubrica; você revisa, ajusta e publica. A pré-visualização Markdown mostra como o aluno verá o feedback. Ao publicar, a nota vai automaticamente para a coluna do diário configurada na atividade.",
  },
  {
    title: "Avaliações (provas com IA e QR)",
    body:
      "Crie provas em Regular, Segunda Chamada ou Recuperação. Você define modalidades por tipo de questão (múltipla escolha, V/F, preenchimento, dissertativa) com distribuição por dificuldade. O sistema gera versões embaralhadas e um cartão-resposta com QR para correção automática (OMR). Cada versão tem seu gabarito próprio.",
  },
  {
    title: "Rubricas e Notas",
    body:
      "Em Rubricas você mantém uma biblioteca de critérios. Em Notas você define a estrutura do diário (com subcolunas se quiser), fórmula e média para aprovação, e exporta o boletim em CSV com 2 casas decimais.",
  },
  {
    title: "Calendário",
    body:
      "Cada mês tem uma cor. Eventos são criados automaticamente pelas atividades, trabalhos, exercícios e aulas com data. Você pode editar título, descrição, data e hora — a alteração se reflete nos módulos de origem.",
  },
  {
    title: "Seleção múltipla e exclusão em massa",
    body:
      "Em Materiais, Exercícios, Atividades e Trabalhos você pode selecionar vários itens ao mesmo tempo e usar a barra flutuante para excluir em lote.",
  },
];

const STUDENT_SECTIONS: Section[] = [
  {
    title: "Como acessar",
    body:
      "Entre com sua matrícula e senha. Na página inicial você vê suas disciplinas, atividades pendentes, trabalhos, exercícios e sua frequência por disciplina. É possível instalar o aplicativo (PWA) pelo botão 'Instalar app' para usar offline.",
  },
  {
    title: "Materiais",
    body:
      "Os materiais ficam organizados em subpastas coloridas: Plano de Aula, Apostilas e Aulas. Você pode abrir online ou baixar o arquivo do material.",
  },
  {
    title: "Chat da turma",
    body:
      "Use o Chat para conversar com o professor e a turma. As mensagens ficam disponíveis para todos os matriculados na disciplina.",
  },
  {
    title: "Frequência e Justificativas (inclusive offline)",
    body:
      "Para registrar presença, escaneie o QR Code exibido pelo professor ou digite o código da sessão. Sem internet, o registro fica na fila local e é enviado assim que a conexão voltar. Faltas podem ser justificadas anexando comprovante — o professor aprova ou recusa.",
  },
  {
    title: "Exercícios",
    body:
      "Você tem até 5 tentativas por exercício. A cada tentativa as questões e alternativas são embaralhadas. A pontuação é distribuída automaticamente entre as questões.",
  },
  {
    title: "Atividades e Trabalhos Acadêmicos",
    body:
      "Para trabalhos em grupo, use o botão 'Meu grupo' para criar ou entrar em um grupo até 7 dias antes da entrega. O botão 'Enviar trabalho' aparece somente para o líder e serve para anexar o PDF final. Estudos de caso e demais atividades individuais são enviados no próprio módulo.",
  },
  {
    title: "Meu Diário",
    body:
      "Anotações pessoais por disciplina. Use para registrar aprendizados, dúvidas e reflexões durante o curso. Você pode baixar em DOCX ou PDF.",
  },
  {
    title: "Avaliações",
    body:
      "O módulo Avaliações reúne todas as provas já corrigidas e lançadas pelo(a) professor(a). Quando a nota é publicada no diário, ela vai automaticamente para o módulo Notas e a prova aparece aqui com o placar (por exemplo, 8,50 de 10,00), a data de lançamento e o módulo/aula de origem. Toque em 'Ver gabarito' para abrir o detalhamento: comentário geral do(a) professor(a), suas respostas lado a lado com o gabarito oficial, indicador visual de acerto/erro por questão (múltipla escolha, verdadeiro/falso, lacunas e dissertativa), pontuação obtida em cada item e o feedback específico quando houver. Para provas impressas com QR Code, preencha o cartão-resposta conforme instrução do(a) professor(a) — a correção objetiva é feita automaticamente e o resultado só aparece neste módulo após a liberação.",
  },
  {
    title: "Notas e Calendário",
    body:
      "Em Notas você acompanha suas médias e o composto do diário com 2 casas decimais. O Calendário mostra prazos, aulas e avaliações organizados por mês em blocos coloridos.",
  },
  {
    title: "Feedback das correções",
    body:
      "Quando o professor publica a correção, você recebe uma notificação com o feedback formatado e a pontuação de cada critério da rubrica.",
  },
];

export function HelpManualButton() {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  if (!profile) return null;

  const isStudent = profile.profile_type === "student";
  const defaultTab = isStudent ? "student" : "teacher";

  const handleDownloadPdf = async () => {
    try {
      setDownloading(true);
      const audience: "student" | "teacher" = isStudent ? "student" : "teacher";
      const sections = audience === "student" ? STUDENT_SECTIONS : TEACHER_SECTIONS;
      const title =
        audience === "student"
          ? "Manual do Aluno — EstudaJá Pro"
          : "Manual do Professor — EstudaJá Pro";

      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

      const pageWidth = 595.28; // A4
      const pageHeight = 841.89;
      const marginX = 56;
      const marginY = 64;
      const maxWidth = pageWidth - marginX * 2;

      let page = pdf.addPage([pageWidth, pageHeight]);
      let y = pageHeight - marginY;

      const wrap = (text: string, f: typeof font, size: number) => {
        const words = text.split(/\s+/);
        const lines: string[] = [];
        let current = "";
        for (const w of words) {
          const test = current ? current + " " + w : w;
          if (f.widthOfTextAtSize(test, size) > maxWidth) {
            if (current) lines.push(current);
            current = w;
          } else {
            current = test;
          }
        }
        if (current) lines.push(current);
        return lines;
      };

      const ensureSpace = (needed: number) => {
        if (y - needed < marginY) {
          page = pdf.addPage([pageWidth, pageHeight]);
          y = pageHeight - marginY;
        }
      };

      const draw = (text: string, f: typeof font, size: number, gap = 4, color = rgb(0, 0, 0)) => {
        for (const line of wrap(text, f, size)) {
          ensureSpace(size + gap);
          page.drawText(line, { x: marginX, y: y - size, size, font: f, color });
          y -= size + gap;
        }
      };

      // Title
      draw(title, fontBold, 20, 8, rgb(0.11, 0.31, 0.55));
      draw(
        new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }),
        font,
        10,
        16,
        rgb(0.4, 0.4, 0.4),
      );

      sections.forEach((s, i) => {
        y -= 6;
        draw(`${i + 1}. ${s.title}`, fontBold, 13, 6, rgb(0.11, 0.31, 0.55));
        draw(s.body, font, 11, 4);
        y -= 6;
      });

      const bytes = await pdf.save();
      const ab = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(ab).set(bytes);
      const blob = new Blob([ab], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        audience === "student" ? "manual-aluno-estudaja.pdf" : "manual-professor-estudaja.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      toast.error("Não foi possível gerar o PDF do manual.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-white hover:bg-white/15 hover:text-white gap-1"
        onClick={() => setOpen(true)}
        aria-label="Manual de uso"
        title="Manual de uso"
      >
        <HelpCircle className="h-4 w-4" />
        <span className="hidden md:inline">Manual</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Manual de uso da plataforma</DialogTitle>
            <DialogDescription>
              Guia rápido e didático das ferramentas do EstudaJá Pro.
            </DialogDescription>
          </DialogHeader>

          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={handleDownloadPdf} disabled={downloading}>
              <Download className="h-4 w-4 mr-2" />
              {downloading ? "Gerando PDF..." : "Baixar manual em PDF"}
            </Button>
          </div>

          <Tabs defaultValue={defaultTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="student" disabled={!isStudent && profile.profile_type !== "admin"}>
                Para alunos
              </TabsTrigger>
              <TabsTrigger value="teacher" disabled={isStudent}>
                Para professores
              </TabsTrigger>
            </TabsList>

            <TabsContent value="student">
              <ScrollArea className="h-[60vh] pr-3">
                <Accordion type="single" collapsible className="w-full">
                  {STUDENT_SECTIONS.map((s, i) => (
                    <AccordionItem key={s.title} value={`s-${i}`}>
                      <AccordionTrigger className="text-left">{s.title}</AccordionTrigger>
                      <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                        {s.body}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="teacher">
              <ScrollArea className="h-[60vh] pr-3">
                <Accordion type="single" collapsible className="w-full">
                  {TEACHER_SECTIONS.map((s, i) => (
                    <AccordionItem key={s.title} value={`t-${i}`}>
                      <AccordionTrigger className="text-left">{s.title}</AccordionTrigger>
                      <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                        {s.body}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}