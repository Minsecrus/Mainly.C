export interface CompilerLogEvent {
  source: "compiler" | "terminal";
  event: string;
  phase?: string;
  elapsedMs?: number;
  exitCode?: number;
  [detail: string]: unknown;
}

export type CompilerLogSink = (event: CompilerLogEvent) => void;

export function consoleCompilerLogger(event: CompilerLogEvent): void {
  const { source, event: name, ...details } = event;
  const suffix = Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : "";
  console.log(`[${source}] ${name}${suffix}`);
}
