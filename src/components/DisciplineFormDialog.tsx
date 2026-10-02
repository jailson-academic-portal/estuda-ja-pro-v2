import { uploadSyllabusFile } from "@/backend/uploads.functions";
import { fileToBase64 } from "@/lib/file-base64";
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { MODULES } from "./discipline/ModuleGrid";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Loader2, Upload, FileText, X } from "lucide-react";
import { extractSyllabusText } from "@/lib/syllabus-extract";
import { Sparkles } from "lucide-react";

const COLORS = [
  "teal",
  "blue",
  "green",
  "purple",
  "pink",
  "orange",
  "indigo",
  "red",
  "amber",
  "cyan",
  "lime",
  "rose",
] as const;
const DEFAULT_DISCIPLINE_STATUS = "active";

const WEEK_DAYS = [
  { value: "mon", label: "Segunda-feira" },
  { value: "tue", label: "Terça-feira" },
  { value: "wed", label: "Quarta-feira" },
  { value: "thu", label: "Quinta-feira" },
  { value: "fri", label: "Sexta-feira" },
  { value: "sat", label: "Sábado" },
] as const;

const schema = z.object({
  name: z.string().trim().min(2, "Informe o nome").max(120),
  group_name: z.string().trim().max(60).optional().or(z.literal("")),
  semester: z.string().trim().min(1, "Informe o semestre").max(20),
  year: z.number().int().min(2000).max(2100),
  syllabus_text: z.string().max(20000).optional().or(z.literal("")),
  color: z.enum(COLORS),
});

export interface DisciplineEditing {
  id?: string;
  name?: string;
  code?: string | null;
  course_id?: string | null;
  group_name?: string | null;
  semester?: string;
  year?: number;
  syllabus_text?: string | null;
  syllabus_file_url?: string | null;
  color?: string;
  start_date?: string | null;
  end_date?: string | null;
  week_days?: string[] | null;
  class_start_time?: string | null;
  class_end_time?: string | null;
  location?: string | null;
}

export function DisciplineFormDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: DisciplineEditing | null;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [courseId, setCourseId] = useState<string>("none");
  const [courses, setCourses] = useState<{ id: string; name: string }[]>([]);
  const [groupName, setGroupName] = useState("");
  const [semester, setSemester] = useState("");
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [syllabus, setSyllabus] = useState("");
  const [color, setColor] = useState<(typeof COLORS)[number]>("teal");
  const [submitting, setSubmitting] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [existingFileUrl, setExistingFileUrl] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [weekDays, setWeekDays] = useState<string[]>([]);
  const [startTime, setStartTime] = useState<string>("");
  const [endTime, setEndTime] = useState<string>("");
  const [location, setLocation] = useState<string>("");
  const [visibleModules, setVisibleModules] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setCourseId(initial?.course_id ?? "none");
      setGroupName(initial?.group_name ?? "");
      setSemester(initial?.semester ?? "1");
      setYear(initial?.year ?? new Date().getFullYear());
      setSyllabus(initial?.syllabus_text ?? "");
      setColor((initial?.color as (typeof COLORS)[number]) ?? "teal");
      setFile(null);
      setExistingFileUrl(initial?.syllabus_file_url ?? null);
      setStartDate(initial?.start_date ?? "");
      setEndDate(initial?.end_date ?? "");
      setWeekDays(initial?.week_days ?? []);
      setStartTime((initial?.class_start_time ?? "").slice(0, 5));
      setEndTime((initial?.class_end_time ?? "").slice(0, 5));
      setLocation(initial?.location ?? "");
      // @ts-ignore - visible_modules is dynamic
      setVisibleModules(initial?.visible_modules ?? MODULES.map(m => m.key));
    }
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    supabase
      .from("courses")
      .select("id, name")
      .order("name")
      .then(({ data }) => setCourses(data ?? []));
  }, [open]);

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (!f) return;
    const allowed = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (!allowed.includes(f.type)) {
      toast.error("Use um arquivo PDF ou Word (.doc/.docx)");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      toast.error("Arquivo deve ter no máximo 10 MB");
      return;
    }
    setFile(f);
  };

  const handleExtract = async () => {
    const target = file;
    if (!target) {
      toast.error("Anexe primeiro um PDF ou .docx");
      return;
    }
    setExtracting(true);
    try {
      const text = await extractSyllabusText(target);
      if (!text) {
        toast.error("Nenhum texto encontrado no arquivo");
        return;
      }
      setSyllabus((prev) => (prev?.trim() ? `${prev.trim()}\n\n${text}` : text).slice(0, 20000));
      toast.success("Texto da ementa extraído");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao extrair");
    } finally {
      setExtracting(false);
    }
  };

  const onSubmit = async () => {
    const parsed = schema.safeParse({ name, group_name: groupName, semester, year, syllabus_text: syllabus, color });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    if (!user) return;
    if (!parsed.data.syllabus_text && !file && !existingFileUrl) {
      toast.error("Adicione a ementa: texto ou arquivo PDF/Word");
      return;
    }
    setSubmitting(true);
    let syllabus_file_url: string | null = existingFileUrl ?? null;

    // Upload file (if any) BEFORE write — path: {user.id}/{disciplineId or 'new-{ts}'}/filename
    if (file) {
      const folderId = initial?.id ?? `new-${Date.now()}`;
      try {
        const up = await uploadSyllabusFile({
          data: {
            folder_id: String(folderId),
            base64: await fileToBase64(file),
            filename: file.name,
            content_type: file.type || "application/octet-stream",
          },
        });
        syllabus_file_url = up.path;
      } catch (e) {
        setSubmitting(false);
        toast.error(`Falha no upload: ${e instanceof Error ? e.message : "erro"}`);
        return;
      }
    }

    const payload = {
      name: parsed.data.name,
      course_id: courseId === "none" ? null : courseId,
      group_name: parsed.data.group_name || null,
      semester: parsed.data.semester,
      year: parsed.data.year,
      status: DEFAULT_DISCIPLINE_STATUS,
      syllabus_text: parsed.data.syllabus_text || null,
      syllabus_file_url,
      color: parsed.data.color,
      start_date: startDate || null,
      end_date: endDate || null,
      week_days: weekDays.length ? weekDays : null,
      class_start_time: startTime || null,
      class_end_time: endTime || null,
      location: location || null,
      visible_modules: visibleModules,
    };
    const res = initial?.id
      ? await supabase.from("disciplines").update(payload).eq("id", initial.id)
      : await supabase.from("disciplines").insert({ ...payload, teacher_id: user.id });
    setSubmitting(false);
    if (res.error) {
      toast.error(res.error.message);
      return;
    }
    toast.success(initial?.id ? "Disciplina atualizada" : "Disciplina criada");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial?.id ? "Editar disciplina" : "Nova disciplina"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="d-name">Nome</Label>
            <Input id="d-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-course">Curso</Label>
            {courses.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhum curso cadastrado. Peça ao administrador para cadastrar.
              </p>
            ) : (
              <Select value={courseId} onValueChange={setCourseId}>
                <SelectTrigger id="d-course"><SelectValue placeholder="Selecione um curso" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem curso</SelectItem>
                  {courses.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="d-group">Turma</Label>
              <Input id="d-group" value={groupName} onChange={(e) => setGroupName(e.target.value)} maxLength={60} placeholder="Ex.: Enf 3A" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-sem">Semestre</Label>
              <Select value={semester} onValueChange={setSemester}>
                <SelectTrigger id="d-sem"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1º</SelectItem>
                  <SelectItem value="2">2º</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-year">Ano</Label>
              <Input id="d-year" type="number" value={year} onChange={(e) => setYear(parseInt(e.target.value || "0", 10))} min={2000} max={2100} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Cor do card</Label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-8 w-8 rounded-full border-2 ${color === c ? "border-foreground" : "border-transparent"}`}
                  style={{ backgroundColor: `var(--color-card-${c})` }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-syl">Ementa</Label>
            <p className="text-xs text-muted-foreground">
              É a base de conhecimento do Assistente de IA. Cole o texto e/ou anexe um PDF / Word.
            </p>
            <Textarea id="d-syl" rows={5} value={syllabus} onChange={(e) => setSyllabus(e.target.value)} maxLength={20000} placeholder="Cole a ementa aqui…" />
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={onPickFile}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4 mr-2" /> {file || existingFileUrl ? "Trocar arquivo" : "Anexar PDF/Word"}
              </Button>
              {file && (
                <Button type="button" variant="secondary" size="sm" onClick={handleExtract} disabled={extracting}>
                  {extracting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                  Extrair texto
                </Button>
              )}
              {(file || existingFileUrl) && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" />
                  {file ? file.name : existingFileUrl?.split("/").pop()}
                  <button
                    type="button"
                    className="ml-1 hover:text-foreground"
                    onClick={() => { setFile(null); setExistingFileUrl(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                    aria-label="Remover arquivo"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              )}
            </div>
          </div>

          <div className="space-y-3 pt-2 border-t">
            <div>
              <h4 className="text-sm font-semibold">Calendário da Disciplina</h4>
              <p className="text-xs text-muted-foreground">
                Opcional. Quando preenchido, ajuda o Assistente de IA a planejar o conteúdo ao longo do semestre.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="d-start">Data de Início</Label>
                <Input id="d-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="d-end">Data de Término</Label>
                <Input id="d-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Dia da Semana</Label>
              <div className="grid grid-cols-2 gap-2">
                {WEEK_DAYS.map((d) => {
                  const checked = weekDays.includes(d.value);
                  return (
                    <label key={d.value} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          setWeekDays((prev) =>
                            v ? [...prev, d.value] : prev.filter((x) => x !== d.value),
                          );
                        }}
                      />
                      {d.label}
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Horário</Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="d-stime" className="text-xs text-muted-foreground">Início</Label>
                  <Input id="d-stime" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="d-etime" className="text-xs text-muted-foreground">Término</Label>
                  <Input id="d-etime" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-loc">Localização (Cidade, Estado)</Label>
              <Input id="d-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Ex.: São Paulo, SP" maxLength={200} />
              <p className="text-xs text-muted-foreground">Usado pelo gerador de Plano de Aula para feriados.</p>
            </div>
            
            <div className="space-y-1.5 pt-2 border-t">
              <Label className="text-sm font-semibold">Módulos Visíveis</Label>
              <p className="text-xs text-muted-foreground mb-2">Selecione quais cards aparecerão no grid principal.</p>
              <div className="grid grid-cols-2 gap-2">
                {MODULES.map((m) => (
                  <label key={m.key} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-slate-50 p-1.5 rounded border border-transparent hover:border-slate-200">
                    <Checkbox
                      checked={visibleModules.includes(m.key)}
                      onCheckedChange={(v) => {
                        setVisibleModules(prev => 
                          v ? [...prev, m.key] : prev.filter(k => k !== m.key)
                        );
                      }}
                    />
                    {m.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={onSubmit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}