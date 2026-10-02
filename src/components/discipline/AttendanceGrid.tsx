import { useState, useMemo, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { setAttendanceStatus } from "@/backend/attendance.functions";
import { toast } from "sonner";
import { Loader2, Pencil, Trash2, CheckCheck } from "lucide-react";
import { formatBRDate } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";



interface Session {
  id: string;
  discipline_id: string;
  topic: string | null;
  programmatic_content?: string | null;
  pedagogical_observations?: string | null;
  session_date: string;
  window_hours: number;
  code_window_minutes: number;
  created_at: string;
  starts_at: string;
  finalized_at: string | null;
  finalized_by: string | null;
  closed_at: string | null;
  code?: string | null;
}

interface Student {
  id: string;
  name: string;
  matricula: string | null;
}

interface Record {
  session_id: string;
  student_id: string;
  status: string;
}

export function AttendanceGrid({ 
  disciplineId, 
  sessions, 
  records, 
  onChanged,
  onEditSession,
  onDeleteSession,
  onBulkUpdate,
  editable = false,
}: { 
  disciplineId: string;
  sessions: Session[];
  records: Record[];
  onChanged: () => void;
  onEditSession?: (session: Session) => void;
  onDeleteSession?: (session: Session) => void;
  onBulkUpdate?: (sessionId: string, status: "present" | "absent" | "justified") => Promise<void>;
  /** Somente professor/admin podem alterar células (a gravação é feita no servidor). */
  editable?: boolean;
}) {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    const loadStudents = async () => {
      setLoading(true);
      try {
        const { data: enrollments, error } = await supabase
          .from("discipline_students")
          .select("student_id, profiles(id, name, enrollment_number)")
          .eq("discipline_id", disciplineId)
          .eq("status", "active");

        if (error) throw error;

        const list = (enrollments ?? []).filter((e: any) => e.profiles).map((e: any) => ({
          id: e.profiles.id,
          name: e.profiles?.name || "Sem Nome",
          matricula: e.profiles?.enrollment_number || "---",
        })).sort((a, b) => a.name.localeCompare(b.name));
        
        setStudents(list);
      } catch (e) {
        toast.error("Erro ao carregar alunos");
      } finally {
        setLoading(false);
      }
    };
    loadStudents();
  }, [disciplineId]);

  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a: Session, b: Session) => {
      const [ay, am, ad] = a.session_date.split("-");
      const [by, bm, bd] = b.session_date.split("-");
      const da = new Date(Number(ay), Number(am) - 1, Number(ad));
      const db = new Date(Number(by), Number(bm) - 1, Number(bd));
      return da.getTime() - db.getTime();
    });
  }, [sessions]);

  const getStatus = (studentId: string, sessionId: string) => {
    const r = records.find(r => r.student_id === studentId && r.session_id === sessionId);
    return r?.status || "absent";
  };

  const handleStatusChange = async (studentId: string, sessionId: string, newStatus: "present" | "absent" | "justified" | "no_class") => {
    const key = `${studentId}-${sessionId}`;
    setUpdating(key);
    try {
      // Gravação no servidor: valida professor/admin e não depende do RLS do cliente.
      await setAttendanceStatus({ data: { session_id: sessionId, student_id: studentId, status: newStatus } });
      toast.success("Presença atualizada");
      
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? `Erro ao atualizar presença: ${e.message}` : "Erro ao atualizar presença");
    } finally {
      setUpdating(null);
    }
  };

  const renderBadge = (status: any, clickable = false) => {
    let content = null;
    switch (status) {
      case "present":
        content = <Badge className="bg-green-600 hover:bg-green-700 text-white w-8 h-8 flex items-center justify-center p-0">P</Badge>;
        break;
      case "absent":
        content = <Badge variant="destructive" className="w-8 h-8 flex items-center justify-center p-0">F</Badge>;
        break;
      case "justified":
        content = <Badge className="bg-[#06b6d4] hover:bg-[#06b6d4] text-white w-8 h-8 flex items-center justify-center p-0">J</Badge>;
        break;
      case "no_class":
        content = <Badge variant="secondary" className="bg-gray-400 text-white w-8 h-8 flex items-center justify-center p-0">SA</Badge>;
        break;
      default:
        content = <Badge variant="outline" className="w-8 h-8 flex items-center justify-center p-0">-</Badge>;
    }
    
    return clickable ? (
      <div className="cursor-pointer transition-transform active:scale-95">
        {content}
      </div>
    ) : content;
  };

  if (loading) return <div className="py-12 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/30 p-3 rounded-lg border">
        <div className="flex items-center gap-4 text-xs font-medium">
          <div className="flex items-center gap-1.5"><Badge className="bg-green-600 w-5 h-5 flex items-center justify-center p-0">P</Badge> Presente</div>
          <div className="flex items-center gap-1.5"><Badge variant="destructive" className="w-5 h-5 flex items-center justify-center p-0">F</Badge> Falta</div>
          <div className="flex items-center gap-1.5"><Badge className="bg-[#06b6d4] w-5 h-5 flex items-center justify-center p-0">J</Badge> Justificada</div>
          <div className="flex items-center gap-1.5"><Badge variant="secondary" className="bg-gray-400 text-white w-5 h-5 flex items-center justify-center p-0">SA</Badge> Sem Aula</div>
        </div>
      </div>

      <div className="border rounded-xl overflow-hidden bg-white shadow-sm">
        <ScrollArea className="w-full">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/50">
                <th className="sticky left-0 z-20 bg-muted/80 backdrop-blur-sm border-r border-b px-4 py-3 text-left min-w-[220px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                  Aluno / Matrícula
                </th>
                {sortedSessions.map(s => {
                  const formatted = formatBRDate(s.session_date).slice(0, 5); // DD/MM
                  return (
                    <th key={s.id} className="border-b border-r px-2 py-3 text-center min-w-[70px] whitespace-nowrap" title={s.topic || "Aula"}>
                      <div className="flex flex-col items-center gap-1">
                        <div className="text-[10px] text-muted-foreground uppercase">{formatted}</div>
                        <div className="flex items-center gap-1 mt-1">
                          {onEditSession && (
                            <button 
                              onClick={() => onEditSession(s)}
                              className="p-1 hover:bg-muted rounded-full transition-colors text-muted-foreground hover:text-primary"
                              title="Editar"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {onBulkUpdate && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button 
                                  className="p-1 hover:bg-muted rounded-full transition-colors text-muted-foreground hover:text-primary"
                                  title="Ações em Massa"
                                >
                                  <CheckCheck className="h-3.5 w-3.5" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="center" className="min-w-[180px]">
                                <DropdownMenuItem onClick={() => onBulkUpdate(s.id, 'present')}>
                                  <Badge className="bg-green-600 mr-2 w-5 h-5 flex items-center justify-center p-0 text-[10px]">P</Badge>
                                  Marcar todos como Presente
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => onBulkUpdate(s.id, 'absent')}>
                                  <Badge variant="destructive" className="mr-2 w-5 h-5 flex items-center justify-center p-0 text-[10px]">F</Badge>
                                  Marcar todos como Falta
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => onBulkUpdate(s.id, 'justified')}>
                                  <Badge className="bg-[#06b6d4] mr-2 w-5 h-5 flex items-center justify-center p-0 text-[10px]">J</Badge>
                                  Marcar todos como Justificada
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                          {onDeleteSession && (
                            <button 
                              onClick={() => onDeleteSession(s)}
                              className="p-1 hover:bg-red-50 rounded-full transition-colors text-muted-foreground hover:text-red-600"
                              title="Excluir"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {students.map(student => (
                <tr key={student.id} className="hover:bg-muted/30 transition-colors">
                  <td className="sticky left-0 z-20 bg-white border-r border-b px-4 py-2 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                    <div className="font-medium truncate max-w-[180px]">{student.name}</div>
                    <div className="text-[10px] text-muted-foreground">{student.matricula}</div>
                  </td>
                  {sortedSessions.map(session => {
                    const status = getStatus(student.id, session.id);
                    const isBusy = updating === `${student.id}-${session.id}`;
                    if (!editable) {
                      return (
                        <td key={session.id} className="border-r border-b p-1 text-center">
                          <div className="flex justify-center">{renderBadge(status)}</div>
                        </td>
                      );
                    }
                    return (
                      <td key={session.id} className="border-r border-b p-1 text-center">
                        <DropdownMenu>
                          <DropdownMenuTrigger disabled={isBusy} className="focus:outline-none">
                            {isBusy ? (
                              <div className="w-8 h-8 flex items-center justify-center">
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                              </div>
                            ) : (
                              renderBadge(status, true)
                            )}
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="center" className="min-w-[120px]">
                            <DropdownMenuItem onClick={() => handleStatusChange(student.id, session.id, 'present')}>
                              <Badge className="bg-green-600 mr-2 w-5 h-5 flex items-center justify-center p-0">P</Badge>
                              Presente
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleStatusChange(student.id, session.id, 'absent')}>
                              <Badge variant="destructive" className="mr-2 w-5 h-5 flex items-center justify-center p-0">F</Badge>
                              Falta
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleStatusChange(student.id, session.id, 'justified')}>
                              <Badge className="bg-[#06b6d4] mr-2 w-5 h-5 flex items-center justify-center p-0">J</Badge>
                              Justificada
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleStatusChange(student.id, session.id, 'no_class')}>
                              <Badge variant="secondary" className="bg-gray-400 text-white mr-2 w-5 h-5 flex items-center justify-center p-0">SA</Badge>
                              Sem Aula
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>
    </div>
  );
}
