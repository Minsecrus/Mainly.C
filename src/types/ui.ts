import type { CompilerLogEvent } from "../compiler/types.js";

export type RunState = "idle" | "loading" | "compiling" | "running" | "success" | "error" | "stopped";
export type OutputTab = "terminal" | "problems" | "logs";
export type AutoRunInterval = 5_000 | 10_000 | 30_000 | null;

export interface UiCompilerLog extends CompilerLogEvent {
  id: number;
  timestamp: number;
}
