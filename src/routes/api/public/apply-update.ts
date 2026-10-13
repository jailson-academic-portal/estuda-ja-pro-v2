import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/apply-update")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const next = normalizeNextPath(url.searchParams.get("next"));
        const target = new URL(next, url.origin);
        // Defesa em profundidade: o `next` normalizado é uma URL
        // absoluta resolvida contra `url.origin`. Se por algum motivo
        // o parser produzir uma origem diferente, descartamos.
        if (target.origin !== url.origin) {
          return new Response("Bad Request", { status: 400 });
        }
        target.searchParams.set("refresh", url.searchParams.get("build") || Date.now().toString());

        return new Response(null, {
          status: 302,
          headers: {
            Location: `${target.pathname}${target.search}${target.hash}`,
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            Pragma: "no-cache",
            Expires: "0",
            "Clear-Site-Data": '"cache"',
          },
        });
      },
    },
  },
});

function normalizeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  // Bloqueia CR/LF e outros caracteres de controle que poderiam
  // quebrar o header HTTP "Location" (header injection). O cliente
  // legítimo (AppUpdateNotifier) só envia path+search+hash locais.
  if (/[\r\n\t\0\u000B\u000C]/.test(value)) return "/";
  if (value.length > 2048) return "/";
  return value;
}