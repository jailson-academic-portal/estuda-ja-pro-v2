import { VAPID_PUBLIC_KEY, urlBase64ToUint8Array, arrayBufferToBase64Url } from "./vapid";
import { subscribePush, unsubscribePush } from "@/backend/push.functions";

export type PushState = "unsupported" | "denied" | "granted" | "default";

export function pushSupported(): boolean {
  return typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

/** Detecta se a página está rodando dentro de um iframe (ex.: preview do editor). */
export function isInIframe(): boolean {
  if (typeof window === "undefined") return false;
  try { return window.self !== window.top; } catch { return true; }
}

/** Detecta se estamos em contexto seguro (HTTPS ou localhost). Push exige isso. */
export function isSecureContextOk(): boolean {
  if (typeof window === "undefined") return false;
  return window.isSecureContext === true;
}

export function currentPushPermission(): PushState {
  if (!pushSupported()) return "unsupported";
  return Notification.permission as PushState;
}

export async function enablePushNotifications(): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) return { ok: false, reason: "Este dispositivo não suporta notificações push." };
  if (!isSecureContextOk()) {
    return { ok: false, reason: "Notificações push exigem HTTPS. Abra o app publicado (https) e tente novamente." };
  }
  if (isInIframe()) {
    return { ok: false, reason: "As notificações não podem ser ativadas dentro do preview do editor. Abra o app publicado em uma aba própria e tente novamente." };
  }

  let perm: NotificationPermission;
  try {
    perm = await Notification.requestPermission();
  } catch (err) {
    console.error("[push] requestPermission threw", err);
    return { ok: false, reason: "O navegador bloqueou o pedido de permissão. Abra o app fora do preview e tente novamente." };
  }
  if (perm !== "granted") {
    return { ok: false, reason: perm === "denied"
      ? "Você bloqueou notificações para este site. Reative nas configurações do navegador."
      : "Permissão de notificação não concedida." };
  }

  // Registramos explicitamente o SW dedicado de push. Não usamos
  // `serviceWorker.ready`, cuja Promise nunca resolve quando nenhum SW
  // controla a página (o app não registra um SW de app-shell).
  let reg: ServiceWorkerRegistration | null = null;
  try {
    reg = await navigator.serviceWorker.register("/push-sw.js", { scope: "/" });
  } catch (err) {
    console.error("[push] register failed", err);
  }
  if (!reg) return { ok: false, reason: "Não foi possível registrar o serviço de notificações." };

  let sub: PushSubscription | null = null;
  try {
    sub = await reg.pushManager.getSubscription();
  } catch (err) {
    console.error("[push] getSubscription failed", err);
  }
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
    } catch (err) {
      console.error("[push] subscribe failed", err);
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: `Falha ao registrar inscrição de push: ${msg}` };
    }
  }

  const p256dh = sub.getKey("p256dh") ? arrayBufferToBase64Url(sub.getKey("p256dh")!) : "";
  const auth = sub.getKey("auth") ? arrayBufferToBase64Url(sub.getKey("auth")!) : "";
  try {
    await subscribePush({
      data: {
        endpoint: sub?.endpoint ?? "",
        p256dh,
        auth,
        userAgent: navigator.userAgent.slice(0, 500),
      },
    });
  } catch (err) {
    console.error("[push] server subscribe failed", err);
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `Falha ao salvar a inscrição no servidor: ${msg}` };
  }
  return { ok: true };
}

export async function disablePushNotifications(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration("/push-sw.js");
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  try { await unsubscribePush({ data: { endpoint: sub.endpoint } }); } catch (_) { /* ignore */ }
  await sub.unsubscribe();
}