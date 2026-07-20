import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const repositoryRoot = path.dirname(fileURLToPath(import.meta.url));
const sdkRoot = path.join(repositoryRoot, "node_modules", "@wasmer", "sdk", "dist");
const coiServiceWorkerRoot = path.join(repositoryRoot, "node_modules", "coi-serviceworker");
const outputRoot = path.join(repositoryRoot, "web-dist");

function deploymentBase(): string {
  if (process.env.GITHUB_ACTIONS !== "true") return "/";
  const repositoryName = process.env.GITHUB_REPOSITORY?.split("/").at(-1);
  return repositoryName ? `/${repositoryName}/` : "/";
}

const localAssets = new Map([
  [
    "/coi-serviceworker.js",
    {
      source: path.join(coiServiceWorkerRoot, "coi-serviceworker.js"),
      destination: path.join(outputRoot, "coi-serviceworker.js"),
      contentType: "text/javascript; charset=utf-8",
    },
  ],
  [
    "/runtime/wasmer-sdk.mjs",
    {
      source: path.join(sdkRoot, "index.mjs"),
      destination: path.join(outputRoot, "runtime", "wasmer-sdk.mjs"),
      contentType: "text/javascript; charset=utf-8",
    },
  ],
  [
    "/toolchain/mainly-c-clang-22.1.0-1.webc",
    {
      source: path.join(repositoryRoot, "dist", "mainly-c-clang-22.1.0-1.webc"),
      destination: path.join(outputRoot, "toolchain", "mainly-c-clang-22.1.0-1.webc"),
      contentType: "application/octet-stream",
    },
  ],
]);

function localRuntimeAssets(): Plugin {
  return {
    name: "mainly-c-local-runtime-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        const asset = localAssets.get(pathname);
        if (!asset) {
          next();
          return;
        }
        if (!fs.existsSync(asset.source)) {
          response.statusCode = 404;
          response.end(`Missing local runtime asset: ${asset.source}`);
          return;
        }
        const stat = fs.statSync(asset.source);
        response.writeHead(200, {
          "Content-Type": asset.contentType,
          "Content-Length": stat.size,
          "Cache-Control": "no-store",
        });
        fs.createReadStream(asset.source).pipe(response);
      });
    },
    closeBundle() {
      for (const asset of localAssets.values()) {
        if (!fs.existsSync(asset.source)) {
          throw new Error(`Missing local runtime asset: ${asset.source}`);
        }
        fs.mkdirSync(path.dirname(asset.destination), { recursive: true });
        fs.copyFileSync(asset.source, asset.destination);
      }
    },
  };
}

const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
};

export default defineConfig({
  base: deploymentBase(),
  plugins: [react(), tailwindcss(), localRuntimeAssets()],
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  build: {
    outDir: "web-dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
  worker: { format: "es" },
});
