import { useState, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { adminImportStudents } from "@/backend/students-import.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Loader2, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";

interface Row { enrollment: string; name: string; }
interface ResultRow extends Row { status: "created" | "exists" | "error"; error?: string; }

function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows: Row[] = [];
  for (const line of lines) {
    // skip header if first cell is non-numeric and looks like 'matricula' / 'enrollment'
    const cells = line.split(/[,;\t]/).map((c) => c.trim().replace(/^"(.*)"$/, "$1"));
    if (cells.length < 2) continue;
    if (rows.length === 0 && /matr|enrol/i.test(cells[0])) continue;
    const [enrollment, name] = cells;
    if (!enrollment || !name) continue;
    rows.push({ 
      enrollment: enrollment.toUpperCase().trim(), 
      name: name.toUpperCase().trim() 
    });
  }
  return rows;
}

export function ImportStudentsTab({ disciplineOptions }: { disciplineOptions?: { id: string; name: string }[] }) {
  const importFn = useServerFn(adminImportStudents);
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [defaultPassword, setDefaultPassword] = useState("estudaja@123");
  const [disciplineId, setDisciplineId] = useState<string>("none");

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseCsv(text);
    setRows(parsed);
    setResults([]);
    if (parsed.length === 0) toast.error("Nenhuma linha válida encontrada");
    else toast.success(`${parsed.length} linha(s) detectada(s)`);
  };

  const confirmImport = async () => {
    if (rows.length === 0) return;
    setImporting(true);
    setResults([]);
    
    const CHUNK_SIZE = 100;
    const allResults: ResultRow[] = [];
    let createdCount = 0;
    let existsCount = 0;
    let errorsCount = 0;

    try {
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        
        if (rows.length > CHUNK_SIZE) {
          toast.info(`Processando ${i} de ${rows.length}...`, { id: 'import-progress' });
        }

        const res = await importFn({
          data: {
            rows: chunk,
            default_password: defaultPassword,
            ...(disciplineId !== "none" ? { discipline_id: disciplineId } : {}),
          },
        });
        
        if (Array.isArray(res.results)) {
          allResults.push(...(res.results as ResultRow[]));
        }
        createdCount += res.created || 0;
        existsCount += res.exists || 0;
        errorsCount += res.errors || 0;
        
        // Update UI progressively
        setResults([...allResults]);
      }
      
      toast.success(
        `Importação concluída: ${createdCount} criados, ${existsCount} já existiam e ${errorsCount} erros.`,
        { id: 'import-progress' }
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro na importação");
    } finally {
      setImporting(false);
    }
  };

  const safeRows = Array.isArray(rows) ? rows : [];
  const safeResults = Array.isArray(results) ? results : [];

  return (
    <Card className="border-0" style={{ boxShadow: "var(--shadow-card)" }}>
      <CardContent className="space-y-4 pt-6">
        <div className="border-2 border-dashed rounded-xl p-6 text-center space-y-3 bg-muted/20">
          <FileSpreadsheet className="h-10 w-10 mx-auto text-muted-foreground" />
          <div>
            <p className="font-medium">Importação em massa via CSV</p>
            <p className="text-xs text-muted-foreground">
              Arquivo com 2 colunas: <code>matricula,nome_completo</code>. Cabeçalho opcional.
            </p>
          </div>
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4 mr-2" /> Selecionar CSV
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Senha inicial padrão</Label>
            <Input value={defaultPassword} onChange={(e) => setDefaultPassword(e.target.value)} />
          </div>
          {disciplineOptions && disciplineOptions.length > 0 && (
            <div className="space-y-1">
              <Label>Matricular na disciplina (opcional)</Label>
              <Select value={disciplineId} onValueChange={setDisciplineId}>
                <SelectTrigger><SelectValue placeholder="Não matricular" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Não matricular</SelectItem>
                  {disciplineOptions.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {safeRows.length > 0 && safeResults.length === 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Pré-visualização ({safeRows.length})</p>
              <Button onClick={confirmImport} disabled={importing}>
                {importing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Confirmar importação
              </Button>
            </div>
            <div className="overflow-x-auto max-h-72 border rounded-md">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground bg-muted/50 sticky top-0">
                  <tr><th className="py-2 px-3">Matrícula</th><th>Nome</th></tr>
                </thead>
                <tbody>
                  {safeRows.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="py-1.5 px-3 font-mono text-xs">{r.enrollment}</td>
                      <td>{r.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {safeResults.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Resultado da importação</p>
            <div className="overflow-x-auto max-h-72 border rounded-md">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground bg-muted/50 sticky top-0">
                  <tr><th className="py-2 px-3">Matrícula</th><th>Nome</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {safeResults.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="py-1.5 px-3 font-mono text-xs">{r.enrollment}</td>
                      <td>{r.name}</td>
                      <td>
                        {r.status === "created" && <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Criado</Badge>}
                        {r.status === "exists" && <Badge variant="secondary">Já existia</Badge>}
                        {r.status === "error" && <Badge className="bg-red-100 text-red-700 hover:bg-red-100" title={r.error}>Erro</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}