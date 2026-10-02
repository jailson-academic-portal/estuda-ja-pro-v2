import { Card, CardContent } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "teal",
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone?: "teal" | "blue" | "green" | "purple" | "orange" | "pink";
}) {
  const toneVar: Record<string, string> = {
    teal: "var(--color-card-teal)",
    blue: "var(--color-card-blue)",
    green: "var(--color-card-green)",
    purple: "var(--color-card-purple)",
    orange: "var(--color-card-orange)",
    pink: "var(--color-card-pink)",
  };
  return (
    <Card className="overflow-hidden border-0" style={{ boxShadow: "var(--shadow-card)" }}>
      <CardContent className="p-5 flex items-center gap-4">
        <div
          className="h-12 w-12 rounded-xl flex items-center justify-center text-white shrink-0"
          style={{ backgroundColor: toneVar[tone] }}
        >
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <div className="text-2xl font-bold leading-tight">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}