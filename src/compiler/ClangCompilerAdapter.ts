import {
  Directory,
  type Output,
  Runtime,
  Wasmer,
} from "@wasmer/sdk";

import { parseClangDiagnostics, type ClangDiagnostic } from "./diagnostics.js";
import {
  InteractiveTerminalSession,
  type TerminalSessionOptions,
} from "./InteractiveTerminalSession.js";
import type { CompilerLogSink } from "./types.js";
import { MAINLY_EXIT_MARKER } from "./runtimeProtocol.js";
import {
  VIRTUAL_WORKSPACE_PATH,
  readVirtualTextFiles,
  type VirtualFileMap,
  type VirtualTextFileMap,
} from "./virtualFilesystem.js";
import {
  compilerDriverForLanguage,
  DEFAULT_LANGUAGE_STANDARDS,
  isLanguageStandardForLanguage,
  sourceLanguageForFileName,
  type LanguageStandard,
  type SourceLanguage,
} from "../languages.js";

export type { CppStandard, CStandard, LanguageStandard } from "../languages.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const INTERACTIVE_RUNTIME_HEADER = "__mainly_runtime.h";

const DEFAULT_COMPILER_FLAGS = [
  "-fdiagnostics-color=always",
  "-g3",
  "-D_DEBUG",
  "-pipe",
  "-finput-charset=UTF-8",
  "-fexec-charset=UTF-8",
] as const;

const STRICT_COMPILER_FLAGS = [
  "-Wall",
  "-Wextra",
  "-Werror",
  "-pedantic",
  "-Wshadow",
  "-Wconversion",
  "-Wfloat-equal",
  "-Wcast-align",
  "-Wcast-qual",
  "-Wwrite-strings",
  "-Wswitch-default",
  "-Wswitch-enum",
] as const;

const DEFAULT_LINKER_FLAGS = ["-lm"] as const;

const INTERACTIVE_RUNTIME_SOURCE = `#ifndef MAINLY_C_RUNTIME_H
#define MAINLY_C_RUNTIME_H
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

static void __mainly_c_emit_exit_marker(void) {
    static const char marker[] = "\\036mainly.c:exit\\036";
    (void)fwrite(marker, 1, sizeof marker - 1, stderr);
    (void)fflush(stderr);
}

__attribute__((constructor))
static void __mainly_c_initialize_runtime(void) {
    /* Streamed browser stdio must expose prompts before the program blocks for input. */
    (void)setvbuf(stdout, NULL, _IONBF, 0);
    (void)setvbuf(stderr, NULL, _IONBF, 0);
    (void)chdir("${VIRTUAL_WORKSPACE_PATH}");
    (void)atexit(__mainly_c_emit_exit_marker);
}
#endif
`;

const INTERACTIVE_RUNTIME_FLAGS = [
  "--target=wasm32-wasip1",
  "--sysroot=/wasix",
  "-resource-dir=/usr",
  "-matomics",
  "-mbulk-memory",
  "-mmutable-globals",
  "-pthread",
  "-mthread-model",
  "posix",
  "-ftls-model=local-exec",
  "-fno-trapping-math",
  "-D_WASI_EMULATED_MMAN",
  "-D_WASI_EMULATED_SIGNAL",
  "-D_WASI_EMULATED_PROCESS_CLOCKS",
  "-lwasi-emulated-mman",
  "-lwasi-emulated-process-clocks",
  "-DUSE_TIMEGM",
  "-Wl,--shared-memory",
  "-Wl,--max-memory=4294967296",
  "-Wl,--import-memory",
  "-Wl,--export-dynamic",
  "-Wl,--export=__heap_base",
  "-Wl,--export=__stack_pointer",
  "-Wl,--export=__data_end",
  "-Wl,--export=__wasm_init_tls",
  "-Wl,--export=__wasm_signal",
  "-Wl,--export=__tls_size",
  "-Wl,--export=__tls_align",
  "-Wl,--export=__tls_base",
] as const;

type ToolName = "clang" | "clang++" | "wasm-ld" | "llvm-ar" | "llvm-ranlib" | "llvm-nm";

export interface ClangCompilerAdapterOptions {
  runtime?: Runtime;
  log?: CompilerLogSink;
  commandTimeoutMs?: number;
}

export interface CompileOptions {
  fileName: string;
  source: string | Uint8Array;
  standard?: LanguageStandard;
  interactive?: boolean;
  strictCompilation?: boolean;
  additionalArguments?: readonly string[];
}

export interface CompileResult {
  ok: boolean;
  wasm?: Uint8Array;
  diagnostics: ClangDiagnostic[];
  stdout: string;
  stderr: string;
  planOutput: string;
  commandPlan: readonly (readonly string[])[];
  elapsedMs: number;
}

export interface StartProgramOptions extends TerminalSessionOptions {
  args?: string[];
  virtualFiles?: VirtualFileMap;
  onVirtualFiles?: (virtualFiles: VirtualTextFileMap) => void;
  onVirtualFilesError?: (message: string) => void;
}

export interface RunBatchOptions {
  stdin?: string | Uint8Array;
  args?: string[];
  virtualFiles?: VirtualFileMap;
}

export interface RunBatchResult extends Output {
  virtualFiles: VirtualTextFileMap;
}

interface CommandResult {
  output: Output;
  args: string[];
}

function parseClangArgumentLine(line: string): string[] {
  return Array.from(
    line.matchAll(/ (?:([^ "\n]+)|"((?:[^"\\$]|\\["\\$])*)")/g),
    (match) =>
      match[1] !== undefined
        ? match[1]
        : match[2].replaceAll(/\\["$\\]/g, (escaped) => escaped[1]),
  );
}

export function parseClangCommandPlan(output: string): string[][] {
  const commands: string[][] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.startsWith(' "')) continue;
    const command = parseClangArgumentLine(line);
    if (command[0] === "") command.shift();
    if (command.length > 0) commands.push(command);
  }
  if (commands.length === 0) {
    throw new Error(`Clang did not emit a command plan:\n${output}`);
  }
  return commands;
}

function toolForExecutable(executable: string): ToolName {
  const name = executable.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase();
  if (name === "clang++" || name?.startsWith("clang++-")) return "clang++";
  if (name === "clang" || name?.startsWith("clang-")) return "clang";
  if (name === "wasm-ld" || name === "ld.lld") return "wasm-ld";
  if (name === "ar" || name === "llvm-ar") return "llvm-ar";
  if (name === "ranlib" || name === "llvm-ranlib") return "llvm-ranlib";
  if (name === "nm" || name === "llvm-nm") return "llvm-nm";
  throw new Error(`Unsupported Clang subprocess: ${executable}`);
}

function validateFileName(fileName: string): SourceLanguage {
  const language = sourceLanguageForFileName(fileName);
  if (!language || fileName.includes("/") || fileName.includes("\\") || fileName.startsWith(".")) {
    throw new Error("mainly.c compiles one root-level C or C++ source file at a time");
  }
  return language;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise.finally(() => clearTimeout(timeout)),
    new Promise<T>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

export class ClangCompilerAdapter {
  readonly #runtime: Runtime;
  readonly #toolchain: Wasmer;
  readonly #log?: CompilerLogSink;
  readonly #commandTimeoutMs: number;

  private constructor(toolchain: Wasmer, options: ClangCompilerAdapterOptions) {
    this.#toolchain = toolchain;
    this.#runtime = options.runtime ?? new Runtime({ registry: null });
    this.#log = options.log;
    this.#commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  static async fromWebc(
    webc: Uint8Array,
    options: ClangCompilerAdapterOptions = {},
  ): Promise<ClangCompilerAdapter> {
    const runtime = options.runtime ?? new Runtime({ registry: null });
    const startedAt = performance.now();
    options.log?.({ source: "compiler", event: "toolchain:load" });
    const toolchain = await Wasmer.fromFile(webc, runtime);
    options.log?.({
      source: "compiler",
      event: "toolchain:ready",
      elapsedMs: Math.round(performance.now() - startedAt),
    });
    return new ClangCompilerAdapter(toolchain, { ...options, runtime });
  }

  static async fromUrl(
    url: URL | string,
    options: ClangCompilerAdapterOptions = {},
  ): Promise<ClangCompilerAdapter> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Unable to load Clang WebC (${response.status} ${response.statusText})`);
    }
    return ClangCompilerAdapter.fromWebc(new Uint8Array(await response.arrayBuffer()), options);
  }

  async compile(options: CompileOptions): Promise<CompileResult> {
    const language = validateFileName(options.fileName);
    const standard = options.standard ?? DEFAULT_LANGUAGE_STANDARDS[language];
    if (!isLanguageStandardForLanguage(language, standard)) {
      throw new Error(`The ${standard} standard does not match ${options.fileName}`);
    }
    const driver = compilerDriverForLanguage(language);
    const startedAt = performance.now();
    const outputName = `${options.fileName.replace(/\.[^.]+$/, "")}.wasm`;
    const workspace = new Directory({
      [options.fileName]: options.source,
      ...(options.interactive ? { [INTERACTIVE_RUNTIME_HEADER]: INTERACTIVE_RUNTIME_SOURCE } : {}),
    });
    try {
      const compilerArgs = [
        `-std=${standard}`,
        "-x",
        language === "cpp" ? "c++" : "c",
        ...DEFAULT_COMPILER_FLAGS,
        ...(options.strictCompilation === false ? [] : STRICT_COMPILER_FLAGS),
        ...(language === "cpp" ? ["-fno-exceptions"] : []),
        ...(options.interactive
          ? ["-include", `${VIRTUAL_WORKSPACE_PATH}/${INTERACTIVE_RUNTIME_HEADER}`]
          : []),
        ...(options.interactive ? INTERACTIVE_RUNTIME_FLAGS : []),
        ...(options.additionalArguments ?? []),
        `${VIRTUAL_WORKSPACE_PATH}/${options.fileName}`,
        ...DEFAULT_LINKER_FLAGS,
        "-o",
        `${VIRTUAL_WORKSPACE_PATH}/${outputName}`,
      ];

      const plan = await this.#runCommand(driver, ["-###", ...compilerArgs], workspace, "plan");
      const planText = `${plan.output.stdout}${plan.output.stderr}`;
      if (!plan.output.ok) {
        return this.#compileFailure(plan.output, planText, [], startedAt);
      }

      const commands = parseClangCommandPlan(planText);
      let stdout = "";
      let stderr = "";
      for (const [index, [executable, ...args]] of commands.entries()) {
        const tool = toolForExecutable(executable);
        const result = await this.#runCommand(
          tool,
          args,
          workspace,
          `command-${index + 1}:${tool}`,
        );
        stdout += result.output.stdout;
        stderr += result.output.stderr;
        if (!result.output.ok) {
          return {
            ok: false,
            diagnostics: parseClangDiagnostics(`${stdout}${stderr}`),
            stdout,
            stderr,
            planOutput: planText,
            commandPlan: commands,
            elapsedMs: Math.round(performance.now() - startedAt),
          };
        }
      }

      return {
        ok: true,
        wasm: await workspace.readFile(outputName),
        diagnostics: parseClangDiagnostics(`${stdout}${stderr}`),
        stdout,
        stderr,
        planOutput: planText,
        commandPlan: commands,
        elapsedMs: Math.round(performance.now() - startedAt),
      };
    } finally {
      workspace.free();
    }
  }

  async runBatch(wasm: Uint8Array, options: RunBatchOptions = {}): Promise<RunBatchResult> {
    const program = await Wasmer.fromFile(wasm, this.#runtime);
    try {
      if (!program.entrypoint) throw new Error("Compiled WebAssembly has no entrypoint");
      const workspace = new Directory(options.virtualFiles);
      try {
        const instance = await program.entrypoint.run({
          args: options.args,
          stdin: options.stdin,
          cwd: VIRTUAL_WORKSPACE_PATH,
          mount: { [VIRTUAL_WORKSPACE_PATH]: workspace },
        });
        const output = await withTimeout(
          instance.wait(),
          this.#commandTimeoutMs,
          `Program did not exit within ${this.#commandTimeoutMs}ms`,
        );
        return { ...output, virtualFiles: await readVirtualTextFiles(workspace) };
      } finally {
        workspace.free();
      }
    } finally {
      program.free();
    }
  }

  async startInteractive(
    wasm: Uint8Array,
    options: StartProgramOptions = {},
  ): Promise<InteractiveTerminalSession> {
    const { startWorkerTerminalProcess } = await import("./WorkerTerminalProcess.js");
    const process = await startWorkerTerminalProcess(wasm, {
      args: options.args,
      virtualFiles: options.virtualFiles,
      onVirtualFiles: options.onVirtualFiles,
      onVirtualFilesError: options.onVirtualFilesError,
      log: options.log ?? this.#log,
    });
    return new InteractiveTerminalSession(process, {
      onStdout: options.onStdout,
      onStderr: options.onStderr,
      hiddenStderrSequences: options.hiddenStderrSequences,
      log: options.log ?? this.#log,
    });
  }

  #compileFailure(
    output: Output,
    planOutput: string,
    commands: string[][],
    startedAt: number,
  ): CompileResult {
    const combined = `${output.stdout}${output.stderr}`;
    return {
      ok: false,
      diagnostics: parseClangDiagnostics(combined),
      stdout: output.stdout,
      stderr: output.stderr,
      planOutput,
      commandPlan: commands,
      elapsedMs: Math.round(performance.now() - startedAt),
    };
  }

  async #runCommand(
    tool: ToolName,
    args: readonly string[],
    workspace: Directory,
    phase: string,
  ): Promise<CommandResult> {
    const command = this.#toolchain.commands[tool];
    if (!command) throw new Error(`Clang WebC does not expose the ${tool} command`);
    const effectiveArgs = tool === "wasm-ld" ? ["--threads=1", ...args] : [...args];
    const startedAt = performance.now();
    this.#log?.({ source: "compiler", event: "command:spawn", phase, args: effectiveArgs });
    const instance = await command.run({
      args: effectiveArgs,
      mount: { [VIRTUAL_WORKSPACE_PATH]: workspace },
    });
    this.#log?.({
      source: "compiler",
      event: "command:wait",
      phase,
      elapsedMs: Math.round(performance.now() - startedAt),
    });
    const output = await withTimeout(
      instance.wait(),
      this.#commandTimeoutMs,
      `${phase} did not exit within ${this.#commandTimeoutMs}ms`,
    );
    this.#log?.({
      source: "compiler",
      event: "command:done",
      phase,
      elapsedMs: Math.round(performance.now() - startedAt),
      exitCode: output.code,
    });
    return { output, args: effectiveArgs };
  }
}
