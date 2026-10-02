import { useState } from "react";
import { BookOpen, ClipboardList, GraduationCap, Library } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RubricLibraryDialog } from "./RubricLibraryDialog";
import { ACTIVITY_RUBRICS, WORK_RUBRICS } from "@/lib/rubric-library";

export function RubricsModule() {
  const [scope, setScope] = useState<"activity" | "work" | null>(null);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <BookOpen className="h-5 w-5" /> Biblioteca de Rubricas
        </h2>
        <p className="text-sm text-muted-foreground">
          Consulte rubricas pré-definidas, duplique modelos e mantenha rubricas pessoais editáveis.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div
          className="rounded-xl border bg-card p-4 space-y-3"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <div className="flex items-start gap-3">
            <ClipboardList className="h-6 w-6 text-primary" />
            <div>
              <div className="font-medium">Atividades Extras</div>
              <p className="text-sm text-muted-foreground">
                Redação, seminário, debate, estudo de caso, aula prática e outros modelos.
              </p>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            {Object.keys(ACTIVITY_RUBRICS).length} rubricas pré-definidas disponíveis
          </div>
          <Button onClick={() => setScope("activity")}>
            <Library className="h-4 w-4 mr-2" /> Abrir biblioteca de atividades
          </Button>
        </div>

        <div
          className="rounded-xl border bg-card p-4 space-y-3"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <div className="flex items-start gap-3">
            <GraduationCap className="h-6 w-6 text-primary" />
            <div>
              <div className="font-medium">Trabalhos Acadêmicos</div>
              <p className="text-sm text-muted-foreground">
                TCC, artigo científico, revisão de literatura, projeto de intervenção e pôster
                científico.
              </p>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            {Object.keys(WORK_RUBRICS).length} rubricas pré-definidas disponíveis
          </div>
          <Button onClick={() => setScope("work")}>
            <Library className="h-4 w-4 mr-2" /> Abrir biblioteca de trabalhos
          </Button>
        </div>
      </div>

      {scope && <RubricLibraryDialog scope={scope} onClose={() => setScope(null)} />}
    </div>
  );
}
