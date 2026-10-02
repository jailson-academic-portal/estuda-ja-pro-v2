import owl from "@/assets/owl-logo.png";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

interface EmptyStateProps {
  message: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
  children?: ReactNode;
}

export function EmptyState({ message, hint, actionLabel, onAction, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-6 rounded-2xl border-2 border-dashed bg-muted/20">
      <img
        src={owl}
        alt="EstudaJá Pro mascote"
        width={88}
        height={88}
        className="opacity-90 mb-3"
      />
      <p className="font-medium text-foreground max-w-md">{message}</p>
      {hint && <p className="text-sm text-muted-foreground mt-1 max-w-md">{hint}</p>}
      {actionLabel && onAction && (
        <Button onClick={onAction} className="mt-4">{actionLabel}</Button>
      )}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}