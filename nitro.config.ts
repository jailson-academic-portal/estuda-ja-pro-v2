import { defineNitroConfig } from "nitropack";

export default defineNitroConfig({
  preset: "vercel",
  routeRules: {
    "/api/**": { cors: true },
  },
  // Forçar que https/http sejam externos
  externals: {
    external: ["https", "http", "http2"],
  },
});
