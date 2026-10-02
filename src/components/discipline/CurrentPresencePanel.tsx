import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Radio,
  Maximize2,
  KeyRound,
  CheckCircle2,
  Loader2,
  QrCode as QrIcon,
  ScanLine,
  X,
  WifiOff,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import jsQR from "jsqr";
import {
  closeAttendanceSession,
  markPresenceBySession,
  confirmAttendance,
} from "@/backend/attendance.functions";
import { AttendanceQr, AttendanceQrFullscreen } from "./AttendanceQr";

const APP_TIME_ZONE = "America/Sao_Paulo";

export interface PanelSession {
  id: string;
  discipline_id: string;
  topic: string | null;
  starts_at: string;
  created_at: string;
  code_window_minutes: number;
  window_hours: number;
  finalized_at: string | null;
  closed_at?: string | null;
  code?: string | null;
}

interface PanelRecord {
  session_id: string;
  student_id: string;
  status: "present" | "absent" | "justified" | "no_class";
}

function startMs(s: PanelSession) {
  return new Date(s.starts_at ?? s.created_at).getTime();
}
function windowEndMs(s: PanelSession) {
  return startMs(s) + (s.code_window_minutes ?? 15) * 60 * 1000;
}
function effectiveEndMs(s: PanelSession) {
  const closed = s.closed_at ? new Date(s.closed_at).getTime() : Infinity;
  return Math.min(windowEndMs(s), closed);
}
function isPresenceOpen(s: PanelSession, nowMs: number) {
  if (s.finalized_at) return false;
  // Suporte a status variados caso venha de uma view ou coluna de status
  const status = (s as any).status?.toLowerCase();
  const isStatusOpen = !status || ["active", "ativa", "open", "aberta"].includes(status);
  
  return isStatusOpen && nowMs >= startMs(s) && nowMs < effectiveEndMs(s);
}
function formatTime(ms: number) {
  return new Date(ms).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: APP_TIME_ZONE,
  });
}
function remaining(s: PanelSession, nowMs: number) {
  const ms = effectiveEndMs(s) - nowMs;
  if (ms <= 0) return "";
  const m = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${m}m${String(sec).padStart(2, "0")}s`;
}

export function CurrentPresencePanel({
  disciplineId,
  isTeacher,
  userId,
  sessions,
  records,
  nowMs,
  onChanged,
  onOpenNew,
}: {
  disciplineId: string;
  isTeacher: boolean;
  userId?: string;
  sessions: PanelSession[];
  records: PanelRecord[];
  nowMs: number;
  onChanged: () => void;
  onOpenNew: () => void;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanRafRef = useRef<number | null>(null);
  const scanStreamRef = useRef<MediaStream | null>(null);

  const openSession = useMemo(() => {
    const open = sessions
      .filter((s) => isPresenceOpen(s, nowMs))
      .sort((a, b) => startMs(b) - startMs(a));
    return open[0] ?? null;
  }, [sessions, nowMs]);

  const qrValue = useMemo(() => {
    if (!openSession) return "";
    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://estudaja.com";
    return `${origin}/disciplines/${disciplineId}?attend=${openSession.id}`;
  }, [openSession, disciplineId]);

  const myStatus = openSession
    ? records.find((r) => r.session_id === openSession.id && r.student_id === userId)?.status
    : undefined;

  const doMark = useCallback(
    async (sessionId: string, silent = false) => {
      setBusy(true);

      setBusy(true);
      try {
        await markPresenceBySession({ data: { session_id: sessionId } });
        toast.success("Presença confirmada!");
        onChanged();
      } catch (e) {
        if (!silent) {
          toast.error(e instanceof Error ? e.message : "Erro ao marcar presença");
        }
      } finally {
        setBusy(false);
      }
    },
    [onChanged],
  );

  const confirmByCode = useCallback(
    async (sessionId: string) => {
      const code = codeInput.trim().toUpperCase();
      if (!/^[A-Z]{6}$/.test(code)) {
        toast.error("Digite o código de 6 letras.");
        return;
      }

      setBusy(true);
      try {
        await confirmAttendance({ data: { session_id: sessionId, code } });
        toast.success("Presença confirmada!");
        setCodeInput("");
        onChanged();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao confirmar presença");
      } finally {
        setBusy(false);
      }
    },
    [codeInput, onChanged],
  );



  const stopScanner = useCallback(() => {
    if (scanRafRef.current != null) {
      cancelAnimationFrame(scanRafRef.current);
      scanRafRef.current = null;
    }
    if (scanStreamRef.current) {
      scanStreamRef.current.getTracks().forEach((t) => t.stop());
      scanStreamRef.current = null;
    }
  }, []);

  const handleQrPayload = useCallback(
    (raw: string) => {
      let attend: string | null = null;
      try {
        const url = new URL(raw);
        attend = url.searchParams.get("attend");
      } catch {
        if (/^[0-9a-f-]{36}$/i.test(raw)) attend = raw;
      }
      if (!attend) {
        toast.error("QR Code inválido para esta chamada.");
        return;
      }
      const target = sessions.find((s) => s.id === attend);
      if (!target || !isPresenceOpen(target, Date.now())) {
        toast.error("Sessão de presença não está aberta.");
        return;
      }
      const already = records.find(
        (r) => r.session_id === attend && r.student_id === userId && r.status === "present",
      );
      if (already) {
        toast.info("Sua presença já foi confirmada nesta aula.");
        setScanOpen(false);
        return;
      }
      setScanOpen(false);
      void doMark(attend);
    },
    [sessions, records, userId, doMark],
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
        scanStreamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        await video.play();
        const tick = () => {
          if (cancelled || !ctx || !videoRef.current) return;
          const v = videoRef.current;
          if (v.readyState >= 2 && v.videoWidth > 0) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const found = jsQR(img.data, img.width, img.height, {
              inversionAttempts: "dontInvert",
            });
            if (found?.data) {
              handleQrPayload(found.data);
              return;
            }
          }
          scanRafRef.current = requestAnimationFrame(tick);
        };
        scanRafRef.current = requestAnimationFrame(tick);
      } catch (e) {
        setScanError(
          e instanceof Error && e.name === "NotAllowedError"
            ? "Permissão da câmera negada. Habilite nas configurações do navegador."
            : "Não foi possível acessar a câmera.",
        );
      }
    })();
    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [scanOpen, handleQrPayload, stopScanner]);

  // Auto-marcação ao abrir via leitura de QR (deep link ?attend=<sessionId>).
  useEffect(() => {
    if (isTeacher || !userId) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const attend = params.get("attend");
    if (!attend) return;
    // Limpa o parâmetro da URL para não repetir.
    params.delete("attend");
    const qs = params.toString();
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${qs ? `?${qs}` : ""}`,
    );
    const target = sessions.find((s) => s.id === attend);
    if (target && isPresenceOpen(target, Date.now())) {
      const already = records.find(
        (r) => r.session_id === attend && r.student_id === userId && r.status === "present",
      );
      if (!already) void doMark(attend, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.length, userId, isTeacher]);

  const handleClose = async () => {
    if (!openSession) return;
    setBusy(true);
    try {
      await closeAttendanceSession({ data: { session_id: openSession.id } });
      toast.success("Presença encerrada");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao encerrar presença");
    } finally {
      setBusy(false);
    }
  };

  // ---------- Sem sessão aberta ----------
  if (!openSession) {
    return (
      <div className="rounded-xl border bg-card p-4" style={{ boxShadow: "var(--shadow-card)" }}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
            <div>
              <div className="font-semibold">Presença Atual</div>
              <div className="text-sm text-muted-foreground">Nenhuma sessão de presença aberta.</div>
            </div>
          </div>
          {isTeacher && (
            <Button onClick={onOpenNew}>
              <Radio className="h-4 w-4 mr-2" /> Abrir presença
            </Button>
          )}
        </div>
      </div>
    );
  }

  const closesAt = formatTime(effectiveEndMs(openSession));
  const startsAt = formatTime(startMs(openSession));

  // ---------- Professor ----------
  if (isTeacher) {
    return (
      <div
        className="rounded-xl border-2 border-primary/30 bg-primary/5 p-4"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
              </span>
              <div className="font-semibold text-primary">Presença Atual</div>
            </div>
            <div className="mt-1 text-sm">
              <div className="font-medium break-words">
                {openSession.topic || "Aula sem tópico"}
              </div>
              <div className="text-muted-foreground">
                Presença aberta de {startsAt} a {closesAt}
                {remaining(openSession, nowMs) && ` · ${remaining(openSession, nowMs)} restantes`}
              </div>
            </div>
            {openSession.code && (
              <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-background px-3 py-2">
                <KeyRound className="h-4 w-4 text-primary" />
                <span className="font-mono text-2xl font-bold tracking-[0.25em]">
                  {openSession.code}
                </span>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setFullscreen(true)}>
                <Maximize2 className="h-4 w-4 mr-2" /> Tela cheia (projetor)
              </Button>
              <Button variant="destructive" size="sm" onClick={handleClose} disabled={busy}>
                {busy ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                Encerrar presença
              </Button>
            </div>
          </div>
          <div className="flex flex-col items-center gap-2 self-center sm:self-start">
            <div className="rounded-xl bg-white p-2">
              <AttendanceQr value={qrValue} size={150} />
            </div>
            <span className="text-xs text-muted-foreground">Alunos escaneiam para marcar</span>
          </div>
        </div>
        <AttendanceQrFullscreen
          open={fullscreen}
          onOpenChange={setFullscreen}
          value={qrValue}
          title={openSession.topic || "Presença da aula"}
          subtitle={`Presença aberta até ${closesAt}`}
          code={openSession.code ?? undefined}
        />
      </div>
    );
  }

  // ---------- Aluno ----------
  const isPresent = myStatus === "present";
  return (
    <div
      className="rounded-xl border-2 border-primary/30 bg-primary/5 p-4"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
        </span>
        <div className="font-semibold text-primary uppercase">
          {openSession.topic || "AULA DE APRESENTAÇÃO"}
        </div>
      </div>
      <div className="mt-1 text-sm text-muted-foreground">
        Fecha às {closesAt}
        {remaining(openSession, nowMs) && (
          <span className="ml-2 font-medium text-amber-600 animate-pulse">
            (Tempo restante: {remaining(openSession, nowMs)})
          </span>
        )}
      </div>

      {isPresent ? (
        <div className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-green-100 py-4 text-green-800">
          <CheckCircle2 className="h-6 w-6" />
          <span className="font-semibold">Presença confirmada!</span>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Para registrar sua presença, escaneie o QR Code exibido no quadro pelo
            professor <span className="font-medium">ou</span> digite abaixo o código de 6
            letras mostrado no quadro.
          </p>

          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              confirmByCode(openSession.id);
            }}
          >
            <div className="flex items-center gap-2 rounded-lg bg-background px-3 py-2 border">
              <KeyRound className="h-5 w-5 text-primary shrink-0" />
              <Input
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6))}
                placeholder="Código do quadro"
                disabled={false}
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                maxLength={6}
                className="h-12 border-0 bg-transparent px-0 text-center font-mono text-2xl font-bold tracking-[0.35em] focus-visible:ring-0 shadow-none"
                aria-label="Código de presença"
              />
            </div>
            <button
              type="submit"
              className="h-14 w-full bg-primary text-primary-foreground hover:bg-primary/90 rounded-md flex items-center justify-center font-semibold text-lg transition-colors cursor-pointer"
              style={{ opacity: 1, pointerEvents: 'auto' }}
            >
              {busy ? (
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-5 w-5 mr-2" />
              )}
              Confirmar Presença
            </button>
          </form>

          <button
            type="button"
            className="h-12 w-full border border-input bg-background hover:bg-accent hover:text-accent-foreground rounded-md flex items-center justify-center font-medium transition-colors cursor-pointer"
            style={{ opacity: 1, pointerEvents: 'auto' }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setScanOpen(true);
            }}
          >
            <ScanLine className="h-5 w-5 mr-2" />
            Ler QR Code
          </button>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <QrIcon className="h-4 w-4 shrink-0" />
            <span>Ou escaneie o QR Code diretamente pela câmera do celular.</span>
          </div>

        </div>
      )}

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
            <div className="pointer-events-none absolute inset-8 rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            {scanError && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-4 text-center text-sm text-white">
                {scanError}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 p-3">
            <span className="text-xs text-muted-foreground">
              Aponte para o QR exibido no quadro.
            </span>
            <Button variant="outline" size="sm" onClick={() => setScanOpen(false)}>
              <X className="h-4 w-4 mr-1" /> Fechar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
