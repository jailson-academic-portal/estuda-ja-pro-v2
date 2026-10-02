import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { sortItemsNumerically } from "@/lib/utils";
import { saveDiaryEntry, deleteDiaryEntry } from "@/backend/diary.functions";
import {
  listStudentSources,
  generateStudentStudyGuide,
  exportDiaryEntryDOCX,
  exportDiaryEntryPDF,
} from "@/backend/student-tools.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import {
  Loader2,
  Plus,
  Trash2,
  NotebookPen,
  Lock,
  GraduationCap,
  FileDown,
  Sparkles,
  Eye,
  Layers,
  Network,
  BookOpen,
} from "lucide-react";
import { toast } from "sonner";

interface Entry { id: string; title: string | null; content: string; created_at: string; updated_at: string; }

type SourceKind = "material" | "apostila" | "ementa";
type SourceItem = { id: string; kind: SourceKind; title: string; module?: string | null; created_at?: string | null };

const GUIDE_PREFIX = "[Guia de Estudo]";
// Legacy prefixes from the previous separate tools (still rendered for old entries)
const LEGACY_PREFIXES = ["[Resumo+Glossário]", "[Mapa Conceitual]"];

function isAIEntry(title: string | null): boolean {
  if (!title) return false;
  return title.startsWith(GUIDE_PREFIX) || LEGACY_PREFIXES.some((p) => title.startsWith(p));
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderInline(s: string) {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function renderMarkdown(md: string): string {
  const out: string[] = [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      i++;
      continue;
    }

    // CONCEPT MAP JSON BLOCK
    if (trimmed === "```concept-map-json") {
      let jsonStr = "";
      i++;
      while (i < lines.length && lines[i].trim() !== "```") {
        jsonStr += lines[i] + "\n";
        i++;
      }
      i++;
      try {
        const cleanJson = jsonStr
          .replace(/```json\s*/gi, "")
          .replace(/```\s*/g, "")
          .trim();
        const data = typeof cleanJson === 'string' ? JSON.parse(cleanJson) : cleanJson;
        out.push(renderConceptMapDiagram(data));
      } catch (e) {
        // Fallback: render as hierarchical list if JSON fails
        const lines = jsonStr.split('\n').filter(l => l.trim() && !l.includes('{') && !l.includes('}') && !l.includes('[') && !l.includes(']'));
        if (lines.length > 0) {
          out.push(`<div class="p-4 border border-teal-500/30 rounded-lg bg-slate-50 my-4 break-inside-avoid"><h4 class="font-bold text-navy mb-2">Mapa Conceitual (Esquema)</h4><ul class="space-y-1">${lines.map(l => `<li class="text-sm">➔ ${escapeHtml(l.replace(/[":,]/g, '').trim())}</li>`).join('')}</ul></div>`);
        } else {
          out.push(`<div class="p-4 border border-destructive/30 rounded-lg bg-destructive/5 my-4 text-xs text-destructive italic break-inside-avoid">Conteúdo do mapa conceitual indisponível no formato visual.</div>`);
        }
      }
      continue;
    }

    if (trimmed === "---") {
      out.push("<hr/>");
      i++;
      continue;
    }
    const img = trimmed.match(/^!\[[^\]]*\]\(([^)]+)\)$/);
    if (img) {
      out.push(`<img src="${escapeHtml(img[1])}" alt="Logo" style="max-height:64px;width:auto"/>`);
      i++;
      continue;
    }
    const h = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      const lvl = h[1].length;
      out.push(`<h${lvl}>${renderInline(h[2])}</h${lvl}>`);
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)[-*]\s+(.+)$/)!;
        const indent = m[1].length;
        items.push(
          `<li style="margin-left:${indent * 8}px">${renderInline(m[2])}</li>`,
        );
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    const paras: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3})\s+/.test(lines[i].trim()) && !/^\s*[-*]\s+/.test(lines[i]) && lines[i].trim() !== "---" && lines[i].trim() !== "```concept-map-json") {
      paras.push(lines[i].trim());
      i++;
    }
    if (paras.length) out.push(`<p>${paras.map(renderInline).join("<br/>")}</p>`);
  }
  return out.join("\n");
}

function renderConceptMapDiagram(data: any): string {
  const central = data.tema_central || "Tema";
  const branches = data.nos_secundarios || [];

  return `
    <div class="concept-map-container my-8 not-prose overflow-x-hidden">
      <!-- Cabeçalho do Mapa -->
      <div class="bg-[#0f172a] text-white p-4 rounded-t-xl font-bold text-center border-b-2 border-[#0d9488]">
        TEMA CENTRAL: ${escapeHtml(central.toUpperCase())}
      </div>

      <!-- Tabela Matriz de Conceitos -->
      <div class="border-x border-b border-slate-200 rounded-b-xl overflow-hidden shadow-sm bg-white">
        <table class="w-full border-collapse text-sm">
          <thead>
            <tr class="bg-slate-100 text-[#0f172a] font-bold border-b border-slate-200">
              <th class="p-3 text-left w-[25%] border-r border-slate-200">CONCEITO PRINCIPAL</th>
              <th class="p-3 text-center w-[20%] border-r border-slate-200">RELAÇÃO</th>
              <th class="p-3 text-left w-[55%]">SUBTÓPICOS & DETALHES</th>
            </tr>
          </thead>
          <tbody>
            ${branches.map((node: any) => `
              <tr class="border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition-colors break-inside-avoid">
                <td class="p-4 align-top font-bold text-[#0f172a] bg-[#f8fafc] border-r border-slate-200">
                  ${escapeHtml(node.titulo)}
                </td>
                <td class="p-4 align-top text-center border-r border-slate-200">
                  <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0d9488] text-white text-[10px] font-bold uppercase tracking-wider whitespace-nowrap">
                    ${escapeHtml(node.relacao || "engloba")} <span class="text-xs">➔</span>
                  </span>
                </td>
                <td class="p-4 align-top">
                  <ul class="space-y-2">
                    ${(node.detalhes || []).map((detail: any) => `
                      <li class="flex items-start gap-2 group">
                        <span class="text-[#0d9488] mt-1 shrink-0">•</span>
                        <div class="flex flex-col">
                          <span class="font-medium text-slate-700">${escapeHtml(detail.titulo)}</span>
                          ${detail.relacao ? `<span class="text-[10px] text-slate-400 italic">(${escapeHtml(detail.relacao)})</span>` : ''}
                        </div>
                      </li>
                    `).join('')}
                  </ul>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * Splits the standardized header (logo + Disciplina/Curso/Professor + doc line)
 * off the top of the document so the viewer can render it exactly like the
 * other documents: logo on the left, identification data on the right.
 */
function splitStandardHeader(md: string): {
  logo: string | null;
  meta: { label: string; value: string }[];
  body: string;
} | null {
  const norm = md.replace(/\r\n/g, "\n");
  const m = norm.match(/^([\s\S]*?)\n-{3,}[ \t]*(?:\n|$)/);
  if (!m) return null;
  const head = m[1];
  if (!/\*\*Disciplina:\*\*/.test(head) && !/!\[/.test(head)) return null;
  const logo = head.match(/!\[[^\]]*\]\(([^)]+)\)/)?.[1] ?? null;
  const meta: { label: string; value: string }[] = [];
  const re = /\*\*([^:*\n]+):\*\*\s*(.+)/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(head)) !== null) {
    meta.push({ label: mm[1].trim(), value: mm[2].trim() });
  }
  return { logo, meta, body: norm.slice(m[0].length).trimStart() };
}

export function MyDiaryModule({ disciplineId }: { disciplineId: string }) {
  const { user } = useAuth();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [viewing, setViewing] = useState<Entry | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase.from("student_diary_entries")
      .select("id, title, content, created_at, updated_at")
      .eq("student_id", user.id).eq("discipline_id", disciplineId)
      .order("updated_at", { ascending: false });
    setEntries((data ?? []) as Entry[]);
    setLoading(false);
  }, [user, disciplineId]);
  useEffect(() => { load(); }, [load]);

  const startNew = () => { setEditing({ id: "", title: null, content: "", created_at: "", updated_at: "" }); setTitle(""); setContent(""); };
  const startEdit = (e: Entry) => { setEditing(e); setTitle(e.title ?? ""); setContent(e.content); };

  const save = async () => {
    if (!content.trim()) { toast.error("Escreva uma anotação"); return; }
    setSubmitting(true);
    try {
      await saveDiaryEntry({ data: {
        id: editing?.id || undefined,
        discipline_id: disciplineId,
        title: title.trim() || undefined,
        content: content.trim(),
      } });
      toast.success("Anotação salva");
      setEditing(null); load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
    finally { setSubmitting(false); }
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir anotação?")) return;
    await deleteDiaryEntry({ data: { id } });
    load();
  };

  const downloadFile = async (
    entryId: string,
    exporter: typeof exportDiaryEntryDOCX | typeof exportDiaryEntryPDF,
  ) => {
    try {
      const res = await exporter({ data: { entry_id: entryId } });
      const bin = atob(res.base64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const blob = new Blob([arr], { type: res.mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao exportar");
    }
  };
  const downloadDocx = (entryId: string) => downloadFile(entryId, exportDiaryEntryDOCX);
  const downloadPdf = (entryId: string) => downloadFile(entryId, exportDiaryEntryPDF);

  const aiEntries = entries.filter((e) => isAIEntry(e.title));
  const noteEntries = entries.filter((e) => !isAIEntry(e.title));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 text-white">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><NotebookPen className="h-5 w-5" /> Meu Diário</h2>
          <p className="text-xs opacity-80 flex items-center gap-1"><Lock className="h-3 w-3" /> Privado — só você vê</p>
        </div>
        <Button onClick={startNew}><Plus className="h-4 w-4 mr-2" /> Nova anotação</Button>
      </div>

      <div className="rounded-xl border bg-card p-4" style={{ boxShadow: "var(--shadow-card)" }}>
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm">Guia de Estudo com IA</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Um material de apoio didático e completo — reúne resumo, glossário, mapa conceitual e roteiro de
          estudo num só documento para te ajudar a se preparar para as avaliações. Não entrega respostas de
          provas: é uma ferramenta de ajuda ao estudo.
        </p>
        <div className="flex flex-wrap items-center gap-2 mb-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5"><Layers className="h-3 w-3 text-blue-600" /> Resumo + Glossário</span>
          <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5"><Network className="h-3 w-3 text-purple-600" /> Mapa Conceitual</span>
          <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5"><BookOpen className="h-3 w-3 text-teal-600" /> Roteiro de Estudo</span>
        </div>
        <Button onClick={() => setGuideOpen(true)} className="w-full sm:w-auto">
          <GraduationCap className="h-4 w-4 mr-2" /> Gerar Guia de Estudo
        </Button>
      </div>

      {editing && (
        <div className="rounded-xl border bg-card p-4 space-y-3" style={{ boxShadow: "var(--shadow-card)" }}>
          <Input placeholder="Título (opcional)" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
          <Textarea placeholder="Suas notas pessoais sobre esta disciplina..." rows={6} value={content} onChange={(e) => setContent(e.target.value)} maxLength={50000} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button disabled={submitting} onClick={save}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salvar
            </Button>
          </div>
        </div>
      )}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : entries.length === 0 ? (
        <div className="border-2 border-dashed rounded-xl py-12 text-center text-sm text-muted-foreground">
          Nenhuma anotação ainda.
        </div>
      ) : (
        <div className="space-y-6">
          {aiEntries.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Guias de Estudo</h3>
              {aiEntries.map((e) => (
                <div key={e.id} className="rounded-xl border bg-card p-4" style={{ boxShadow: "var(--shadow-card)" }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {e.title && <div className="font-medium truncate">{e.title}</div>}
                      <div className="text-xs text-muted-foreground">{new Date(e.updated_at).toLocaleString("pt-BR")}</div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button size="sm" variant="outline" onClick={() => setViewing(e)}>
                        <Eye className="h-4 w-4 mr-1" /> Ver
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => downloadPdf(e.id)}>
                        <FileDown className="h-4 w-4 mr-1" /> PDF
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => downloadDocx(e.id)}>
                        <FileDown className="h-4 w-4 mr-1" /> DOCX
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => remove(e.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {noteEntries.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Anotações pessoais</h3>
              {noteEntries.map((e) => (
                <div key={e.id} className="rounded-xl border bg-card p-4" style={{ boxShadow: "var(--shadow-card)" }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {e.title && <div className="font-medium truncate">{e.title}</div>}
                      <div className="text-xs text-muted-foreground">{new Date(e.updated_at).toLocaleString("pt-BR")}</div>
                      <p className="text-sm mt-2 whitespace-pre-wrap line-clamp-4">{e.content}</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button size="sm" variant="ghost" onClick={() => startEdit(e)}>Editar</Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => remove(e.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {guideOpen && (
        <StudyGuideDialog
          disciplineId={disciplineId}
          onClose={() => setGuideOpen(false)}
          onDone={(entry) => {
            setGuideOpen(false);
            load();
            setViewing(entry);
          }}
        />
      )}

      {viewing && (
        <Dialog open onOpenChange={(o) => !o && setViewing(null)}>
          <DialogContent className="max-w-2xl w-[92vw] sm:w-full overflow-x-hidden max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-base">Guia de Estudo</DialogTitle>
              <DialogDescription>
                Gerado em {new Date(viewing.created_at).toLocaleString("pt-BR")}
              </DialogDescription>
            </DialogHeader>
            {(() => {
              const parts = splitStandardHeader(viewing.content);
              const bodyHtml = renderMarkdown(parts ? parts.body : viewing.content);
              return (
                <>
                  {parts && (parts.logo || parts.meta.length > 0) && (
                    <div className="flex items-start gap-4 border-b pb-4 mb-2">
                      {parts.logo && (
                        <img
                          src={parts.logo}
                          alt="Logo"
                          className="h-16 w-auto max-w-[128px] object-contain shrink-0"
                        />
                      )}
                      <div className="space-y-0.5 text-sm min-w-0 flex-1 break-words">
                        {parts.meta.map((x) => (
                          <div key={x.label} className="break-words">
                            <span className="font-semibold">{x.label}:</span> {x.value}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div
                    className="prose prose-sm max-w-none dark:prose-invert prose-headings:mt-3 prose-headings:mb-1 prose-p:my-1 prose-ul:my-1"
                    dangerouslySetInnerHTML={{ __html: bodyHtml }}
                  />
                </>
              );
            })()}
            <DialogFooter>
              <Button variant="outline" onClick={() => downloadPdf(viewing.id)}>
                <FileDown className="h-4 w-4 mr-2" /> Baixar PDF
              </Button>
              <Button variant="outline" onClick={() => downloadDocx(viewing.id)}>
                <FileDown className="h-4 w-4 mr-2" /> Baixar DOCX
              </Button>
              <Button onClick={() => setViewing(null)}>Fechar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/* ---------- Unified Study Guide dialog ---------- */

function StudyGuideDialog({
  disciplineId,
  onClose,
  onDone,
}: {
  disciplineId: string;
  onClose: () => void;
  onDone: (entry: Entry) => void;
}) {
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [loadingSources, setLoadingSources] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [theme, setTheme] = useState("");
  const [objective, setObjective] = useState<"fixacao" | "avaliacao" | "aprofundamento">("avaliacao");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setLoadingSources(true);
    listStudentSources({
      data: { discipline_id: disciplineId, include_apostila: true, include_ementa: true },
    })
      .then((res) => setSources(sortItemsNumerically((res.items as SourceItem[]) ?? [])))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Erro ao carregar materiais"))
      .finally(() => setLoadingSources(false));
  }, [disciplineId]);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const labelKind = (k: SourceKind) =>
    k === "apostila" ? "Apostila" : k === "ementa" ? "Ementa" : "Aula";

  const submit = async () => {
    if (selected.length === 0) {
      toast.error("Selecione ao menos um material");
      return;
    }
    setRunning(true);
    try {
      const items = selected
        .map((id) => sources.find((s) => s.id === id))
        .filter((s): s is SourceItem => Boolean(s))
        .map((s) => ({ id: s.id, kind: s.kind }));
      const res = await generateStudentStudyGuide({
        data: {
          discipline_id: disciplineId,
          sources: items,
          theme: theme.trim() || undefined,
          objective,
        },
      });
      toast.success("Guia de Estudo gerado e salvo no Meu Diário");
      const now = new Date().toISOString();
      onDone({ id: res.id, title: res.title, content: res.content, created_at: now, updated_at: now });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !running && onClose()}>
      <DialogContent className="max-w-2xl w-[92vw] sm:w-full overflow-x-hidden max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GraduationCap className="h-4 w-4 text-primary" /> Guia de Estudo
          </DialogTitle>
          <DialogDescription>
            Selecione um ou mais materiais (Apostilas, Aulas e/ou Ementa). A IA gera um guia único e
            didático — resumo, glossário, mapa conceitual e roteiro — para te ajudar a estudar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">Materiais disponíveis (seleção múltipla)</Label>
            {loadingSources ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : sources.length === 0 ? (
              <p className="text-sm text-muted-foreground border-2 border-dashed rounded-lg p-4 text-center">
                Nenhum material disponível para esta disciplina.
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto border rounded-lg">
                {(["apostila", "material", "ementa"] as const).map((kind) => {
                  const group = sources
                    .filter((s) => s.kind === kind)
                    .sort((a, b) => (a.title || "").localeCompare(b.title || "", undefined, { numeric: true, sensitivity: "base" }));
                  if (group.length === 0) return null;
                  const groupLabel =
                    kind === "apostila" ? "Apostilas" : kind === "material" ? "Aulas" : "Ementas";
                  return (
                    <div key={kind}>
                      <div className="px-3 py-1.5 bg-muted/60 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sticky top-0">
                        {groupLabel}
                      </div>
                      <div className="divide-y">
                        {group.map((s) => {
                          const checked = selected.includes(s.id);
                          const dateLabel = s.created_at
                            ? new Date(s.created_at).toLocaleDateString("pt-BR")
                            : null;
                          return (
                            <label
                              key={`${s.kind}-${s.id}`}
                              className="flex items-center justify-between gap-3 p-3 w-full border-b min-w-0 hover:bg-accent cursor-pointer"
                            >
                              <div className="flex items-start gap-3 min-w-0 flex-1">
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={() => toggle(s.id)}
                                  className="mt-0.5 shrink-0"
                                />
                                <div className="min-w-0 flex-1 break-words whitespace-normal">
                                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                                    <span className="text-sm font-medium break-words leading-tight">{s.title}</span>
                                    <span className="shrink-0 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                                      {labelKind(s.kind)}
                                    </span>
                                  </div>
                                  <div className="text-xs text-muted-foreground break-words whitespace-normal leading-tight mt-0.5">
                                    {s.module ? `${s.module}` : ""}
                                    {s.module && dateLabel ? " · " : ""}
                                    {dateLabel ? `Postado em ${dateLabel}` : ""}
                                  </div>
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <Label className="mb-1 block">Módulo ou tema específico (opcional)</Label>
            <Input
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="Ex.: Sistema cardiovascular"
              maxLength={300}
            />
          </div>

          <div>
            <Label className="mb-2 block">Objetivo do estudo</Label>
            <RadioGroup
              value={objective}
              onValueChange={(v) => setObjective(v as typeof objective)}
              className="space-y-1"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="fixacao" /> Fixação do Conteúdo
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="avaliacao" /> Preparação para Avaliação
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="aprofundamento" /> Aprofundamento
              </label>
            </RadioGroup>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={running}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={running || selected.length === 0}>
            {running && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Gerar e salvar no diário
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
