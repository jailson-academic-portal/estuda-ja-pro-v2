import { useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

declare const __BUILD_ID__: string;

const POLL_INTERVAL_MS = 20_000;
const DISMISSED_BUILD_KEY = "estudaja:dismissed-build-id";
const APPLYING_BUILD_KEY = "estudaja:applying-build-id";

async function hardReload(buildId: string) {
  try {
    localStorage.setItem(DISMISSED_BUILD_KEY, buildId);
    sessionStorage.setItem(APPLYING_BUILD_KEY, buildId);
  } catch {
    // ignore quota / privacy errors
  }
  // 1) Drop any service workers that may be serving the stale shell
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    /* noop */
  }
  // 2) Purge the Cache Storage (PWA / browser caches keyed by URL)
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* noop */
  }
  // 3) Navigate through a no-store endpoint that asks the browser to clear cached app files.
  const url = new URL(window.location.href);
  url.searchParams.set("v", buildId);
  const refreshUrl = new URL("/api/public/apply-update", window.location.origin);
  refreshUrl.searchParams.set("build", buildId);
  refreshUrl.searchParams.set("next", `${url.pathname}${url.search}${url.hash}`);
  window.location.replace(refreshUrl.toString());
}

export function AppUpdateNotifier() {
  const currentBuildId = useRef(__BUILD_ID__);
  const notified = useRef(false);
  const [availableBuildId, setAvailableBuildId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      if (cancelled || notified.current) return;
      try {
        const res = await fetch(`/api/public/version?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { buildId?: string };
        if (!data.buildId) return;
        if (data.buildId === currentBuildId.current) {
          localStorage.removeItem(DISMISSED_BUILD_KEY);
          sessionStorage.removeItem(APPLYING_BUILD_KEY);
          setAvailableBuildId(null);
          return;
        }
        if (sessionStorage.getItem(APPLYING_BUILD_KEY) === data.buildId) return;
        if (sessionStorage.getItem(DISMISSED_BUILD_KEY) === data.buildId) return;
        if (data.buildId !== currentBuildId.current) {
          notified.current = true;
          setAvailableBuildId(data.buildId);
        }
      } catch {
        // network glitch — ignore, try again next tick
      }
    };

    void check();
    const interval = setInterval(check, POLL_INTERVAL_MS);
    const onFocus = () => check();
    const onPageShow = () => check();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const dismiss = () => {
    if (availableBuildId) sessionStorage.setItem(DISMISSED_BUILD_KEY, availableBuildId);
    notified.current = false;
    setAvailableBuildId(null);
  };

  return (
    <AlertDialog open={Boolean(availableBuildId)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Nova versão disponível</AlertDialogTitle>
          <AlertDialogDescription>
            Deseja atualizar agora para carregar as correções mais recentes do aplicativo?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={dismiss}>Não, depois</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (availableBuildId) void hardReload(availableBuildId);
            }}
          >
            Sim, atualizar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}