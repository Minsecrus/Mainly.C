import type { Output } from "@wasmer/sdk";

import type { CompilerLogSink } from "./types.js";

export interface TerminalSessionOptions {
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
  hiddenStderrSequences?: readonly string[];
  log?: CompilerLogSink;
}

export interface TerminalResult extends Output {
  stdout: string;
  stderr: string;
}

export interface TerminalProcess {
  readonly stdin?: WritableStream<Uint8Array>;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  wait(): Promise<Output>;
  terminate(): void;
}

export class TerminalTerminatedError extends Error {
  constructor() {
    super("Terminal process was terminated");
    this.name = "TerminalTerminatedError";
  }
}

interface OutputWaiter {
  stream: "stdout" | "stderr";
  expected: string;
  resolve: () => void;
  reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
}

/**
 * Connects a running WASIX process to an xterm-style terminal.
 *
 * With the pinned SDK 0.8 runtime, call finish() only after the program has
 * consumed its terminal input (for example after waitForOutput() resolves).
 * Waiting before that point can turn the still-open terminal into EOF.
 */
export class InteractiveTerminalSession {
  readonly #process: TerminalProcess;
  readonly #options: TerminalSessionOptions;
  readonly #encoder = new TextEncoder();
  readonly #stdoutDecoder = new TextDecoder();
  readonly #stderrDecoder = new TextDecoder();
  readonly #waiters = new Set<OutputWaiter>();
  readonly #stdinWriter: WritableStreamDefaultWriter;
  readonly #stdoutDone: Promise<void>;
  readonly #stderrDone: Promise<void>;
  #stdout = "";
  #stderr = "";
  #stderrDisplayPending = "";
  #finishPromise?: Promise<TerminalResult>;
  #inputReleased = false;
  #terminated = false;

  constructor(process: TerminalProcess, options: TerminalSessionOptions = {}) {
    if (!process.stdin) {
      throw new Error("The WASIX runtime did not expose a stdin stream");
    }
    this.#process = process;
    this.#options = options;
    this.#stdinWriter = process.stdin.getWriter();
    this.#stdoutDone = process.stdout.pipeTo(
      new WritableStream({
        write: (chunk: Uint8Array) => this.#acceptStdout(chunk),
        close: () => {
          const tail = this.#stdoutDecoder.decode();
          if (tail) this.#appendStdout(tail);
          this.#log("terminal:stdout-closed");
        },
      }),
    );
    this.#stderrDone = process.stderr.pipeTo(
      new WritableStream({
        write: (chunk: Uint8Array) => this.#acceptStderr(chunk),
        close: () => {
          const tail = this.#stderrDecoder.decode();
          if (tail) this.#appendStderr(tail);
          this.#flushVisibleStderr(true);
          this.#log("terminal:stderr-closed");
        },
      }),
    );
  }

  get stdout(): string {
    return this.#stdout;
  }

  get stderr(): string {
    return this.#stderr;
  }

  get terminated(): boolean {
    return this.#terminated;
  }

  async write(data: string | Uint8Array): Promise<void> {
    if (this.#inputReleased) {
      throw new Error("Cannot write after waiting for the terminal process to exit");
    }
    const bytes = typeof data === "string" ? this.#encoder.encode(data) : data;
    const printable = typeof data === "string" ? JSON.stringify(data) : `${data.byteLength} bytes`;
    this.#log("terminal:stdin-write", { data: printable });
    await this.#stdinWriter.write(bytes);
    this.#log("terminal:stdin-accepted", { data: printable });
  }

  async closeInput(): Promise<void> {
    this.#log("terminal:stdin-close");
    await this.#stdinWriter.close();
  }

  terminate(): void {
    if (this.#terminated || this.#inputReleased) return;
    this.#log("terminal:terminate");
    this.#terminated = true;
    this.#inputReleased = true;
    const error = new TerminalTerminatedError();
    for (const waiter of [...this.#waiters]) waiter.reject(error);
    this.#waiters.clear();
    this.#stdinWriter.releaseLock();
    this.#process.terminate();
    this.#log("terminal:terminated");
  }

  waitForOutput(expected: string, timeoutMs = 30_000): Promise<void> {
    if (this.#stdout.includes(expected)) return Promise.resolve();

    return this.#waitForStream("stdout", expected, timeoutMs);
  }

  waitForStderr(expected: string, timeoutMs?: number): Promise<void> {
    if (this.#stderr.includes(expected)) return Promise.resolve();

    return this.#waitForStream("stderr", expected, timeoutMs);
  }

  #waitForStream(
    stream: "stdout" | "stderr",
    expected: string,
    timeoutMs?: number,
  ): Promise<void> {

    return new Promise((resolve, reject) => {
      const waiter: OutputWaiter = {
        stream,
        expected,
        resolve: () => {
          if (waiter.timeout) clearTimeout(waiter.timeout);
          this.#waiters.delete(waiter);
          this.#log("terminal:output-observed", { stream, expected });
          resolve();
        },
        reject: (error) => {
          this.#waiters.delete(waiter);
          reject(error);
        },
      };
      if (timeoutMs !== undefined) {
        waiter.timeout = setTimeout(() => {
          waiter.reject(
            new Error(`Terminal did not produce ${JSON.stringify(expected)} within ${timeoutMs}ms`),
          );
        }, timeoutMs);
      }
      this.#waiters.add(waiter);
    });
  }

  finish(): Promise<TerminalResult> {
    this.#finishPromise ??= this.#finish();
    return this.#finishPromise;
  }

  /** Wait for a naturally exiting process without closing its live stdin. */
  async waitForExit(): Promise<TerminalResult> {
    await Promise.all([this.#stdoutDone, this.#stderrDone]);
    return this.finish();
  }

  async #finish(): Promise<TerminalResult> {
    const startedAt = performance.now();
    this.#stdinWriter.releaseLock();
    this.#inputReleased = true;
    this.#log("terminal:stdin-released");
    this.#log("terminal:wait");
    const output = await this.#process.wait();
    await Promise.all([this.#stdoutDone, this.#stderrDone]);
    this.#log("terminal:exited", {
      elapsedMs: Math.round(performance.now() - startedAt),
      exitCode: output.code,
    });
    return { ...output, stdout: this.#stdout, stderr: this.#stderr };
  }

  #acceptStdout(chunk: Uint8Array): void {
    this.#appendStdout(this.#stdoutDecoder.decode(chunk, { stream: true }));
  }

  #acceptStderr(chunk: Uint8Array): void {
    this.#appendStderr(this.#stderrDecoder.decode(chunk, { stream: true }));
  }

  #appendStdout(text: string): void {
    if (!text) return;
    this.#stdout += text;
    this.#log("terminal:stdout", { data: JSON.stringify(text) });
    this.#options.onStdout?.(text);
    for (const waiter of [...this.#waiters]) {
      if (waiter.stream === "stdout" && this.#stdout.includes(waiter.expected)) waiter.resolve();
    }
  }

  #appendStderr(text: string): void {
    if (!text) return;
    this.#stderr += text;
    this.#log("terminal:stderr", { data: JSON.stringify(text) });
    this.#stderrDisplayPending += text;
    this.#flushVisibleStderr(false);
    for (const waiter of [...this.#waiters]) {
      if (waiter.stream === "stderr" && this.#stderr.includes(waiter.expected)) waiter.resolve();
    }
  }

  #flushVisibleStderr(final: boolean): void {
    const hidden = this.#options.hiddenStderrSequences ?? [];
    if (hidden.length === 0) {
      if (this.#stderrDisplayPending) this.#options.onStderr?.(this.#stderrDisplayPending);
      this.#stderrDisplayPending = "";
      return;
    }

    let pending = this.#stderrDisplayPending;
    let visible = "";
    while (pending) {
      let matchIndex = -1;
      let match = "";
      for (const sequence of hidden) {
        const index = pending.indexOf(sequence);
        if (index >= 0 && (matchIndex < 0 || index < matchIndex)) {
          matchIndex = index;
          match = sequence;
        }
      }
      if (matchIndex >= 0) {
        visible += pending.slice(0, matchIndex);
        pending = pending.slice(matchIndex + match.length);
        continue;
      }
      if (final) {
        visible += pending;
        pending = "";
        break;
      }

      let keep = 0;
      for (const sequence of hidden) {
        const limit = Math.min(sequence.length - 1, pending.length);
        for (let length = limit; length > keep; length--) {
          if (pending.endsWith(sequence.slice(0, length))) {
            keep = length;
            break;
          }
        }
      }
      visible += pending.slice(0, pending.length - keep);
      pending = pending.slice(pending.length - keep);
      break;
    }
    this.#stderrDisplayPending = pending;
    if (visible) this.#options.onStderr?.(visible);
  }

  #log(event: string, details: Record<string, unknown> = {}): void {
    this.#options.log?.({ source: "terminal", event, ...details });
  }
}
