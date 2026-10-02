import { createFileRoute } from "@tanstack/react-router";

// No production build, o Vinxi injeta __BUILD_ID__ via define.
// No desenvolvimento ou quando não definido, usamos um fallback seguro.
// @ts-ignore
const BUILD_ID = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "development";

export const Route = createFileRoute("/api/public/version")({
  server: {
    handlers: {
      GET: async () => {
        return new Response(JSON.stringify({ 
          buildId: BUILD_ID,
          timestamp: new Date().toISOString()
        }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store, no-cache, must-revalidate",
          },
        });
      },
    },
  },
});
