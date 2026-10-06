import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import appCss from "../styles.css?url";
import { AuthProvider } from "@/lib/auth-context";
import { Toaster } from "@/components/ui/sonner";
import { AppUpdateNotifier } from "@/components/AppUpdateNotifier";
import { useEffect, useState, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAppBadge } from "@/hooks/use-app-badge";
import { OwlLogo } from "@/components/OwlLogo";
import { CustomErrorBoundary } from "@/components/CustomErrorBoundary";
// force redeploy


function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#0f172a" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "EstudaJá" },
      { title: "EstudaJá Pro - Plataforma Acadêmica Inteligente" },
      { name: "description", content: "Plataforma acadêmica completa com IA para professores e alunos." },
      { name: "author", content: "EstudaJá Pro" },
      { property: "og:title", content: "EstudaJá Pro" },
      { property: "og:description", content: "Plataforma acadêmica completa com IA para professores e alunos." },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "EstudaJá Pro" },
      { property: "og:url", content: "https://estudaja.com/" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "EstudaJá Pro" },
      { name: "twitter:description", content: "Plataforma acadêmica completa com IA para professores e alunos." },
      { property: "og:image", content: "https://estudaja.com/og-image.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:image", content: "https://estudaja.com/og-image.png" },
    ],
    links: [
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
      { rel: "shortcut icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: CustomErrorBoundary,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" translate="no" className="notranslate">
      <head>
        <HeadContent />
      </head>
      <body translate="no" className="notranslate">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
            queries: {
              staleTime: 1000 * 60 * 10, // Aumentado para 10 minutos para reduzir requisições redundantes
              gcTime: 1000 * 60 * 30,
              refetchOnWindowFocus: false,
              retry: 1, // Falha rápido em conexões ruins, evitando loops de loading
              // Prevent queries from throwing to the error boundary automatically
              throwOnError: false,
            },
          mutations: {
            retry: false,
            throwOnError: false,
          },
        },
      }),
  );

  useEffect(() => {
    if (typeof window !== "undefined") {
      // Cleanup any stuck service workers from aborted PWA
      navigator.serviceWorker.getRegistrations().then(registrations => {
        for (const registration of registrations) {
          // Preserva o service worker dedicado de push (/push-sw.js).
          const scriptUrl = registration.active?.scriptURL ?? registration.installing?.scriptURL ?? "";
          if (scriptUrl.includes("push-sw.js")) continue;
          registration.unregister();
          console.log("[PWA Cleanup] Unregistered service worker");
        }
      });
    }

    // Defensive Chunk Loading Retry Logic
    if (typeof window !== "undefined") {
      const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
        const error = event.reason?.message || "";
        if (/failed to fetch dynamically imported module|loading chunk/i.test(error)) {
          const hasReloaded = sessionStorage.getItem("estudaja:chunk_retry");
          if (!hasReloaded) {
            sessionStorage.setItem("estudaja:chunk_retry", "true");
            console.warn("Detectado erro de carregamento de módulo. Reiniciando suavemente...");
            window.location.reload();
          }
        }
      };
      
      window.addEventListener("unhandledrejection", handleUnhandledRejection);
      return () => window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    }
  }, []);


  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppBadgeSync />
        <Suspense fallback={<LoadingOverlay />}>
          <Outlet />
        </Suspense>
        <Toaster richColors position="top-right" />
        <AppUpdateNotifier />
      </AuthProvider>
    </QueryClientProvider>
  );
}

function LoadingOverlay() {
  const [showRetry, setShowRetry] = useState(false);
  
  useEffect(() => {
    const timer = setTimeout(() => setShowRetry(true), 10000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0f172a] text-white p-4 text-center">
      <div className="mb-4">
        <OwlLogo size={64} withText={false} className="animate-pulse" />
      </div>
      
      {!showRetry ? (
        <>
          <div className="h-1 w-32 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-full origin-left animate-loading-bar bg-[#0d9488]" />
          </div>
          <p className="mt-4 text-[10px] font-medium tracking-[0.2em] text-[#0d9488] uppercase opacity-50">
            Otimizando sua experiência acadêmica...
          </p>
        </>
      ) : (
        <div className="max-w-xs animate-in fade-in zoom-in duration-300">
          <p className="text-sm text-white/70 mb-4">
            A conexão está demorando mais do que o esperado.
          </p>
          <button 
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-[#0d9488] hover:bg-[#0d9488]/80 text-white rounded-md text-sm font-medium transition-colors"
          >
            Tentar Novamente
          </button>
        </div>
      )}
    </div>
  );
}

// Must live inside AuthProvider: useAppBadge reads the auth context.
function AppBadgeSync() {
  useAppBadge();
  return null;
}
