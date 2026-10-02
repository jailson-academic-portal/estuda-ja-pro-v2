import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Dialog, DialogContent } from "@/components/ui/dialog";

/** Renderiza um QR Code a partir de um texto/URL. Client-only (usa canvas). */
export function AttendanceQr({
  value,
  size = 200,
  className,
}: {
  value: string;
  size?: number;
  className?: string;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0f172a", light: "#ffffff" },
    })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {
        if (active) setDataUrl(null);
      });
    return () => {
      active = false;
    };
  }, [value, size]);

  if (!dataUrl) {
    return (
      <div
        className={className}
        style={{ width: size, height: size }}
        aria-hidden
      />
    );
  }
  return (
    <img
      src={dataUrl}
      width={size}
      height={size}
      alt="QR Code de presença"
      className={className}
    />
  );
}

/** Exibe o QR em tela cheia (para projetor/TV). */
export function AttendanceQrFullscreen({
  open,
  onOpenChange,
  value,
  title,
  subtitle,
  code,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  value: string;
  title: string;
  subtitle?: string;
  code?: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <div className="flex flex-col items-center gap-6 py-6 text-center">
          <div>
            <h2 className="text-2xl font-bold">{title}</h2>
            {subtitle && <p className="text-muted-foreground mt-1">{subtitle}</p>}
          </div>
          <AttendanceQr value={value} size={420} className="rounded-xl" />
          {code && (
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Código de presença</p>
              <p className="font-mono text-5xl font-bold tracking-[0.3em]">{code}</p>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            Aponte a câmera para o QR Code ou digite o código no app para marcar presença.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
