import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

interface SchoolClass {
  id: string;
  name: string;
  course_id: string;
  shift: string;
  period: string;
  created_at: string;
  course?: { name: string };
}

export function ClassesTab() {
  const [items, setItems] = useState<SchoolClass[]>([]);
  const [courses, setCourses] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // Form state
  const [name, setName] = useState("");
  const [courseId, setCourseId] = useState("");
  const [shift, setShift] = useState("Manhã");
  const [period, setPeriod] = useState("2026.2");

  const load = async () => {
    setLoading(true);
    try {
      const { data: classData, error: classError } = await supabase
        .from("school_classes" as any)
        .select("*, course:courses(name)")
        .order("name");
      
      if (!classError) {
        setItems(classData as any[]);
      } else {
        console.warn("school_classes error, returning empty list:", classError.message);
        setItems([]);
      }

      const { data: courseData } = await supabase.from("courses" as any).select("id, name").order("name");
      if (courseData) setCourses(courseData as any[]);
    } catch (e) {
      console.error("Classes query failed silenty", e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const onCreate = async () => {
    if (!name || !courseId || !period) {
      toast.error("Preencha todos os campos");
      return;
    }

    setSaving(true);
    const { data: institution } = await supabase.from("institutions" as any).select("id").limit(1).maybeSingle();
    
    const { error } = await supabase.from("school_classes" as any).insert({
      name,
      course_id: courseId,
      shift: shift as any,
      period,
      institution_id: (institution as any)?.id || "00000000-0000-0000-0000-000000000000"
    });

    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Turma criada com sucesso!");
    setDialogOpen(false);
    setName("");
    await load();
  };

  const onDelete = async (id: string) => {
    const { error } = await supabase.from("school_classes" as any).delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Turma excluída");
      await load();
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="space-y-4 pt-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Users className="h-5 w-5 text-teal-600" /> Turmas
          </h3>
          <Button onClick={() => setDialogOpen(true)} className="bg-teal-600 hover:bg-teal-700">
            <Plus className="h-4 w-4 mr-2" /> Nova Turma
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-teal-600" /></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((item) => (
              <Card key={item.id} className="p-4 relative hover:border-teal-200 transition-colors">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="absolute top-2 right-2 text-muted-foreground hover:text-red-600"
                  onClick={() => onDelete(item.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
                <div className="space-y-1">
                  <h4 className="font-bold text-teal-900">{item.name}</h4>
                  <p className="text-xs text-muted-foreground">{item.course?.name || "Sem curso"}</p>
                  <div className="flex gap-2 mt-2">
                    <span className="text-[10px] px-2 py-0.5 bg-teal-100 text-teal-700 rounded-full">{item.shift}</span>
                    <span className="text-[10px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">{item.period}</span>
                  </div>
                </div>
              </Card>
            ))}
            {items.length === 0 && (
              <div className="col-span-full text-center py-12 bg-muted/20 rounded-xl border-2 border-dashed">
                <p className="text-muted-foreground">Nenhuma turma cadastrada. Comece criando uma agora!</p>
              </div>
            )}
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cadastrar Nova Turma</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Nome da Turma</Label>
              <Input placeholder="Ex: Farmácia - Noite - 2026.2" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Curso</Label>
              <Select value={courseId} onValueChange={setCourseId}>
                <SelectTrigger><SelectValue placeholder="Selecione o curso" /></SelectTrigger>
                <SelectContent>
                  {courses.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Turno</Label>
                <Select value={shift} onValueChange={setShift}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Manhã">Manhã</SelectItem>
                    <SelectItem value="Tarde">Tarde</SelectItem>
                    <SelectItem value="Noite">Noite</SelectItem>
                    <SelectItem value="Integral">Integral</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Período/Ano</Label>
                <Input placeholder="2026.2" value={period} onChange={e => setPeriod(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={onCreate} disabled={saving} className="bg-teal-600 hover:bg-teal-700">
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salvar Turma
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
