import { Directory, Wasmer, init } from "@wasmer/sdk";

import type {
  ProgramWorkerRequest,
  ProgramWorkerResponse,
} from "./programWorkerProtocol.js";
import {
  VIRTUAL_WORKSPACE_PATH,
  readVirtualTextFiles,
} from "./virtualFilesystem.js";

interface WorkerScope {
  onmessage: ((event: MessageEvent<ProgramWorkerRequest>) => void) | null;
  postMessage(message: ProgramWorkerResponse, transfer?: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;
let stdinWriter: WritableStreamDefaultWriter<Uint8Array> | undefined;
let waitForInstance: (() => Promise<void>) | undefined;
let inputQueue = Promise.resolve();

function post(message: ProgramWorkerResponse, transfer?: Transferable[]): void {
  scope.postMessage(message, transfer);
}

function serializeError(cause: unknown): { message: string; stack?: string } {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  return { message: error.message, stack: error.stack };
}

async function pump(
  stream: ReadableStream<Uint8Array>,
  type: "stdout" | "stderr",
): Promise<void> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      const copy = value.slice().buffer;
      post({ type, data: copy }, [copy]);
    }
  } finally {
    reader.releaseLock();
  }
}

async function start(message: Extract<ProgramWorkerRequest, { type: "start" }>): Promise<void> {
  await init({
    module: new URL(message.sdkModuleUrl),
    workerUrl: new URL(message.sdkWorkerUrl),
  });
  const program = await Wasmer.fromFile(new Uint8Array(message.wasm));
  if (!program.entrypoint) throw new Error("Compiled WebAssembly has no entrypoint");
  const workspace = new Directory(message.virtualFiles);
  const instance = await program.entrypoint.run({
    args: message.args,
    cwd: VIRTUAL_WORKSPACE_PATH,
    mount: { [VIRTUAL_WORKSPACE_PATH]: workspace },
  });
  if (!instance.stdin) throw new Error("The WASIX runtime did not expose a stdin stream");
  stdinWriter = instance.stdin.getWriter();
  const stdoutDone = pump(instance.stdout, "stdout");
  const stderrDone = pump(instance.stderr, "stderr");
  waitForInstance = async () => {
    const output = await instance.wait();
    await Promise.all([stdoutDone, stderrDone]);
    post({
      type: "exit",
      code: output.code,
      ok: output.ok,
      virtualFiles: await readVirtualTextFiles(workspace),
    });
  };
  post({ type: "ready" });
}

function queueInput(
  requestId: number,
  operation: (writer: WritableStreamDefaultWriter<Uint8Array>) => Promise<void>,
): void {
  inputQueue = inputQueue
    .then(async () => {
      if (!stdinWriter) throw new Error("Program stdin is not ready");
      await operation(stdinWriter);
      post({ type: "stdin-result", requestId });
    })
    .catch((cause) => {
      post({ type: "stdin-result", requestId, error: serializeError(cause).message });
    });
}

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === "start") {
    void start(message).catch((cause) => {
      post({ type: "error", phase: "start", ...serializeError(cause) });
    });
    return;
  }
  if (message.type === "stdin") {
    queueInput(message.requestId, (writer) => writer.write(new Uint8Array(message.data)));
    return;
  }
  if (message.type === "close-stdin") {
    queueInput(message.requestId, (writer) => writer.close());
    return;
  }
  if (message.type === "wait") {
    if (!waitForInstance) {
      post({ type: "error", phase: "wait", message: "Program instance is not ready" });
      return;
    }
    void inputQueue
      .then(async () => {
        stdinWriter?.releaseLock();
        stdinWriter = undefined;
        await waitForInstance?.();
      })
      .catch((cause) => {
        post({ type: "error", phase: "wait", ...serializeError(cause) });
      });
  }
};
