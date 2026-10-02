import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Download, Copy, Check, Film, Image as ImageIcon, Presentation, FileText } from "lucide-react";
import { toast } from "sonner";
import institutional from "@/assets/estudaja-institucional.mp4.asset.json";
import promo30s from "@/assets/divulgacao/estudaja-30s.mp4.asset.json";
import capa from "@/assets/divulgacao/01-capa.png.asset.json";
import funcionalidades from "@/assets/divulgacao/02-funcionalidades.png.asset.json";
import planos from "@/assets/divulgacao/03-planos.png.asset.json";
import diferenciais from "@/assets/divulgacao/04-diferenciais.png.asset.json";
import deckPptx from "@/assets/marketing/estudaja-pitch-deck.pptx.asset.json";
import deckPdf from "@/assets/marketing/estudaja-pitch-deck.pdf.asset.json";
import onePager from "@/assets/marketing/estudaja-one-pager.pdf.asset.json";
import deckVideo from "@/assets/marketing/estudaja-pitch-deck-video.mp4.asset.json";

const IMAGES = [
  { title: "Capa / post principal", asset: capa },
  { title: "Funcionalidades", asset: funcionalidades },
  { title: "Planos e uso", asset: planos },
  { title: "Diferenciais", asset: diferenciais },
];

const VIDEOS = [
  {
    title: "Vídeo institucional (60s)",
    description: "Apresenta os Assistentes de IA e a interface de cada Criador. Ideal para site e reuniões.",
    asset: institutional,
  },
  {
    title: "Vídeo curto de divulgação (30s)",
    description: "Formato vertical para stories, Reels e TikTok.",
    asset: promo30s,
  },
  {
    title: "Apresentação institucional em vídeo (39s)",
    description:
      "O pitch deck completo em vídeo, com transições e trilha sonora. Para enviar a escolas e parceiros.",
    asset: deckVideo,
  },
];

const TEXTS: { title: string; body: string }[] = [
  {
    title: "Instagram / Facebook — post institucional",
    body: `Planejar aula não precisa consumir seu fim de semana. 📚

O EstudaJá Pro reúne, num só lugar, os Criadores com IA que o professor usa todo dia:
• Plano de aula a partir da ementa
• Apostila didática completa
• Slides prontos para projetar (PPTX e PDF)
• Atividades e trabalhos acadêmicos
• Listas de exercícios com gabarito
• Avaliações com correção por câmera (OMR)

Diário digital, frequência por QR Code, notas e feedback pedagógico integrados.

Conheça: estudaja.com
#EstudaJa #ProfessorDigital #EducacaoComIA #PlanoDeAula`,
  },
  {
    title: "LinkedIn — institucional",
    body: `Quanto tempo a sua escola perde com tarefas que poderiam ser automatizadas?

O EstudaJá Pro é uma plataforma acadêmica integrada para o ensino médio e superior. Ela une, em um único fluxo: planejamento de aula, produção de material didático, atividades, avaliações com correção automática por leitura de câmera, diário digital, frequência por QR Code e acompanhamento pedagógico por evidências.

O resultado é simples: o professor volta a investir tempo no que importa — a aprendizagem — e a coordenação passa a ter dados reais para decidir.

Vamos conversar sobre como aplicar isso na sua instituição: estudaja.com`,
  },
  {
    title: "Story / Reels — roteiro curto",
    body: `[0-3s] "Plano de aula em 2 minutos?"
[3-8s] Mostra a ementa sendo colada no Criador de Plano de Aula.
[8-15s] Plano gerado → apostila → slides prontos.
[15-22s] Avaliação impressa sendo corrigida pela câmera do celular.
[22-30s] "EstudaJá Pro — do planejamento à nota. estudaja.com"`,
  },
  {
    title: "E-mail marketing — professores",
    body: `Assunto: Seu plano de aula, apostila e slides prontos hoje ainda

Olá, professor(a),

O EstudaJá Pro transforma a sua ementa em plano de aula, apostila, slides, lista de exercícios e avaliação — com correção automática e nota lançada direto no diário digital.

O que você ganha:
• Menos tempo em tarefas repetitivas
• Material padronizado com a identidade da sua instituição
• Frequência por QR Code, inclusive offline
• Feedback pedagógico individual para cada aluno

Crie sua conta em estudaja.com e teste os Criadores hoje mesmo.

Equipe EstudaJá`,
  },
  {
    title: "Descrição para loja de aplicativos",
    body: `EstudaJá Pro — plataforma acadêmica integrada para o ensino médio e superior.

Planeje, produza e avalie em um só lugar: plano de aula, apostilas, slides, atividades, exercícios e avaliações gerados com inteligência artificial a partir da sua ementa. Registre frequência por QR Code (com suporte offline), lance notas com médias automáticas, envie feedback pedagógico e acompanhe o desempenho de cada turma.

Para alunos: materiais, atividades, exercícios com tentativas, notas, frequência e comunicação direta com o professor.`,
  },
];

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          toast.success("Texto copiado");
          setTimeout(() => setDone(false), 2000);
        } catch {
          toast.error("Não foi possível copiar automaticamente");
        }
      }}
    >
      {done ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
      Copiar
    </Button>
  );
}

export function MarketingTab() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Materiais prontos para divulgar o EstudaJá Pro com professores, escolas e parceiros.
        Baixe os arquivos ou copie os textos e publique.
      </p>

      <Card className="border-0" style={{ boxShadow: "var(--shadow-card)" }}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Presentation className="h-4 w-4" /> Documentos institucionais
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border p-4 space-y-2">
            <div className="font-medium text-sm">Apresentação institucional (9 slides)</div>
            <p className="text-xs text-muted-foreground">
              Pitch deck para reuniões com escolas, coordenações e parceiros: problema, solução,
              Criadores com IA, gestão acadêmica, perfis de uso e passos de adoção.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button asChild size="sm" variant="outline">
                <a href={deckPptx.url} download={deckPptx.original_filename}>
                  <Download className="h-3.5 w-3.5 mr-1" /> Baixar PPTX
                </a>
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href={deckPdf.url} download={deckPdf.original_filename}>
                  <Download className="h-3.5 w-3.5 mr-1" /> Baixar PDF
                </a>
              </Button>
            </div>
          </div>
          <div className="rounded-lg border p-4 space-y-2">
            <div className="font-medium text-sm flex items-center gap-2">
              <FileText className="h-4 w-4" /> One-pager / folder digital
            </div>
            <p className="text-xs text-muted-foreground">
              Resumo visual de uma página com benefícios, funcionalidades, perfis de uso e chamada
              para demonstração. Ideal para enviar por e-mail ou WhatsApp.
            </p>
            <div className="pt-1">
              <Button asChild size="sm" variant="outline">
                <a href={onePager.url} download={onePager.original_filename}>
                  <Download className="h-3.5 w-3.5 mr-1" /> Baixar PDF
                </a>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0" style={{ boxShadow: "var(--shadow-card)" }}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Film className="h-4 w-4" /> Vídeos
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {VIDEOS.map((v) => (
            <div key={v.title} className="rounded-lg border p-3 space-y-2">
              <video src={v.asset.url} controls playsInline className="w-full rounded-md bg-black" />
              <div className="font-medium text-sm">{v.title}</div>
              <p className="text-xs text-muted-foreground">{v.description}</p>
              <Button asChild size="sm" variant="outline">
                <a href={v.asset.url} download={v.asset.original_filename}>
                  <Download className="h-3.5 w-3.5 mr-1" /> Baixar MP4
                </a>
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-0" style={{ boxShadow: "var(--shadow-card)" }}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ImageIcon className="h-4 w-4" /> Imagens para redes sociais
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {IMAGES.map((img) => (
            <div key={img.title} className="rounded-lg border p-2 space-y-2">
              <img
                src={img.asset.url}
                alt={img.title}
                loading="lazy"
                className="w-full rounded-md object-cover"
              />
              <div className="text-xs font-medium">{img.title}</div>
              <Button asChild size="sm" variant="outline" className="w-full">
                <a href={img.asset.url} download={img.asset.original_filename}>
                  <Download className="h-3.5 w-3.5 mr-1" /> Baixar
                </a>
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-0" style={{ boxShadow: "var(--shadow-card)" }}>
        <CardHeader>
          <CardTitle className="text-base">Textos prontos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {TEXTS.map((t) => (
            <div key={t.title} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{t.title}</div>
                <CopyButton text={t.body} />
              </div>
              <Textarea readOnly value={t.body} className="min-h-32 text-xs font-mono" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}