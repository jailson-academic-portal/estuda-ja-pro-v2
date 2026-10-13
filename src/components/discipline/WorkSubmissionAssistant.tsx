import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  FileDown,
  GraduationCap,
  Info,
  Loader2,
  Send,
  Users,
  Upload,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { exportWorkCoverPDF, submitAcademicWork } from "@/backend/works.functions";
import { getDisciplineHeader } from "@/backend/disciplines.functions";
import { toast } from "sonner";
import { formatBRDate } from "@/lib/utils";
import {
  WorkTutorPanel,
  type TutorSection,
} from "@/components/discipline/WorkTutorPanel";

interface WorkLike {
  id: string;
  title: string;
  instructions?: string | null;
  subtype?: string | null;
  due_at?: string | null;
  delivery_type?: string | null;
}

interface WorkSubmissionAssistantProps {
  work: WorkLike;
  disciplineId: string;
  onClose: () => void;
  onDone: () => void;
}

interface CoverFields {
  institution: string;
  course: string;
  discipline: string;
  teacher: string;
  author: string;
  theme: string;
  city: string;
  year: string;
}

const TOTAL_STEPS = 7;

/** Correlaciona a aba ativa (0-6) à seção enviada ao Tutor IA. */
const SECTION_BY_STEP: TutorSection[] = [
  "capa",
  "resumo",
  "introducao",
  "desenvolvimento",
  "metodologia",
  "consideracoes",
  "finalizar",
];

const FILL_ERROR =
  "Por favor, preencha todos os campos da atividade/resposta antes de solicitar a análise da IA.";

const STEPS: Array<{ label: string; title: string; guide: string }> = [
  {
    label: "1. Capa",
    title: "Etapa 1 — Capa e identificação (ABNT NBR 14724)",
    guide:
      "Preencha os dados de identificação do trabalho. A capa deve conter: nome da instituição, curso, nome completo do(s) autor(es), título do trabalho (tema), cidade e ano.\n\nO campo Autor já foi preenchido automaticamente com o nome do usuário logado ou com os integrantes do grupo — revise e ajuste se necessário. Use fonte Arial ou Times New Roman 12, textos centralizados e o título em negrito.",
  },
  {
    label: "2. Resumo",
    title: "Etapa 2 — Resumo e palavras-chave",
    guide:
      "Escreva um resumo de 150 a 500 palavras, em parágrafo único e sem tópicos, contendo: tema, objetivo, metodologia, resultados principais e conclusão. Em seguida informe de 3 a 5 palavras-chave separadas por ponto e vírgula.\n\nO resumo não deve conter citações, tabelas ou abreviações não explicadas.",
  },
  {
    label: "3. Introdução",
    title: "Etapa 3 — Introdução",
    guide:
      "Apresente o tema, contextualize o problema, delimite a pergunta de pesquisa, defina os objetivos (geral e específicos) e justifique a relevância acadêmica e profissional do trabalho. Extensão sugerida: 2 a 3 páginas.\n\nToda ideia retirada de outro autor precisa de citação no formato autor-data, por exemplo (SOBRENOME, ano).",
  },
  {
    label: "4. Desenvolvimento",
    title: "Etapa 4 — Desenvolvimento / Revisão de Literatura",
    guide:
      "Desenvolva a fundamentação teórica com autores que sustentam o trabalho. Organize em subtítulos coerentes, relacione os estudos entre si (compare, contraste e aponte convergências) e aprofunde a análise crítica em vez de apenas descrever.\n\nCitações diretas de até 3 linhas ficam entre aspas; acima disso, use bloco recuado de 4 cm, fonte 10 e espaçamento simples.",
  },
  {
    label: "5. Metodologia",
    title: "Etapa 5 — Metodologia",
    guide:
      "Descreva como o trabalho foi realizado: tipo de pesquisa (bibliográfica, documental, de campo, estudo de caso, revisão sistemática), participantes/amostra, instrumentos de coleta, procedimentos de análise e, quando houver seres humanos, os aspectos éticos (CEP/CONEP).\n\nO texto deve permitir que outro pesquisador reproduza o percurso metodológico.",
  },
  {
    label: "6. Considerações finais",
    title: "Etapa 6 — Considerações finais e referências",
    guide:
      "Retome os objetivos, sintetize os principais achados, aponte as limitações do estudo e sugestões para trabalhos futuros — sem introduzir dados novos.\n\nNas Referências, liste apenas as obras efetivamente citadas, em ordem alfabética, seguindo a ABNT NBR 6023 (SOBRENOME, Nome. Título. Cidade: Editora, ano.).",
  },
  {
    label: "7. Finalizar",
    title: "Etapa 7 — Revisão final e envio",
    guide:
      "Confira a lista de verificação abaixo, revise ortografia, padronização das citações e numeração das seções.\n\nUse “Baixar PDF (capa ABNT)” para exportar o trabalho com a capa já formatada: fonte Arial/Times New Roman 12, margens ABNT (superior e esquerda 3 cm; inferior e direita 2 cm), instituição e autor(es) em caixa alta, título em negrito no meio da página e cidade/ano no rodapé.\n\nAo clicar em “Enviar para Correção”, o trabalho completo (capa, resumo, seções e referências) será enviado ao professor e analisado pela IA de correção. A nota e a devolutiva ficam disponíveis na lista de trabalhos.",
  },
];

function StepGuide({ index }: { index: number }) {
  const s = STEPS[index];
  return (
    <div className="rounded-xl border bg-muted/40 p-4 space-y-2">
      <div className="flex items-center gap-2">
        <span className="p-1.5 rounded-lg bg-primary/10">
          <Info className="h-4 w-4 text-primary" />
        </span>
        <h3 className="font-semibold text-sm">{s.title}</h3>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
        {s.guide}
      </p>
    </div>
  );
}

export function WorkSubmissionAssistant({
  work,
  disciplineId,
  onClose,
  onDone,
}: WorkSubmissionAssistantProps) {
  const { user, profile } = useAuth();
  const [step, setStep] = useState(0);
  const [sending, setSending] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [groupNames, setGroupNames] = useState<string[]>([]);
  const [cover, setCover] = useState<CoverFields>({
    institution: "",
    course: "",
    discipline: "",
    teacher: "",
    author: "",
    theme: work.title ?? "",
    city: "",
    year: String(new Date().getFullYear()),
  });
  const [abstractText, setAbstractText] = useState("");
  const [keywords, setKeywords] = useState("");
  const [introduction, setIntroduction] = useState("");
  const [development, setDevelopment] = useState("");
  const [methodology, setMethodology] = useState("");
  const [conclusion, setConclusion] = useState("");
  const [references, setReferences] = useState("");

  const draftKey = `draft_work_abnt_${work.id}`;

  // Recupera rascunho salvo localmente (mesmo comportamento dos outros formulários).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        cover?: Partial<CoverFields>;
        abstractText?: string;
        keywords?: string;
        introduction?: string;
        development?: string;
        methodology?: string;
        conclusion?: string;
        references?: string;
      };
      if (parsed.cover) setCover((c) => ({ ...c, ...parsed.cover }));
      if (parsed.abstractText) setAbstractText(parsed.abstractText);
      if (parsed.keywords) setKeywords(parsed.keywords);
      if (parsed.introduction) setIntroduction(parsed.introduction);
      if (parsed.development) setDevelopment(parsed.development);
      if (parsed.methodology) setMethodology(parsed.methodology);
      if (parsed.conclusion) setConclusion(parsed.conclusion);
      if (parsed.references) setReferences(parsed.references);
    } catch {
      /* ignore */
    }
  }, [draftKey]);

  // Auto-save do rascunho.
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          draftKey,
          JSON.stringify({
            cover,
            abstractText,
            keywords,
            introduction,
            development,
            methodology,
            conclusion,
            references,
          }),
        );
      } catch {
        /* ignore */
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [
    draftKey,
    cover,
    abstractText,
    keywords,
    introduction,
    development,
    methodology,
    conclusion,
    references,
  ]);

  // Cabeçalho institucional da disciplina (instituição, curso, disciplina, professor).
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const h = (await getDisciplineHeader({
          data: { discipline_id: disciplineId },
        })) as unknown as {
          institution_name?: string | null;
          course_name?: string | null;
          discipline_name?: string | null;
          teacher_name?: string | null;
          logo_url?: string | null;
        } | null;
        if (cancel || !h) return;
        setLogoUrl(h.logo_url ?? null);
        setCover((c) => ({
          ...c,
          institution: c.institution || (h.institution_name ?? ""),
          course: c.course || (h.course_name ?? ""),
          discipline: c.discipline || (h.discipline_name ?? ""),
          teacher: c.teacher || (h.teacher_name ?? ""),
          theme: c.theme || work.title,
        }));
      } catch {
        /* noop */
      }
    })();
    return () => {
      cancel = true;
    };
  }, [disciplineId, work.title]);

  // Autor(es): nome do usuário logado ou integrantes do grupo do trabalho.
  useEffect(() => {
    let cancel = false;
    (async () => {
      const fallback = profile?.name || user?.email?.split("@")[0] || "";
      let names: string[] = [];
      if (user) {
        try {
          const { data: group } = await supabase
            .from("activity_groups")
            .select("leader_id, member_ids")
            .eq("discipline_id", disciplineId)
            .eq("activity_id", work.id)
            .eq("activity_kind", "work")
            .or(`leader_id.eq.${user.id},member_ids.cs.{${user.id}}`)
            .maybeSingle();
          const g = group as unknown as { leader_id: string; member_ids: string[] | null } | null;
          const ids = g
            ? Array.from(
                new Set([g.leader_id, ...((g.member_ids ?? []) as string[])]),
              ).filter(Boolean)
            : [];
          if (ids.length) {
            const { data: profs } = await supabase
              .from("profiles")
              .select("id,name")
              .in("id", ids);
            names = ((profs ?? []) as Array<{ name: string | null }>)
              .map((p) => p.name ?? "")
              .filter((n) => n.trim().length > 0);
          }
        } catch {
          /* sem grupo acessível: usa o próprio usuário */
        }
      }
      if (!names.length && fallback) names = [fallback];
      if (cancel) return;
      setGroupNames(names);
      setCover((c) => ({ ...c, author: c.author || names.join("; ") }));
    })();
    return () => {
      cancel = true;
    };
  }, [disciplineId, work.id, user, profile]);

  const stepError = (index: number): string | null => {
    if (index === 0 && (!cover.author.trim() || !cover.theme.trim())) return FILL_ERROR;
    if (index === 2 && introduction.trim().length < 40) return FILL_ERROR;
    if (index === 3 && development.trim().length < 40) return FILL_ERROR;
    if (index === 5 && conclusion.trim().length < 40) return FILL_ERROR;
    return null;
  };

  const goNext = () => {
    const err = stepError(step);
    if (err) {
      toast.error(err);
      return;
    }
    setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1));
  };

  const goBack = () => setStep((s) => Math.max(0, s - 1));

  const jumpTo = (index: number) => {
    if (index <= step) setStep(index);
  };

  const fullText = useMemo(() => {
    const blocks: string[] = [];
    const idLines: string[] = [];
    if (cover.institution.trim()) idLines.push(`INSTITUIÇÃO: ${cover.institution.trim()}`);
    if (cover.course.trim()) idLines.push(`CURSO: ${cover.course.trim()}`);
    if (cover.discipline.trim()) idLines.push(`DISCIPLINA: ${cover.discipline.trim()}`);
    if (cover.teacher.trim()) idLines.push(`PROFESSOR(A): ${cover.teacher.trim()}`);
    if (cover.author.trim()) idLines.push(`AUTOR(ES): ${cover.author.trim()}`);
    idLines.push(`TEMA: ${(cover.theme || work.title).trim()}`);
    if (cover.city.trim() || cover.year.trim()) {
      idLines.push(
        [cover.city.trim(), cover.year.trim()].filter(Boolean).join(" - "),
      );
    }
    blocks.push(idLines.join("\n"));

    if (abstractText.trim()) {
      blocks.push(`RESUMO\n${abstractText.trim()}`);
    }
    if (keywords.trim()) {
      blocks.push(`PALAVRAS-CHAVE: ${keywords.trim()}`);
    }
    if (introduction.trim()) blocks.push(`1 INTRODUÇÃO\n${introduction.trim()}`);
    if (development.trim()) blocks.push(`2 DESENVOLVIMENTO\n${development.trim()}`);
    if (methodology.trim()) blocks.push(`3 METODOLOGIA\n${methodology.trim()}`);
    if (conclusion.trim()) blocks.push(`4 CONSIDERAÇÕES FINAIS\n${conclusion.trim()}`);
    if (references.trim()) blocks.push(`REFERÊNCIAS\n${references.trim()}`);

    return blocks.join("\n\n");
  }, [
    cover,
    abstractText,
    keywords,
    introduction,
    development,
    methodology,
    conclusion,
    references,
    work.title,
  ]);

  // Texto enviado ao Tutor IA em cada aba (persona base + instruções da etapa).
  const tutorTexts = useMemo(() => {
    const capaLines: string[] = [];
    if (cover.institution.trim()) capaLines.push(`INSTITUIÇÃO: ${cover.institution.trim()}`);
    if (cover.course.trim()) capaLines.push(`CURSO: ${cover.course.trim()}`);
    if (cover.discipline.trim()) capaLines.push(`DISCIPLINA: ${cover.discipline.trim()}`);
    if (cover.teacher.trim()) capaLines.push(`PROFESSOR(A): ${cover.teacher.trim()}`);
    if (cover.author.trim()) capaLines.push(`AUTOR(ES): ${cover.author.trim()}`);
    capaLines.push(`TEMA: ${(cover.theme || work.title).trim()}`);
    if (cover.city.trim()) capaLines.push(`CIDADE: ${cover.city.trim()}`);
    if (cover.year.trim()) capaLines.push(`ANO: ${cover.year.trim()}`);

    const resumoLines = [
      abstractText.trim() ? `RESUMO:\n${abstractText.trim()}` : "",
      keywords.trim() ? `PALAVRAS-CHAVE: ${keywords.trim()}` : "",
    ].filter(Boolean);

    const consideracoesLines = [
      conclusion.trim() ? `CONSIDERAÇÕES FINAIS:\n${conclusion.trim()}` : "",
      references.trim() ? `REFERÊNCIAS:\n${references.trim()}` : "",
    ].filter(Boolean);

    return {
      capa: capaLines.join("\n"),
      resumo: resumoLines.join("\n\n"),
      introducao: introduction.trim(),
      desenvolvimento: development.trim(),
      metodologia: methodology.trim(),
      consideracoes: consideracoesLines.join("\n\n"),
      finalizar: fullText,
    };
  }, [
    cover,
    abstractText,
    keywords,
    introduction,
    development,
    methodology,
    conclusion,
    references,
    fullText,
    work.title,
  ]);

  const handleSubmit = async () => {
    for (const idx of [0, 2, 3, 5]) {
      const err = stepError(idx);
      if (err) {
        toast.error(err);
        setStep(idx);
        return;
      }
    }

    setSending(true);
    try {
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      if (!authUser) throw new Error("Usuário não autenticado.");

      await submitAcademicWork({
        data: {
          work_id: work.id,
          file_url: "inline_submission",
          submission_text: fullText,
        },
      });

      toast.success("Trabalho enviado para correção!");
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao enviar trabalho");
    } finally {
      setSending(false);
    }
  };

  // Conteúdo usado na geração do PDF (capa ABNT + seções do trabalho).
  const pdfPayload = useMemo(
    () => ({
      cover: {
        logo_data_url: logoUrl,
        institution: cover.institution.trim(),
        author: cover.author.trim(),
        title: (cover.theme || work.title).trim(),
        city: cover.city.trim(),
        year: cover.year.trim(),
      },
      sections: [
        abstractText.trim() ? { heading: "RESUMO", body: abstractText.trim() } : null,
        keywords.trim() ? { heading: "PALAVRAS-CHAVE", body: keywords.trim() } : null,
        introduction.trim() ? { heading: "1 INTRODUÇÃO", body: introduction.trim() } : null,
        development.trim() ? { heading: "2 DESENVOLVIMENTO", body: development.trim() } : null,
        methodology.trim() ? { heading: "3 METODOLOGIA", body: methodology.trim() } : null,
        conclusion.trim()
          ? { heading: "4 CONSIDERAÇÕES FINAIS", body: conclusion.trim() }
          : null,
        references.trim() ? { heading: "REFERÊNCIAS", body: references.trim() } : null,
      ].filter((section): section is { heading: string; body: string } => section !== null),
      file_name: work.title,
    }),
    [
      cover,
      logoUrl,
      abstractText,
      keywords,
      introduction,
      development,
      methodology,
      conclusion,
      references,
      work.title,
    ],
  );

  /** Gera o PDF com a capa no padrão ABNT e baixa o arquivo. */
  const handleExportPDF = async () => {
    setExporting(true);
    try {
      const res = await exportWorkCoverPDF({ data: pdfPayload });
      const binary = atob(res.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: res.mime }));
      const link = document.createElement("a");
      link.href = url;
      link.download = res.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast.success("PDF gerado com a capa no padrão ABNT.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar o PDF");
    } finally {
      setExporting(false);
    }
  };

  const checklist = [
    {
      label: "Capa preenchida (autor e tema)",
      ok: !!cover.author.trim() && !!cover.theme.trim(),
    },
    { label: "Introdução redigida", ok: introduction.trim().length >= 40 },
    { label: "Desenvolvimento redigido", ok: development.trim().length >= 40 },
    { label: "Considerações finais redigidas", ok: conclusion.trim().length >= 40 },
    { label: "Metodologia descrita (recomendado)", ok: methodology.trim().length > 0 },
    { label: "Referências informadas (recomendado)", ok: references.trim().length > 0 },
    { label: "Resumo e palavras-chave (recomendado)", ok: abstractText.trim().length > 0 },
  ];

  return (
    <Dialog open onOpenChange={(o) => !o && !sending && onClose()}>
      <DialogContent className="max-w-5xl h-[90vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 border-b bg-muted/20">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-primary/10 rounded-lg shrink-0">
              <GraduationCap className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-lg">
                Assistente de Trabalho ABNT: TRABALHO ACADÊMICO
              </DialogTitle>
              <DialogDescription className="truncate">
                {work.title}
                {work.due_at ? ` · Entrega: ${formatBRDate(work.due_at)} às 23:59` : ""}
              </DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant="outline" className="h-6">
                Etapa {step + 1} de {TOTAL_STEPS}
              </Badge>
            </div>
          </div>
          <Progress value={((step + 1) / TOTAL_STEPS) * 100} className="mt-3 h-1.5" />
        </DialogHeader>

        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <Tabs
            value={String(step)}
            onValueChange={(v) => jumpTo(Number(v))}
            className="h-full flex min-w-0 flex-1 flex-col"
          >
            <div className="px-4 py-3 border-b bg-background flex flex-wrap items-center justify-between gap-4 sticky top-0 z-10 w-full">
              <TabsList className="h-auto flex-wrap justify-start gap-2 bg-transparent p-0">
                {STEPS.map((s, i) => (
                  <TabsTrigger
                    key={s.label}
                    value={String(i)}
                    disabled={i > step}
                    className="rounded-full px-3 py-1 text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                  >
                    {s.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              <Button
                type="button"
                size="sm"
                variant={tutorOpen ? "secondary" : "default"}
                className="gap-2 shrink-0 shadow-sm"
                onClick={() => setTutorOpen((v) => !v)}
                aria-pressed={tutorOpen}
              >
                <Bot className="h-4 w-4" />
                <span className="hidden sm:inline">Tutor IA</span>
              </Button>
            </div>

            {/* 1. Capa */}
            <TabsContent value="0" className="flex-1 overflow-y-auto p-6 mt-0">
              <div className="max-w-3xl mx-auto space-y-5">
                <StepGuide index={0} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Label>Logo da Instituição (Opcional)</Label>
                    <div className="mt-1 relative border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center gap-2 hover:bg-muted/50 transition-colors bg-muted/10 group">
                      {logoUrl ? (
                        <div className="relative">
                          <img src={logoUrl} alt="Logo" className="max-h-24 object-contain rounded-md" />
                          <Button
                            type="button"
                            size="icon"
                            variant="destructive"
                            className="absolute -top-3 -right-4 h-6 w-6 rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => {
                              e.preventDefault();
                              setLogoUrl(null);
                            }}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <>
                          <div className="p-2 bg-primary/5 rounded-full">
                            <Upload className="h-6 w-6 text-muted-foreground/60" />
                          </div>
                          <p className="text-xs text-muted-foreground text-center">
                            Arraste uma imagem ou clique para selecionar
                          </p>
                        </>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        className="absolute inset-0 opacity-0 cursor-pointer"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = (ev) => {
                            setLogoUrl(ev.target?.result as string);
                          };
                          reader.readAsDataURL(file);
                          e.target.value = "";
                        }}
                      />
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="abnt-author">Autor(es)</Label>
                    <Input
                      id="abnt-author"
                      value={cover.author}
                      onChange={(e) => setCover((c) => ({ ...c, author: e.target.value }))}
                      placeholder="Nome completo do(s) autor(es)"
                    />
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {groupNames.length > 1
                        ? "Carregado automaticamente dos integrantes do grupo — revise se necessário."
                        : "Carregado automaticamente do seu cadastro — revise se necessário."}
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="abnt-institution">Instituição</Label>
                    <Input
                      id="abnt-institution"
                      value={cover.institution}
                      onChange={(e) =>
                        setCover((c) => ({ ...c, institution: e.target.value }))
                      }
                      placeholder="Nome da instituição"
                    />
                  </div>
                  <div>
                    <Label htmlFor="abnt-course">Curso</Label>
                    <Input
                      id="abnt-course"
                      value={cover.course}
                      onChange={(e) => setCover((c) => ({ ...c, course: e.target.value }))}
                      placeholder="Nome do curso"
                    />
                  </div>
                  <div>
                    <Label htmlFor="abnt-discipline">Disciplina</Label>
                    <Input
                      id="abnt-discipline"
                      value={cover.discipline}
                      onChange={(e) =>
                        setCover((c) => ({ ...c, discipline: e.target.value }))
                      }
                      placeholder="Nome da disciplina"
                    />
                  </div>
                  <div>
                    <Label htmlFor="abnt-teacher">Professor(a)</Label>
                    <Input
                      id="abnt-teacher"
                      value={cover.teacher}
                      onChange={(e) => setCover((c) => ({ ...c, teacher: e.target.value }))}
                      placeholder="Nome do(a) professor(a)"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="abnt-theme">Tema / Título do trabalho</Label>
                    <Input
                      id="abnt-theme"
                      value={cover.theme}
                      onChange={(e) => setCover((c) => ({ ...c, theme: e.target.value }))}
                      placeholder="Título do trabalho"
                    />
                  </div>
                  <div>
                    <Label htmlFor="abnt-city">Cidade</Label>
                    <Input
                      id="abnt-city"
                      value={cover.city}
                      onChange={(e) => setCover((c) => ({ ...c, city: e.target.value }))}
                      placeholder="Cidade"
                    />
                  </div>
                  <div>
                    <Label htmlFor="abnt-year">Ano</Label>
                    <Input
                      id="abnt-year"
                      value={cover.year}
                      onChange={(e) => setCover((c) => ({ ...c, year: e.target.value }))}
                      placeholder="Ano"
                    />
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* 2. Resumo */}
            <TabsContent value="1" className="flex-1 overflow-y-auto p-6 mt-0">
              <div className="max-w-3xl mx-auto space-y-5">
                <StepGuide index={1} />
                <div>
                  <Label htmlFor="abnt-abstract">Resumo (150 a 500 palavras)</Label>
                  <Textarea
                    id="abnt-abstract"
                    className="min-h-[220px] leading-relaxed"
                    value={abstractText}
                    onChange={(e) => setAbstractText(e.target.value)}
                    placeholder="Escreva o resumo em parágrafo único..."
                  />
                </div>
                <div>
                  <Label htmlFor="abnt-keywords">Palavras-chave (3 a 5, separadas por ponto e vírgula)</Label>
                  <Input
                    id="abnt-keywords"
                    value={keywords}
                    onChange={(e) => setKeywords(e.target.value)}
                    placeholder="Ex.: atenção primária; saúde coletiva; educação em saúde"
                  />
                </div>
              </div>
            </TabsContent>

            {/* 3. Introdução */}
            <TabsContent value="2" className="flex-1 overflow-y-auto p-6 mt-0">
              <div className="max-w-3xl mx-auto space-y-5">
                <StepGuide index={2} />
                <div>
                  <Label htmlFor="abnt-intro">Introdução</Label>
                  <Textarea
                    id="abnt-intro"
                    className="min-h-[320px] leading-relaxed"
                    value={introduction}
                    onChange={(e) => setIntroduction(e.target.value)}
                    placeholder="Contextualize o tema, o problema, os objetivos e a justificativa..."
                  />
                </div>
              </div>
            </TabsContent>

            {/* 4. Desenvolvimento */}
            <TabsContent value="3" className="flex-1 overflow-y-auto p-6 mt-0">
              <div className="max-w-3xl mx-auto space-y-5">
                <StepGuide index={3} />
                <div>
                  <Label htmlFor="abnt-development">Desenvolvimento / Revisão de Literatura</Label>
                  <Textarea
                    id="abnt-development"
                    className="min-h-[360px] leading-relaxed"
                    value={development}
                    onChange={(e) => setDevelopment(e.target.value)}
                    placeholder="Fundamente o tema com autores, comparações e análise crítica..."
                  />
                </div>
              </div>
            </TabsContent>

            {/* 5. Metodologia */}
            <TabsContent value="4" className="flex-1 overflow-y-auto p-6 mt-0">
              <div className="max-w-3xl mx-auto space-y-5">
                <StepGuide index={4} />
                <div>
                  <Label htmlFor="abnt-methodology">Metodologia</Label>
                  <Textarea
                    id="abnt-methodology"
                    className="min-h-[280px] leading-relaxed"
                    value={methodology}
                    onChange={(e) => setMethodology(e.target.value)}
                    placeholder="Tipo de pesquisa, participantes, instrumentos, análise e aspectos éticos..."
                  />
                </div>
              </div>
            </TabsContent>

            {/* 6. Considerações finais */}
            <TabsContent value="5" className="flex-1 overflow-y-auto p-6 mt-0">
              <div className="max-w-3xl mx-auto space-y-5">
                <StepGuide index={5} />
                <div>
                  <Label htmlFor="abnt-conclusion">Considerações finais</Label>
                  <Textarea
                    id="abnt-conclusion"
                    className="min-h-[220px] leading-relaxed"
                    value={conclusion}
                    onChange={(e) => setConclusion(e.target.value)}
                    placeholder="Retome os objetivos, sintetize os achados e aponte limitações..."
                  />
                </div>
                <div>
                  <Label htmlFor="abnt-references">Referências (ABNT NBR 6023)</Label>
                  <Textarea
                    id="abnt-references"
                    className="min-h-[200px] leading-relaxed"
                    value={references}
                    onChange={(e) => setReferences(e.target.value)}
                    placeholder="SOBRENOME, Nome. Título. Cidade: Editora, ano."
                  />
                </div>
              </div>
            </TabsContent>

            {/* 7. Finalizar */}
            <TabsContent value="6" className="flex-1 overflow-y-auto p-6 mt-0 bg-muted/10">
              <div className="max-w-3xl mx-auto space-y-5">
                <StepGuide index={6} />
                <div className="rounded-xl border bg-background p-5 space-y-3">
                  <h4 className="font-semibold text-sm">Lista de verificação</h4>
                  <ul className="space-y-2">
                    {checklist.map((item) => (
                      <li key={item.label} className="flex items-center gap-2 text-sm">
                        <CheckCircle2
                          className={
                            item.ok
                              ? "h-4 w-4 text-primary shrink-0"
                              : "h-4 w-4 text-muted-foreground/40 shrink-0"
                          }
                        />
                        <span className={item.ok ? "" : "text-muted-foreground"}>
                          {item.label}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-xl border bg-background p-5">
                  <h4 className="font-semibold text-sm mb-2">Prévia do texto que será enviado</h4>
                  <pre className="whitespace-pre-wrap text-xs text-muted-foreground max-h-56 overflow-y-auto leading-relaxed font-sans">
                    {fullText}
                  </pre>
                </div>

                <div className="flex flex-wrap justify-center gap-3 pt-2">
                  <Button
                    size="lg"
                    variant="outline"
                    className="gap-2 px-6 py-6 text-base"
                    onClick={handleExportPDF}
                    disabled={sending || exporting}
                  >
                    {exporting ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" /> Gerando PDF...
                      </>
                    ) : (
                      <>
                        <FileDown className="h-5 w-5" /> Baixar PDF (capa ABNT)
                      </>
                    )}
                  </Button>
                  <Button
                    size="lg"
                    className="gap-2 px-8 py-6 text-base"
                    onClick={handleSubmit}
                    disabled={sending}
                  >
                    {sending ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" /> Enviando...
                      </>
                    ) : (
                      <>
                        <Send className="h-5 w-5" /> Enviar para Correção
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground italic text-center">
                  * O trabalho será enviado ao professor e analisado pela IA de correção.
                </p>
              </div>
            </TabsContent>
          </Tabs>

          <WorkTutorPanel
            open={tutorOpen}
            onClose={() => setTutorOpen(false)}
            section={SECTION_BY_STEP[step] ?? "capa"}
            text={tutorTexts[SECTION_BY_STEP[step] ?? "capa"]}
            title={work.title}
            instructions={work.instructions ?? null}
          />
        </div>

        <DialogFooter className="p-6 border-t bg-muted/20">
          <div className="flex w-full items-center justify-between gap-3">
            <Button variant="outline" onClick={onClose} disabled={sending}>
              Cancelar
            </Button>
            <div className="flex gap-3">
              <Button variant="outline" onClick={goBack} disabled={step === 0 || sending}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
              </Button>
              {step < TOTAL_STEPS - 1 && (
                <Button onClick={goNext} disabled={sending} className="gap-2">
                  Avançar <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
