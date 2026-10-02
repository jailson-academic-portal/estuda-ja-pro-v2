import { useEffect, useState } from "react";
import { uploadBrandingFile } from "@/backend/branding.functions";
import { fileToBase64 } from "@/lib/file-base64";
import {
  listAssessmentHeaderTemplates,
  saveAssessmentHeaderTemplate,
  deleteAssessmentHeaderTemplate,
} from "@/backend/assessment-headers.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Loader2, Plus, Trash2, Pencil, Upload, LayoutTemplate } from "lucide-react";
import { toast } from "sonner";

type Template = {
  id: string;
  name: string;
  logo_url: string | null;
  logo_scale: number;
  banner_color: string;
  strip_color: string;
  unit_label: string | null;
  shift_label: string | null;
  instructions: string | null;
  show_grade_box: boolean;
  compact_questions_header: boolean;
  exclusive_answer_sheet_rules: boolean;
  can_edit?: boolean;
};

const emptyForm = (instructions: string): Template => ({
  id: "",
  name: "",
  logo_url: null,
  logo_scale: 1,
  banner_color: "#C8D400",
  strip_color: "#E8323C",
  unit_label: "",
  shift_label: "",
  instructions,
  show_grade_box: true,
  compact_questions_header: true,
  exclusive_answer_sheet_rules: true,
  can_edit: true,
});

/**
 * Gerenciamento dos modelos de cabeçalho usados EXCLUSIVAMENTE nas avaliações
 * (folha de questões e folha de respostas). Não altera os demais documentos.
 */
export function AssessmentHeaderTemplates() {
  const [items, setItems] = useState<Template[]>([]);
  const [defaults, setDefaults] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Template | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await listAssessmentHeaderTemplates();
      setItems(
        ((res.items ?? []) as any[]).map((t) => ({ 
          ...t, 
          logo_scale: Number(t.logo_scale) || 1,
          compact_questions_header: t.compact_questions_header !== false,
          exclusive_answer_sheet_rules: t.exclusive_answer_sheet_rules !== false,
        })) as Template[],
      );
      setDefaults(res.default_instructions);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar modelos");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    refresh();
  }, []);

  const uploadLogo = async (file: File) => {
    if (file.size > 3 * 1024 * 1024) return toast.error("Tamanho máximo: 3 MB");
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return toast.error("Use PNG, JPG ou WebP.");
    setSaving(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const base64 = await fileToBase64(file);
      const { url } = await uploadBrandingFile({
        data: { base64, content_type: file.type, prefix: "cabecalho", ext },
      });
      setForm((prev) => (prev ? { ...prev, logo_url: url } : prev));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao enviar a logo");
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (!form) return;
    if (!form.name.trim()) return toast.error("Dê um nome ao modelo.");
    setSaving(true);
    try {
      await saveAssessmentHeaderTemplate({
        data: {
          id: form.id || null,
          name: form.name.trim(),
          logo_url: form.logo_url || null,
          logo_scale: form.logo_scale ?? 1,
          banner_color: form.banner_color,
          strip_color: form.strip_color,
          unit_label: form.unit_label || null,
          shift_label: form.shift_label || null,
          instructions: form.instructions || null,
          show_grade_box: form.show_grade_box,
          compact_questions_header: form.compact_questions_header,
          exclusive_answer_sheet_rules: form.exclusive_answer_sheet_rules,
        },
      });
      toast.success("Modelo salvo");
      setForm(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Remover este modelo de cabeçalho?")) return;
    try {
      await deleteAssessmentHeaderTemplate({ data: { id } });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao remover");
    }
  };

  return (
    <div className="rounded-xl border bg-card p-6 mt-6" style={{ boxShadow: "var(--shadow-card)" }}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <LayoutTemplate className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Cabeçalho das Avaliações</h2>
        </div>
        {!form && (
          <Button size="sm" onClick={() => setForm(emptyForm(defaults))}>
            <Plus className="h-4 w-4 mr-2" /> Novo modelo
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Modelo institucional aplicado somente na folha de questões e na folha de respostas das
        avaliações — faixa com a logo, tarja de disciplina/avaliação, quadro com aluno, matrícula,
        unidade, turno, data e professor, e o quadro de orientações.
      </p>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : form ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Nome do modelo</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ex.: UNIPLAN — São José"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Unidade</Label>
              <Input
                value={form.unit_label ?? ""}
                onChange={(e) => setForm({ ...form, unit_label: e.target.value })}
                placeholder="Ex.: SÃO JOSÉ"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Turno</Label>
              <Input
                value={form.shift_label ?? ""}
                onChange={(e) => setForm({ ...form, shift_label: e.target.value })}
                placeholder="Ex.: NOITE"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Cor da faixa</Label>
                <Input
                  type="color"
                  value={form.banner_color}
                  onChange={(e) => setForm({ ...form, banner_color: e.target.value })}
                  className="h-10 p-1"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Cor da tarja</Label>
                <Input
                  type="color"
                  value={form.strip_color}
                  onChange={(e) => setForm({ ...form, strip_color: e.target.value })}
                  className="h-10 p-1"
                />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Logo da faixa</Label>
            <div className="flex items-center gap-3">
              <div
                className="flex-1 rounded-md p-3 flex items-center justify-end"
                style={{
                  backgroundColor: form.banner_color,
                  minHeight: `${64 * Math.max(1, form.logo_scale ?? 1)}px`,
                }}
              >
                {form.logo_url ? (
                  <img
                    src={form.logo_url}
                    alt="Logo do cabeçalho"
                    className="object-contain"
                    style={{
                      maxHeight: `${48 * (form.logo_scale ?? 1)}px`,
                      maxWidth: `${190 * (form.logo_scale ?? 1)}px`,
                    }}
                  />
                ) : (
                  <span className="text-xs text-black/60">Sem logo</span>
                )}
              </div>
              <label className="inline-flex">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadLogo(f);
                    e.target.value = "";
                  }}
                />
                <Button asChild variant="outline" disabled={saving}>
                  <span className="cursor-pointer">
                    <Upload className="h-4 w-4 mr-2" /> Enviar
                  </span>
                </Button>
              </label>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Tamanho da logo na faixa</Label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {Math.round((form.logo_scale ?? 1) * 100)}%
              </span>
            </div>
            <Slider
              min={50}
              max={250}
              step={5}
              value={[Math.round((form.logo_scale ?? 1) * 100)]}
              onValueChange={(v) => setForm({ ...form, logo_scale: (v[0] ?? 100) / 100 })}
            />
            <p className="text-xs text-muted-foreground">
              Acima de 100% a faixa do cabeçalho cresce proporcionalmente no PDF.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Orientações (uma por linha)</Label>
            <Textarea
              rows={6}
              value={form.instructions ?? ""}
              onChange={(e) => setForm({ ...form, instructions: e.target.value })}
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={form.show_grade_box}
              onCheckedChange={(v) => setForm({ ...form, show_grade_box: v })}
            />
            <Label className="text-sm">Mostrar quadro de nota ao lado das orientações</Label>
          </div>

          <div className="space-y-3 pt-2 border-t">
            <div className="flex items-center gap-2">
              <Switch
                checked={form.compact_questions_header}
                onCheckedChange={(v) => setForm({ ...form, compact_questions_header: v })}
              />
              <div className="space-y-0.5">
                <Label className="text-sm">Usar cabeçalho compacto na Folha de Questões</Label>
                <p className="text-[11px] text-muted-foreground">
                  Omite a logo institucional e exibe apenas uma barra simples de 1 linha com Aluno, Matrícula, Nº Avaliação e Nota Máxima nas folhas de questões.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={form.exclusive_answer_sheet_rules}
                onCheckedChange={(v) => setForm({ ...form, exclusive_answer_sheet_rules: v })}
              />
              <div className="space-y-0.5">
                <Label className="text-sm">Exibir Orientações (Regras 1 a 4) e Quadro de Nota EXCLUSIVAMENTE na Folha de Respostas</Label>
                <p className="text-[11px] text-muted-foreground">
                  Remove a caixa de regras e a caixa de notas das páginas de questões.
                </p>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salvar modelo
            </Button>
            <Button variant="outline" onClick={() => setForm(null)} disabled={saving}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum modelo criado ainda.</p>
      ) : (
        <ul className="divide-y">
          {items.map((t) => (
            <li key={t.id} className="py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="h-8 w-8 rounded" style={{ backgroundColor: t.banner_color }} />
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{t.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {[t.unit_label, t.shift_label].filter(Boolean).join(" · ") || "Sem unidade/turno"}
                  </div>
                </div>
              </div>
              {t.can_edit && (
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" onClick={() => setForm({ ...t })}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(t.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}