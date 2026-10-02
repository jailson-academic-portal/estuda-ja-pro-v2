import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { getMyBranding, setMyBranding, uploadBrandingFile } from "@/backend/branding.functions";
import { fileToBase64 } from "@/lib/file-base64";
import { Button } from "@/components/ui/button";
import { AppHeader } from "@/components/AppHeader";
import { Loader2, Upload, Trash2, Image as ImageIcon, Lock } from "lucide-react";
import { toast } from "sonner";
import { AssessmentHeaderTemplates } from "@/components/assessment/AssessmentHeaderTemplates";

export const Route = createFileRoute("/branding")({
  component: BrandingPage,
  head: () => ({
    meta: [{ title: "Identidade Visual" }],
  }),
});

function BrandingPage() {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [scope, setScope] = useState<"institution" | "teacher">("teacher");
  const [canEdit, setCanEdit] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await getMyBranding();
      setLogoUrl(res.logo_url);
      setScope(res.scope);
      setCanEdit(res.can_edit);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar identidade visual");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    refresh();
  }, []);

  const handleUpload = async (file: File) => {
    if (!user) return;
    if (file.size > 3 * 1024 * 1024) {
      toast.error("Tamanho máximo: 3 MB");
      return;
    }
    if (!/^image\/(png|jpe?g|webp|svg\+xml)$/.test(file.type)) {
      toast.error("Formato não suportado. Use PNG, JPG, WebP ou SVG.");
      return;
    }
    setSaving(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const base64 = await fileToBase64(file);
      const { url } = await uploadBrandingFile({
        data: { base64, content_type: file.type, prefix: "logo", ext },
      });
      await setMyBranding({ data: { logo_url: url } });
      toast.success("Logo atualizada");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao enviar logo");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!confirm("Remover a logo atual?")) return;
    setSaving(true);
    try {
      await setMyBranding({ data: { logo_url: null } });
      toast.success("Logo removida");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  };

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen academic-bg">
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-xl border bg-card p-6" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="flex items-center gap-2 mb-1">
            <ImageIcon className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">Identidade Visual</h1>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            {profile.profile_type === 'admin'
              ? "Sua marca própria/assinatura será aplicada nos slides e materiais pedagógicos."
              : scope === "institution"
              ? "Logo institucional — aplicada automaticamente em todos os documentos gerados por professores vinculados a esta instituição."
              : "Sua logo de professor autônomo — aplicada automaticamente em todos os documentos que você gerar."}
          </p>

          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <>
              <div className="border-2 border-dashed rounded-lg p-6 flex flex-col items-center gap-3 mb-4 bg-background">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt="Logo atual"
                    className="max-h-32 object-contain"
                  />
                ) : (
                  <div className="text-sm text-muted-foreground">Nenhuma logo cadastrada</div>
                )}
              </div>

              {!canEdit ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
                  <Lock className="h-4 w-4" />
                  Apenas o gestor da instituição pode alterar esta logo.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleUpload(f);
                        e.target.value = "";
                      }}
                      disabled={saving}
                    />
                    <Button asChild disabled={saving}>
                      <span className="cursor-pointer">
                        {saving ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Upload className="h-4 w-4 mr-2" />
                        )}
                        {logoUrl ? "Substituir logo" : "Enviar logo"}
                      </span>
                    </Button>
                  </label>
                  {logoUrl && (
                    <Button variant="outline" onClick={handleRemove} disabled={saving}>
                      <Trash2 className="h-4 w-4 mr-2" /> Remover
                    </Button>
                  )}
                </div>
              )}

              <p className="text-xs text-muted-foreground mt-4">
                Formatos aceitos: PNG, JPG, WebP, SVG · Máximo 3 MB · Recomendado: imagem horizontal
                até 600 × 200 px com fundo transparente.
              </p>
            </>
          )}
        </div>

        <AssessmentHeaderTemplates />
      </main>
    </div>
  );
}