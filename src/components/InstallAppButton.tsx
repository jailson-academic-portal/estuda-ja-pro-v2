import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Download, Smartphone, Monitor } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    nav.standalone === true
  );
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function InstallAppButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    if (isStandalone()) setInstalled(true);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  const handleClick = async () => {
    if (deferred) {
      try {
        await deferred.prompt();
        const res = await deferred.userChoice;
        if (res.outcome === "accepted") setInstalled(true);
        setDeferred(null);
      } catch {
        setHelpOpen(true);
      }
      return;
    }
    setHelpOpen(true);
  };

  return (
    <>
      <Button variant="outline" onClick={handleClick} title="Instalar o aplicativo">
        <Download className="h-4 w-4 mr-2" /> Instalar app
      </Button>
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Instalar o EstudaJá Pro</DialogTitle>
            <DialogDescription>
              Adicione o ícone do aplicativo à tela inicial do seu dispositivo para
              acesso rápido, mesmo offline.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-2 font-medium mb-2">
                <Smartphone className="h-4 w-4" /> No celular
              </div>
              {isIOS() ? (
                <ol className="list-decimal ml-5 space-y-1 text-muted-foreground">
                  <li>Abra este site no <strong>Safari</strong>.</li>
                  <li>Toque no ícone de <strong>Compartilhar</strong> (quadrado com seta).</li>
                  <li>Escolha <strong>"Adicionar à Tela de Início"</strong>.</li>
                  <li>Confirme em <strong>Adicionar</strong>.</li>
                </ol>
              ) : (
                <ol className="list-decimal ml-5 space-y-1 text-muted-foreground">
                  <li>Abra o menu do navegador (⋮ no Chrome).</li>
                  <li>Toque em <strong>"Instalar aplicativo"</strong> ou <strong>"Adicionar à tela inicial"</strong>.</li>
                  <li>Confirme a instalação.</li>
                </ol>
              )}
            </div>
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-2 font-medium mb-2">
                <Monitor className="h-4 w-4" /> No computador
              </div>
              <ol className="list-decimal ml-5 space-y-1 text-muted-foreground">
                <li>Use <strong>Chrome</strong>, <strong>Edge</strong> ou outro navegador compatível.</li>
                <li>Clique no ícone de <strong>instalar</strong> (⊕) na barra de endereços.</li>
                <li>Ou abra o menu ⋮ e escolha <strong>"Instalar EstudaJá Pro"</strong>.</li>
                <li>Confirme para adicionar o ícone à área de trabalho.</li>
              </ol>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}