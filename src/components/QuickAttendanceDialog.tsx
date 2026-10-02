import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, KeyRound, Loader2, ScanLine } from "lucide-react";
import jsQR from "jsqr";
import {
  confirmAttendanceByCode,
  markPresenceBySession,
} from "@/backend/attendance.functions";



export function QuickAttendanceDialog({
  open,
  onOpenChange,
  onMarked,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onMarked?: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!open) {
      setCode("");
      setScanOpen(false);
    }
  }, [open]);

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation(); // Evita qualquer bolha de evento
    
    if (code.length !== 6) {
      toast.error("Código incompleto");
      return;
    }

    setBusy(true);
    try {
      await confirmAttendanceByCode({ data: { code } });
      toast.success("Presença confirmada!");
      setCode("");
      onOpenChange(false);
      onMarked?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("fetch") || msg.toLowerCase().includes("timeout") || msg.toLowerCase().includes("network")) {
        toast.error("Erro de conexão. Verifique sua internet.");
      } else {
        toast.error(msg || "Erro ao confirmar presença");
      }
    } finally {
      setBusy(false);
    }
  };


  const stopScanner = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const handlePayload = useCallback(
    async (raw: string) => {
      let attend: string | null = null;
      try {
        const url = new URL(raw);
        attend = url.searchParams.get("attend");
      } catch {
        if (/^[0-9a-f-]{36}$/i.test(raw)) attend = raw;
      }
      if (!attend) {
        toast.error("QR Code inválido.");
        return;
      }
      setScanOpen(false);
      setBusy(true);
      try {
        try {
          await markPresenceBySession({ data: { session_id: attend } });
          toast.success("Presença confirmada!");
        } catch (err) {
          throw err;
        }
        onOpenChange(false);
        onMarked?.();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes("fetch") || msg.toLowerCase().includes("timeout") || msg.toLowerCase().includes("network")) {
          toast.error("Erro de conexão. Verifique sua internet.");
        } else {
          toast.error(msg || "Erro ao marcar presença");
        }
      } finally {
        setBusy(false);
      }

    },
    [onMarked, onOpenChange],
  );

  useEffect(() => {
    if (!scanOpen) {
      stopScanner();
      return;
    }
    let cancelled = false;
    setScanError(null);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        v.setAttribute("playsinline", "true");
        await v.play();
        const tick = () => {
          if (cancelled || !ctx || !videoRef.current) return;
          const vv = videoRef.current;
          if (vv.readyState >= 2 && vv.videoWidth > 0) {
            canvas.width = vv.videoWidth;
            canvas.height = vv.videoHeight;
            ctx.drawImage(vv, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const found = jsQR(img.data, img.width, img.height, {
              inversionAttempts: "dontInvert",
            });
            if (found?.data) {
              void handlePayload(found.data);
              return;
            }
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        setScanError(
          err instanceof Error && err.name === "NotAllowedError"
            ? "Permissão da câmera negada."
            : "Não foi possível acessar a câmera.",
        );
      }
    })();
    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [scanOpen, handlePayload, stopScanner]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Marcar presença
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Digite o código de 6 letras exibido no quadro pelo(a) professor(a) ou
          escaneie o QR Code.
        </p>

        <form onSubmit={submitCode} className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-lg bg-background border px-3 py-2">
            <KeyRound className="h-5 w-5 text-primary shrink-0" />
            <Input
              value={code}
              onChange={(e) =>
                setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6))
              }
              placeholder="ABCDEF"
              disabled={false}
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={6}
              className="h-12 border-0 bg-transparent px-0 text-center font-mono text-2xl font-bold tracking-[0.35em] focus-visible:ring-0 shadow-none"
              aria-label="Código de presença"
              autoFocus={true}
            />

          </div>
          <button
            type="submit"
            className="h-12 w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-md flex items-center justify-center font-medium transition-colors cursor-pointer"
            style={{ opacity: 1, pointerEvents: 'auto' }}
          >
            {busy ? (
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
            ) : (
              <CheckCircle2 className="h-5 w-5 mr-2" />
            )}
            Confirmar presença
          </button>
        </form>

        <div className="relative py-1 text-center text-xs uppercase text-muted-foreground">
          <span className="bg-background px-2 relative z-10">ou</span>
          <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
        </div>

        <button
          type="button"
          className="h-12 w-full border border-input bg-background hover:bg-accent hover:text-accent-foreground rounded-md flex items-center justify-center font-medium transition-colors cursor-pointer"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setScanOpen(true);
          }}
          style={{ opacity: 1, pointerEvents: 'auto' }}
        >
          <ScanLine className="h-5 w-5 mr-2" />
          Ler QR Code
        </button>

        <Dialog open={scanOpen} onOpenChange={setScanOpen}>
          <DialogContent className="max-w-md p-0 overflow-hidden">
            <DialogHeader className="p-4 pb-2">
              <DialogTitle className="flex items-center gap-2">
                <ScanLine className="h-5 w-5" /> Ler QR Code da presença
              </DialogTitle>
            </DialogHeader>
            <div className="relative bg-black aspect-square">
              <video
                ref={videoRef}
                className="absolute inset-0 h-full w-full object-cover"
                muted
                playsInline
              />
              {scanError && (
                <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-white bg-black/70">
                  {scanError}
                </div>
              )}
            </div>
            <div className="p-4 text-center text-xs text-muted-foreground">
              Aponte a câmera para o QR Code exibido pelo(a) professor(a).
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}