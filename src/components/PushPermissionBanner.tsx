import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  currentPushPermission, enablePushNotifications, disablePushNotifications, pushSupported,
} from "@/lib/push-client";

export function PushPermissionBanner() {
  const [perm, setPerm] = useState<"unsupported" | "default" | "granted" | "denied">("unsupported");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pushSupported()) { setPerm("unsupported"); return; }
    setPerm(currentPushPermission());
  }, []);

  if (perm === "unsupported") return null;

  const activate = async () => {
    setBusy(true);
    const res = await enablePushNotifications();
    setBusy(false);
    if (res.ok) {
      toast.success("Notificações ativadas neste dispositivo");
      setPerm("granted");
    } else {
      toast.error(res.reason ?? "Não foi possível ativar as notificações");
      setPerm(currentPushPermission());
    }
  };

  const deactivate = async () => {
    setBusy(true);
    await disablePushNotifications();
    setBusy(false);
    toast.success("Notificações desativadas neste dispositivo");
  };

  if (perm === "granted") {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="text-white hover:bg-white/15 hover:text-white" aria-label="Notificações push ativas" title="Push ativo neste dispositivo">
            <Bell className="h-5 w-5 text-emerald-300" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={deactivate} disabled={busy}>
            <BellOff className="h-4 w-4 mr-2" /> Desativar push
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Button
      variant="ghost" size="sm"
      onClick={activate}
      disabled={busy || perm === "denied"}
      title={perm === "denied" ? "Permissão bloqueada no navegador" : "Ativar notificações neste dispositivo"}
      className="text-white hover:bg-white/15 hover:text-white hidden sm:inline-flex"
    >
      <Bell className="h-4 w-4 mr-1" />
      {perm === "denied" ? "Push bloqueado" : "Ativar push"}
    </Button>
  );
}