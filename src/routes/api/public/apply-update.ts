import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/apply-update")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const next = normalizeNextPath(url.searchParams.get("next"));
        const target = new URL(next, url.origin);
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
  return value;
}