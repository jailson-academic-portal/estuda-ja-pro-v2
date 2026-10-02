import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Camera,
  CameraOff,
  ScanLine,
  CheckCircle2,
  AlertTriangle,
  Flashlight,
  FlashlightOff,
} from "lucide-react";
import { toast } from "sonner";
import { processOMR, type OMRLayout, type DetectedAnswer } from "@/lib/omr";

type Props = {
  layout: OMRLayout;
  onConfirm: (answers: Record<string, string | null>) => void;
  submitting?: boolean;
};

export function OMRScannerPane({ layout, onConfirm, submitting }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detected, setDetected] = useState<DetectedAnswer[] | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const stop = () => {
    setTorchOn(false);
    setTorchSupported(false);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setActive(false);
  };

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      const next = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      toast.error("Lanterna indisponível neste dispositivo.");
      setTorchSupported(false);
    }
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1440 } },
      });
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      await track
        ?.applyConstraints?.({
          advanced: [
            { focusMode: "continuous" },
            { exposureMode: "continuous" },
            { whiteBalanceMode: "continuous" },
          ] as unknown as MediaTrackConstraintSet[],
        })
        .catch(() => undefined);
      const caps = track?.getCapabilities?.() as
        | (MediaTrackCapabilities & { torch?: boolean })
        | undefined;
      setTorchSupported(Boolean(caps?.torch));
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setActive(true);
    } catch (e) {
      console.error(e);
      toast.error("Não foi possível acessar a câmera.");
    }
  };

  useEffect(() => () => stop(), []);

  const capture = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    setBusy(true);
    try {
      const v = videoRef.current;
      const c = canvasRef.current;
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      const ctx = c.getContext("2d");
      if (!ctx) throw new Error("Canvas indisponível");
      ctx.drawImage(v, 0, 0, c.width, c.height);
      const { detected: res } = processOMR(c, layout);
      const init: Record<string, string | null> = {};
      res.forEach((d) => {
        init[d.question_id] = d.picked;
      });
      const pickedCount = res.filter((d) => d.picked).length;
      setOverrides(init);
      setDetected(res);
      stop();
      const ambCount = res.filter((d) => d.ambiguous).length;
      toast.success(
        `Folha lida: ${pickedCount} resposta(s) detectada(s). ${ambCount > 0 ? `${ambCount} para revisar.` : "Sem ambiguidades."}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na leitura óptica.");
    } finally {
      setBusy(false);
    }
  };

  const retry = () => {
    setDetected(null);
    setOverrides({});
    start();
  };

  if (detected) {
    const objectiveDetected = detected.filter(
      (d) => d.qtype === "multiple_choice" || d.qtype === "true_false",
    );
    const unresolved = objectiveDetected.filter((d) => !overrides[d.question_id]).length;
    const needsReview = objectiveDetected.filter((d) => d.ambiguous || !d.picked).length;
    const canConfirm = unresolved === 0 && !submitting;
    return (
      <div className="space-y-3">
        <div
          className={`rounded-lg border p-3 text-sm flex items-center gap-2 ${needsReview > 0 ? "bg-destructive/10 border-destructive/30" : "bg-primary/10 border-primary/30"}`}
        >
          {needsReview > 0 ? (
            <AlertTriangle className="h-4 w-4 text-destructive" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-primary" />
          )}
          {needsReview > 0
            ? `Leitura concluída com ${needsReview} questão(ões) para confirmar. Nenhuma resposta insegura será corrigida automaticamente.`
            : "Leitura concluída com segurança. Confira e confirme."}
        </div>
        <div className="space-y-1 max-h-[40vh] overflow-y-auto overflow-x-hidden">
          {detected.map((d, i) => {
            const omrQ = layout.questions.find((q) => q.question_id === d.question_id);
            const labels = omrQ?.bubbles.map((b) => b.label) ?? [];
            if (d.qtype !== "multiple_choice" && d.qtype !== "true_false") {
              return (
                <div
                  key={d.question_id}
                  className="flex items-center justify-between text-sm border rounded px-3 py-1.5 bg-muted/40"
                >
                  <span>
                    {String(i + 1).padStart(2, "0")}.{" "}
                    <span className="text-muted-foreground">
                      Dissertativa/lacuna — correção manual
                    </span>
                  </span>
                </div>
              );
            }
            return (
              <div
                key={d.question_id}
                className={`flex flex-col gap-1.5 text-sm border rounded px-3 py-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2 ${d.ambiguous || !overrides[d.question_id] ? "border-destructive/50 bg-destructive/10" : ""}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {(d.ambiguous || !overrides[d.question_id]) && (
                    <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                  )}
                  <span className="font-medium">{String(i + 1).padStart(2, "0")}.</span>
                  <span className="text-xs text-muted-foreground truncate">
                    {d.reason ??
                      (d.confidence != null ? `Confiança ${(d.confidence * 100).toFixed(0)}%` : "")}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1 sm:justify-end sm:shrink-0">
                  {labels.map((L) => {
                    const sel = overrides[d.question_id] === L;
                    return (
                      <button
                        key={L}
                        onClick={() =>
                          setOverrides((s) => ({ ...s, [d.question_id]: sel ? null : L }))
                        }
                        className={`h-8 w-8 shrink-0 rounded-full text-xs font-bold border-2 ${sel ? "bg-primary text-primary-foreground border-primary" : "bg-background border-muted-foreground/30 text-muted-foreground hover:border-primary"}`}
                      >
                        {L}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={retry} disabled={submitting} className="w-full sm:w-auto">
            <Camera className="h-4 w-4 mr-2" /> Escanear novamente
          </Button>
          <Button
            className="w-full sm:w-auto"
            onClick={() => onConfirm(overrides)}
            disabled={!canConfirm}
            title={
              unresolved > 0 ? "Confirme todas as questões objetivas antes de corrigir." : undefined
            }
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4 mr-2" />
            )}
            {unresolved > 0 ? `Confirmar ${unresolved} pendente(s)` : "Confirmar e corrigir"}
          </Button>
        </div>
        <canvas ref={canvasRef} className="hidden" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="bg-black/90 rounded-xl overflow-hidden relative w-full" style={{ height: "min(80dvh, 90vw * 4 / 3)", minHeight: "70dvh" }}>
        <video ref={videoRef} className="w-full h-full object-contain" playsInline muted />
        {!active && (
          <div className="absolute inset-0 flex items-center justify-center text-white/80 text-sm">
            <ScanLine className="h-6 w-6 mr-2" /> Pronto para escanear o gabarito
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground text-center">
        Posicione a folha de respostas inteira no enquadramento, com boa iluminação e os 4
        marcadores pretos visíveis nos cantos. Preencha COMPLETAMENTE com caneta preta ou azul o
        círculo.
      </p>
      <div className="flex flex-wrap gap-2 justify-center">
        {!active ? (
          <Button onClick={start}>
            <Camera className="h-4 w-4 mr-2" /> Iniciar câmera
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={stop}>
              <CameraOff className="h-4 w-4 mr-2" /> Parar
            </Button>
            {torchSupported && (
              <Button variant="outline" onClick={toggleTorch} aria-pressed={torchOn}>
                {torchOn ? (
                  <FlashlightOff className="h-4 w-4 mr-2" />
                ) : (
                  <Flashlight className="h-4 w-4 mr-2" />
                )}
                Lanterna
              </Button>
            )}
            <Button onClick={capture} disabled={busy}>
              {busy ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <ScanLine className="h-4 w-4 mr-2" />
              )}
              Capturar e ler
            </Button>
          </>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
