import React, { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pencil, RefreshCw, CheckCircle2, Loader2, X, MessageSquareOff, MessageSquare } from "lucide-react";
import type { ClinicalCaseDraft } from "@/backend/simulsaude-cases.functions";

interface Props {
  draft: ClinicalCaseDraft;
  onChange: (draft: ClinicalCaseDraft) => void;
  onRegenerate: () => void;
  onPublish: () => void;
  onDiscard: () => void;
  regenerating?: boolean;
  publishing?: boolean;
}

export const ClinicalCaseDraftReview: React.FC<Props> = ({
  draft,
  onChange,
  onRegenerate,
  onPublish,
  onDiscard,
  regenerating,
  publishing,
}) => {
  const [editing, setEditing] = useState(false);
  const busy = Boolean(regenerating || publishing);

  const setPatient = (key: keyof ClinicalCaseDraft["patient"], value: string) =>
    onChange({ ...draft, patient: { ...draft.patient, [key]: value } });

  const setVital = (i: number, key: string, value: string) => {
    const vital_signs = draft.vital_signs.map((v, idx) => (idx === i ? { ...v, [key]: value } : v));
    onChange({ ...draft, vital_signs });
  };

  const setLab = (i: number, key: string, value: string) => {
    const lab_exams = draft.lab_exams.map((v, idx) => (idx === i ? { ...v, [key]: value } : v));
    onChange({ ...draft, lab_exams });
  };

  const setConduct = (i: number, key: keyof ClinicalCaseDraft["expected_conducts"][0], value: string | number) => {
    const expected_conducts = draft.expected_conducts.map((c, idx) => (idx === i ? { ...c, [key]: value } : c));
    onChange({ ...draft, expected_conducts });
  };

  const setPharmacotherapy = (i: number, key: keyof ClinicalCaseDraft["patient"]["pharmacotherapy"][0], value: string) => {
    const pharmacotherapy = draft.patient.pharmacotherapy.map((p, idx) => (idx === i ? { ...p, [key]: value } : p));
    onChange({ ...draft, patient: { ...draft.patient, pharmacotherapy } });
  };

  const setListItem = (field: "evaluation_criteria", i: number, value: string) =>
    onChange({ ...draft, [field]: draft[field].map((v, idx) => (idx === i ? value : v)) });

  const classificationTone = (c: string) =>
    /crit/i.test(c) ? "bg-destructive" : /alter/i.test(c) ? "bg-orange-500" : "bg-green-600";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Badge variant="outline" className="mb-2">Rascunho gerado por IA</Badge>
          <h2 className="text-2xl font-bold">Aprovação e Edição do Rascunho</h2>
          <p className="text-sm text-muted-foreground">
            Revise o caso clínico antes de liberar para os alunos matriculados.
          </p>
        </div>
        <Button variant="ghost" onClick={onDiscard} disabled={busy}>
          <X className="h-4 w-4 mr-1" /> Descartar
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Título e Ficha de Apresentação do Paciente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Título do Caso</label>
            <Input value={draft.title} readOnly={!editing} onChange={(e) => onChange({ ...draft, title: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Resumo</label>
            <Textarea value={draft.description} readOnly={!editing} onChange={(e) => onChange({ ...draft, description: e.target.value })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {([
              ["name", "Paciente"],
              ["age", "Idade"],
              ["sex", "Sexo"],
              ["occupation", "Ocupação"],
            ] as const).map(([key, label]) => (
              <div key={key} className="space-y-1.5">
                <label className="text-sm font-medium">{label}</label>
                <Input value={draft.patient[key]} readOnly={!editing} onChange={(e) => setPatient(key, e.target.value)} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Anamnese, Histórico e Queixa Principal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Queixa Principal</label>
            <Textarea value={draft.patient.chief_complaint} readOnly={!editing} onChange={(e) => setPatient("chief_complaint", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Anamnese</label>
            <Textarea className="min-h-[120px]" value={draft.patient.anamnesis} readOnly={!editing} onChange={(e) => setPatient("anamnesis", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Histórico Clínico</label>
            <Textarea className="min-h-[120px]" value={draft.patient.history} readOnly={!editing} onChange={(e) => setPatient("history", e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span>💊 Medicamentos em Uso / Farmacoterapia Atual</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto border rounded-md">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="font-bold min-w-[200px]">Medicamento / Princípio Ativo</TableHead>
                  <TableHead className="font-bold min-w-[150px]">Dose / Apresentação</TableHead>
                  <TableHead className="font-bold min-w-[150px]">Posologia / Frequência</TableHead>
                  <TableHead className="font-bold min-w-[120px]">Horários</TableHead>
                  <TableHead className="font-bold min-w-[200px]">Relação com Alimento / Obs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {draft.patient.pharmacotherapy?.map((med, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      {editing ? (
                        <Input value={med.medication} onChange={(e) => setPharmacotherapy(i, "medication", e.target.value)} />
                      ) : med.medication}
                    </TableCell>
                    <TableCell>
                      {editing ? (
                        <Input value={med.dose_route} onChange={(e) => setPharmacotherapy(i, "dose_route", e.target.value)} />
                      ) : med.dose_route}
                    </TableCell>
                    <TableCell>
                      {editing ? (
                        <Input value={med.posology_schedule} onChange={(e) => setPharmacotherapy(i, "posology_schedule", e.target.value)} />
                      ) : med.posology_schedule}
                    </TableCell>
                    <TableCell>
                      {editing ? (
                        <Input value={med.intake_times} onChange={(e) => setPharmacotherapy(i, "intake_times", e.target.value)} />
                      ) : med.intake_times}
                    </TableCell>
                    <TableCell>
                      {editing ? (
                        <Input value={med.food_relation} onChange={(e) => setPharmacotherapy(i, "food_relation", e.target.value)} />
                      ) : med.food_relation}
                    </TableCell>
                  </TableRow>
                ))}
                {(!draft.patient.pharmacotherapy || draft.patient.pharmacotherapy.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-4 text-muted-foreground italic">
                      Nenhum medicamento registrado.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Suplementos / Antiócidos em uso</label>
            <Input 
              value={draft.patient.supplements || ""} 
              readOnly={!editing} 
              onChange={(e) => setPatient("supplements", e.target.value)} 
              placeholder="Ex: Carbonato de Cálcio, Hidróxido de Alumínio..."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Configurações de Interação</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
            <div className="flex items-center gap-3">
              {(draft as any).chat_enabled !== false ? <MessageSquare className="h-5 w-5 text-primary" /> : <MessageSquareOff className="h-5 w-5 text-muted-foreground" />}
              <div>
                <p className="font-medium">Habilitar Chat com Paciente (IA)</p>
                <p className="text-xs text-muted-foreground">Permite que os alunos entrevistem o paciente usando IA.</p>
              </div>
            </div>
            <Switch 
              checked={(draft as any).chat_enabled !== false} 
              onCheckedChange={(checked) => onChange({ ...draft, chat_enabled: checked } as any)} 
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sinais Vitais</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="border">Parâmetro</TableHead>
                <TableHead className="border">Valor</TableHead>
                <TableHead className="border">Unidade</TableHead>
                <TableHead className="border">Referência</TableHead>
                <TableHead className="border">Classificação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {draft.vital_signs.map((v, i) => (
                <TableRow key={i} className={i % 2 === 0 ? "bg-muted/30" : "bg-background"}>
                  {(["parameter", "value", "unit", "reference"] as const).map((k) => (
                    <TableCell key={k} className="border">
                      {editing ? (
                        <Input className="h-8" value={v[k]} onChange={(e) => setVital(i, k, e.target.value)} />
                      ) : (
                        v[k]
                      )}
                    </TableCell>
                  ))}
                  <TableCell className="border">
                    {editing ? (
                      <Input className="h-8" value={v.classification} onChange={(e) => setVital(i, "classification", e.target.value)} />
                    ) : (
                      <Badge className={classificationTone(v.classification)}>{v.classification}</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Exames Laboratoriais e Valores de Referência</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="border">Exame</TableHead>
                <TableHead className="border">Valor</TableHead>
                <TableHead className="border">Unidade</TableHead>
                <TableHead className="border">Valor de Referência</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {draft.lab_exams.map((v, i) => (
                <TableRow key={i} className={i % 2 === 0 ? "bg-muted/30" : "bg-background"}>
                  {(["exam", "value", "unit", "reference"] as const).map((k) => (
                    <TableCell key={k} className="border">
                      {editing ? (
                        <Input className="h-8" value={v[k]} onChange={(e) => setLab(i, k, e.target.value)} />
                      ) : (
                        v[k]
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Condutas Esperadas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {draft.expected_conducts.map((c, i) =>
              editing ? (
                <div key={i} className="space-y-2 p-3 border rounded-lg bg-muted/20">
                  <div className="flex gap-2">
                    <div className="flex-1 space-y-1">
                      <label className="text-[10px] font-bold uppercase">Opção de Conduta</label>
                      <Textarea value={c.label} onChange={(e) => setConduct(i, "label", e.target.value)} />
                    </div>
                    <div className="w-24 space-y-1">
                      <label className="text-[10px] font-bold uppercase">Nota</label>
                      <Input type="number" step="0.1" min="0" max="10" value={c.score} onChange={(e) => setConduct(i, "score", parseFloat(e.target.value) || 0)} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase">Feedback Pedagógico</label>
                    <Textarea value={c.feedback} onChange={(e) => setConduct(i, "feedback", e.target.value)} />
                  </div>
                </div>
              ) : (
                <div key={i} className="p-3 border rounded-lg">
                  <div className="flex justify-between items-start mb-1">
                    <p className="font-semibold text-sm">{c.label}</p>
                    <Badge variant={c.score >= 7 ? "default" : "secondary"}>Nota: {c.score}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground italic">{c.feedback}</p>
                </div>
              ),
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Critérios de Avaliação</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {draft.evaluation_criteria.map((c, i) =>
              editing ? (
                <Textarea key={i} value={c} onChange={(e) => setListItem("evaluation_criteria", i, e.target.value)} />
              ) : (
                <p key={i} className="text-sm">• {c}</p>
              ),
            )}
          </CardContent>
        </Card>
        {(draft.clinical_questions ?? []).length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Perguntas Dissertativas e Espelho de Resposta</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {(draft.clinical_questions ?? []).map((q, i) => (
                <div key={i} className="rounded-lg border p-3 space-y-2">
                  <p className="text-xs font-bold uppercase text-muted-foreground">Questão {i + 1}</p>
                  {editing ? (
                    <Textarea
                      value={q.question}
                      onChange={(e) => {
                        const list = [...(draft.clinical_questions ?? [])];
                        list[i] = { ...list[i], question: e.target.value };
                        onChange({ ...draft, clinical_questions: list });
                      }}
                    />
                  ) : (
                    <p className="text-sm font-medium">{q.question}</p>
                  )}
                  <p className="text-[10px] font-bold uppercase text-muted-foreground">Espelho de resposta</p>
                  {editing ? (
                    <Textarea
                      value={q.expected_answer}
                      onChange={(e) => {
                        const list = [...(draft.clinical_questions ?? [])];
                        list[i] = { ...list[i], expected_answer: e.target.value };
                        onChange({ ...draft, clinical_questions: list });
                      }}
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground whitespace-pre-line">{q.expected_answer}</p>
                  )}
                  {(q.rubric ?? []).length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase text-muted-foreground">Rubrica de correção</p>
                      {(q.rubric ?? []).map((r, ri) => (
                        <p key={ri} className="text-xs">
                          • <span className="font-medium">{r.criterion}</span> ({r.weight} pts)
                          {r.description ? ` — ${r.description}` : ""}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>


      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end sticky bottom-0 bg-background/95 backdrop-blur py-4 border-t">
        <Button variant={editing ? "secondary" : "outline"} onClick={() => setEditing((e) => !e)} disabled={busy}>
          <Pencil className="h-4 w-4 mr-2" /> {editing ? "Concluir Edição" : "Editar Rascunho"}
        </Button>
        <Button variant="outline" onClick={onRegenerate} disabled={busy}>
          {regenerating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Regerar com IA
        </Button>
        <Button onClick={onPublish} disabled={busy}>
          {publishing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
          Aprovar e Publicar para os Alunos
        </Button>
      </div>
    </div>
  );
};