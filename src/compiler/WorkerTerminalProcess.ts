import wasmerSdkModuleUrl from "@wasmer/sdk/wasm?url";
import ProgramWorker from "./program.worker?worker";

import type {
  TerminalProcess,
  TerminalProcessOutput,
} from "./InteractiveTerminalSession.js";
import type {
  ProgramWorkerRequest,
  ProgramWorkerResponse,
} from "./programWorkerProtocol.js";
import type { CompilerLogSink } from "./types.js";
import type { VirtualFileMap, VirtualTextFileMap } from "./virtualFilesystem.js";

interface PendingInput {
  resolve: () => void;
  reject: (error: Error) => void;
}

interface WorkerTerminalProcessOptions {
  args?: string[];
  virtualFiles?: VirtualFileMap;
  onVirtualFiles?: (virtualFiles: VirtualTextFileMap) => void;
  onVirtualFilesError?: (message: string) => void;
  log?: CompilerLogSink;
}

const TERMINATION_SNAPSHOT_TIMEOUT_MS = 500;

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function localAssetUrl(path: string): URL {
  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return new URL(`${base}${path}`, window.location.origin);
}

function post(worker: Worker, message: ProgramWorkerRequest, transfer?: Transferable[]): void {
  worker.postMessage(message, transfer ?? []);
}

class WorkerTerminalProcess implements TerminalProcess {
  readonly stdin: WritableStream<Uint8Array>;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;

  readonly #worker = new ProgramWorker({ name: "mainly.c program" });
  readonly #pendingInput = new Map<number, PendingInput>();
  readonly #log?: CompilerLogSink;
  readonly #onVirtualFiles?: (virtualFiles: VirtualTextFileMap) => void;
  readonly #onVirtualFilesError?: (message: string) => void;
  #stdoutController!: ReadableStreamDefaultController<Uint8Array>;
  #stderrController!: ReadableStreamDefaultController<Uint8Array>;
  #requestId = 0;
  #readyResolve!: () => void;
  #readyReject!: (error: Error) => void;
  #exitResolve!: (output: TerminalProcessOutput) => void;
  #exitReject!: (error: Error) => void;
  #ready: Promise<void>;
  #exit: Promise<TerminalProcessOutput>;
  #waitRequested = false;
  #closed = false;
  #terminating = false;
  #terminationPromise?: Promise<void>;
  #terminationResolve?: () => void;
  #terminationTimer?: ReturnType<typeof setTimeout>;
  #previousVirtualFilesError?: string;

  constructor(wasm: Uint8Array, options: WorkerTerminalProcessOptions = {}) {
    this.#log = options.log;
    this.#onVirtualFiles = options.onVirtualFiles;
    this.#onVirtualFilesError = options.onVirtualFilesError;
    this.stdout = new ReadableStream({ start: (controller) => { this.#stdoutController = controller; } });
    this.stderr = new ReadableStream({ start: (controller) => { this.#stderrController = controller; } });
    this.stdin = new WritableStream<Uint8Array>({
      write: (data) => this.#sendInput(data),
      close: () => this.#closeInput(),
    });
    this.#ready = new Promise((resolve, reject) => {
      this.#readyResolve = resolve;
      this.#readyReject = reject;
    });
    this.#exit = new Promise((resolve, reject) => {
      this.#exitResolve = resolve;
      this.#exitReject = reject;
    });
    void this.#exit.catch(() => undefined);
    this.#worker.onmessage = (event: MessageEvent<ProgramWorkerResponse>) => this.#onMessage(event.data);
    this.#worker.onerror = (event) => {
      event.preventDefault();
      this.#fail(new Error(event.message || "Program worker crashed"));
    };
    this.#worker.onmessageerror = () => this.#fail(new Error("Program worker message could not be decoded"));

    const bytes = wasm.slice().buffer;
    this.#log?.({ source: "terminal", event: "worker:start" });
    post(
      this.#worker,
      {
        type: "start",
        wasm: bytes,
        args: options.args,
        virtualFiles: options.virtualFiles,
        sdkModuleUrl: new URL(wasmerSdkModuleUrl, window.location.origin).href,
        sdkWorkerUrl: localAssetUrl("runtime/wasmer-sdk.mjs").href,
      },
      [bytes],
    );
  }

  async ready(): Promise<void> {
    await this.#ready;
  }

  wait(): Promise<TerminalProcessOutput> {
    if (!this.#waitRequested && !this.#closed) {
      this.#waitRequested = true;
      post(this.#worker, { type: "wait" });
    }
    return this.#exit;
  }

  terminate(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    if (this.#terminationPromise) return this.#terminationPromise;
    this.#log?.({ source: "terminal", event: "worker:terminate" });
    this.#terminating = true;
    this.#terminationPromise = new Promise((resolve) => {
      this.#terminationResolve = resolve;
    });
    try {
      post(this.#worker, { type: "terminate" });
    } catch (cause) {
      this.#completeTermination(
        undefined,
        `终止前无法请求最终虚拟文件快照：${errorMessage(cause)}`,
      );
      return this.#terminationPromise;
    }
    this.#terminationTimer = setTimeout(() => {
      this.#completeTermination(
        undefined,
        `终止前读取最终虚拟文件快照超过 ${TERMINATION_SNAPSHOT_TIMEOUT_MS}ms，已使用最近一次同步结果`,
      );
    }, TERMINATION_SNAPSHOT_TIMEOUT_MS);
    return this.#terminationPromise;
  }

  #sendInput(data: Uint8Array): Promise<void> {
    const copy = data.slice().buffer;
    return this.#sendInputRequest({ type: "stdin", requestId: ++this.#requestId, data: copy }, [copy]);
  }

  #closeInput(): Promise<void> {
    return this.#sendInputRequest({ type: "close-stdin", requestId: ++this.#requestId });
  }

  #sendInputRequest(message: ProgramWorkerRequest, transfer?: Transferable[]): Promise<void> {
    if (this.#closed) return Promise.reject(new Error("Program worker is not running"));
    return new Promise((resolve, reject) => {
      if ("requestId" in message) this.#pendingInput.set(message.requestId, { resolve, reject });
      post(this.#worker, message, transfer);
    });
  }

  #onMessage(message: ProgramWorkerResponse): void {
    if (this.#closed) return;
    if (message.type === "ready") {
      this.#log?.({ source: "terminal", event: "worker:ready" });
      this.#readyResolve();
      return;
    }
    if (message.type === "stdout" || message.type === "stderr") {
      const controller = message.type === "stdout" ? this.#stdoutController : this.#stderrController;
      controller.enqueue(new Uint8Array(message.data));
      return;
    }
    if (message.type === "virtual-files") {
      this.#deliverVirtualFiles(message.virtualFiles);
      return;
    }
    if (message.type === "virtual-files-error") {
      this.#reportVirtualFilesError(message.message);
      return;
    }
    if (message.type === "terminate-result") {
      if (this.#terminating) this.#completeTermination(message.virtualFiles, message.error);
      return;
    }
    if (message.type === "stdin-result") {
      const pending = this.#pendingInput.get(message.requestId);
      if (!pending) return;
      this.#pendingInput.delete(message.requestId);
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve();
      return;
    }
    if (message.type === "exit") {
      if (this.#terminating) {
        this.#completeTermination(message.virtualFiles);
        return;
      }
      this.#closed = true;
      this.#stdoutController.close();
      this.#stderrController.close();
      this.#exitResolve({
        code: message.code,
        ok: message.ok,
        stdout: "",
        stderr: "",
        stdoutBytes: new Uint8Array(),
        stderrBytes: new Uint8Array(),
        virtualFiles: message.virtualFiles,
      });
      this.#worker.terminate();
      return;
    }
    this.#fail(new Error(`${message.phase}: ${message.message}`));
  }

  #fail(error: Error): void {
    if (this.#closed) return;
    if (this.#terminating) {
      this.#completeTermination(undefined, error.message);
      return;
    }
    this.#closed = true;
    this.#log?.({ source: "terminal", event: "worker:error", message: error.message });
    this.#worker.terminate();
    this.#readyReject(error);
    this.#exitReject(error);
    for (const pending of this.#pendingInput.values()) pending.reject(error);
    this.#pendingInput.clear();
    this.#stdoutController.error(error);
    this.#stderrController.error(error);
  }

  #deliverVirtualFiles(virtualFiles: VirtualTextFileMap): void {
    try {
      this.#onVirtualFiles?.(virtualFiles);
      this.#previousVirtualFilesError = undefined;
    } catch (cause) {
      this.#reportVirtualFilesError(errorMessage(cause));
    }
  }

  #reportVirtualFilesError(message: string): void {
    if (message === this.#previousVirtualFilesError) return;
    this.#previousVirtualFilesError = message;
    this.#log?.({ source: "terminal", event: "worker:virtual-files-error", message });
    try {
      this.#onVirtualFilesError?.(message);
    } catch (cause) {
      this.#log?.({
        source: "terminal",
        event: "worker:virtual-files-error-handler",
        message: errorMessage(cause),
      });
    }
  }

  #completeTermination(virtualFiles?: VirtualTextFileMap, syncError?: string): void {
    if (this.#closed) return;
    if (virtualFiles) {
      this.#log?.({
        source: "terminal",
        event: "worker:terminate-snapshot",
        fileCount: Object.keys(virtualFiles).length,
      });
      this.#deliverVirtualFiles(virtualFiles);
    }
    if (syncError) this.#reportVirtualFilesError(syncError);
    this.#closed = true;
    if (this.#terminationTimer !== undefined) clearTimeout(this.#terminationTimer);
    this.#worker.terminate();
    const error = new Error("Program worker was terminated");
    for (const pending of this.#pendingInput.values()) pending.reject(error);
    this.#pendingInput.clear();
    this.#stdoutController.close();
    this.#stderrController.close();
    this.#exitReject(error);
    this.#terminationResolve?.();
  }
}

export async function startWorkerTerminalProcess(
  wasm: Uint8Array,
  options: WorkerTerminalProcessOptions = {},
): Promise<TerminalProcess> {
  const process = new WorkerTerminalProcess(wasm, options);
  await process.ready();
  return process;
}
