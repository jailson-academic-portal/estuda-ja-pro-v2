import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { updateInstitutionBranding } from "@/backend/institution-admin.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Palette, Image as ImageIcon, Save } from "lucide-react";
import { toast } from "sonner";

export function InstitutionBrandingTab() {
  const updateBranding = useServerFn(updateInstitutionBranding);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [institution, setInstitution] = useState<any>(null);

  const [unit, setUnit] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#0d9488");
  const [secondaryColor, setSecondaryColor] = useState("#14b8a6");
  const [logoUrl, setLogoUrl] = useState("");

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("institutions").select("*").limit(1).maybeSingle();
      if (data) {
        setInstitution(data);
        setUnit((data as any).unit || "");
        setPrimaryColor((data as any).primary_color || "#0d9488");
        setSecondaryColor((data as any).secondary_color || "#14b8a6");
        setLogoUrl(data.logo_url || "");
      }
      setLoading(false);
    };
    void load();
  }, []);

  const handleSave = async () => {
    if (!institution) return;
    setSaving(true);
    try {
      await updateBranding({
        data: {
          id: institution.id,
          unit,
          primaryColor,
          secondaryColor,
          logoUrl: logoUrl || undefined
        }
      });
      toast.success("Branding institucional atualizado!");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-teal-600" /></div>;

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-teal-600" /> Personalização da Marca
          </CardTitle>
          <CardDescription>
            Configure a identidade visual da sua instituição para relatórios e documentos PDF.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Nome da Unidade / Campus</Label>
                <Input placeholder="Ex: Uniplano - São José" value={unit} onChange={e => setUnit(e.target.value)} />
              </div>

              <div className="space-y-1.5">
                <Label>URL do Logotipo</Label>
                <div className="flex gap-2">
                  <Input placeholder="https://..." value={logoUrl} onChange={e => setLogoUrl(e.target.value)} />
                  <Button variant="outline" size="icon"><ImageIcon className="h-4 w-4" /></Button>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Cor Primária (Marca)</Label>
                <div className="flex gap-3 items-center">
                  <Input type="color" className="w-12 h-10 p-1" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} />
                  <Input value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Cor Secundária</Label>
                <div className="flex gap-3 items-center">
                  <Input type="color" className="w-12 h-10 p-1" value={secondaryColor} onChange={e => setSecondaryColor(e.target.value)} />
                  <Input value={secondaryColor} onChange={e => setSecondaryColor(e.target.value)} />
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t flex justify-end">
            <Button onClick={handleSave} disabled={saving} className="bg-teal-600 hover:bg-teal-700">
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Salvar Configurações
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm bg-muted/30">
        <CardHeader>
          <CardTitle className="text-sm">Pré-visualização do Cabeçalho</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="border rounded bg-white p-6 shadow-sm">
            <div className="flex justify-between items-start border-b pb-4 mb-4" style={{ borderColor: primaryColor }}>
              <div className="flex gap-4 items-center">
                <div className="w-16 h-16 bg-muted rounded flex items-center justify-center overflow-hidden">
                  {logoUrl ? <img src={logoUrl} alt="Logo" className="max-w-full max-h-full" /> : <ImageIcon className="text-muted-foreground" />}
                </div>
                <div>
                  <h2 className="text-xl font-bold uppercase" style={{ color: primaryColor }}>{institution?.name || "Nome da Instituição"}</h2>
                  <p className="text-sm font-medium" style={{ color: secondaryColor }}>{unit || "Unidade — Campus"}</p>
                </div>
              </div>
              <div className="text-right text-[10px] text-muted-foreground">
                Documento Gerado via EstudaJá Pro
              </div>
            </div>
            <div className="h-20 bg-muted/10 rounded border border-dashed flex items-center justify-center text-xs text-muted-foreground">
              Área de Conteúdo do Relatório / Prova
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
