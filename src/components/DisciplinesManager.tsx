import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { DisciplineCard, type DisciplineCardData } from "./DisciplineCard";
import { DisciplineFormDialog, type DisciplineEditing } from "./DisciplineFormDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Search, Loader2 } from "lucide-react";
import { GripVertical } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { EmptyState } from "@/components/EmptyState";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  copyDisciplineToNextSemester,
  setDisciplineStatus,
  deleteDiscipline,
  reorderDisciplines,
} from "@/backend/disciplines.functions";
import { getTeacherDisciplines } from "@/backend/teacher-disciplines.functions";
import { useSubscription } from "@/hooks/use-subscription";
import { UpgradeRequiredDialog } from "@/components/UpgradeRequiredDialog";

interface Row {
  id: string;
  name: string;
  code: string | null;
  group_name: string | null;
  semester: string;
  year: number;
  color: string;
  status: "active" | "archived";
  syllabus_text: string | null;
  start_date: string | null;
  end_date: string | null;
  week_days: string[] | null;
  class_start_time: string | null;
  class_end_time: string | null;
  sort_order: number | null;
}

// Paleta harmônica usada para garantir uma cor de destaque única por disciplina.
const DISTINCT_PALETTE = [
  "teal", "blue", "purple", "orange", "green",
  "pink", "indigo", "amber", "cyan", "rose", "red", "lime",
] as const;

/** Mantém a cor escolhida pelo professor, mas resolve duplicatas com a paleta. */
function assignDistinctColors<T extends { color: string }>(rows: T[]): T[] {
  const used = new Set<string>();
  return rows.map((row) => {
    let color = row.color;
    if (!color || used.has(color)) {
      color = DISTINCT_PALETTE.find((c) => !used.has(c)) ?? row.color;
    }
    used.add(color);
    return { ...row, color };
  });
}

function SortableDisciplineItem({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative ${isDragging ? "z-50 opacity-80" : ""}`}
    >
      <button
        type="button"
        aria-label="Arrastar para reordenar"
        className="absolute left-2 top-2 z-10 rounded-md bg-white/20 p-1 text-white cursor-grab active:cursor-grabbing touch-none hover:bg-white/30"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      {children}
    </div>
  );
}

export function DisciplinesManager() {
  const { user } = useAuth();
  const { isPaid } = useSubscription();
  const [items, setItems] = useState<DisciplineCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"active" | "archived">("active");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DisciplineEditing | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DisciplineCardData | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const activeCount = items.filter((d) => d.status === "active").length;

  const handleCreate = () => {
    // Free plan: only 1 active discipline. Block before opening the form.
    if (!isPaid && view === "active" && activeCount >= 1) {
      setUpgradeOpen(true);
      return;
    }
    setEditing(null);
    setDialogOpen(true);
  };


  const copyFn = useServerFn(copyDisciplineToNextSemester);
  const statusFn = useServerFn(setDisciplineStatus);
  const deleteFn = useServerFn(deleteDiscipline);
  const reorderFn = useServerFn(reorderDisciplines);
  const getTeacherDisciplinesFn = useServerFn(getTeacherDisciplines);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    
    // Usamos supabaseAdmin se o usuário for admin ou se houver erro no client
    // para garantir a exibição das disciplinas sem falhas de RLS.
    let disciplines: Row[] = [];
    
    try {
      const data = await getTeacherDisciplinesFn({ data: { status: view } });
      disciplines = (data || []) as Row[];

      const ids = disciplines.map((d) => d.id);
      let counts: Record<string, number> = {};
      
      if (ids.length) {
        const { data: enrolls } = await supabase
          .from("discipline_students")
          .select("discipline_id")
          .in("discipline_id", ids);
        
        counts = (enrolls ?? []).reduce<Record<string, number>>((acc, r) => {
          acc[r.discipline_id as string] = (acc[r.discipline_id as string] ?? 0) + 1;
          return acc;
        }, {});
      }

      setItems(
        assignDistinctColors(disciplines.map((d) => ({
          id: d.id,
          name: d.name,
          code: d.code,
          group_name: d.group_name,
          semester: d.semester,
          year: d.year,
          color: d.color,
          status: d.status,
          studentCount: counts[d.id] ?? 0,
          start_date: d.start_date,
          end_date: d.end_date,
          week_days: d.week_days,
          class_start_time: d.class_start_time,
          class_end_time: d.class_end_time,
        }))),
      );
    } catch (err) {
      console.error("[DisciplinesManager] Fetch failed:", err);
      toast.error("Erro ao carregar disciplinas. Verifique sua conexão.");
    } finally {
      setLoading(false);
    }
  }, [user, view, getTeacherDisciplinesFn]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = items.filter((d) =>
    d.name.toLowerCase().includes(search.toLowerCase()),
  );

  const canReorder = search.trim() === "";

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((d) => d.id === active.id);
    const newIndex = items.findIndex((d) => d.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(items, oldIndex, newIndex);
    setItems(next);
    try {
      await reorderFn({ data: { ordered_ids: next.map((d) => d.id) } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar a ordem");
      load();
    }
  };

  const handleEdit = async (id: string) => {
    const { data } = await supabase.from("disciplines").select("*").eq("id", id).maybeSingle();
    if (data) {
      setEditing(data as DisciplineEditing);
      setDialogOpen(true);
    }
  };

  const handleCopy = async (id: string) => {
    const { data } = await supabase.from("disciplines").select("semester,year,group_name").eq("id", id).maybeSingle();
    if (!data) return;
    const nextSemester = data.semester === "1" ? "2" : "1";
    const nextYear = nextSemester === "1" ? Number(data.year) + 1 : Number(data.year);
    try {
      await copyFn({ data: {
        discipline_id: id, semester: nextSemester, year: nextYear,
        group_name: data.group_name ?? undefined,
      }});
      toast.success(`Copiada para ${nextSemester}º/${nextYear} (materiais e estrutura, sem alunos)`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao copiar");
    }
  };

  const handleArchive = async (id: string, target: "active" | "archived") => {
    try {
      await statusFn({ data: { discipline_id: id, status: target }});
      toast.success(target === "archived" ? "Disciplina arquivada" : "Disciplina restaurada");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  const handleDelete = async (force = false) => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteFn({ data: {
        discipline_id: deleteTarget.id,
        confirm_name: deleteConfirmName,
        force,
      }});
      toast.success("Disciplina excluída");
      setDeleteTarget(null);
      setDeleteConfirmName("");
      load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro";
      if (msg.includes("force=true")) {
        // Re-throw via a confirm: ask if they want to force
        if (confirm(`${msg}\n\nDeseja excluir mesmo assim?`)) {
          await handleDelete(true);
        }
      } else {
        toast.error(msg);
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Disciplinas</h2>
          <p className="text-sm text-white/80">
            Toda matéria, atividade, frequência e nota acontece dentro de uma disciplina.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" /> Nova disciplina
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative flex-1">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/70" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome"
            className="pl-9 bg-white/10 border-white/40 text-white placeholder:text-white/70 focus-visible:ring-white/50"
          />
        </div>
        <Tabs value={view} onValueChange={(v) => setView(v as "active" | "archived")}>
          <TabsList>
            <TabsTrigger value="active">Ativas</TabsTrigger>
            <TabsTrigger value="archived">Arquivadas</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl overflow-hidden bg-white/5 border border-white/10 animate-pulse">
              <div className="h-36 bg-white/10" />
              <div className="p-4 space-y-3">
                <div className="h-4 w-3/4 bg-white/10 rounded" />
                <div className="flex justify-between">
                  <div className="h-3 w-1/2 bg-white/5 rounded" />
                  <div className="h-3 w-8 bg-white/5 rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          message={view === "active" ? "Nenhuma disciplina ainda." : "Nenhuma disciplina arquivada."}
          hint={view === "active" ? "Crie sua primeira disciplina e comece a organizar tudo no EstudaJá Pro." : "As disciplinas que você arquivar aparecerão aqui."}
          actionLabel={view === "active" ? "Nova disciplina" : undefined}
          onAction={view === "active" ? handleCreate : undefined}
        />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={filtered.map((d) => d.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((d) => {
                const card = (
                  <DisciplineCard
                    discipline={d}
                    href={`/disciplines/${d.id}`}
                    onEdit={() => handleEdit(d.id)}
                    onCopy={() => handleCopy(d.id)}
                    onArchive={() => handleArchive(d.id, "archived")}
                    onUnarchive={() => handleArchive(d.id, "active")}
                    onDelete={() => setDeleteTarget(d)}
                  />
                );
                return canReorder ? (
                  <SortableDisciplineItem key={d.id} id={d.id}>
                    {card}
                  </SortableDisciplineItem>
                ) : (
                  <div key={d.id}>{card}</div>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <DisciplineFormDialog open={dialogOpen} onOpenChange={setDialogOpen} initial={editing} onSaved={load} />
      <UpgradeRequiredDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} reason="discipline" />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) { setDeleteTarget(null); setDeleteConfirmName(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir disciplina?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é <strong>permanente</strong> e removerá todos os dados associados a{" "}
              <strong>{deleteTarget?.name}</strong>.
              {deleteTarget && deleteTarget.studentCount > 0 && (
                <span className="block mt-2 text-destructive">
                  Atenção: existem {deleteTarget.studentCount} estudante(s) matriculado(s).
                  Considere arquivar para preservar o histórico.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <p className="text-sm">
              Para confirmar, digite o nome da disciplina: <strong>{deleteTarget?.name}</strong>
            </p>
            <Input
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              placeholder="Digite o nome exato"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(false); }}
              disabled={deleting || !deleteTarget || deleteConfirmName.trim().toLowerCase() !== deleteTarget.name.trim().toLowerCase()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir definitivamente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}