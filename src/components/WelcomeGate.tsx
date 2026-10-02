import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { OwlLogo } from "@/components/OwlLogo";
import { GraduationCap, Users, UserPlus, Building2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function WelcomeGate() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"initial" | "login" | "signup">("initial");
  const navigate = useNavigate();

  useEffect(() => {
    // Only show on the marketing page (/inicio) or main dashboard (/) for unauthenticated or first-time users
    const isPublicPage = window.location.pathname === "/inicio";
    const isRoot = window.location.pathname === "/";
    const hasSeenGate = localStorage.getItem("estudaja:welcome-gate-seen");
    
    if (!hasSeenGate && (isPublicPage || isRoot)) {
      setOpen(true);
    }
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    localStorage.setItem("estudaja:welcome-gate-seen", "true");
  }, []);

  const handleNavigate = (to: string, search?: any) => {
    handleClose();
    navigate({ to, search });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-[450px] p-0 overflow-hidden border-teal-500/20 shadow-2xl">
        <div className="relative p-6 sm:p-8 flex flex-col items-center text-center space-y-6">
          <button 
            onClick={handleClose}
            className="absolute right-4 top-4 p-2 rounded-full hover:bg-slate-100 transition-colors"
          >
            <X className="h-4 w-4 text-slate-400" />
          </button>

          <div className="flex flex-col items-center space-y-2">
            <OwlLogo size={80} withText={false} />
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">
              <span className="text-teal-600">EstudaJá</span>{" "}
              <span className="text-amber-400">Pro</span>
            </h2>
          </div>

          {step === "initial" && (
            <>
              <div className="space-y-2">
                <DialogTitle className="text-xl font-bold text-slate-800">
                  Você já é usuário do EstudaJá Pro?
                </DialogTitle>
                <p className="text-sm text-slate-500">
                  Selecione a opção abaixo para direcionarmos você ao local correto.
                </p>
              </div>

              <div className="grid w-full gap-3 pt-2">
                <Button 
                  onClick={() => setStep("login")}
                  className="h-14 text-base font-bold bg-teal-600 hover:bg-teal-700 shadow-lg shadow-teal-500/20"
                >
                  SIM, JÁ SOU USUÁRIO
                </Button>
                <Button 
                  variant="outline"
                  onClick={() => setStep("signup")}
                  className="h-14 text-base font-semibold border-teal-500/30 text-teal-700 hover:bg-teal-50"
                >
                  NÃO, QUERO CONHECER / CADASTRAR
                </Button>
              </div>
            </>
          )}

          {step === "login" && (
            <>
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-slate-800">Selecione seu acesso</h3>
                <p className="text-sm text-slate-500">Como você deseja entrar na plataforma?</p>
              </div>

              <div className="grid w-full gap-3 pt-2">
                <Button 
                  onClick={() => handleNavigate("/login", { tab: "matricula" })}
                  className="h-16 flex flex-col items-center justify-center bg-blue-600 hover:bg-blue-700 text-white transition-all group shadow-md"
                >
                  <div className="flex items-center gap-2">
                    <GraduationCap className="h-5 w-5 text-white" />
                    <span className="font-bold text-white">Sou Aluno</span>
                  </div>
                  <span className="text-[10px] text-blue-100 uppercase tracking-wider font-medium">Acesso por matrícula</span>
                </Button>

                <Button 
                  variant="outline"
                  onClick={() => handleNavigate("/login", { tab: "email" })}
                  className="h-16 flex flex-col items-center justify-center border-2 hover:border-teal-500 hover:bg-teal-50 transition-all group"
                >
                  <div className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-teal-600" />
                    <span className="font-bold text-slate-800">Sou Professor</span>
                  </div>
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Acesso por e-mail/senha</span>
                </Button>

                <Button 
                  variant="outline"
                  onClick={() => handleNavigate("/login", { tab: "gestor" })}
                  className="h-16 flex flex-col items-center justify-center border-2 hover:border-teal-500 hover:bg-teal-50 transition-all group"
                >
                  <div className="flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-teal-600" />
                    <span className="font-bold text-slate-800">Sou Gestor / Instituição</span>
                  </div>
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Painel Administrativo</span>
                </Button>

                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setStep("initial")}
                  className="mt-2 text-slate-400 hover:text-teal-600"
                >
                  Voltar
                </Button>
              </div>
            </>
          )}

          {step === "signup" && (
            <>
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-slate-800">Criar minha conta</h3>
                <p className="text-sm text-slate-500">Escolha o perfil que melhor descreve você.</p>
              </div>

              <div className="grid w-full gap-3 pt-2">
                <Button 
                  variant="outline"
                  onClick={() => handleNavigate("/signup")}
                  className="h-16 flex flex-col items-center justify-center border-2 hover:border-teal-500 hover:bg-teal-50 transition-all"
                >
                  <div className="flex items-center gap-2">
                    <UserPlus className="h-5 w-5 text-teal-600" />
                    <span className="font-bold text-slate-800">Cadastrar como Professor</span>
                  </div>
                </Button>

                <Button 
                  variant="outline"
                  onClick={() => handleNavigate("/signup")}
                  className="h-16 flex flex-col items-center justify-center border-2 hover:border-teal-500 hover:bg-teal-50 transition-all"
                >
                  <div className="flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-teal-600" />
                    <span className="font-bold text-slate-800">Cadastrar minha Instituição</span>
                  </div>
                </Button>

                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setStep("initial")}
                  className="mt-2 text-slate-400 hover:text-teal-600"
                >
                  Voltar
                </Button>
              </div>
            </>
          )}
          
          <div className="pt-4 text-[10px] text-slate-400 font-medium">
            ESTUDAJÁ PRO © 2026 · SISTEMA INTEGRADO
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
