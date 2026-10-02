import { sanitizeListTitle, sanitizeTitleList } from "@/lib/text-sanitize";
import { sortItemsNumerically } from "@/lib/utils";
import { uploadMaterialFile } from "@/backend/uploads.functions";
import { fileToBase64 } from "@/lib/file-base64";
import { useEffect, useState, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import {
  createMaterialModule, deleteMaterialModule, saveMaterial, deleteMaterial, exportMaterialPDF,
  listMaterialsForStudent,
} from "@/backend/materials.functions";

import { saveCalendarEvent } from "@/backend/calendar.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { EmptyState } from "@/components/EmptyState";
import { BulkDeleteBar } from "@/components/BulkDeleteBar";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Plus, FolderPlus, Trash2, Upload, FileText, ExternalLink, Eye, Download, Presentation, ChevronDown, BookOpen, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { compareByModuleOrder } from "@/lib/ai-content";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { format } from "date-fns";

interface Module { id: string; name: string; position: number; }
interface Material {
  id: string; module_id: string; title: string; description: string | null;
  content?: string | null; file_url: string | null; status: "draft" | "published";
  source?: string;
  created_at?: string;
  /** Presente na listagem enxuta do aluno (o corpo do texto não é carregado). */
  has_content?: boolean;
}


type MaterialCategory = "plano" | "apostila" | "aula" | "outros";

function categorizeMaterial(m: Material): MaterialCategory {
  const title = (m.title ?? "").trim();
  const isPptx = Boolean(m.file_url && /\.pptx$/i.test(m.file_url));
  if (/^plano de aula/i.test(title)) return "plano";
  if (/^apostila/i.test(title)) return "apostila";
  if (isPptx || /aula\s*\d/i.test(title)) return "aula";
  return "outros";
}

const CATEGORY_META: Record<
  MaterialCategory,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    bgClass: string;
    textClass: string;
    borderClass: string;
    iconClass: string;
  }
> = {
  plano: {
    label: "Plano de Aula",
    icon: ClipboardList,
    bgClass: "bg-category-plano-bg",
    textClass: "text-category-plano-text",
    borderClass: "border-category-plano-border",
    iconClass: "text-category-plano-text",
  },
  apostila: {
    label: "Apostilas",
    icon: BookOpen,
    bgClass: "bg-category-apostila-bg",
    textClass: "text-category-apostila-text",
    borderClass: "border-category-apostila-border",
    iconClass: "text-category-apostila-text",
  },
  aula: {
    label: "Aulas / Apresentações",
    icon: Presentation,
    bgClass: "bg-category-aula-bg",
    textClass: "text-category-aula-text",
    borderClass: "border-category-aula-border",
    iconClass: "text-category-aula-text",
  },
  outros: {
    label: "Outros materiais",
    icon: FileText,
    bgClass: "bg-category-outros-bg",
    textClass: "text-category-outros-text",
    borderClass: "border-category-outros-border",
    iconClass: "text-category-outros-text",
  },
};

const CATEGORY_ORDER: MaterialCategory[] = ["plano", "apostila", "aula", "outros"];

function downloadBase64(filename: string, mime: string, base64: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function MaterialsModule({ disciplineId, isTeacher }: { disciplineId: string; isTeacher: boolean }) {
  const queryClient = useQueryClient();
  const listForStudent = useServerFn(listMaterialsForStudent);

  const materialsQueryKey = ["discipline-materials", disciplineId, isTeacher ? "teacher" : "student"];

  const { data, isLoading } = useQuery({
    queryKey: materialsQueryKey,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<{ modules: Module[]; materials: Material[] }> => {
      if (!isTeacher) {
        const res = await listForStudent({ data: { discipline_id: disciplineId } });
        return {
          modules: (res.modules ?? []) as Module[],
          materials: (res.materials ?? []) as unknown as Material[],
        };
      }
      const [{ data: mods, error: modsErr }, { data: mats, error: matsErr }] = await Promise.all([
        supabase
          .from("material_modules")
          .select("id,name,position")
          .eq("discipline_id", disciplineId)
          .order("position", { ascending: true }),
        supabase
          .from("materials")
          .select("id,module_id,title,description,content,file_url,status,position,created_at,source")
          .eq("discipline_id", disciplineId)
          .order("position", { ascending: true })
          .order("created_at", { ascending: true }),
      ]);
      if (modsErr) console.error("[MaterialsModule] Error loading modules:", modsErr);
      if (matsErr) console.error("[MaterialsModule] Error loading materials:", matsErr);
      return { modules: (mods ?? []) as Module[], materials: (mats ?? []) as unknown as Material[] };
    },
  });

  const modules = sortItemsNumerically((data?.modules ?? []) as Module[]);
  const materials = sortItemsNumerically((data?.materials ?? []) as Material[]);
  const loading = isLoading;

  const load = useCallback(
    () => queryClient.invalidateQueries({ queryKey: materialsQueryKey }),
    [queryClient, disciplineId, isTeacher],
  );

  const [editing, setEditing] = useState<{ moduleId: string; material?: Material } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearSelected = () => setSelected(new Set());
  const bulkDelete = async () => {
    const ids = Array.from(selected);
    const results = await Promise.allSettled(ids.map((id) => deleteMaterial({ data: { id } })));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed === 0) toast.success(`${ids.length} material(is) excluído(s)`);
    else toast.error(`${ids.length - failed} excluído(s), ${failed} falharam`);
    clearSelected();
    await load();
  };

  const createMaterialModuleFn = useServerFn(createMaterialModule);

  const handleAddMaterial = async () => {
    if (modules.length > 0) {
      setEditing({ moduleId: modules[0].id });
      return;
    }
    try {
      const row = await createMaterialModuleFn({ data: { discipline_id: disciplineId, name: "Módulo 1" } });
      if (row?.id) {
        await load();
        setEditing({ moduleId: row.id });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar módulo");
    }
  };

  const visibleMaterials = (modId: string) =>
    materials.filter((m) => m.module_id === modId && (isTeacher || m.status === "published"));


  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-white">
          <h2 className="text-lg font-semibold">Materiais didáticos</h2>
          <p className="text-sm opacity-80">{modules.length} módulo(s)</p>
        </div>
        {isTeacher && (
          <Button size="sm" onClick={handleAddMaterial}>
            <Plus className="h-4 w-4 mr-1" /> Material
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl bg-white/15" />
          ))}
        </div>

      ) : modules.length === 0 ? (
        <EmptyState
          message={isTeacher ? "Nenhum material publicado ainda." : "Nenhum material publicado ainda."}
          hint={isTeacher ? "Que tal gerar o primeiro com o Assessor IA ou criar um módulo manualmente?" : "Volte em breve — seu(sua) professor(a) vai publicar os materiais por aqui."}
        />
      ) : modules.map((mod) => (
        <div key={mod.id} className="rounded-xl border bg-card p-4" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{mod.name}</h3>
            {isTeacher && (
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing({ moduleId: mod.id })}>
                  <Plus className="h-4 w-4 mr-1" /> Material
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive"
                  onClick={async () => {
                    if (!confirm(`Excluir módulo "${mod.name}" e todos os materiais?`)) return;
                    await deleteMaterialModule({ data: { id: mod.id } }); load();
                  }}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
          <div className="mt-3 space-y-2">
            {visibleMaterials(mod.id).length === 0 ? (
              <p className="text-xs text-muted-foreground">Sem materiais.</p>
            ) : CATEGORY_ORDER.map((cat) => {
              const items = visibleMaterials(mod.id)
                .filter((m) => categorizeMaterial(m) === cat)
                .sort((a, b) => compareByModuleOrder(a, b) || a.title.localeCompare(b.title, undefined, { numeric: true }));
              if (items.length === 0) return null;
              const meta = CATEGORY_META[cat];
              const Icon = meta.icon;
              return (
                <Collapsible key={cat} defaultOpen className={`rounded-lg border ${meta.borderClass} ${meta.bgClass}`}>
                  <CollapsibleTrigger className={`group flex w-full items-center gap-2 px-3 py-2 text-sm font-medium ${meta.textClass}`}>
                    <Icon className={`h-4 w-4 shrink-0 ${meta.iconClass}`} />
                    <span className="flex-1 text-left">{meta.label}</span>
                    <span className={`text-xs ${meta.iconClass}`}>{items.length}</span>
                    <ChevronDown className={`h-4 w-4 transition-transform group-data-[state=open]:rotate-180 ${meta.iconClass}`} />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-2 px-2 pb-2">
                    {items.map((mat) => (
                      <MaterialRow key={mat.id} material={mat} isTeacher={isTeacher}
                        selected={selected.has(mat.id)}
                        onToggleSelected={() => toggleSelected(mat.id)}
                        onEdit={() => setEditing({ moduleId: mod.id, material: mat })}
                        onDelete={async () => {
                          if (!confirm("Excluir material?")) return;
                          await deleteMaterial({ data: { id: mat.id } }); load();
                        }} />
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
        </div>
      ))}

      {editing && (
        <MaterialEditorDialog
          open
          onClose={() => setEditing(null)}
          disciplineId={disciplineId}
          moduleId={editing.moduleId}
          material={editing.material}
          onDone={() => { setEditing(null); load(); }}
        />
      )}
      {isTeacher && (
        <BulkDeleteBar count={selected.size} itemLabel="material" onClear={clearSelected} onConfirm={bulkDelete} />
      )}
    </div>
  );
}


function MaterialRow({ material, isTeacher, onEdit, onDelete, selected, onToggleSelected }: {
  material: Material; isTeacher: boolean; onEdit: () => void; onDelete: () => void;
  selected?: boolean; onToggleSelected?: () => void;
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [pdfSignedUrl, setPdfSignedUrl] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [presentOpen, setPresentOpen] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [pdfChecked, setPdfChecked] = useState(false);
  const isPdfFile = Boolean(material.file_url && /\.pdf$/i.test(material.file_url));
  const isExternalFile = material.source === "external";
  useEffect(() => {
    // O aluno recebe link do PDF direto ou do arquivo anexado pelo professor
    // (material externo). Decks gerados pela IA seguem restritos ao professor.
    if (!material.file_url || (!isTeacher && !isPdfFile && !isExternalFile)) { setSignedUrl(null); return; }
    supabase.storage.from("materials").createSignedUrl(material.file_url, 3600)
      .then(({ data }) => setSignedUrl(data?.signedUrl ?? null));
  }, [material.file_url, isTeacher, isPdfFile, isExternalFile]);


  // For slide decks (.pptx) a visual PDF sibling lives at the same path with a
  // .pdf extension. Sign it so the student can download the visual slides PDF
  // (not the running text). Older materials without a sibling simply hide it.
  const isPptxFile = Boolean(material.file_url && /\.pptx$/i.test(material.file_url));
  useEffect(() => {
    if (!material.file_url || !isPptxFile) { setPdfSignedUrl(null); setPdfChecked(true); return; }
    setPdfChecked(false);
    const pdfPath = material.file_url.replace(/\.pptx$/i, ".pdf");
    supabase.storage.from("materials").createSignedUrl(pdfPath, 3600)
      .then(({ data }) => setPdfSignedUrl(data?.signedUrl ?? null))
      .catch(() => setPdfSignedUrl(null))
      .finally(() => setPdfChecked(true));
  }, [material.file_url, isPptxFile]);

  const hasRichContent = Boolean(
    (material.content && material.content.trim().length > 0) || material.has_content,
  );
  const isPptx = isPptxFile;

  const officeEmbedUrl = signedUrl
    ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(signedUrl)}`
    : null;
  const handleDownloadPDF = async () => {
    const t = toast.loading("Gerando PDF...", { duration: 10000 });
    setDownloadingPdf(true);
    try {
      const res = await exportMaterialPDF({ data: { id: material.id } });
      if (res) {
        await new Promise(resolve => setTimeout(resolve, 300));
        downloadBase64(res.filename, res.mime, res.base64);
        toast.success("PDF gerado com sucesso!", { id: t });
      } else {
        throw new Error("Erro ao gerar arquivo");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao baixar PDF", { id: t });
    } finally {
      setDownloadingPdf(false);
    }
  };


  return (
    <div className="flex items-center justify-between gap-3 p-3 w-full border rounded-lg min-w-0 bg-card">
      {isTeacher && onToggleSelected && (
        <Checkbox
          className="shrink-0"
          checked={selected}
          onCheckedChange={onToggleSelected}
          aria-label="Selecionar material"
        />
      )}
      <div className="min-w-0 flex-1 break-words whitespace-normal">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-medium text-sm break-words leading-tight">{sanitizeListTitle(material.title)}</span>
          {material.source === 'external' && (
            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
              Material Externo
            </span>
          )}
          {isTeacher && (
            <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${material.status === "published" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
              {material.status === "published" ? "Publicado" : "Rascunho"}
            </span>
          )}
        </div>
        {material.created_at && (
          <p className="text-[11px] text-muted-foreground mt-1">
            Adicionado em {format(new Date(material.created_at), "dd/MM/yyyy 'às' HH:mm")}
          </p>
        )}
        {material.description && <p className="text-xs text-muted-foreground mt-1 break-words whitespace-normal">{material.description}</p>}
        {!isTeacher && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {/* Portal do aluno: PDF quando existir, senão o arquivo anexado pelo professor. */}
            {isPptx && signedUrl && (
              <Button size="sm" onClick={() => setPresentOpen(true)} className="h-7 text-xs">
                <Presentation className="h-3.5 w-3.5 mr-1" /> Abrir Apresentação
              </Button>
            )}
            {isPptx ? (
              pdfSignedUrl ? (
                <a href={pdfSignedUrl} download={`${material.title}.pdf`}>
                  <Button size="sm" variant="outline" className="h-7 text-xs">
                    <Download className="h-3.5 w-3.5 mr-1" /> Baixar PDF
                  </Button>
                </a>
              ) : signedUrl ? (
                <a href={signedUrl} download={`${material.title}.pptx`}>
                  <Button size="sm" variant="outline" className="h-7 text-xs">
                    <Download className="h-3.5 w-3.5 mr-1" /> Baixar PPTX
                  </Button>
                </a>
              ) : (
                <Button size="sm" variant="outline" disabled className="h-7 text-xs">
                  {pdfChecked ? <Download className="h-3.5 w-3.5 mr-1" /> : <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                  PDF em breve
                </Button>
              )
            ) : isPdfFile && signedUrl ? (
              <a href={signedUrl} target="_blank" rel="noopener noreferrer" download={`${material.title}.pdf`}>
                <Button size="sm" variant="outline" className="h-7 text-xs">
                  <Download className="h-3.5 w-3.5 mr-1" /> Baixar PDF
                </Button>
              </a>
            ) : isExternalFile && signedUrl ? (
              <a
                href={signedUrl}
                target="_blank"
                rel="noopener noreferrer"
                download={`${material.title}.${material.file_url?.split(".").pop() ?? "pdf"}`}
              >
                <Button size="sm" variant="outline" className="h-7 text-xs">
                  <Download className="h-3.5 w-3.5 mr-1" /> Baixar arquivo
                </Button>
              </a>
            ) : hasRichContent || material.file_url ? (
              <Button size="sm" variant="outline" onClick={handleDownloadPDF} disabled={downloadingPdf} className="h-7 text-xs">
                {downloadingPdf ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                Baixar PDF
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled className="h-7 text-xs">
                <Download className="h-3.5 w-3.5 mr-1" /> PDF em breve
              </Button>
            )}
          </div>
        )}


        {isTeacher && (hasRichContent || isPptx) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {isPptx && (
              <>
                <Button size="sm" onClick={() => setPresentOpen(true)} disabled={!signedUrl} className="h-7 text-xs">
                  <Presentation className="h-3.5 w-3.5 mr-1" /> Abrir Apresentação
                </Button>
                {signedUrl && (
                  <a href={signedUrl} download={`${material.title}.pptx`}>
                    <Button size="sm" variant="outline" className="h-7 text-xs">
                      <Download className="h-3.5 w-3.5 mr-1" /> Baixar PPTX
                    </Button>
                  </a>
                )}
                {pdfSignedUrl && (
                  <a href={pdfSignedUrl} download={`${material.title}.pdf`}>
                    <Button size="sm" variant="outline" className="h-7 text-xs">
                      <Download className="h-3.5 w-3.5 mr-1" /> Baixar PDF
                    </Button>
                  </a>
                )}
              </>
            )}
            {hasRichContent && !isPptx && (
              <>
            <Button size="sm" variant="outline" onClick={() => setViewerOpen(true)} className="h-7 text-xs">
              <Eye className="h-3.5 w-3.5 mr-1" /> Abrir conteúdo
            </Button>
                <Button size="sm" variant="outline" onClick={handleDownloadPDF} disabled={downloadingPdf} className="h-7 text-xs">
                  {downloadingPdf ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                  Baixar PDF
                </Button>
              </>
            )}
          </div>
        )}
        {isTeacher && signedUrl && !isPptx && (
          <div className="mt-2">
            <a href={signedUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center" download={material.source === 'external' ? `${material.title}.${material.file_url?.split('.').pop()}` : undefined}>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5">
                {material.file_url?.toLowerCase().endsWith('.pdf') ? (
                  <FileText className="h-3.5 w-3.5" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                {material.source === 'external' 
                  ? (material.file_url?.toLowerCase().endsWith('.pdf') ? 'Baixar PDF' : 'Baixar DOCX')
                  : (material.file_url?.toLowerCase().endsWith('.pdf') ? 'Abrir PDF' : 'Baixar Documento')
                }
                <ExternalLink className="h-3 w-3 ml-0.5" />
              </Button>
            </a>
          </div>
        )}
      </div>
      {isTeacher && (
        <div className="flex gap-1 shrink-0">
          <Button size="sm" variant="ghost" onClick={onEdit}>Editar</Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
      {isPptx && officeEmbedUrl && (
        <Dialog open={presentOpen} onOpenChange={setPresentOpen}>
          <DialogContent className="max-w-5xl w-[92vw] sm:w-full overflow-x-hidden">
            <DialogHeader>
              <DialogTitle>{material.title}</DialogTitle>
              <DialogDescription>
                Apresentação interativa — use as setas para avançar e retroceder os slides.
              </DialogDescription>
            </DialogHeader>
            <div className="aspect-video w-full overflow-hidden rounded-lg border bg-muted">
              <iframe
                src={officeEmbedUrl}
                title={material.title}
                className="h-full w-full"
                allowFullScreen
              />
            </div>
            {isTeacher && (
              <DialogFooter>
                <a href={signedUrl ?? "#"} download>
                  <Button variant="outline" size="sm">
                    <Download className="h-4 w-4 mr-1" /> Baixar PPTX
                  </Button>
                </a>
              </DialogFooter>
            )}
          </DialogContent>
        </Dialog>
      )}
      {isTeacher && hasRichContent && (
        <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
          <DialogContent className="max-w-3xl w-[92vw] sm:w-full overflow-x-hidden max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{material.title}</DialogTitle>
              {material.description && (
                <DialogDescription>{material.description}</DialogDescription>
              )}
            </DialogHeader>
            <div className="prose prose-sm dark:prose-invert max-w-none [&_h1]:mt-2 [&_h1]:mb-3 [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:mt-3 [&_h3]:mb-1.5 [&_p]:my-2 [&_p]:leading-relaxed [&_ul]:my-2 [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:pl-5 [&_li]:my-1 [&_strong]:font-semibold">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {(material.content ?? "").replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n")}
              </ReactMarkdown>
            </div>
            {signedUrl && !isPptx && (
              <DialogFooter>
                <a href={signedUrl} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm">
                    <ExternalLink className="h-4 w-4 mr-1" /> Abrir arquivo anexo
                  </Button>
                </a>
              </DialogFooter>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function NewModuleDialog({ open, onOpenChange, disciplineId, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; disciplineId: string; onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => { if (open) setName(""); }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Novo módulo</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="m-name">Nome do módulo</Label>
          <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!name.trim() || submitting} onClick={async () => {
            setSubmitting(true);
            try {
              await createMaterialModule({ data: { discipline_id: disciplineId, name: name.trim() } });
              toast.success("Módulo criado"); onDone();
            } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
            finally { setSubmitting(false); }
          }}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MaterialEditorDialog({ open, onClose, disciplineId, moduleId, material, onDone }: {
  open: boolean; onClose: () => void; disciplineId: string; moduleId: string;
  material?: Material; onDone: () => void;
}) {
  const [title, setTitle] = useState(material?.title ?? "");
  const [description, setDescription] = useState(material?.description ?? "");
  const [content, setContent] = useState(material?.content ?? "");
  const [category, setCategory] = useState<string>("Material Complementar");
  const [file, setFile] = useState<File | null>(null);
  const [lessonDate, setLessonDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize category from description if it matches our pattern (for existing external materials)
  useEffect(() => {
    if (material?.description?.startsWith("Categoria: ")) {
      setCategory(material.description.replace("Categoria: ", ""));
    }
  }, [material]);

  const submit = async (publish: boolean) => {
    if (!title.trim()) { toast.error("Informe o título"); return; }
    
    setSubmitting(true);
    const loadingToast = toast.loading(file ? "Fazendo upload e salvando..." : "Salvando material...");
    
    try {
      let file_url = material?.file_url ?? undefined;
      
      // Step 1: Upload file to storage FIRST if a new file is selected
      if (file) {
        try {
          const up = await uploadMaterialFile({
            data: {
              discipline_id: disciplineId,
              base64: await fileToBase64(file),
              filename: file.name,
              content_type: file.type || "application/octet-stream",
            },
          });
          file_url = up.path;
        } catch (uploadErr) {
          console.error("[MaterialEditor] Upload failed:", uploadErr);
          throw new Error(`Falha no upload do arquivo: ${uploadErr instanceof Error ? uploadErr.message : 'Erro desconhecido'}`);
        }
      }

      // Step 2: Save metadata to DB only after upload success
      const finalDescription = category ? `Categoria: ${category}${description ? ` - ${description}` : ''}` : description;
      
      await saveMaterial({ data: {
        id: material?.id, discipline_id: disciplineId, module_id: moduleId,
        title: title.trim(),
        description: finalDescription.trim() || undefined,
        content: content.trim() || undefined,
        file_url, 
        source: file ? "external" : (material?.source ?? "manual"),
        publish,
      } });

      if (lessonDate) {
        try {
          await saveCalendarEvent({
            data: {
              discipline_id: disciplineId,
              title: title.trim(),
              event_date: new Date(lessonDate).toISOString(),
              kind: "aula",
            },
          });
        } catch (err) {
          console.warn("Falha ao adicionar ao calendário", err);
        }
      }
      
      toast.success(publish ? "Material publicado" : "Rascunho salvo", { id: loadingToast });
      onDone();
    } catch (e) { 
      toast.error(e instanceof Error ? e.message : "Erro ao salvar material", { id: loadingToast }); 
    }
    finally { setSubmitting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{material ? "Editar material" : "Novo material"}</DialogTitle>
          <DialogDescription>Você pode salvar como rascunho e publicar depois.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Título</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
            </div>
            <div className="space-y-1.5">
              <Label>Categoria / Seção</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Apostilas">Apostilas</SelectItem>
                  <SelectItem value="Material Complementar">Material Complementar</SelectItem>
                  <SelectItem value="Artigos">Artigos</SelectItem>
                  <SelectItem value="Exercícios">Exercícios</SelectItem>
                  <SelectItem value="Slides">Slides</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Descrição curta (opcional)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </div>
          <div className="space-y-1.5">
            <Label>Conteúdo (texto)</Label>
            <Textarea rows={5} value={content} onChange={(e) => setContent(e.target.value)} maxLength={50000} placeholder="Escreva o conteúdo ou cole o texto aqui..." />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1"><Upload className="h-3.5 w-3.5" /> Anexo (PDF, DOCX, PPTX)</Label>
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:bg-muted/50 transition-colors"
            >
              <input 
                type="file" 
                className="hidden" 
                ref={fileInputRef}
                accept=".pdf,.docx,.doc,.pptx"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <div className="flex flex-col items-center gap-1">
                {file ? (
                  <div className="text-sm font-medium text-primary break-all flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                  </div>
                ) : material?.file_url ? (
                  <div className="text-sm text-muted-foreground flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Arquivo atual mantido. Clique para alterar.
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">Arraste ou clique para selecionar arquivo</p>
                    <p className="text-[10px] text-muted-foreground">PDF, DOCX, PPTX até 50MB</p>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="material-lesson-date">Data e hora da aula (opcional)</Label>
            <Input
              id="material-lesson-date"
              type="datetime-local"
              value={lessonDate}
              onChange={(e) => setLessonDate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Se preenchida, a aula será adicionada ao calendário da disciplina.
            </p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="outline" disabled={submitting} onClick={() => submit(false)}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salvar rascunho
          </Button>
          <Button disabled={submitting} onClick={() => submit(true)}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Publicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}