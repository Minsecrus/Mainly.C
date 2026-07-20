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

async function downloadToolchain(
  onProgress?: (progress: ToolchainLoadProgress) => void,
): Promise<Uint8Array> {
  const response = await fetch(localAssetUrl("toolchain/mainly-c-clang-22.1.0-1.webc"));
  if (!response.ok) {
    throw new Error(`无法载入本地 Clang 工具链（HTTP ${response.status}）`);
  }

  const totalHeader = response.headers.get("content-length");
  const totalBytes = totalHeader ? Number.parseInt(totalHeader, 10) : undefined;
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress?.({ loadedBytes: bytes.byteLength, totalBytes, percent: 100 });
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  const preallocated = totalBytes ? new Uint8Array(totalBytes) : undefined;
  let loadedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (preallocated) preallocated.set(value, loadedBytes);
    else chunks.push(value);
    loadedBytes += value.byteLength;
    onProgress?.({
      loadedBytes,
      totalBytes,
      percent: totalBytes ? Math.min(100, Math.round((loadedBytes / totalBytes) * 100)) : undefined,
    });
  }

  if (preallocated) {
    return loadedBytes === preallocated.byteLength
      ? preallocated
      : preallocated.slice(0, loadedBytes);
  }

  const bytes = new Uint8Array(loadedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function loadCompiler(options: LoadCompilerOptions = {}): Promise<ClangCompilerAdapter> {
  compilerInitialization ??= (async () => {
    options.log?.({ source: "compiler", event: "sdk:initialize" });
    await initializeSdk();
    options.log?.({ source: "compiler", event: "toolchain:download" });
    const webc = await downloadToolchain(options.onProgress);
    const runtime = new Runtime({ registry: null });
    return ClangCompilerAdapter.fromWebc(webc, {
      runtime,
      log: options.log,
      commandTimeoutMs: 60_000,
    });
  })().catch((error) => {
    compilerInitialization = undefined;
    throw error;
  });
  return compilerInitialization;
}
