import { useState, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { importStudentsCSV } from "@/backend/institution-admin.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Loader2, FileSpreadsheet, Download, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface PreviewStudent {
  name: string;
  email: string;
  matricula: string;
}

export function AdminImportStudentsV2() {
  const importFn = useServerFn(importStudentsCSV);
  const fileRef = useRef<HTMLInputElement>(null);
  
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [preview, setPreview] = useState<PreviewStudent[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchingClasses, setFetchingClasses] = useState(true);

  useState(() => {
    const loadClasses = async () => {
      try {
        const { data, error } = await supabase.from("school_classes" as any).select("id, name").order("name");
        if (!error && data) {
          setClasses(data as any[]);
        } else {
          setClasses([]);
        }
      } catch {
        setClasses([]);
      } finally {
        setFetchingClasses(false);
      }
    };
    loadClasses();
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    const students: PreviewStudent[] = [];

    // Ignora cabeçalho se necessário
    const startIdx = /nome|email|matricula/i.test(lines[0]) ? 1 : 0;

    for (let i = startIdx; i < lines.length; i++) {
      const parts = lines[i].split(/[,;]/).map(p => p.trim());
      if (parts.length >= 2) {
        students.push({
          name: parts[0].toUpperCase().trim(),
          email: parts[1],
          matricula: (parts[2] || "").toUpperCase().trim()
        });
      }
    }

    setPreview(students);
    toast.info(`${students.length} alunos detectados no arquivo.`);
  };

  const handleImport = async () => {
    if (!selectedClass) return toast.error("Selecione uma turma para enturmação.");
    if (preview.length === 0) return toast.error("Nenhum dado para importar.");

    setLoading(true);
    let successCount = 0;
    let failedCount = 0;
    const CHUNK_SIZE = 100;

    try {
      for (let i = 0; i < preview.length; i += CHUNK_SIZE) {
        const chunk = preview.slice(i, i + CHUNK_SIZE);
        
        if (preview.length > CHUNK_SIZE) {
          toast.info(`Processando ${i} de ${preview.length}...`, { id: 'import-progress' });
        }

        const result = await importFn({ data: { classId: selectedClass, students: chunk } });
        successCount += result.success;
        failedCount += result.failed;
      }
      
      toast.success(`Importação concluída! ${successCount} alunos inseridos com sucesso e ${failedCount} erros.`, { id: 'import-progress' });
      setPreview([]);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const downloadTemplate = () => {
    const csvContent = "Nome,Email,Matricula\nFulano de Tal,fulano@exemplo.com,2024001\nBeltrana Silva,beltrana@exemplo.com,2024002";
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "modelo_importacao_estudaja.csv");
    link.click();
  };

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-teal-600" /> Importador de Alunos (CSV)
          </CardTitle>
          <CardDescription>
            Realize a enturmação automática via arquivo. Os alunos serão vinculados à turma e suas respectivas disciplinas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Selecione a Turma de Destino</Label>
              <Select value={selectedClass} onValueChange={setSelectedClass}>
                <SelectTrigger>
                  <SelectValue placeholder={fetchingClasses ? "Carregando turmas..." : "Escolher turma..."} />
                </SelectTrigger>
                <SelectContent>
                  {classes.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 flex flex-col justify-end">
              <Button variant="outline" onClick={downloadTemplate} className="w-full">
                <Download className="h-4 w-4 mr-2" /> Baixar Modelo CSV
              </Button>
            </div>
          </div>

          <div className="border-2 border-dashed rounded-xl p-10 text-center space-y-4 bg-muted/20 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => fileRef.current?.click()}>
            <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground" />
            <div className="space-y-1">
              <p className="font-semibold text-teal-900">Clique para selecionar ou arraste seu arquivo CSV</p>
              <p className="text-xs text-muted-foreground">Colunas obrigatórias: Nome, E-mail. Opcional: Matrícula.</p>
            </div>
            <input type="file" ref={fileRef} accept=".csv" className="hidden" onChange={handleFileUpload} />
          </div>

          {preview.length > 0 && (
            <div className="space-y-4 pt-4 animate-in fade-in slide-in-from-bottom-2">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-sm flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" /> Pré-visualização da Importação
                </h4>
                <Button onClick={handleImport} disabled={loading} className="bg-teal-600 hover:bg-teal-700">
                  {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Confirmar e Enturmar {preview.length} Alunos
                </Button>
              </div>
              <div className="border rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="p-2 border-b">Nome</th>
                      <th className="p-2 border-b">E-mail</th>
                      <th className="p-2 border-b">Matrícula</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {preview.map((s, i) => (
                      <tr key={i} className="hover:bg-muted/50">
                        <td className="p-2">{s.name}</td>
                        <td className="p-2">{s.email}</td>
                        <td className="p-2 text-muted-foreground font-mono">{s.matricula || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
