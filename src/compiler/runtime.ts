import { Runtime, init } from "@wasmer/sdk";
import wasmerSdkModuleUrl from "@wasmer/sdk/wasm?url";

import { ClangCompilerAdapter } from "./ClangCompilerAdapter.js";
import type { CompilerLogSink } from "./types.js";

export interface ToolchainLoadProgress {
  loadedBytes: number;
  totalBytes?: number;
  percent?: number;
}

export interface LoadCompilerOptions {
  log?: CompilerLogSink;
  onProgress?: (progress: ToolchainLoadProgress) => void;
}

let sdkInitialization: Promise<unknown> | undefined;
let compilerInitialization: Promise<ClangCompilerAdapter> | undefined;

const TOOLCHAIN_FILE_NAME = "mainly-c-clang-22.1.0-4.webc.gz";
const TOOLCHAIN_CACHE_PREFIX = "mainly-c-toolchain-";
const TOOLCHAIN_CACHE_NAME = `${TOOLCHAIN_CACHE_PREFIX}clang-22.1.0-4-gzip-v1`;

function localAssetUrl(path: string): URL {
  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return new URL(`${base}${path}`, window.location.origin);
}

async function initializeSdk(): Promise<void> {
  if (!crossOriginIsolated) {
    throw new Error("当前页面缺少 COOP/COEP 隔离头，无法启动本地 WebAssembly 线程运行时");
  }
  sdkInitialization ??= init({
    module: new URL(wasmerSdkModuleUrl, window.location.origin),
    workerUrl: localAssetUrl("runtime/wasmer-sdk.mjs"),
  });
  await sdkInitialization;
}

async function openToolchainCache(log?: CompilerLogSink): Promise<Cache | undefined> {
  if (!("caches" in window)) return undefined;

  try {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((name) => name.startsWith(TOOLCHAIN_CACHE_PREFIX) && name !== TOOLCHAIN_CACHE_NAME)
        .map((name) => caches.delete(name)),
    );
    return await caches.open(TOOLCHAIN_CACHE_NAME);
  } catch (cause) {
    log?.({
      source: "compiler",
      event: "toolchain:cache-error",
      message: cause instanceof Error ? cause.message : String(cause),
    });
    return undefined;
  }
}

async function requestPersistentStorage(log?: CompilerLogSink): Promise<void> {
  try {
    const storage = navigator.storage;
    if (!storage?.persist) return;
    const persistent = (await storage.persisted?.()) || (await storage.persist());
    log?.({ source: "compiler", event: "toolchain:storage", persistent });
  } catch (cause) {
    log?.({
      source: "compiler",
      event: "toolchain:storage-error",
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function cacheableResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.delete("cache-control");
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("expires");
  headers.delete("vary");
  return new Response(response.clone().body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function deleteCachedToolchain(log?: CompilerLogSink): Promise<void> {
  if (!("caches" in window)) return;
  try {
    const cache = await caches.open(TOOLCHAIN_CACHE_NAME);
    await cache.delete(localAssetUrl(`toolchain/${TOOLCHAIN_FILE_NAME}`));
  } catch (cause) {
    log?.({
      source: "compiler",
      event: "toolchain:cache-delete-error",
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

async function downloadToolchain(
  onProgress?: (progress: ToolchainLoadProgress) => void,
  log?: CompilerLogSink,
): Promise<Uint8Array> {
  const toolchainUrl = localAssetUrl(`toolchain/${TOOLCHAIN_FILE_NAME}`);
  const cache = await openToolchainCache(log);
  let response: Response | undefined;
  if (cache) {
    try {
      response = await cache.match(toolchainUrl);
    } catch (cause) {
      log?.({
        source: "compiler",
        event: "toolchain:cache-error",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
  let cacheWrite: Promise<void> | undefined;

  if (response?.ok) {
    log?.({ source: "compiler", event: "toolchain:cache-hit" });
  } else {
    log?.({ source: "compiler", event: "toolchain:download" });
    response = await fetch(toolchainUrl);
    if (response.ok && cache) {
      cacheWrite = cache
        .put(toolchainUrl, cacheableResponse(response))
        .then(() => {
          log?.({ source: "compiler", event: "toolchain:cache-write" });
          void requestPersistentStorage(log);
        })
        .catch((cause) => {
          log?.({
            source: "compiler",
            event: "toolchain:cache-error",
            message: cause instanceof Error ? cause.message : String(cause),
          });
        });
    }
  }

  if (!response.ok) {
    throw new Error(`无法载入本地 Clang 工具链（HTTP ${response.status}）`);
  }

  if (typeof DecompressionStream === "undefined") {
    throw new Error("当前浏览器不支持 gzip 流式解压，无法载入本地 Clang 工具链");
  }

  const totalHeader = response.headers.get("content-length");
  const parsedTotalBytes = totalHeader ? Number.parseInt(totalHeader, 10) : undefined;
  const totalBytes =
    response.headers.has("content-encoding") ||
    parsedTotalBytes === undefined ||
    !Number.isFinite(parsedTotalBytes) ||
    parsedTotalBytes <= 0
      ? undefined
      : parsedTotalBytes;
  const compressedBody = response.body ?? new Response(await response.arrayBuffer()).body;
  if (!compressedBody) throw new Error("本地 Clang 工具链响应没有可读取的内容");

  let downloadedBytes = 0;
  const progressStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      downloadedBytes += chunk.byteLength;
      onProgress?.({
        loadedBytes: downloadedBytes,
        totalBytes,
        percent: totalBytes
          ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
          : undefined,
      });
      controller.enqueue(chunk);
    },
    flush() {
      onProgress?.({ loadedBytes: downloadedBytes, totalBytes, percent: 100 });
    },
  });
  const gzipDecompressor = new DecompressionStream("gzip") as unknown as TransformStream<
    Uint8Array,
    Uint8Array
  >;
  const reader = compressedBody
    .pipeThrough(progressStream)
    .pipeThrough(gzipDecompressor)
    .getReader();
  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loadedBytes += value.byteLength;
  }

  const bytes = new Uint8Array(loadedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  await cacheWrite;
  return bytes;
}

export function loadCompiler(options: LoadCompilerOptions = {}): Promise<ClangCompilerAdapter> {
  compilerInitialization ??= (async () => {
    options.log?.({ source: "compiler", event: "sdk:initialize" });
    await initializeSdk();
    const webc = await downloadToolchain(options.onProgress, options.log);
    const runtime = new Runtime({ registry: null });
    return ClangCompilerAdapter.fromWebc(webc, {
      runtime,
      log: options.log,
      commandTimeoutMs: 60_000,
    });
  })().catch((error) => {
    compilerInitialization = undefined;
    void deleteCachedToolchain(options.log);
    throw error;
  });
  return compilerInitialization;
}
