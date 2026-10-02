import React from "react";
import ReactMarkdown from "react-markdown";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const PEPInterface: React.FC<{ case: any; activeTab: string }> = ({ case: caseData, activeTab }) => {
  const patient = caseData.patient_info || {};
  const vitalSigns = patient.vital_signs || [];
  const labExams = (caseData.investigation_data?.lab_exams) || [];
  const pharmacotherapy = patient.pharmacotherapy || [];

  const classificationTone = (c: string) => {
    const val = (c || "").toLowerCase();
    if (val.includes("crit")) return "bg-red-100 text-red-800 border-red-200";
    if (val.includes("alter") || val.includes("elev")) return "bg-amber-100 text-amber-800 border-amber-200";
    return "bg-green-100 text-green-800 border-green-200";
  };

  if (activeTab === "pep") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Prontuário & Sinais Vitais</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-4 border rounded-lg bg-muted/10">
            <div>
              <p className="text-[10px] uppercase text-muted-foreground font-bold">Paciente</p>
              <p className="font-semibold">{patient.name || "Não informado"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-muted-foreground font-bold">Idade / Sexo</p>
              <p className="font-semibold">{patient.age || "-"} / {patient.sex || "-"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-muted-foreground font-bold">Ocupação</p>
              <p className="font-semibold">{patient.occupation || "-"}</p>
            </div>
            <div className="md:col-span-2 lg:col-span-3">
              <p className="text-[10px] uppercase text-muted-foreground font-bold">Queixa Principal</p>
              <p className="font-semibold">{patient.chief_complaint || caseData.title}</p>
            </div>
            <div className="md:col-span-2 lg:col-span-3">
              <p className="text-[10px] uppercase text-muted-foreground font-bold">Anamnese & Histórico</p>
              <div className="text-sm leading-relaxed whitespace-pre-wrap [&_p]:mb-2 [&_strong]:font-semibold">
                <ReactMarkdown>{String(patient.anamnesis || "")}</ReactMarkdown>
                <p><span className="font-semibold">Histórico:</span></p>
                <ReactMarkdown>{String(patient.history || caseData.description || "")}</ReactMarkdown>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="font-bold flex items-center gap-2">
              <div className="h-1 w-4 bg-primary rounded-full" />
              Parâmetros e Sinais Vitais
            </h4>
            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold">Parâmetro</TableHead>
                    <TableHead className="font-bold">Valor Medido</TableHead>
                    <TableHead className="font-bold">Unidade</TableHead>
                    <TableHead className="font-bold">Referência</TableHead>
                    <TableHead className="font-bold">Classificação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vitalSigns.map((vs: any, i: number) => (
                    <TableRow key={i} className="hover:bg-muted/30">
                      <TableCell className="font-medium">{vs.parameter}</TableCell>
                      <TableCell className="font-mono text-primary font-bold">{vs.value}</TableCell>
                      <TableCell>{vs.unit}</TableCell>
                      <TableCell className="text-muted-foreground">{vs.reference}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={classificationTone(vs.classification)}>
                          {vs.classification || "Normal"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {vitalSigns.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground italic">
                        Nenhum sinal vital registrado neste prontuário.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="font-bold flex items-center gap-2">
              <div className="h-1 w-4 bg-primary rounded-full" />
              Medicamentos em Uso (Farmacoterapia Atual)
            </h4>
            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold">Medicamento / Princípio Ativo</TableHead>
                    <TableHead className="font-bold">Dose e Via</TableHead>
                    <TableHead className="font-bold">Posologia / Frequência</TableHead>
                    <TableHead className="font-bold">Horários</TableHead>
                    <TableHead className="font-bold">Relação com Dieta</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pharmacotherapy.map((med: any, i: number) => (
                    <TableRow key={i} className="hover:bg-muted/30">
                      <TableCell className="font-medium">{med.medication}</TableCell>
                      <TableCell>{med.dose_route}</TableCell>
                      <TableCell className="font-mono text-sm">{med.posology_schedule}</TableCell>
                      <TableCell className="font-mono text-sm">{med.intake_times}</TableCell>
                      <TableCell className="text-sm">{med.food_relation}</TableCell>
                    </TableRow>
                  ))}
                  {pharmacotherapy.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground italic">
                        Nenhum medicamento registrado no prontuário.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {patient.supplements && (
              <div className="p-3 bg-amber-50 border border-amber-100 rounded-md">
                <p className="text-xs font-bold text-amber-800 uppercase mb-1">Suplementos / Antiócidos em uso</p>
                <p className="text-sm text-amber-900">{patient.supplements}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (activeTab === "investigation") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Investigação & Exames Complementares</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="font-bold">Exame</TableHead>
                  <TableHead className="font-bold">Resultado</TableHead>
                  <TableHead className="font-bold">Unidade</TableHead>
                  <TableHead className="font-bold">Valor de Referência</TableHead>
                  <TableHead className="font-bold">Classificação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {labExams.map((exam: any, i: number) => (
                  <TableRow key={i} className="hover:bg-muted/30">
                    <TableCell className="font-medium">{exam.exam}</TableCell>
                    <TableCell className="font-mono text-primary font-bold">{exam.value}</TableCell>
                    <TableCell>{exam.unit}</TableCell>
                    <TableCell className="text-muted-foreground">{exam.reference}</TableCell>
                    <TableCell>
                      <Badge 
                        variant="outline" 
                        className={classificationTone(
                          exam.classification || (parseFloat(exam.value) > parseFloat(exam.reference?.split('-')[1] || exam.reference) ? 'Alterado' : 'Normal')
                        )}
                      >
                        {exam.classification || (parseFloat(exam.value) > parseFloat(exam.reference?.split('-')[1] || exam.reference) ? 'Alterado' : 'Normal')}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {labExams.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground italic">
                      Nenhum exame laboratorial disponível para este caso.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
};
