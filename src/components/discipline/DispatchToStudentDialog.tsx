import { useEffect, useState } from "react";
import { sortItemsNumerically } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import {
  dispatchAIToStudent,
  listMaterialModulesForDispatch,
} from "@/backend/ai-dispatch.functions";
import { publishExerciseListAsExercise } from "@/backend/ai-assistant.functions";
import { deriveSlidesTitle } from "@/lib/ai-content";

type Target = "activity" | "academic_work" | "material";

const ACTIVITY_SUBTYPES: Array<{ value: string; label: string }> = [
  { value: "redacao", label: "Redação" },
  { value: "seminario", label: "Seminário" },
  { value: "debate", label: "Debate" },
  { value: "visita_tecnica", label: "Visita Técnica" },
  { value: "aula_pratica", label: "Aula Prática" },
  { value: "workshop", label: "Workshop" },
  { value: "case_study", label: "Estudo de Caso" },
  { value: "care_plan", label: "Plano de Cuidados" },
  { value: "pharmaceutical_plan", label: "Plano Farmacêutico" },
  { value: "practical_report", label: "Relatório Prático" },
  { value: "free_activity", label: "Atividade Livre" },
];

const WORK_SUBTYPES: Array<{ value: string; label: string }> = [
  { value: "tema_predefinido", label: "Tema pré-definido" },
  { value: "artigo_cientifico", label: "Artigo Científico" },
  { value: "revisao_literatura", label: "Revisão de Literatura" },
  { value: "estudo_caso_academico", label: "Estudo de Caso Acadêmico" },
  { value: "projeto_intervencao", label: "Projeto de Intervenção" },
  { value: "relatorio_pesquisa", label: "Relatório de Pesquisa" },
  { value: "resumo_expandido", label: "Resumo Expandido" },
  { value: "poster_cientifico", label: "Pôster Científico" },
  { value: "tcc", label: "TCC" },
];

/** Sugere o destino padrão e o subtipo a partir da ferramenta de IA. */
function suggestDefaults(tool: string): {
  target: Target;
  activity_subtype?: string;
  work_subtype?: string;
} {
  switch (tool) {
    case "case_study":
      return { target: "activity", activity_subtype: "case_study" };
    case "essay_prompt":
      return { target: "activity", activity_subtype: "redacao" };
    case "exercise_list":
    case "quiz":
      return { target: "activity", activity_subtype: "free_activity" };
    case "syllabus":
    case "activity_syllabus":
      return { target: "activity", activity_subtype: "free_activity" };
    case "apostila":
    case "slides":
    case "study_guide":
      return { target: "material" };
    default:
      return { target: "activity", activity_subtype: "free_activity" };
  }
}

export function DispatchToStudentDialog({
  generationId,
  disciplineId,
  tool,
  defaultTitle,
  contentMarkdown,
  onClose,
  onSent,
}: {
  generationId: string;
  disciplineId: string;
  tool: string;
  defaultTitle: string;
  contentMarkdown: string;
  onClose: () => void;
  onSent?: () => void;
}) {
  // O "Criador de Exercícios" gera exercícios que o aluno resolve pelo app.
  // Nesse caso o conteúdo é publicado no módulo "Exercícios" do aluno (não em
  // Atividades/Trabalhos/Materiais) e não tem tipo nem data de entrega, pois
  // não valem nota.
  const isExercise = tool === "exercise_list";
  const defaults = suggestDefaults(tool);
  const [target, setTarget] = useState<Target>(defaults.target);
  const [activitySubtype, setActivitySubtype] = useState(defaults.activity_subtype ?? "free_activity");
  const [workSubtype, setWorkSubtype] = useState(defaults.work_subtype ?? "tema_predefinido");
  const [title, setTitle] = useState(
    tool === "slides" ? deriveSlidesTitle(contentMarkdown) ?? defaultTitle : defaultTitle,
  );
  const [date, setDate] = useState<string>(() => {
    const d = new Date(Date.now() + 7 * 86400000);
    return d.toISOString().slice(0, 10);
  });
  const [time, setTime] = useState("23:59");
  const [publish, setPublish] = useState(true);
  const [moduleId, setModuleId] = useState<string>("");
  const [modules, setModules] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (target !== "material") return;
    setLoading(true);
    listMaterialModulesForDispatch({ data: { discipline_id: disciplineId } })
      .then((r) => setModules(sortItemsNumerically(r.items as Array<{ id: string; name: string }>)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [target, disciplineId]);

  const showDueDate = target === "activity" || target === "academic_work";

  const submit = async () => {
    if (!title.trim()) {
      toast.error("Informe um título");
      return;
    }
    setBusy(true);
    try {
      if (isExercise) {
        const res = await publishExerciseListAsExercise({
          data: { generation_id: generationId, title: title.trim() },
        });
        const count = (res as { question_count?: number })?.question_count ?? 0;
        toast.success(`Exercício publicado no módulo Exercícios (${count} questões).`);
        onSent?.();
        onClose();
        return;
      }
      let dueAt: string | null = null;
      if (showDueDate && date) {
        const local = new Date(`${date}T${time || "23:59"}:00`);
        dueAt = local.toISOString();
      }
      await dispatchAIToStudent({
        data: {
          generation_id: generationId,
          target,
          title: title.trim(),
          content_markdown: contentMarkdown,
          publish,
          activity_subtype: target === "activity" ? (activitySubtype as never) : undefined,
          work_subtype: target === "academic_work" ? (workSubtype as never) : undefined,
          due_at: dueAt,
          module_id: target === "material" && moduleId ? moduleId : undefined,
        },
      });
      toast.success(
        target === "material"
          ? publish ? "Material publicado para os alunos" : "Material salvo como rascunho"
          : publish ? "Conteúdo liberado para os alunos" : "Salvo como rascunho",
      );
      onSent?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao enviar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Enviar conteúdo para o aluno</DialogTitle>
          <DialogDescription>
            {isExercise
              ? "O exercício será publicado no módulo Exercícios da página do aluno. O aluno pode responder várias vezes (com questões e alternativas embaralhadas) e baixar o PDF com o cabeçalho padrão."
              : "O conteúdo aparecerá diretamente na seção correspondente da página do aluno (Atividades Extras, Trabalhos Acadêmicos ou Materiais), com cabeçalho institucional no topo. O prazo de entrega é definido aqui."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Onde publicar</Label>
            <Select
              value={isExercise ? "exercise" : target}
              onValueChange={(v) => setTarget(v as Target)}
              disabled={isExercise}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {isExercise ? (
                  <SelectItem value="exercise">Exercícios</SelectItem>
                ) : (
                  <>
                    <SelectItem value="activity">Atividade Extra</SelectItem>
                    <SelectItem value="academic_work">Trabalho Acadêmico</SelectItem>
                    <SelectItem value="material">Materiais Didáticos</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Título</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </div>

          {!isExercise && target === "activity" && (
            <div>
              <Label className="text-xs">Tipo da atividade</Label>
              <Select value={activitySubtype} onValueChange={setActivitySubtype}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTIVITY_SUBTYPES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {!isExercise && target === "academic_work" && (
            <div>
              <Label className="text-xs">Tipo de trabalho</Label>
              <Select value={workSubtype} onValueChange={setWorkSubtype}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WORK_SUBTYPES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {!isExercise && target === "material" && (
            <div>
              <Label className="text-xs">Módulo de Materiais</Label>
              <Select value={moduleId} onValueChange={setModuleId} disabled={loading}>
                <SelectTrigger>
                  <SelectValue placeholder={loading ? "Carregando..." : "Selecione (ou deixe automático)"} />
                </SelectTrigger>
                <SelectContent>
                  {modules.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">
                Se não escolher, o sistema cria/usa o módulo &quot;Materiais didáticos&quot;.
              </p>
            </div>
          )}

          {!isExercise && showDueDate && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Data de entrega</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Hora</Label>
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
            </div>
          )}

          {!isExercise && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={publish}
                onChange={(e) => setPublish(e.target.checked)}
              />
              Liberar imediatamente para os alunos
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            {isExercise
              ? "Publicar exercício"
              : publish ? "Publicar para os alunos" : "Salvar como rascunho"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}