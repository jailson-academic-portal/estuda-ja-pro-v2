import React, { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, BrainCircuit, Loader2, Check, ChevronsUpDown, Sparkles } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { sanitizeListTitle, sanitizeTitleList, sanitizeAITitle } from "@/lib/text-sanitize";
import { stripDocumentHeaderMetadata, stripLeadingStandardHeader } from "@/lib/document-header";
import { sortItemsNumerically } from "@/lib/utils";

/**
 * Aulas de um módulo: usa as aulas da apostila quando existirem; para módulos
 * práticos/avaliativos (sem apostila ou sem aulas teóricas), usa as aulas ou
 * etapas vindas do Plano de Aula.
 */
function extractLessons(apostila: any): string[] {
  const content = typeof apostila?.result === "string" ? apostila.result : JSON.stringify(apostila?.result ?? "");
  const found = content.match(/# (Aula \d+[:\s][^#\n]+)/g)?.map((l: string) => l.replace("# ", "").trim()) || [];
  const map = new Map<string, string>();
  sanitizeTitleList(found).forEach((l: string) => {
    const prefix = l.match(/^(Aula \d+)/i)?.[0] || l;
    if (!map.has(prefix)) map.set(prefix, l);
  });
  const fromApostila = Array.from(map.values());
  if (fromApostila.length) return fromApostila;
  const fromPlan = Array.isArray(apostila?.planLessons) ? apostila.planLessons.map(String) : [];
  return Array.from(new Set(fromPlan.filter((l: string) => !!l.trim())));
}

/** IDs reais de apostila (uuid) — módulos vindos apenas do plano usam "plan-N". */
const isApostilaId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(String(id));

/** Sorts modules or lessons in ascending numeric order (Módulo 1 → Módulo N, Aula 1 → Aula N). */
function sortNumeric(items: any[], labelKey?: string): any[] {
  return sortItemsNumerically(items.map(item => {
    if (typeof item === 'string') return { title: item };
    return item;
  })).map((item, index) => {
    if (typeof items[0] === 'string') return item.title;
    return item;
  });
}
import { useServerFn } from "@tanstack/react-start";
import { getDynamicCaseSuggestions } from "@/backend/simulsaude-suggestions.functions";
import {
  generateClinicalCaseDraft,
  publishClinicalCase,
  type ClinicalCaseDraft,
} from "@/backend/simulsaude-cases.functions";
import {
  getLessonPlanThemeBank,
  getLessonPlanModules,
  type LessonPlanThemeBankPayload,
} from "@/backend/lesson-plan-themes.functions";
import { ClinicalCaseDraftReview } from "@/components/simulsaude/ClinicalCaseDraftReview";
import { AILoadingOverlay } from "@/components/AILoadingOverlay";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  generateCaseStudyFromPlan,
  generateActivitySyllabusFromPlan,
  listAIGenerations,
  getAIGeneration,
} from "@/backend/ai-assistant.functions";

export type PlannedCaseSeed = {
  id: string;
  title: string;
  scenario?: string | null;
  objectives?: string | null;
  module_number?: number | null;
};

export const ClinicalCaseGenerator: React.FC<{ 
  disciplineId: string;
  selectedApostilaId?: string;
  selectedLessons?: string[];
  onLessonChange?: (apostilaId: string, lessons: string[]) => void;
  onPublished?: () => void;
  /** Rascunho previsto no Plano de Aula que será materializado como caso completo. */
  plannedCase?: PlannedCaseSeed | null;
}> = ({ disciplineId, selectedApostilaId, selectedLessons = [], onLessonChange, onPublished, plannedCase = null }) => {
  const [disciplineName, setDisciplineName] = useState("Carregando...");
  const [courseName, setCourseName] = useState("Saúde");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [customTheme, setCustomTheme] = useState("");
  const [selectedTheme, setSelectedTheme] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);
  
  // States for the new dropdowns
  const [apostilas, setApostilas] = useState<any[]>([]);
  const [selectedApostilaIds, setSelectedApostilaIds] = useState<string[]>([]);
  const [loadingApostilas, setLoadingApostilas] = useState(false);
  const [diaryColumns, setDiaryColumns] = useState<{ id: string; name: string }[]>([]);
  const [loadingColumns, setLoadingColumns] = useState(false);
  const [selectedColumnId, setSelectedColumnId] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<ClinicalCaseDraft | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [lastTheme, setLastTheme] = useState("");
  const [difficulty, setDifficulty] = useState<"basico" | "intermediario" | "avancado">("intermediario");
  const [themeBank, setThemeBank] = useState<LessonPlanThemeBankPayload | null>(null);
  const [editingPlanTheme, setEditingPlanTheme] = useState(false);
  // Caso do Plano de Aula escolhido manualmente na lista (sobrepõe o inferido pelo módulo).
  const [pickedPlanIndex, setPickedPlanIndex] = useState<number | null>(null);
  // Cenário/objetivos do plano carregados no formulário — enviados à IA na geração.
  const [planContext, setPlanContext] = useState<{ cenario?: string; objetivos?: string } | null>(null);

  // Deadline states
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("23:59");
  const [allowLate, setAllowLate] = useState(true);
  const [latePenalty, setLatePenalty] = useState(0.5);
  
  const [selectedLessonIds, setSelectedLessonIds] = useState<string[]>(selectedLessons.map(String));

  // Grupo de IA padronizado (mesma lógica das Atividades Extras): elaboração e vinculação.
  const [elaborating, setElaborating] = useState(false);
  const [showCaseStudies, setShowCaseStudies] = useState(false);
  const [caseStudies, setCaseStudies] = useState<Array<{ id: string; title: string }>>([]);
  const [loadingCS, setLoadingCS] = useState(false);
  const [showSyllabi, setShowSyllabi] = useState(false);
  const [syllabi, setSyllabi] = useState<Array<{ id: string; title: string }>>([]);
  const [loadingSyl, setLoadingSyl] = useState(false);

  const getSuggestionsFn = useServerFn(getDynamicCaseSuggestions);
  const getThemeBankFn = useServerFn(getLessonPlanThemeBank);
  const getPlanModulesFn = useServerFn(getLessonPlanModules);
  const generateDraftFn = useServerFn(generateClinicalCaseDraft);
  const publishCaseFn = useServerFn(publishClinicalCase);
  const generateCaseStudyFn = useServerFn(generateCaseStudyFromPlan);
  const generateSyllabusFn = useServerFn(generateActivitySyllabusFromPlan);
  const listGenerationsFn = useServerFn(listAIGenerations);
  const getGenerationFn = useServerFn(getAIGeneration);

  /**
   * Elabora o contexto completo do caso clínico com a IA — mesma lógica do
   * botão das Atividades Extras (estudo de caso clínico/laboratorial especializado).
   * O texto gerado preenche automaticamente o campo 3 do formulário.
   */
  const elaborateWithAI = useCallback(async () => {
    const topic = customTheme.trim();
    if (topic.length < 2) {
      toast.error("Informe o título do caso clínico antes de elaborar com a IA");
      return;
    }
    setElaborating(true);
    const t = toast.loading("Elaborando Caso Clínico completo com a IA…");
    try {
      const currentText = stripLeadingStandardHeader(stripDocumentHeaderMetadata(selectedTheme)).trim();
      // Instrução interna do SimulSaúde: a IA deve gerar um CASO CLÍNICO
      // (paciente, sintomas, diagnóstico e conduta), não um estudo de caso genérico.
      const clinicalInstruction =
        "Gere um CASO CLÍNICO da área da saúde (não um estudo de caso genérico): apresente um paciente com dados de identificação, queixa principal, história da doença atual, sintomas, sinais vitais e exames relevantes, evoluindo para diagnóstico, hipóteses diferenciais e conduta terapêutica/nursing adequada ao contexto clínico do tema.";
      const extra = [
        clinicalInstruction,
        currentText
          ? `Contexto/instruções atuais do caso (expanda e detalhe): ${currentText.slice(0, 2200)}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const res = await generateCaseStudyFn({
        data: { discipline_id: disciplineId, module_topic: topic, extra_context: extra },
      });
      const genId = (res as { id?: string })?.id;
      if (!genId) throw new Error("Resposta inválida da geração");
      const detail = await getGenerationFn({ data: { id: genId } });
      const result = (detail as { result?: unknown })?.result;
      const md = typeof result === "string" ? result : JSON.stringify(result ?? "");
      if (!md.trim() || /^###\s*Erro na Geração/i.test(md.trim())) {
        throw new Error("A IA não conseguiu elaborar o conteúdo. Tente novamente.");
      }
      setSelectedTheme(md);
      toast.success("Caso clínico elaborado — revise e gere o rascunho", { id: t });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao elaborar com IA", { id: t });
    } finally {
      setElaborating(false);
    }
  }, [customTheme, selectedTheme, disciplineId, generateCaseStudyFn, getGenerationFn]);

  const openCaseStudyPicker = async () => {
    setShowCaseStudies(true);
    setLoadingCS(true);
    try {
      const res = await listGenerationsFn({
        data: { discipline_id: disciplineId, tool: "case_study", limit: 50 },
      });
      const items = Array.isArray(res?.items) ? res.items : [];
      setCaseStudies(items.map((i) => ({ id: i.id, title: i.title })));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar estudos de caso");
    } finally {
      setLoadingCS(false);
    }
  };

  const attachCaseStudy = async (id: string, title: string) => {
    try {
      const res = await getGenerationFn({ data: { id } });
      const md = typeof res?.result === "string" ? res.result : JSON.stringify(res?.result ?? "");
      setSelectedTheme(md);
      if (title) setCustomTheme((cur) => (cur.trim() ? cur : title));
      toast.success("Estudo de caso vinculado");
      setShowCaseStudies(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  const openSyllabusPicker = async () => {
    setShowSyllabi(true);
    setLoadingSyl(true);
    try {
      const res = await listGenerationsFn({
        data: { discipline_id: disciplineId, tool: "activity_syllabus", limit: 50 },
      });
      const items = Array.isArray(res?.items) ? res.items : [];
      setSyllabi(items.map((i) => ({ id: i.id, title: i.title })));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar ementas");
    } finally {
      setLoadingSyl(false);
    }
  };

  const attachSyllabus = async (id: string, title: string) => {
    try {
      const res = await getGenerationFn({ data: { id } });
      const md = typeof res?.result === "string" ? res.result : JSON.stringify(res?.result ?? "");
      setSelectedTheme(md);
      if (title) setCustomTheme((cur) => (cur.trim() ? cur : title));
      toast.success("Ementa vinculada");
      setShowSyllabi(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  useEffect(() => {
    async function loadApostilas() {
      setLoadingApostilas(true);
      const [{ data, error }, planModules] = await Promise.all([
        supabase
          .from("ai_generations")
          .select("id, title, result")
          .eq("discipline_id", disciplineId)
          .eq("tool", "apostila"),
        getPlanModulesFn({ data: { disciplineId } })
          .then((r) => r.modules)
          .catch((err) => {
            console.error("Error loading lesson plan modules:", err);
            return [] as Awaited<ReturnType<typeof getPlanModulesFn>>["modules"];
          }),
      ]);

      if (!error) {
        const moduleNumberOf = (a: any) =>
          Number(String(a?.title ?? "").match(/M[óo]dulo\s*(\d+)/i)?.[1] ?? 0);

        // Apostilas recebem as aulas/etapas do plano como fallback; módulos do
        // plano sem apostila (práticos/avaliativos) entram como itens próprios.
        const base = (data ?? []).map((a: any) => {
          const mod = planModules.find((m) => m.numero === moduleNumberOf(a));
          return { ...a, planLessons: mod ? (mod.aulas.length ? mod.aulas : mod.etapas) : [] };
        });
        const covered = new Set(base.map(moduleNumberOf).filter((n) => n > 0));
        const planOnly = planModules
          .filter((m) => !covered.has(m.numero))
          .map((m) => ({
            id: `plan-${m.numero}`,
            title: m.titulo,
            result: "",
            planLessons: m.aulas.length ? m.aulas : m.etapas,
            planOnly: true,
          }));

        const sortedApostilas = sortNumeric([...base, ...planOnly], "title");
        setApostilas(sortedApostilas);
        
        
        // Restore from localStorage or use defaults. Quando o gerador é aberto a
        // partir de um caso previsto no plano, o rascunho antigo é ignorado para
        // não sobrepor o título/cenário do caso escolhido.
        const savedData = plannedCase ? null : localStorage.getItem(`clinical_case_draft_${disciplineId}`);
        if (savedData) {
          try {
            const parsed = JSON.parse(savedData);
            setCustomTheme(parsed.customTheme || "");
            setSelectedTheme(parsed.selectedTheme || "");
            setSelectedApostilaIds(parsed.selectedApostilaIds || []);
            setSelectedLessonIds(parsed.selectedLessonIds || []);
            setSelectedColumnId(parsed.selectedColumnId || "");
            setDueDate(parsed.dueDate || "");
            setDueTime(parsed.dueTime || "23:59");
            setAllowLate(parsed.allowLate ?? true);
            setLatePenalty(parsed.latePenalty ?? 0.5);
          } catch (e) {
            console.error("Error parsing saved draft", e);
          }
        } else {
          // Default: ALL modules selected, with ALL their lessons pre-selected.
          const allIds = sortedApostilas.map((a: any) => a.id as string);
          setSelectedApostilaIds(allIds);
          const allLessons = sortNumeric(Array.from(new Set(sortedApostilas.flatMap((a: any) => extractLessons(a)))));
          onLessonChange?.(allIds[0] ?? "", allLessons);
        }
      }
      setLoadingApostilas(false);
    }
    
    async function loadDiaryColumns() {
      setLoadingColumns(true);
      try {
        const { getDiaryColumns } = await import("@/backend/diary-release.functions");
        const columns = await getDiaryColumns({ data: { discipline_id: disciplineId } });
        setDiaryColumns(columns);
        // Only set default if not restored from localStorage
        const savedData = localStorage.getItem(`clinical_case_draft_${disciplineId}`);
        if (!savedData && columns.length > 0) setSelectedColumnId(columns[0].id);
      } catch (err) {
        console.error("Error loading diary columns:", err);
      } finally {
        setLoadingColumns(false);
      }
    }

    async function loadThemeBank() {
      try {
        const bank = await getThemeBankFn({ data: { disciplineId } });
        setThemeBank(bank);
        // Caso previsto no plano aberto a partir do SimulSaúde: pré-seleciona no banco de temas.
        if (plannedCase) {
          const cleanTitle = sanitizeAITitle(plannedCase.title, 300) || plannedCase.title.trim();
          const key = cleanTitle.toLowerCase();
          const idx = (bank?.tema_caso_clinico_simulsaude ?? []).findIndex(
            (t) => (sanitizeAITitle(t.tema, 300) || t.tema.trim()).toLowerCase() === key,
          );
          if (idx >= 0) setPickedPlanIndex(idx);
          else setCustomTheme(cleanTitle);
        }
      } catch (err) {
        console.error("Error loading lesson plan theme bank:", err);
        if (plannedCase) setCustomTheme(sanitizeAITitle(plannedCase.title, 300) || plannedCase.title.trim());
      }
    }

    loadApostilas();
    loadDiaryColumns();
    loadThemeBank();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disciplineId, plannedCase?.id]);

  // Auto-save effect
  useEffect(() => {
    if (customTheme || selectedTheme || selectedApostilaIds.length > 0 || selectedLessonIds.length > 0) {
      const dataToSave = {
        customTheme,
        selectedTheme,
        selectedApostilaIds,
        selectedLessonIds,
        selectedColumnId,
        dueDate,
        dueTime,
        allowLate,
        latePenalty
      };
      localStorage.setItem(`clinical_case_draft_${disciplineId}`, JSON.stringify(dataToSave));
    }
  }, [customTheme, selectedTheme, selectedApostilaIds, selectedLessonIds, selectedColumnId, dueDate, dueTime, allowLate, latePenalty, disciplineId]);

  const clearDraft = () => {
    localStorage.removeItem(`clinical_case_draft_${disciplineId}`);
  };

  /** Primeira apostila real selecionada (módulos práticos não têm apostila). */
  const primaryApostilaId = React.useMemo(
    () => selectedApostilaIds.map(String).find(isApostilaId),
    [selectedApostilaIds],
  );

  // Lessons available for the currently checked modules, sorted ascending by lesson number.
  const availableLessons = React.useMemo(() => {
    const list = apostilas
      .filter((a: any) => selectedApostilaIds.map(String).includes(String(a.id)))
      .flatMap((a: any) => extractLessons(a));
    return sortNumeric(Array.from(new Set(list)));
  }, [apostilas, selectedApostilaIds]);

  // Números dos módulos atualmente selecionados (extraídos do título da apostila).
  const selectedModuleNumbers = React.useMemo(() => {
    return apostilas
      .filter((a: any) => selectedApostilaIds.map(String).includes(String(a.id)))
      .map((a: any) => Number(String(a.title ?? "").match(/M[óo]dulo\s*(\d+)/i)?.[1] ?? 0))
      .filter((n) => n > 0);
  }, [apostilas, selectedApostilaIds]);

  // Tema de Caso Clínico definido no Plano de Aula ativo para o módulo escolhido.
  type PlanCaseTheme = LessonPlanThemeBankPayload["tema_caso_clinico_simulsaude"][number];
  // Títulos vindos do plano passam pelo sanitizador: nada de frases da IA
  // ("Aqui estão 5 temas...") no card ou no formulário de geração.
  const planCases = React.useMemo(
    () =>
      (themeBank?.tema_caso_clinico_simulsaude ?? [])
        .map((t) => ({ ...t, tema: sanitizeAITitle(t.tema, 300) || t.tema.trim() }))
        .filter((t) => !!t.tema),
    [themeBank],
  );
  const planTheme = React.useMemo<PlanCaseTheme | null>(() => {
    const list = planCases;
    if (pickedPlanIndex !== null && list[pickedPlanIndex]) return list[pickedPlanIndex];
    // Rascunho vindo do SimulSaúde que não consta (ou ainda não carregou) no banco de temas.
    if (plannedCase) {
      return {
        modulo: plannedCase.module_number ?? 0,
        modulo_titulo: "",
        tema: sanitizeAITitle(plannedCase.title, 300) || plannedCase.title.trim(),
        cenario: plannedCase.scenario?.trim() || undefined,
        objetivos: plannedCase.objectives?.trim() || undefined,
      };
    }
    if (!list.length) return null;
    const match = list.find((t) => selectedModuleNumbers.includes(t.modulo));
    return match ?? (selectedModuleNumbers.length === 0 ? list[0] : null) ?? list[0];
  }, [planCases, selectedModuleNumbers, pickedPlanIndex, plannedCase]);


  /** Número do módulo extraído do título de uma apostila ("Módulo 3 — ..."). */
  const apostilaModuleNumber = (a: any): number =>
    Number(String(a?.title ?? "").match(/M[óo]dulo\s*(\d+)/i)?.[1] ?? 0);

  /**
   * "Carregar cenário": repassa o caso previsto no plano para o formulário de
   * geração — título, instruções (cenário + objetivos) e vínculo com o módulo
   * correspondente (todas as aulas marcadas) — e abre o formulário preenchido.
   */
  const openPlanCaseForm = (theme: PlanCaseTheme) => {
    const raw = (customTheme.trim() || theme.tema).trim();
    const title = sanitizeAITitle(raw, 300) || raw;
    setCustomTheme(title);
    setLastTheme(title);
    const ctx = [
      theme.cenario?.trim() ? `Cenário: ${theme.cenario.trim()}` : "",
      theme.objetivos?.trim() ? `Objetivos: ${theme.objetivos.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    setSelectedTheme(ctx);
    setPlanContext({ cenario: theme.cenario?.trim() || undefined, objetivos: theme.objetivos?.trim() || undefined });

    if (theme.modulo > 0) {
      const moduleApostilas = apostilas.filter((a: any) => apostilaModuleNumber(a) === theme.modulo);
      if (moduleApostilas.length) {
        const ids = moduleApostilas.map((a: any) => String(a.id));
        const lessons = sortNumeric(Array.from(new Set(moduleApostilas.flatMap((a: any) => extractLessons(a))))).map(String);
        setSelectedApostilaIds(ids);
        setSelectedLessonIds(lessons);
        onLessonChange?.(ids[0] ?? "", lessons);
      }
    }
    setEditingPlanTheme(false);
    setDialogOpen(true);
  };

  // Sync with prop if it changes from outside
  useEffect(() => {
    if (selectedLessons.length > 0) {
      setSelectedLessonIds(selectedLessons.map(String));
    }
  }, [selectedLessons]);

  // SELEÇÃO AUTOMÁTICA AO MARCAR MÓDULOS (USEEFFECT SINCRO) - Only run if no saved draft
  useEffect(() => {
    if (apostilas.length === 0) return;
    
    const savedData = localStorage.getItem(`clinical_case_draft_${disciplineId}`);
    if (savedData) return;

    const allLessonsFromSelectedModules = apostilas
      .filter((a: any) => selectedApostilaIds.map(String).includes(String(a.id)))
      .flatMap((a: any) => extractLessons(a))
      .map(String);
    
    setSelectedLessonIds(allLessonsFromSelectedModules);
  }, [selectedApostilaIds, apostilas, disciplineId]);

  const handleToggleApostila = (id: string | number) => {
    const targetId = String(id);
    setSelectedApostilaIds(prev => {
      const isOn = prev.map(String).includes(targetId);
      const next = isOn 
        ? prev.filter((x) => String(x) !== targetId) 
        : [...prev, targetId];
      return next;
    });
  };

  // FUNÇÃO DE TOGGLE DIRETA E SEM PARADA
  const toggleLesson = (lessonId: string | number) => {
    const targetId = String(lessonId);
    setSelectedLessonIds(prev => {
      const exists = prev.some(id => String(id) === targetId);
      const next = exists 
        ? prev.filter(id => String(id) !== targetId) 
        : [...prev, targetId];
      
      // Notify parent if needed
      onLessonChange?.(selectedApostilaIds[0] || "", next);
      return next;
    });
  };

  const refreshSuggestions = async (apostilaIds: string[], lessons: string[]) => {
    setLoadingSuggestions(true);
    try {
      const result = await getSuggestionsFn({ data: { 
        disciplineId, 
        selectedLesson: lessons.map(String).join(", "), 
        apostilaIds: apostilaIds.map(String).filter(isApostilaId)
      } });
      setSuggestions(result);
    } catch (error) {
      console.error("Error refreshing suggestions:", error);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  // RECALCULO DE SUGESTÕES DA IA (REATIVIDADE DE SUGESTÕES DA IA)
  useEffect(() => {
    if (selectedApostilaIds.length > 0 && selectedLessonIds.length > 0) {
      refreshSuggestions(selectedApostilaIds, selectedLessonIds);
    } else {
      setSuggestions([]);
    }
  }, [selectedApostilaIds, selectedLessonIds]);

  useEffect(() => {
    async function loadDisciplineInfo() {
      const { data } = await supabase
        .from("disciplines")
        .select("name, group_name")
        .eq("id", disciplineId)
        .maybeSingle();
      
      if (data) {
        setDisciplineName(data.name);
        setCourseName(data.group_name || "Saúde");
      }
    }
    loadDisciplineInfo();
  }, [disciplineId]);

  const onOpenChange = async (open: boolean) => {
    setDialogOpen(open);
    if (open && suggestions.length === 0) {
      if (selectedApostilaIds.length > 0 && selectedLessonIds.length > 0) {
        refreshSuggestions(selectedApostilaIds, selectedLessonIds);
      } else if (selectedApostilaIds.length > 0) {
        setLoadingSuggestions(true);
        try {
          const result = await getSuggestionsFn({ data: { 
            disciplineId, 
            selectedLesson: selectedLessonIds.join(", "), 
            apostilaIds: selectedApostilaIds 
          } });
          setSuggestions(result);
        } catch (error) {
          console.error("Error loading suggestions:", error);
        } finally {
          setLoadingSuggestions(false);
        }
      }
    }
  };



  const handleGenerateCase = async () => {
    const theme = (customTheme.trim() || selectedTheme).trim();
    if (!theme) return;
    setIsGenerating(true);
    setLastTheme(theme);
    try {
      const result = await generateDraftFn({
        data: {
          disciplineId,
          theme,
          apostilaId: primaryApostilaId,
          lessons: selectedLessonIds,
          difficulty,
          planScenario: planContext?.cenario,
          planObjectives: planContext?.objetivos,
          extraContext: selectedTheme.trim() || undefined,
        },
      });
      setDraft(result);
      clearDraft();
      setDialogOpen(false);
    } catch (error: any) {
      console.error("Error generating clinical case:", error);
      toast.error(error?.message || "Não foi possível gerar o caso clínico.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerate = async () => {
    if (!lastTheme) return;
    setIsGenerating(true);
    try {
      const result = await generateDraftFn({
        data: {
          disciplineId,
          theme: lastTheme,
          apostilaId: primaryApostilaId,
          lessons: selectedLessonIds,
          difficulty,
          planScenario: planContext?.cenario,
          planObjectives: planContext?.objetivos,
          extraContext: selectedTheme.trim() || undefined,
        },
      });
      setDraft(result);
      toast.success("Novo rascunho gerado.");
    } catch (error: any) {
      toast.error(error?.message || "Não foi possível regerar o caso clínico.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePublish = async () => {
    if (!draft) return;
    setPublishing(true);
    try {
      await publishCaseFn({
        data: {
          disciplineId,
          draft,
          apostilaId: primaryApostilaId,
          lessons: selectedLessonIds,
          diaryAssessmentId: selectedColumnId && selectedColumnId !== "none" ? selectedColumnId : undefined,
          dueDate: dueDate ? `${dueDate}T${dueTime}:00` : undefined,
          allowLateSubmission: allowLate,
          latePenaltyPerDay: latePenalty,
          replacePlannedCaseId: plannedCase?.id,
        },
      });
      toast.success("Caso clínico publicado para os alunos matriculados!");
      setDraft(null);
      clearDraft();
      setSelectedTheme("");
      setCustomTheme("");
      onPublished?.();
    } catch (error: any) {
      toast.error(error?.message || "Não foi possível publicar o caso clínico.");
    } finally {
      setPublishing(false);
    }
  };

  if (draft) {
    return (
      <>
        <ClinicalCaseDraftReview
          draft={draft}
          onChange={setDraft}
          onRegenerate={handleRegenerate}
          onPublish={handlePublish}
          onDiscard={() => { setDraft(null); clearDraft(); }}
          regenerating={isGenerating}
          publishing={publishing}
        />
        <AILoadingOverlay
          open={isGenerating}
          steps={["Regerando Caso Clínico com IA…", "Ajustando sinais vitais…", "Revisando condutas esperadas…"]}
        />
      </>
    );
  }

  return (
    <Card>
      <AILoadingOverlay
        open={isGenerating}
        steps={[
          "Gerando Caso Clínico com IA…",
          "Construindo ficha do paciente…",
          "Calculando sinais vitais e exames…",
          "Definindo condutas esperadas…",
        ]}
      />
      <CardHeader>
        <CardTitle>Gestão de Casos Clínicos</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {planCases.length > 1 && (
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Casos previstos no Plano de Aula ({planCases.length})
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {planCases.map((c, idx) => {
                const active = planTheme === c;
                return (
                  <button
                    key={`${c.modulo}-${idx}`}
                    type="button"
                    onClick={() => {
                      setPickedPlanIndex(idx);
                      setCustomTheme("");
                      setEditingPlanTheme(false);
                    }}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      active ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted/50"
                    }`}
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-primary/80">
                      {c.modulo_titulo || `Módulo ${c.modulo}`}
                    </div>
                    <div className="text-sm font-medium leading-snug">{c.tema}</div>
                    {c.cenario && <div className="mt-1 text-xs text-muted-foreground line-clamp-2">{c.cenario}</div>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {planTheme && (
          <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wide text-primary">
                  Caso previsto no Plano de Aula — {planTheme.modulo_titulo || `Módulo ${planTheme.modulo}`}
                </p>
                {editingPlanTheme ? (
                  <Input
                    autoFocus
                    value={customTheme || planTheme.tema}
                    onChange={(e) => setCustomTheme(e.target.value)}
                  />
                ) : (
                  <p className="text-base font-semibold leading-snug">
                    {customTheme.trim() || planTheme.tema}
                  </p>
                )}
              </div>
              <BrainCircuit className="h-6 w-6 shrink-0 text-primary/70" />
            </div>
            {(planTheme.cenario || planTheme.objetivos) && (
              <div className="space-y-1 text-xs text-muted-foreground">
                {planTheme.cenario && (
                  <p>
                    <span className="font-semibold text-foreground/80">Cenário:</span> {planTheme.cenario}
                  </p>
                )}
                {planTheme.objetivos && (
                  <p>
                    <span className="font-semibold text-foreground/80">Objetivos:</span> {planTheme.objetivos}
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Nível de dificuldade:</span>
              {([
                { value: "basico", label: "Básico" },
                { value: "intermediario", label: "Intermediário" },
                { value: "avancado", label: "Avançado" },
              ] as const).map((opt) => (
                <Button
                  key={opt.value}
                  type="button"
                  size="sm"
                  variant={difficulty === opt.value ? "default" : "outline"}
                  onClick={() => setDifficulty(opt.value)}
                >
                  {opt.label}
                </Button>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                size="lg"
                disabled={isGenerating || loadingApostilas}
                onClick={() => openPlanCaseForm(planTheme)}
              >
                <Sparkles className="mr-2 h-4 w-4" /> Carregar cenário e gerar Caso Clínico
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={() => {
                  setEditingPlanTheme((v) => !v);
                  if (!editingPlanTheme && !customTheme.trim()) setCustomTheme(planTheme.tema);
                }}
              >
                {editingPlanTheme ? "Concluir edição" : "Editar tema"}
              </Button>
              <Button
                variant="ghost"
                size="lg"
                onClick={() => {
                  // Novo tema livre: limpa o vínculo com o caso do plano.
                  setPlanContext(null);
                  setCustomTheme("");
                  setSelectedTheme("");
                  setDialogOpen(true);
                }}
              >
                Gerar novo tema
              </Button>
            </div>
          </div>
        )}

        <Dialog open={dialogOpen} onOpenChange={onOpenChange}>
          <DialogTrigger asChild>
            <Button size="lg" className="w-full">
              <Plus className="mr-2 h-5 w-5" /> Gerar Novo Caso com IA
            </Button>
          </DialogTrigger>
          <DialogContent 
            className="max-w-2xl max-h-[92vh] overflow-y-auto"
            onInteractOutside={(e) => e.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle>Gerar Novo Caso Clínico com IA</DialogTitle>
              <DialogDescription>
                Selecione o tema e vincule aos conteúdos da disciplina para que a IA crie um caso didático personalizado.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {/* PADRONIZAÇÃO PROFESSOR: 1. Título, 2. Vínculo, 3. Descrição/Instruções, 4. Data Limite, 5. Rubrica */}
              
              <div className="space-y-1.5">
                <label className="text-sm font-medium">1. Título do Caso Clínico <span className="text-destructive">*</span></label>
                <Input 
                  value={customTheme} 
                  onChange={(e) => setCustomTheme(e.target.value)} 
                  placeholder="Ex: Manejo da Crise Hipertensiva na Gestação"
                />
                {suggestions.length > 0 && !loadingSuggestions && (
                  <div className="pt-1">
                    <label className="text-[10px] text-muted-foreground uppercase font-bold px-1">Sugestões baseadas nas aulas ({selectedLessonIds.length}):</label>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {suggestions.slice(0, 4).map(s => (
                        <Button 
                          key={s} 
                          variant="ghost" 
                          size="sm" 
                          className="h-auto py-1 px-3 text-[10px] bg-primary/5 hover:bg-primary/10 text-primary border border-primary/20 whitespace-normal text-left break-words"
                          onClick={() => setCustomTheme(s)}
                        >
                          {s}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Nível de Dificuldade</label>
                <div className="flex flex-wrap gap-2">
                  {([
                    { value: "basico", label: "Básico" },
                    { value: "intermediario", label: "Intermediário" },
                    { value: "avancado", label: "Avançado" },
                  ] as const).map((opt) => (
                    <Button
                      key={opt.value}
                      type="button"
                      size="sm"
                      variant={difficulty === opt.value ? "default" : "outline"}
                      onClick={() => setDifficulty(opt.value)}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-3 p-3 bg-muted/30 rounded-lg border">
                <label className="text-sm font-medium">2. Vínculo com Módulos e Aulas <span className="text-destructive">*</span></label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-muted-foreground uppercase font-bold">Módulos</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-between font-normal h-9 text-xs">
                          {loadingApostilas
                            ? "Carregando..."
                            : selectedApostilaIds.length === 0
                              ? "Selecionar..."
                              : `${selectedApostilaIds.length} módulo(s)`}
                          <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[--radix-popover-trigger-width] p-2" align="start">
                        <div className="max-h-[220px] overflow-y-auto space-y-1">
                          {apostilas.map((a: any) => {
                            const checked = selectedApostilaIds.map(String).includes(String(a.id));
                            return (
                            <label
                              key={a.id}
                              className={`flex items-start gap-2 rounded-md p-2 hover:bg-muted cursor-pointer text-sm transition-colors ${checked ? 'bg-primary/10 border border-primary/20' : ''}`}
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={() => handleToggleApostila(a.id)}
                                className="mt-0.5"
                              />
                              <span className="leading-snug">{a.title}</span>
                            </label>
                          );})}
                          {!loadingApostilas && apostilas.length === 0 && (
                            <p className="p-2 text-[10px] italic text-muted-foreground">
                              Nenhum módulo encontrado. Gere um Plano de Aula ou uma Apostila para esta disciplina.
                            </p>
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] text-muted-foreground uppercase font-bold">Lançar no Diário</label>
                    <select
                      className="w-full h-9 rounded-md border bg-background px-2 text-xs"
                      value={selectedColumnId}
                      onChange={(e) => setSelectedColumnId(e.target.value)}
                    >
                      <option value="none">Não lançar nota</option>
                      {diaryColumns.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] text-muted-foreground uppercase font-bold">
                      Aulas / Etapas Selecionadas ({selectedLessonIds.length}/{availableLessons.length})
                    </label>
                    {availableLessons.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const allSelected = selectedLessonIds.length === availableLessons.length && availableLessons.length > 0;
                          const next = allSelected ? [] : availableLessons.map(String);
                          setSelectedLessonIds(next);
                          onLessonChange?.(selectedApostilaIds[0] || "", next);
                        }}
                        className="text-[10px] font-semibold text-primary hover:text-primary/80 underline-offset-2 hover:underline disabled:opacity-50 disabled:pointer-events-none"
                        disabled={availableLessons.length === 0}
                      >
                        {selectedLessonIds.length === availableLessons.length && availableLessons.length > 0
                          ? "Desmarcar Todas"
                          : "Selecionar Todas"}
                      </button>
                    )}
                  </div>
                  <div className="max-h-[120px] overflow-y-auto border bg-background rounded-md p-2 space-y-1.5">
                    {availableLessons.map(l => {
                      // CONVERSÃO E COMPARAÇÃO DE IDs ( STRING DRIVEN )
                      const isSelected = selectedLessonIds.some(id => String(id) === String(l));
                      return (
                        <div 
                          key={l} 
                          // VÍNCULO DE CLIQUE NA DIV DA AULA ( UI & CHECKMARK )
                          className={`flex items-center gap-3 p-2.5 hover:bg-slate-50 rounded-lg select-none cursor-pointer transition-colors border ${isSelected ? 'border-teal-100 bg-teal-50/30' : 'border-transparent'}`}
                          onClick={() => toggleLesson(l)}
                        >
                          {/* Estilização do Ícone de Check quando selecionada */}
                          <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded transition-all duration-200 ${
                            isSelected 
                              ? 'bg-[#0d9488] border-[#0d9488] shadow-sm' 
                              : 'border-2 border-slate-300 bg-white'
                          }`}>
                            {isSelected && <Check className="h-3.5 w-3.5 text-white stroke-[3px]" />}
                          </div>
                          <span className={`text-[11px] leading-snug transition-colors ${isSelected ? 'text-teal-900 font-semibold' : 'text-slate-600'}`}>
                            {l}
                          </span>
                        </div>
                      );
                    })}
                    {availableLessons.length === 0 && (
                      <p className="text-[10px] text-muted-foreground p-2 text-center italic">
                        {selectedApostilaIds.length === 0
                          ? "Selecione ao menos um módulo para listar as aulas"
                          : "Módulo prático/avaliativo sem aulas teóricas — você pode salvar o caso clínico assim mesmo."}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* GRUPO DE IA PADRONIZADO (Atividades Extras): elaboração e vinculação */}
              <div className="mb-2 flex flex-wrap gap-2">
                <Button size="sm" type="button" onClick={() => void elaborateWithAI()} disabled={elaborating || isGenerating}>
                  {elaborating ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5 mr-1" />
                  )}
                  Elaborar Caso Clínico completo com IA
                </Button>
                <Button size="sm" variant="outline" type="button" onClick={openSyllabusPicker} disabled={elaborating || isGenerating}>
                  <Sparkles className="h-3.5 w-3.5 mr-1" /> Vincular Ementa da IA
                </Button>
                <Button size="sm" variant="outline" type="button" onClick={openCaseStudyPicker} disabled={elaborating || isGenerating}>
                  <Sparkles className="h-3.5 w-3.5 mr-1" /> Vincular Caso Clínico da IA
                </Button>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">3. Instruções / Contexto Adicional (IA)</label>
                <Textarea
                  rows={elaborating ? 6 : 3}
                  disabled={elaborating}
                  value={selectedTheme} 
                  onChange={(e) => setSelectedTheme(e.target.value)}
                  placeholder="Ex: Focar em sinais de choque hipovolêmico e exames de imagem..."
                />
                <p className="text-[10px] text-muted-foreground">Opcional. Ajuda a IA a personalizar o cenário clínico.</p>
              </div>

              <div className="grid grid-cols-2 gap-3 p-3 bg-muted/30 rounded-lg border">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">4. Data Limite de Entrega</label>
                  <Input 
                    type="date" 
                    className="h-9"
                    value={dueDate} 
                    onChange={(e) => setDueDate(e.target.value)} 
                  />
                </div>
                <div className="flex flex-col justify-end gap-2 pb-1">
                  <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                    <Checkbox checked={allowLate} onCheckedChange={(v) => setAllowLate(v === true)} />
                    Aplicar penalidade por atraso
                  </label>
                  {allowLate && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">Desconto/dia:</span>
                      <Input 
                        type="number" 
                        className="h-6 w-12 text-[10px] px-1" 
                        value={latePenalty} 
                        onChange={(e) => setLatePenalty(Number(e.target.value))} 
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="p-3 bg-primary/5 rounded-lg border border-primary/10 flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium">5. Rubrica e Critérios</label>
                  <p className="text-[10px] text-muted-foreground">A IA gerará a rubrica padrão do SimulClinic automaticamente.</p>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-primary font-bold">
                  <Check className="h-4 w-4" /> PADRÃO SIMULCLINIC
                </div>
              </div>

              {loadingSuggestions ? (
                <div className="flex flex-col items-center justify-center py-4 text-muted-foreground gap-2">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <p className="text-xs">Gerando eixos didáticos...</p>
                </div>
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={handleGenerateCase} disabled={isGenerating || !customTheme.trim()}>
                {isGenerating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                Gerar Rascunho com IA
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {showCaseStudies && (
          <Dialog open onOpenChange={(o) => !o && setShowCaseStudies(false)}>
            <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Estudos de Caso gerados pela IA</DialogTitle>
                <DialogDescription>
                  Selecione um estudo de caso para vincular como contexto deste caso clínico.
                </DialogDescription>
              </DialogHeader>
              {loadingCS ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              ) : caseStudies.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Nenhum estudo de caso ainda. Gere pelo Assistente de IA &rarr; Estudo de caso.
                </p>
              ) : (
                <div className="space-y-2">
                  {caseStudies.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => attachCaseStudy(c.id, c.title)}
                      className="w-full text-left rounded border p-3 hover:bg-accent transition"
                    >
                      <div className="text-sm font-medium">{sanitizeListTitle(c.title)}</div>
                    </button>
                  ))}
                </div>
              )}
            </DialogContent>
          </Dialog>
        )}
        {showSyllabi && (
          <Dialog open onOpenChange={(o) => !o && setShowSyllabi(false)}>
            <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Ementas geradas pela IA</DialogTitle>
                <DialogDescription>
                  Selecione uma ementa para vincular como contexto deste caso clínico.
                </DialogDescription>
              </DialogHeader>
              {loadingSyl ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              ) : syllabi.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Nenhuma ementa ainda. Gere pelo Assistente de IA &rarr; Ementa de Atividade/Trabalho.
                </p>
              ) : (
                <div className="space-y-2">
                  {syllabi.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => attachSyllabus(c.id, c.title)}
                      className="w-full text-left rounded border p-3 hover:bg-accent transition"
                    >
                      <div className="text-sm font-medium">{sanitizeListTitle(c.title)}</div>
                    </button>
                  ))}
                </div>
              )}
            </DialogContent>
          </Dialog>
        )}
      </CardContent>
    </Card>
  );
};
