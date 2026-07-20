export interface ProgramWorkerStartMessage {
  type: "start";
  wasm: ArrayBuffer;
  args?: string[];
  sdkModuleUrl: string;
  sdkWorkerUrl: string;
}

export interface ProgramWorkerInputMessage {
  type: "stdin";
  requestId: number;
  data: ArrayBuffer;
}

export interface ProgramWorkerCloseInputMessage {
  type: "close-stdin";
  requestId: number;
}

export interface ProgramWorkerWaitMessage {
  type: "wait";
}

export type ProgramWorkerRequest =
  | ProgramWorkerStartMessage
  | ProgramWorkerInputMessage
  | ProgramWorkerCloseInputMessage
  | ProgramWorkerWaitMessage;

export type ProgramWorkerResponse =
  | { type: "ready" }
  | { type: "stdout"; data: ArrayBuffer }
  | { type: "stderr"; data: ArrayBuffer }
  | { type: "stdin-result"; requestId: number; error?: string }
  | { type: "exit"; code: number; ok: boolean }
  | { type: "error"; phase: string; message: string; stack?: string };
