import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { saveCalendarEvent, deleteCalendarEvent, updateSourceDueDate } from "@/backend/calendar.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, Pencil, CalendarDays, ClipboardList, GraduationCap, Dumbbell, FileText, Stethoscope } from "lucide-react";
import { toast } from "sonner";
import { ACTIVITY_SUBTYPE_LABELS, WORK_SUBTYPE_LABELS } from "@/lib/rubric-library";
import { buildCalendarEventTitle, extractLessonReference, formatEventTimeLine, normalizeDueDate, stripReferenceSuffix } from "@/lib/calendar-titles";

interface CalEvent {
  id: string; title: string; description: string | null;
  event_date: string; end_date: string | null; kind: string;
  source: "custom" | "activity" | "work" | "exercise" | "case" | "assessment";
  source_id?: string;
  raw_title?: string;
  reference?: string | null;
}

export function CalendarModule({ disciplineId, isTeacher, onOpenClinicalCases }: { disciplineId: string; isTeacher: boolean; onOpenClinicalCases?: () => void }) {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: customs }, { data: acts }, { data: works }, { data: exs }, { data: cases }, { data: assessments }] = await Promise.all([
      supabase.from("calendar_events").select("*").eq("discipline_id", disciplineId).order("event_date"),
      supabase.from("activities").select("id,title,due_at,status,subtype,instructions").eq("discipline_id", disciplineId).not("due_at", "is", null),
      supabase.from("academic_works").select("id,title,due_at,status,subtype,instructions").eq("discipline_id", disciplineId).not("due_at", "is", null),
      supabase.from("exercises").select("id,title,due_at,status,module_label,topic").eq("discipline_id", disciplineId).not("due_at", "is", null),
      supabase.from("clinical_cases").select("id,title,due_date,status,description").eq("discipline_id", disciplineId).not("due_date", "is", null),
      supabase.from("assessments").select("id,title,assessment_date,status,module_name").eq("discipline_id", disciplineId).not("assessment_date", "is", null),
    ]);
    const all: CalEvent[] = [];
    for (const c of customs ?? []) all.push({ id: c.id, title: c.title, description: c.description, event_date: c.event_date, end_date: c.end_date, kind: c.kind, source: "custom" });
    for (const a of acts ?? []) {
      if (!isTeacher && a.status !== "published") continue;
      const ref = extractLessonReference(a.title, a.instructions);
      const label = ACTIVITY_SUBTYPE_LABELS[a.subtype as string] ?? "Atividade Extra";
      all.push({ id: `act-${a.id}`, source_id: a.id, raw_title: a.title, reference: ref, title: buildCalendarEventTitle(label, a.title, ref), description: null, event_date: a.due_at!, end_date: null, kind: "activity_due", source: "activity" });
    }
    for (const w of works ?? []) {
      if (!isTeacher && w.status !== "published") continue;
      const ref = extractLessonReference(w.title, w.instructions);
      const label = WORK_SUBTYPE_LABELS[w.subtype as string] ?? "Trabalho Acadêmico";
      all.push({ id: `wrk-${w.id}`, source_id: w.id, raw_title: w.title, reference: ref, title: buildCalendarEventTitle(label, w.title, ref), description: null, event_date: w.due_at!, end_date: null, kind: "work_due", source: "work" });
    }
    for (const ex of exs ?? []) {
      if (!isTeacher && ex.status !== "published") continue;
      const ref = extractLessonReference(ex.module_label, ex.title, ex.topic);
      all.push({ id: `exr-${ex.id}`, source_id: ex.id, raw_title: ex.title, reference: ref, title: buildCalendarEventTitle("Exercício", ex.title, ref), description: null, event_date: ex.due_at!, end_date: null, kind: "exercise_due", source: "exercise" });
    }
    for (const c of cases ?? []) {
      if (!isTeacher && c.status !== "published") continue;
      const ref = extractLessonReference(c.title, c.description);
      all.push({ id: `cas-${c.id}`, source_id: c.id, raw_title: c.title, reference: ref, title: buildCalendarEventTitle("Caso Clínico", c.title, ref), description: null, event_date: c.due_date!, end_date: null, kind: "clinical_case_due", source: "case" });
    }
    for (const av of assessments ?? []) {
      if (!isTeacher && av.status === "draft") continue;
      const ref = extractLessonReference(av.module_name, av.title);
      all.push({ id: `avl-${av.id}`, source_id: av.id, raw_title: av.title, reference: ref, title: buildCalendarEventTitle("Avaliação", av.title, ref), description: null, event_date: av.assessment_date || new Date(`${av.assessment_date}T23:59:00`).toISOString(), end_date: null, kind: "assessment_due", source: "assessment" });
    }
    all.sort((a, b) => a.event_date.localeCompare(b.event_date));
    setEvents(all);
    setLoading(false);
  }, [disciplineId, isTeacher]);
  useEffect(() => { load(); }, [load]);

  const [editing, setEditing] = useState<CalEvent | null>(null);

  const iconFor = (e: CalEvent) => e.source === "activity" ? ClipboardList : e.source === "work" || e.source === "assessment" ? GraduationCap : e.source === "exercise" ? Dumbbell : e.source === "case" ? Stethoscope : FileText;

  const groupByMonth = events.reduce<Record<string, CalEvent[]>>((acc, e) => {
    const d = new Date(e.event_date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    (acc[key] ??= []).push(e);
    return acc;
  }, {});

  const MONTH_PALETTE = [
    { bg: "bg-category-plano-bg", border: "border-category-plano-border", text: "text-category-plano-text" },
    { bg: "bg-category-apostila-bg", border: "border-category-apostila-border", text: "text-category-apostila-text" },
    { bg: "bg-category-aula-bg", border: "border-category-aula-border", text: "text-category-aula-text" },
    { bg: "bg-category-outros-bg", border: "border-category-outros-border", text: "text-category-outros-text" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><CalendarDays className="h-5 w-5" /> Calendário</h2>
          <p className="text-sm text-muted-foreground">Prazos e eventos da disciplina</p>
        </div>
        {isTeacher && <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4 mr-2" /> Novo evento</Button>}
      </div>
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : Object.keys(groupByMonth).length === 0 ? (
        <div className="border-2 border-dashed rounded-xl py-12 text-center text-sm text-muted-foreground">Nenhum evento.</div>
      ) : Object.entries(groupByMonth).map(([month, list], idx) => {
        const [y, m] = month.split("-").map(Number);
        const palette = MONTH_PALETTE[(m - 1) % MONTH_PALETTE.length];
        void idx;
        return (
        <div key={month} className={`rounded-xl border-2 ${palette.border} ${palette.bg} p-4 space-y-2`} style={{ boxShadow: "var(--shadow-card)" }}>
          <div className={`text-xs uppercase font-semibold ${palette.text}`}>
            {new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
          </div>
          {list.map((e) => {
            const Icon = iconFor(e);
            return (
              <div key={e.id} className={`flex items-start gap-3 py-2 border-t first:border-t-0 ${palette.border}`}>
                <div className="text-center shrink-0 w-12">
                  <div className="text-xl font-bold leading-none">{new Date(e.event_date).getDate()}</div>
                  <div className="text-[10px] uppercase text-muted-foreground">{new Date(e.event_date).toLocaleDateString("pt-BR", { weekday: "short" })}</div>
                </div>
                <Icon className={`h-4 w-4 mt-1 ${palette.text}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                    {e.source === "case" ? (
                      <button
                        type="button"
                        className="text-left underline decoration-dotted hover:text-primary"
                        onClick={() => onOpenClinicalCases?.()}
                      >
                        {e.title}
                      </button>
                    ) : (
                      <span>{e.title}</span>
                    )}
                    {e.source === "case" && (
                      <span className="rounded-full border border-category-plano-border bg-category-plano-bg px-2 py-0.5 text-[10px] font-semibold uppercase text-category-plano-text">
                        SimulClinic
                      </span>
                    )}
                  </div>
                  {e.description && <div className="text-xs text-muted-foreground">{e.description}</div>}
                  <div className="text-xs text-slate-500">
                    {formatEventTimeLine(e.event_date, e.source)}
                  </div>
                </div>
                {isTeacher && (
                  <div className="flex shrink-0">
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditing(e)} title="Editar"><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={async () => {
                      if (!confirm("Excluir evento do calendário?")) return;
                      try { 
                        if (e.source === "custom") {
                          await deleteCalendarEvent({ data: { id: e.id } });
                        } else {
                          await updateSourceDueDate({
                            data: {
                              source: e.source as any,
                              id: e.source_id!,
                              due_at: null,
                            },
                          });
                        }
                        toast.success("Removido do calendário"); 
                        load(); 
                      } catch (err) { toast.error(err instanceof Error ? err.message : "Erro"); }
                    }}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        );
      })}
      {creating && <NewEventDialog disciplineId={disciplineId} onClose={() => setCreating(false)} onDone={() => { setCreating(false); load(); }} />}
      {editing && <EditEventDialog event={editing} disciplineId={disciplineId} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function NewEventDialog({ disciplineId, onClose, onDone }: { disciplineId: string; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T23:59`;
  });
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    if (!title.trim() || !date) { toast.error("Preencha título e data/horário"); return; }
    setSubmitting(true);
    try {
      await saveCalendarEvent({ data: { discipline_id: disciplineId, title: title.trim(), description: description.trim() || undefined, event_date: new Date(date).toISOString() } });
      toast.success("Evento criado"); onDone();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
    finally { setSubmitting(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Novo evento</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Título</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></div>
          <div><Label>Data e hora</Label><Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><Label>Descrição (opcional)</Label><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={submitting} onClick={submit}>{submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Criar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function toLocalInputValue(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toDateOnlyInputValue(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function EditEventDialog({ event, disciplineId, onClose, onDone }: { event: CalEvent; disciplineId: string; onClose: () => void; onDone: () => void }) {
  const isCustom = event.source === "custom";
  const [title, setTitle] = useState(
    isCustom ? event.title : stripReferenceSuffix(event.raw_title ?? event.title),
  );
  const [reference, setReference] = useState(event.reference ?? "");
  const [description, setDescription] = useState(event.description ?? "");
  const [date, setDate] = useState(toLocalInputValue(event.event_date));
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    if (!date || !title.trim()) { toast.error("Preencha os campos obrigatórios"); return; }
    setSubmitting(true);
    try {
      const iso = new Date(date).toISOString();
      if (!iso) { toast.error("Data inválida"); return; }
      const ref = reference.trim();
      if (isCustom) {
        const fullTitle = ref ? `${stripReferenceSuffix(title.trim())} - ${ref}` : title.trim();
        await saveCalendarEvent({ data: { id: event.id, discipline_id: disciplineId, title: fullTitle, description: description.trim() || undefined, event_date: iso, kind: event.kind } });
      } else {
        const fullTitle = ref ? `${stripReferenceSuffix(title.trim())} - ${ref}` : stripReferenceSuffix(title.trim());
        await updateSourceDueDate({
          data: {
            source: event.source,
            id: event.source_id!,
            due_at: iso,
            title: fullTitle,
            note: description.trim() || undefined,
          },
        });
      }
      toast.success("Atualizado"); onDone();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
    finally { setSubmitting(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edição rápida do evento</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Título / Tema</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={250} /></div>
          <div>
            <Label>Módulo ou Aula de referência (opcional)</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} placeholder="Ex.: Aula 4 ou Módulo 2" />
          </div>
          <div>
            <Label>Data e hora <span className="text-destructive">*</span></Label>
            <Input type="datetime-local" className="h-9" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label>Observações (opcional)</Label>
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
          </div>
          <p className="text-xs text-muted-foreground">
            Exibido no calendário como: <strong>{`${title.trim() || "Título"}${reference.trim() ? ` - ${reference.trim()}` : ""}`}</strong>
          </p>
          {!isCustom && (
            <p className="text-xs text-muted-foreground">As alterações serão refletidas no calendário, na página do professor e para os alunos.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={submitting} onClick={submit}>{submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
