import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export default defineConfig({
  plugins: [],
  vite: {
    build: {
      sourcemap: false,
      reportCompressedSize: false,
      chunkSizeWarningLimit: 1200,
    },
    define: {
      __BUILD_ID__: JSON.stringify(createSourceHash()),
    },
    ssr: {
      // Externalizar módulos Node.js que não devem ser bundleados
      external: ["https", "http", "http2", "zlib", "stream", "util", "buffer"],
    },
    optimizeDeps: {
      exclude: ["@supabase/supabase-js"],
    },
  },
});

function createSourceHash() {
  const hash = createHash("sha256");
  for (const file of collectFiles("src")) {
    hash.update(file);
    hash.update(readFileSync(file));
  }
  return hash.digest("hex").slice(0, 16);
}

function collectFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .flatMap((entry) => {
      const fullPath = join(dir, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) return collectFiles(fullPath);
      if (!/\.(ts|tsx|css)$/.test(entry) || entry === "routeTree.gen.ts") return [];
      return [fullPath];
    })
    .sort();
}
