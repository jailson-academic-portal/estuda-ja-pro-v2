import { Sparkles } from "lucide-react";

export function ModulePlaceholder({ title, description }: { title: string; description: string }) {
  return (
    <div className="border-2 border-dashed rounded-xl py-16 px-6 text-center">
      <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
        <Sparkles className="h-6 w-6 text-primary" />
      </div>
      <h3 className="font-semibold text-lg">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">{description}</p>
      <p className="text-xs text-muted-foreground mt-4">Em construção — chegará na próxima etapa.</p>
    </div>
  );
}