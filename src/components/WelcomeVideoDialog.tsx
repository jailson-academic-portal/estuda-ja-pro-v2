import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import institutionalVideo from "@/assets/estudaja-institucional.mp4.asset.json";

const KEY_PREFIX = "estudaja:welcome-video:v1:";

export function WelcomeVideoDialog({ userId }: { userId: string | undefined }) {
  const [open, setOpen] = useState(false);
  const [dontShow, setDontShow] = useState(false);

  useEffect(() => {
    if (!userId) return;
    try {
      if (localStorage.getItem(KEY_PREFIX + userId) === "hidden") return;
    } catch {
      return;
    }
    const t = setTimeout(() => setOpen(true), 400);
    return () => clearTimeout(t);
  }, [userId]);

  const close = () => {
    if (dontShow && userId) {
      try {
        localStorage.setItem(KEY_PREFIX + userId, "hidden");
      } catch {
        /* noop */
      }
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : close())}>
      <DialogContent className="max-w-3xl p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Bem-vindo(a) ao EstudaJá Pro</DialogTitle>
          <DialogDescription>
            Um minuto para conhecer os Assistentes de IA e os Criadores da plataforma.
          </DialogDescription>
        </DialogHeader>
        <video
          src={institutionalVideo.url}
          controls
          autoPlay
          playsInline
          className="w-full rounded-lg bg-black"
        />
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <Checkbox
              checked={dontShow}
              onCheckedChange={(v) => setDontShow(v === true)}
            />
            Não exibir este vídeo novamente
          </label>
          <Button onClick={close}>Continuar para a plataforma</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}