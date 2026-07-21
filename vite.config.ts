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
const coiServiceWorkerRoot = path.join(repositoryRoot, "node_modules", "coi-serviceworker");
const outputRoot = path.join(repositoryRoot, "web-dist");
const toolchainFileName = "mainly-c-clang-22.1.0-4.webc";
const toolchainSource = path.join(repositoryRoot, "dist", toolchainFileName);
const compressedToolchainSource = `${toolchainSource}.gz`;

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
    `/toolchain/${toolchainFileName}.gz`,
    {
      source: compressedToolchainSource,
      destination: path.join(outputRoot, "toolchain", `${toolchainFileName}.gz`),
      contentType: "application/gzip",
    },
  ],
]);

async function generateCompressedToolchain(): Promise<void> {
  if (!fs.existsSync(toolchainSource)) {
    throw new Error(`Missing local runtime asset: ${toolchainSource}`);
  }

  const sourceStat = fs.statSync(toolchainSource);
  if (fs.existsSync(compressedToolchainSource)) {
    const compressedStat = fs.statSync(compressedToolchainSource);
    if (compressedStat.size > 0 && compressedStat.mtimeMs >= sourceStat.mtimeMs) return;
  }

  fs.mkdirSync(path.dirname(compressedToolchainSource), { recursive: true });
  const temporaryPath = `${compressedToolchainSource}.${process.pid}.tmp`;
  try {
    await pipeline(
      fs.createReadStream(toolchainSource),
      createGzip({ level: zlibConstants.Z_BEST_COMPRESSION }),
      fs.createWriteStream(temporaryPath),
    );
    fs.rmSync(compressedToolchainSource, { force: true });
    fs.renameSync(temporaryPath, compressedToolchainSource);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function localRuntimeAssets(): Plugin {
  let compressedToolchainPreparation: Promise<void> | undefined;
  const prepareCompressedToolchain = () => {
    compressedToolchainPreparation ??= generateCompressedToolchain().catch((error) => {
      compressedToolchainPreparation = undefined;
      throw error;
    });
    return compressedToolchainPreparation;
  };

  return {
    name: "mainly-c-local-runtime-assets",
    buildStart() {
      return prepareCompressedToolchain();
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
          if (asset.source === compressedToolchainSource) {
            await prepareCompressedToolchain();
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
      await prepareCompressedToolchain();
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
