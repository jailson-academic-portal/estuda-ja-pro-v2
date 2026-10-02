// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
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
