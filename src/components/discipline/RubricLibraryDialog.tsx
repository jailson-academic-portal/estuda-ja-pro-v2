import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Plus, Trash2, Copy, Pencil, BookOpen, Check } from "lucide-react";
import { toast } from "sonner";
import {
  ACTIVITY_RUBRICS,
  ACTIVITY_SUBTYPE_LABELS,
  WORK_RUBRICS,
  WORK_SUBTYPE_LABELS,
  templateToRubric,
} from "@/lib/rubric-library";

type Crit = { id: string; name: string; description?: string; weight: number; max_score: number };
type Formula = "weighted_average" | "simple_average";

export interface CustomRubric {
  id: string;
  owner_id: string;
  name: string;
  scope: "activity" | "work";
  subtype: string | null;
  criteria: Crit[];
  grading_formula: Formula;
}

export interface RubricSelection {
  name: string;
  criteria: Crit[];
  grading_formula: Formula;
}

export function RubricLibraryDialog({
  scope,
  onClose,
  onSelect,
}: {
  scope: "activity" | "work";
  onClose: () => void;
  onSelect?: (sel: RubricSelection) => void;
}) {
  const { user } = useAuth();
  const [tab, setTab] = useState<"predefined" | "personal">("predefined");
  const [items, setItems] = useState<CustomRubric[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<CustomRubric | null>(null);
  const [creating, setCreating] = useState(false);

  const presets = scope === "activity" ? ACTIVITY_RUBRICS : WORK_RUBRICS;
  const labels = scope === "activity" ? ACTIVITY_SUBTYPE_LABELS : WORK_SUBTYPE_LABELS;

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("custom_rubrics")
      .select("*")
      .eq("owner_id", user.id)
      .eq("scope", scope)
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setItems((data ?? []) as unknown as CustomRubric[]);
    setLoading(false);
  }, [user, scope]);

  useEffect(() => {
    load();
  }, [load]);

  const duplicate = async (
    r:
      | CustomRubric
      | { name: string; criteria: Crit[]; grading_formula: Formula; subtype?: string | null },
    editAfterCopy = false,
  ) => {
    if (!user) return;
    const payload = {
      owner_id: user.id,
      name: `${r.name} (cópia)`,
      scope,
      subtype: ("subtype" in r ? r.subtype : null) ?? null,
      criteria: r.criteria.map((c) => ({ ...c, id: crypto.randomUUID() })),
      grading_formula: r.grading_formula,
    };
    const { data, error } = await supabase
      .from("custom_rubrics")
      .insert(payload)
      .select("*")
      .maybeSingle();
    if (error) return toast.error(error.message);
    toast.success("Rubrica duplicada na sua biblioteca");
    setTab("personal");
    if (editAfterCopy && data) setEditing(data as unknown as CustomRubric);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir esta rubrica pessoal?")) return;
    const { error } = await supabase.from("custom_rubrics").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Excluída");
    load();
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" /> Biblioteca de Rubricas
            </DialogTitle>
            <DialogDescription>
              Visualize as rubricas pré-definidas ou gerencie suas rubricas pessoais.
              {onSelect && ' Clique em "Aplicar" para usar uma rubrica nesta atividade.'}
            </DialogDescription>
          </DialogHeader>

          <Tabs value={tab} onValueChange={(v) => setTab(v as "predefined" | "personal")}>
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="predefined">
                Pré-definidas ({Object.keys(presets).length})
              </TabsTrigger>
              <TabsTrigger value="personal">Minhas rubricas ({items.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="predefined" className="space-y-2 mt-3">
              {Object.values(presets).map((tpl) => (
                <div key={tpl.key} className="border rounded-lg p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{tpl.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {labels[tpl.key] ?? tpl.key} · {tpl.criteria.length} critérios
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {onSelect && (
                        <Button
                          size="sm"
                          onClick={() => {
                            onSelect({
                              name: tpl.name,
                              criteria: templateToRubric(tpl),
                              grading_formula: "weighted_average",
                            });
                            onClose();
                          }}
                        >
                          <Check className="h-3.5 w-3.5 mr-1" /> Aplicar
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          duplicate({
                            name: tpl.name,
                            criteria: templateToRubric(tpl),
                            grading_formula: "weighted_average",
                            subtype: tpl.key,
                          })
                        }
                      >
                        <Copy className="h-3.5 w-3.5 mr-1" /> Duplicar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          duplicate(
                            {
                              name: tpl.name,
                              criteria: templateToRubric(tpl),
                              grading_formula: "weighted_average",
                              subtype: tpl.key,
                            },
                            true,
                          )
                        }
                      >
                        <Pencil className="h-3.5 w-3.5 mr-1" /> Editar cópia
                      </Button>
                    </div>
                  </div>
                  <details className="mt-2">
                    <summary className="text-xs cursor-pointer text-primary">Ver critérios</summary>
                    <ul className="mt-2 space-y-1 text-xs">
                      {tpl.criteria.map((c, i) => (
                        <li key={i}>
                          <span className="font-medium">{c.name}</span> — peso {c.weight}%
                          {c.description && (
                            <span className="block text-muted-foreground">{c.description}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              ))}
            </TabsContent>

            <TabsContent value="personal" className="space-y-2 mt-3">
              <div className="flex justify-end">
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus className="h-4 w-4 mr-1" /> Nova rubrica
                </Button>
              </div>
              {loading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : items.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Você ainda não tem rubricas pessoais. Crie uma nova ou duplique uma pré-definida.
                </p>
              ) : (
                items.map((r) => (
                  <div key={r.id} className="border rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-sm">{r.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.criteria.length} critérios · fórmula:{" "}
                          {r.grading_formula === "simple_average" ? "média simples" : "ponderada"}
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {onSelect && (
                          <Button
                            size="sm"
                            onClick={() => {
                              onSelect({
                                name: r.name,
                                criteria: r.criteria.map((c) => ({
                                  ...c,
                                  id: crypto.randomUUID(),
                                })),
                                grading_formula: r.grading_formula,
                              });
                              onClose();
                            }}
                          >
                            <Check className="h-3.5 w-3.5 mr-1" /> Aplicar
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                          <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => duplicate(r)}>
                          <Copy className="h-3.5 w-3.5 mr-1" /> Duplicar
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          onClick={() => remove(r.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {(creating || editing) && (
        <RubricEditorDialog
          scope={scope}
          rubric={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            load();
          }}
        />
      )}
    </>
  );
}

function RubricEditorDialog({
  scope,
  rubric,
  onClose,
  onSaved,
}: {
  scope: "activity" | "work";
  rubric?: CustomRubric;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [name, setName] = useState(rubric?.name ?? "");
  const [formula, setFormula] = useState<Formula>(rubric?.grading_formula ?? "weighted_average");
  const [criteria, setCriteria] = useState<Crit[]>(
    rubric?.criteria ?? [
      { id: crypto.randomUUID(), name: "Critério 1", weight: 100, max_score: 10 },
    ],
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!user) return;
    if (!name.trim()) return toast.error("Informe um nome");
    if (criteria.length === 0) return toast.error("Adicione ao menos um critério");
    setSaving(true);
    const payload = {
      owner_id: user.id,
      name: name.trim(),
      scope,
      criteria,
      grading_formula: formula,
      subtype: rubric?.subtype ?? null,
    };
    const q = rubric
      ? supabase.from("custom_rubrics").update(payload).eq("id", rubric.id)
      : supabase.from("custom_rubrics").insert(payload);
    const { error } = await q;
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Rubrica salva");
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{rubric ? "Editar rubrica" : "Nova rubrica pessoal"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Fórmula da nota final</Label>
            <select
              className="border rounded px-2 py-1.5 text-sm w-full"
              value={formula}
              onChange={(e) => setFormula(e.target.value as Formula)}
            >
              <option value="weighted_average">Média ponderada</option>
              <option value="simple_average">Média simples</option>
            </select>
          </div>
          <div>
            <Label>Critérios</Label>
            <div className="space-y-2 mt-2">
              {criteria.map((c, i) => (
                <div key={c.id} className="border rounded p-2 space-y-2">
                  <div className="flex gap-2 items-center">
                    <Input
                      value={c.name}
                      onChange={(e) =>
                        setCriteria(
                          criteria.map((r, idx) =>
                            idx === i ? { ...r, name: e.target.value } : r,
                          ),
                        )
                      }
                      placeholder="Critério"
                    />
                    <Input
                      type="number"
                      className="w-20"
                      value={c.weight}
                      onChange={(e) =>
                        setCriteria(
                          criteria.map((r, idx) =>
                            idx === i ? { ...r, weight: Number(e.target.value) } : r,
                          ),
                        )
                      }
                      placeholder="Peso %"
                    />
                    <Input
                      type="number"
                      className="w-20"
                      value={c.max_score}
                      onChange={(e) =>
                        setCriteria(
                          criteria.map((r, idx) =>
                            idx === i ? { ...r, max_score: Number(e.target.value) } : r,
                          ),
                        )
                      }
                      placeholder="Máx"
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive"
                      onClick={() => setCriteria(criteria.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <Textarea
                    rows={2}
                    placeholder="Descrição do critério"
                    value={c.description ?? ""}
                    onChange={(e) =>
                      setCriteria(
                        criteria.map((r, idx) =>
                          idx === i ? { ...r, description: e.target.value } : r,
                        ),
                      )
                    }
                  />
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setCriteria([
                    ...criteria,
                    { id: crypto.randomUUID(), name: "", weight: 0, max_score: 10 },
                  ])
                }
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Critério
              </Button>
              <p className="text-xs text-muted-foreground">
                Soma dos pesos: {criteria.reduce((s, c) => s + (c.weight || 0), 0)}%
              </p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={saving} onClick={save}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
