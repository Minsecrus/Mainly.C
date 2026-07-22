/// <reference lib="WebWorker" />

import { LspFrameParser } from "./lspFrameParser.js";
import type { JsonRpcMessage } from "./protocol.js";

interface WorkspaceFilePayload {
  name: string;
  content: string;
}

interface WorkspaceMessage {
  channel: "workspace";
  files: WorkspaceFilePayload[];
  openFileNames: string[];
}

interface LspMessage {
  channel: "lsp";
  message: JsonRpcMessage;
}

type IncomingMessage = WorkspaceMessage | LspMessage;

interface EmscriptenFileSystem {
  analyzePath(path: string): { exists: boolean };
  mkdir(path: string): void;
  writeFile(path: string, data: string | Uint8Array): void;
  unlink(path: string): void;
}

interface ClangdModule {
  FS: EmscriptenFileSystem;
  callMain(args?: string[]): number | Promise<number>;
}

interface ClangdFactoryOptions {
  thisProgram: string;
  mainScriptUrlOrBlob: string;
  INITIAL_MEMORY?: number;
  locateFile(path: string, prefix: string): string;
  stdinReady(): Promise<void> | undefined;
  stdin(): number | null;
  stdout(charCode: number): void;
  stderr(charCode: number): void;
  onExit(status: unknown): void;
  onAbort(reason: unknown): void;
}

type ClangdFactory = (options: ClangdFactoryOptions) => Promise<ClangdModule>;

const worker = self as DedicatedWorkerGlobalScope;
const CLANGD_CACHE_NAME = "mainly-c-clangd-21.1.0-v1";
const WORKSPACE_PATH = "/workspace";
const CLANGD_CONFIG_PATH = `${WORKSPACE_PATH}/.clangd`;
const CLANGD_CONFIG = JSON.stringify({ Index: { StandardLibrary: false } });
const textEncoder = new TextEncoder();
const frameParser = new LspFrameParser();

let clangd: ClangdModule | undefined;
let latestWorkspace: WorkspaceMessage = {
  channel: "workspace",
  files: [],
  openFileNames: [],
};
let workspaceFileNames = new Set<string>();
let resolveStdinReady: (() => void) | undefined;
const stdinChunks: Uint8Array[] = [];
let currentStdinChunk: Array<number | null> = [];

function postControl(type: string, detail: Record<string, unknown> = {}): void {
  worker.postMessage({ channel: "control", type, ...detail });
}

function postLsp(message: JsonRpcMessage): void {
  worker.postMessage({ channel: "lsp", message });
}

function localAssetUrl(path: string): string {
  const base = new URL(import.meta.env.BASE_URL, worker.location.origin);
  return new URL(path, base).href;
}

async function fetchCached(url: string): Promise<Response> {
  try {
    const cache = await caches.open(CLANGD_CACHE_NAME);
    const cached = await cache.match(url);
    if (cached) {
      postControl("cache-hit");
      return cached;
    }

    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    await cache.put(url, response.clone());
    return response;
  } catch (cause) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`, { cause });
    return response;
  }
}

async function loadWasmBlobUrl(): Promise<string> {
  const response = await fetchCached(localAssetUrl("lsp/clangd.wasm.gz"));
  if (!response.body) throw new Error("clangd WASM response did not expose a readable stream");

  const compressedTotal = Number.parseInt(response.headers.get("Content-Length") ?? "", 10);
  let compressedRead = 0;
  const progressStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      compressedRead += chunk.byteLength;
      postControl("progress", {
        loaded: compressedRead,
        total: Number.isFinite(compressedTotal) ? compressedTotal : undefined,
      });
      controller.enqueue(chunk);
    },
  });
  const decompressed = response.body
    .pipeThrough(progressStream)
    .pipeThrough(
      new DecompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>,
    );
  const blob = await new Response(decompressed).blob();
  return URL.createObjectURL(new Blob([blob], { type: "application/wasm" }));
}

function stdin(): number | null {
  if (currentStdinChunk.length === 0) {
    const nextChunk = stdinChunks.shift();
    if (!nextChunk) return null;
    currentStdinChunk = [...nextChunk, null];
  }
  return currentStdinChunk.shift() ?? null;
}

function stdinReady(): Promise<void> | undefined {
  if (stdinChunks.length > 0) return undefined;
  return new Promise<void>((resolve) => {
    resolveStdinReady = resolve;
  });
}

function enqueueLspMessage(message: JsonRpcMessage): void {
  const body = textEncoder.encode(JSON.stringify(message));
  const header = textEncoder.encode(`Content-Length: ${body.byteLength}\r\n`);
  const delimiter = textEncoder.encode("\r\n");
  stdinChunks.push(header, delimiter, body);
  resolveStdinReady?.();
  resolveStdinReady = undefined;
}

function ensureWorkspaceDirectory(fileSystem: EmscriptenFileSystem): void {
  if (!fileSystem.analyzePath(WORKSPACE_PATH).exists) fileSystem.mkdir(WORKSPACE_PATH);
  if (!fileSystem.analyzePath(CLANGD_CONFIG_PATH).exists) {
    fileSystem.writeFile(CLANGD_CONFIG_PATH, CLANGD_CONFIG);
  }
}

function isSafeWorkspaceFileName(name: string): boolean {
  return name.length > 0 && !name.includes("/") && !name.includes("\\") && name !== ".clangd";
}

function applyWorkspace(
  files: readonly WorkspaceFilePayload[],
  openFileNames: readonly string[],
): void {
  if (!clangd) return;
  const fileSystem = clangd.FS;
  ensureWorkspaceDirectory(fileSystem);
  const openNames = new Set(openFileNames);

  const nextNames = new Set(files.filter((file) => isSafeWorkspaceFileName(file.name)).map((file) => file.name));
  for (const oldName of workspaceFileNames) {
    if (nextNames.has(oldName)) continue;
    const path = `${WORKSPACE_PATH}/${oldName}`;
    if (fileSystem.analyzePath(path).exists) fileSystem.unlink(path);
  }

  for (const file of files) {
    if (!isSafeWorkspaceFileName(file.name)) continue;
    const path = `${WORKSPACE_PATH}/${file.name}`;
    if (openNames.has(file.name) && fileSystem.analyzePath(path).exists) continue;
    fileSystem.writeFile(path, file.content);
  }
  workspaceFileNames = nextNames;
}

function handleIncomingMessage(event: MessageEvent<IncomingMessage>): void {
  const data = event.data;
  if (data?.channel === "lsp") {
    enqueueLspMessage(data.message);
    return;
  }
  if (data?.channel === "workspace") {
    latestWorkspace = data;
    applyWorkspace(data.files, data.openFileNames);
  }
}

worker.addEventListener("message", handleIncomingMessage);

async function startClangd(): Promise<void> {
  if (!worker.crossOriginIsolated) {
    throw new Error("clangd requires a cross-origin-isolated browser context");
  }

  const clangdJavaScriptUrl = localAssetUrl("lsp/clangd.js");
  const [wasmBlobUrl, moduleNamespace] = await Promise.all([
    loadWasmBlobUrl(),
    import(/* @vite-ignore */ clangdJavaScriptUrl) as Promise<{ default: ClangdFactory }>,
  ]);
  const Clangd = moduleNamespace.default;
  let stderrLine = "";

  const abort = (reason: unknown) => {
    postControl("error", { message: `clangd stopped: ${String(reason)}` });
  };

  clangd = await Clangd({
    thisProgram: "/usr/bin/clangd",
    mainScriptUrlOrBlob: clangdJavaScriptUrl,
    locateFile: (path, prefix) => path.endsWith(".wasm") ? wasmBlobUrl : `${prefix}${path}`,
    stdinReady,
    stdin,
    stdout: (charCode) => {
      for (const message of frameParser.push(charCode)) {
        postLsp(message);
      }
    },
    stderr: (charCode) => {
      if (charCode === 10) {
        if (stderrLine.trim()) postControl("log", { message: stderrLine });
        stderrLine = "";
      } else {
        stderrLine += String.fromCharCode(charCode);
      }
    },
    onExit: abort,
    onAbort: abort,
  });

  applyWorkspace(latestWorkspace.files, latestWorkspace.openFileNames);
  try {
    void Promise.resolve(clangd.callMain([
      "--background-index=false",
      "--clang-tidy=false",
      // Keep clangd's request handling synchronous inside this dedicated Worker.
      // This avoids nested Emscripten Pthread races without blocking the UI thread.
      "--sync",
      "--log=error",
    ])).catch(abort);
  } catch (cause) {
    abort(cause);
    throw cause;
  }
  postControl("ready");
}

void startClangd().catch((cause) => {
  postControl("error", {
    message: cause instanceof Error ? cause.message : String(cause),
  });
});
