import owl from "@/assets/owl-logo.png";

export function OwlLogo({ size, withText = true, className }: { size?: number; withText?: boolean; className?: string }) {
  return (
    <div className={`flex items-center gap-3.5 ${className || ""}`}>
      <img
        src={owl}
        alt="EstudaJá Pro mascot"
        className="w-14 h-14 sm:w-16 sm:h-16 object-contain drop-shadow-sm"
        style={size ? { width: size, height: size } : undefined}
      />
      {withText && (
        <div className="leading-tight">
          <div className="text-xl sm:text-2xl font-bold">
            <span className="text-white">EstudaJá</span>{" "}
            <span className="text-amber-400">Pro</span>
          </div>

          <div className="text-sm text-white/90">
            Aprendizagem acadêmica inteligente
          </div>
        </div>
      )}
    </div>
  );
}
