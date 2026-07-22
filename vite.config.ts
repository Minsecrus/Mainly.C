import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGzip, constants as zlibConstants } from "node:zlib";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const repositoryRoot = path.dirname(fileURLToPath(import.meta.url));
const sdkRoot = path.join(repositoryRoot, "node_modules", "@wasmer", "sdk", "dist");
const outputRoot = path.join(repositoryRoot, "web-dist");
const toolchainFileName = "mainly-c-clang-22.1.0-4.webc";
const toolchainSource = path.join(repositoryRoot, "dist", toolchainFileName);
const compressedToolchainSource = `${toolchainSource}.gz`;
const publishedToolchainFileName = `${toolchainFileName}.data`;
const clangdCacheRoot = path.join(repositoryRoot, ".cache", "clangd-21.1.0");
const clangdJavaScriptSource = path.join(clangdCacheRoot, "clangd.js");
const clangdWasmSource = path.join(clangdCacheRoot, "clangd.wasm");
const compressedClangdWasmSource = `${clangdWasmSource}.gz`;

interface LocalAsset {
  source: string;
  destination: string;
  contentType: string;
}

function deploymentBase(): string {
  if (process.env.GITHUB_ACTIONS !== "true") return "/";
  const repositoryName = process.env.GITHUB_REPOSITORY?.split("/").at(-1);
  return repositoryName ? `/${repositoryName}/` : "/";
}

const localAssets = new Map<string, LocalAsset>([
  [
    "/coi-serviceworker.js",
    {
      source: path.join(repositoryRoot, "public", "coi-serviceworker.js"),
      destination: path.join(outputRoot, "coi-serviceworker.js"),
      contentType: "text/javascript; charset=utf-8",
    },
  ],
  [
    "/runtime/wasmer-sdk.js",
    {
      source: path.join(sdkRoot, "index.mjs"),
      destination: path.join(outputRoot, "runtime", "wasmer-sdk.js"),
      contentType: "text/javascript; charset=utf-8",
    },
  ],
  [
    `/toolchain/${publishedToolchainFileName}`,
    {
      source: compressedToolchainSource,
      destination: path.join(outputRoot, "toolchain", publishedToolchainFileName),
      contentType: "application/octet-stream",
    },
  ],
  [
    "/lsp/clangd.js",
    {
      source: clangdJavaScriptSource,
      destination: path.join(outputRoot, "lsp", "clangd.js"),
      contentType: "text/javascript; charset=utf-8",
    },
  ],
  [
    "/lsp/clangd.wasm.gz",
    {
      source: compressedClangdWasmSource,
      destination: path.join(outputRoot, "lsp", "clangd.wasm.gz"),
      contentType: "application/gzip",
    },
  ],
]);

async function generateCompressedAsset(sourcePath: string, compressedPath: string): Promise<void> {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing local runtime asset: ${sourcePath}`);
  }

  const sourceStat = fs.statSync(sourcePath);
  if (fs.existsSync(compressedPath)) {
    const compressedStat = fs.statSync(compressedPath);
    if (compressedStat.size > 0 && compressedStat.mtimeMs >= sourceStat.mtimeMs) return;
  }

  fs.mkdirSync(path.dirname(compressedPath), { recursive: true });
  const temporaryPath = `${compressedPath}.${process.pid}.tmp`;
  try {
    await pipeline(
      fs.createReadStream(sourcePath),
      createGzip({ level: zlibConstants.Z_BEST_COMPRESSION }),
      fs.createWriteStream(temporaryPath),
    );
    fs.rmSync(compressedPath, { force: true });
    fs.renameSync(temporaryPath, compressedPath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

async function generateCompressedRuntimeAssets(): Promise<void> {
  await Promise.all([
    generateCompressedAsset(toolchainSource, compressedToolchainSource),
    generateCompressedAsset(clangdWasmSource, compressedClangdWasmSource),
  ]);
}

function localRuntimeAssets(): Plugin {
  let runtimeAssetPreparation: Promise<void> | undefined;
  const prepareRuntimeAssets = () => {
    runtimeAssetPreparation ??= generateCompressedRuntimeAssets().catch((error) => {
      runtimeAssetPreparation = undefined;
      throw error;
    });
    return runtimeAssetPreparation;
  };

  return {
    name: "mainly-c-local-runtime-assets",
    buildStart() {
      return prepareRuntimeAssets();
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        const asset = localAssets.get(pathname);
        if (!asset) {
          next();
          return;
        }

        void (async () => {
          if (
            asset.source === compressedToolchainSource ||
            asset.source === compressedClangdWasmSource
          ) {
            await prepareRuntimeAssets();
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
          if (request.method === "HEAD") {
            response.end();
            return;
          }

          const source = fs.createReadStream(asset.source);
          const abortSource = () => source.destroy();
          request.once("aborted", abortSource);
          response.once("close", abortSource);
          try {
            await pipeline(source, response);
          } catch (error) {
            if (!request.aborted && !response.destroyed) throw error;
          } finally {
            request.off("aborted", abortSource);
            response.off("close", abortSource);
            source.destroy();
          }
        })().catch((error) => {
          server.config.logger.error(
            `Unable to serve local runtime asset ${pathname}: ${error instanceof Error ? error.message : String(error)}`,
          );
          if (!response.headersSent) {
            response.statusCode = 500;
            response.end("Unable to serve local runtime asset");
          } else if (!response.destroyed) {
            response.destroy(error instanceof Error ? error : undefined);
          }
        });
      });
    },
    async closeBundle() {
      await prepareRuntimeAssets();
      for (const asset of localAssets.values()) {
        if (!fs.existsSync(asset.source)) {
          throw new Error(`Missing local runtime asset: ${asset.source}`);
        }
        fs.mkdirSync(path.dirname(asset.destination), { recursive: true });
        fs.copyFileSync(asset.source, asset.destination);
      }
      fs.copyFileSync(
        path.join(outputRoot, "index.html"),
        path.join(outputRoot, "app-shell.data"),
      );
    },
  };
}

const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
};

const developmentWatchIgnores = [
  "**/.cache/**",
  "**/.tools/**",
  "**/dist/**",
  "**/toolchain/clang-22/package/bin/**",
  "**/toolchain/clang-22/package/sysroot/**",
  "**/toolchain/clang-22/package/wasix-compat-sysroot/**",
];

export default defineConfig({
  base: deploymentBase(),
  plugins: [react(), tailwindcss(), localRuntimeAssets()],
  server: {
    headers: isolationHeaders,
    watch: { ignored: developmentWatchIgnores },
  },
  preview: { headers: isolationHeaders },
  build: {
    outDir: "web-dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
  worker: { format: "es" },
});
