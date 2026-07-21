import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const defaultWasmer = path.join(
  repositoryRoot,
  ".tools",
  "wasmer",
  "v7.2.0",
  "bin",
  "wasmer.exe",
);
const defaultWebc = path.join(
  repositoryRoot,
  "dist",
  "mainly-c-clang-22.1.0-4.webc",
);

const wasmerPath = process.env.WASMER_PATH || defaultWasmer;
const webcPath = process.env.CLANG_WEBC || defaultWebc;
const ansiEscape = /\u001b\[[0-?]*[ -/]*[@-~]/g;

for (const requiredPath of [wasmerPath, webcPath]) {
  if (!fs.existsSync(requiredPath)) {
    throw new Error(`Required file does not exist: ${requiredPath}`);
  }
}

const cacheRoot = path.join(repositoryRoot, ".cache", "wasmer-test-home");
fs.mkdirSync(cacheRoot, { recursive: true });

function guestVolume(hostPath) {
  return `${hostPath.replaceAll("\\", "/")}:/workspace`;
}

function runWasmer(args, { input, allowFailure = false } = {}) {
  const result = spawnSync(wasmerPath, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 5 * 60 * 1000,
    env: {
      ...process.env,
      WASMER_DIR: cacheRoot,
      WASMER_CACHE_DIR: path.join(cacheRoot, "cache"),
    },
  });

  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(
      `Wasmer exited with ${result.status}.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return result;
}

function unquoteClangArgs(line) {
  return Array.from(
    line.matchAll(/ (?:([^ "\n]+)|"((?:[^"\\$]|\\["\\$])*)")/g),
    (match) =>
      match[1] !== undefined
        ? match[1]
        : match[2].replaceAll(/\\["$\\]/g, (escaped) => escaped[1]),
  );
}

function parseCommandPlan(output) {
  const commands = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.startsWith(' "')) continue;
    const command = unquoteClangArgs(line);
    if (command[0] === "") command.shift();
    if (command.length > 0) commands.push(command);
  }
  if (commands.length === 0) {
    throw new Error(`Clang did not emit a command plan:\n${output}`);
  }
  return commands;
}

function entrypointFor(executable) {
  const name = path.posix.basename(executable).toLowerCase();
  if (name === "clang++" || name.startsWith("clang++-")) return "clang++";
  if (name === "clang" || name.startsWith("clang-")) return "clang";
  if (name === "wasm-ld" || name === "ld.lld") return "wasm-ld";
  if (name === "ar" || name === "llvm-ar") return "llvm-ar";
  if (name === "ranlib" || name === "llvm-ranlib") return "llvm-ranlib";
  if (name === "nm" || name === "llvm-nm") return "llvm-nm";
  throw new Error(`Unsupported Clang subprocess: ${executable}`);
}

const defaultCompilerFlags = [
  "-fdiagnostics-color=always",
  "-g3",
  "-D_DEBUG",
  "-Wall",
  "-Wextra",
  "-Werror",
  "-pedantic",
  "-pipe",
  "-Wshadow",
  "-Wconversion",
  "-Wfloat-equal",
  "-Wcast-align",
  "-Wcast-qual",
  "-Wwrite-strings",
  "-Wswitch-default",
  "-Wswitch-enum",
  "-finput-charset=UTF-8",
  "-fexec-charset=UTF-8",
];

function compile(workDirectory, sourceName, outputName, extraArgs = [], standard) {
  const cpp = /\.(?:cpp|cc|cxx)$/i.test(sourceName);
  const driver = cpp ? "clang++" : "clang";
  const commonArgs = [
    "run",
    "--volume",
    guestVolume(workDirectory),
    "-e",
    driver,
    webcPath,
    "--",
  ];
  const compilerArgs = [
    `-std=${standard ?? (cpp ? "c++23" : "c23")}`,
    "-x",
    cpp ? "c++" : "c",
    ...defaultCompilerFlags,
    ...(cpp ? ["-fno-exceptions"] : []),
    ...extraArgs,
    `/workspace/${sourceName}`,
    "-lm",
    "-o",
    `/workspace/${outputName}`,
  ];

  const planResult = runWasmer([...commonArgs, "-###", ...compilerArgs], {
    allowFailure: true,
  });
  const planOutput = `${planResult.stdout}${planResult.stderr}`;
  if (planResult.status !== 0) {
    return { result: planResult, planOutput };
  }

  const commands = parseCommandPlan(planOutput);
  let lastResult = planResult;
  for (const [executable, ...args] of commands) {
    const entrypoint = entrypointFor(executable);
    lastResult = runWasmer(
      [
        "run",
        "--volume",
        guestVolume(workDirectory),
        "-e",
        entrypoint,
        webcPath,
        "--",
        ...args,
      ],
      { allowFailure: true },
    );
    if (lastResult.status !== 0) break;
  }
  return { result: lastResult, planOutput, commands };
}

const interactiveRuntimeFlags = [
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
];

const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mainly-c-clang22-test-"));
try {
  for (const fixture of [
    "c23-smoke.c",
    "c23-library.c",
    "interactive.c",
    "diagnostic-error.c",
    "language-standard.cpp",
    "filesystem-smoke.cpp",
    "print-smoke.cpp",
    "virtual-files.c",
  ]) {
    fs.copyFileSync(path.join(scriptDirectory, fixture), path.join(workDirectory, fixture));
  }
  fs.copyFileSync(
    path.join(repositoryRoot, "examples", "number-lab.c"),
    path.join(workDirectory, "number-lab.c"),
  );

  const version = runWasmer(["run", "-e", "clang", webcPath, "--", "--version"]);
  if (!version.stdout.includes("clang version 22.1.0")) {
    throw new Error(`Unexpected compiler version:\n${version.stdout}${version.stderr}`);
  }

  const c23 = compile(workDirectory, "c23-smoke.c", "c23-smoke.wasm");
  if (c23.result.status !== 0) {
    throw new Error(`C23 compilation failed:\n${c23.result.stdout}${c23.result.stderr}`);
  }
  const c23Run = runWasmer(["run", path.join(workDirectory, "c23-smoke.wasm")]);
  if (c23Run.stdout.trim() !== "C23:42:ok") {
    throw new Error(`Unexpected C23 output: ${JSON.stringify(c23Run.stdout)}`);
  }

  const c23Library = compile(
    workDirectory,
    "c23-library.c",
    "c23-library.wasm",
    interactiveRuntimeFlags,
    "c23",
  );
  if (c23Library.result.status !== 0) {
    throw new Error(
      `WASIX C23 library compilation failed:\n${c23Library.result.stdout}${c23Library.result.stderr}`,
    );
  }
  const c23LibraryRun = runWasmer(["run", path.join(workDirectory, "c23-library.wasm")]);
  if (c23LibraryRun.stdout.trim() !== "C23-lib:42:ok") {
    throw new Error(`Unexpected WASIX C23 library output: ${JSON.stringify(c23LibraryRun.stdout)}`);
  }

  const virtualFiles = compile(
    workDirectory,
    "virtual-files.c",
    "virtual-files.wasm",
    interactiveRuntimeFlags,
    "c23",
  );
  if (virtualFiles.result.status !== 0) {
    throw new Error(
      `Virtual filesystem fixture compilation failed:\n${virtualFiles.result.stdout}${virtualFiles.result.stderr}`,
    );
  }

  const cpp23 = compile(
    workDirectory,
    "language-standard.cpp",
    "language-standard.wasm",
    interactiveRuntimeFlags,
    "c++23",
  );
  if (cpp23.result.status !== 0) {
    throw new Error(`C++23 compilation failed:\n${cpp23.result.stdout}${cpp23.result.stderr}`);
  }
  const cpp23Run = runWasmer(["run", path.join(workDirectory, "language-standard.wasm")]);
  if (cpp23Run.stdout.trim() !== "202302") {
    throw new Error(`Unexpected C++23 output: ${JSON.stringify(cpp23Run.stdout)}`);
  }

  const print = compile(
    workDirectory,
    "print-smoke.cpp",
    "print-smoke.wasm",
    interactiveRuntimeFlags,
    "c++23",
  );
  if (print.result.status !== 0) {
    throw new Error(`std::println compilation failed:\n${print.result.stdout}${print.result.stderr}`);
  }
  const printRun = runWasmer(["run", path.join(workDirectory, "print-smoke.wasm")]);
  if (printRun.stdout.trim() !== "Hello, C++!") {
    throw new Error(`Unexpected std::println output: ${JSON.stringify(printRun.stdout)}`);
  }

  const filesystem = compile(
    workDirectory,
    "filesystem-smoke.cpp",
    "filesystem-smoke.wasm",
    interactiveRuntimeFlags,
    "c++17",
  );
  if (filesystem.result.status !== 0) {
    throw new Error(
      `std::filesystem compilation failed:\n${filesystem.result.stdout}${filesystem.result.stderr}`,
    );
  }
  const filesystemRun = runWasmer(["run", path.join(workDirectory, "filesystem-smoke.wasm")]);
  if (filesystemRun.stdout.trim() !== "fstream=created by C++,filesystem=ok,space=unsupported") {
    throw new Error(`Unexpected std::filesystem output: ${JSON.stringify(filesystemRun.stdout)}`);
  }

  const interactive = compile(
    workDirectory,
    "interactive.c",
    "interactive.wasm",
    interactiveRuntimeFlags,
  );
  if (interactive.result.status !== 0) {
    throw new Error(
      `Interactive fixture compilation failed:\n${interactive.result.stdout}${interactive.result.stderr}`,
    );
  }
  const interactiveRun = runWasmer(
    ["run", path.join(workDirectory, "interactive.wasm")],
    { input: "Ada\n" },
  );
  if (!interactiveRun.stdout.includes("name> hello, Ada")) {
    throw new Error(`Unexpected interactive output: ${JSON.stringify(interactiveRun.stdout)}`);
  }

  const numberLab = compile(
    workDirectory,
    "number-lab.c",
    "number-lab.wasm",
    interactiveRuntimeFlags,
  );
  if (numberLab.result.status !== 0) {
    throw new Error(
      `Number Lab compilation failed:\n${numberLab.result.stdout}${numberLab.result.stderr}`,
    );
  }
  const numberLabRun = runWasmer(
    ["run", path.join(workDirectory, "number-lab.wasm")],
    { input: "12 7 3 19 7 -4 11 2 8 6\n7\n" },
  );
  for (const expected of [
    "排序结果: -4, 2, 3, 6, 7, 7, 8, 11, 12, 19",
    "平均值: 7.100",
    "总体标准差: 5.907",
    "排序后下标为 4",
  ]) {
    if (!numberLabRun.stdout.includes(expected)) {
      throw new Error(`Number Lab output lacks ${JSON.stringify(expected)}:\n${numberLabRun.stdout}`);
    }
  }

  const diagnostic = compile(
    workDirectory,
    "diagnostic-error.c",
    "diagnostic-error.wasm",
  );
  if (diagnostic.result.status === 0) {
    throw new Error("The invalid diagnostic fixture unexpectedly compiled");
  }
  const diagnosticOutput = `${diagnostic.result.stdout}${diagnostic.result.stderr}`;
  const plainDiagnosticOutput = diagnosticOutput.replace(ansiEscape, "");
  if (!/\/workspace\/diagnostic-error\.c:4:\d+: error:/.test(plainDiagnosticOutput)) {
    throw new Error(`Diagnostic did not include file, line, and column:\n${diagnosticOutput}`);
  }

  console.log(
    JSON.stringify(
      {
        compiler: version.stdout.split(/\r?\n/, 1)[0],
        c23: c23Run.stdout.trim(),
        c23Library: c23LibraryRun.stdout.trim(),
        cpp23: cpp23Run.stdout.trim(),
        print: printRun.stdout.trim(),
        filesystem: filesystemRun.stdout.trim(),
        interactive: interactiveRun.stdout.trim(),
        numberLab: "strict compile and interactive output passed",
        diagnostic: plainDiagnosticOutput.split(/\r?\n/).find((line) => line.includes(" error:")),
      },
      null,
      2,
    ),
  );
} finally {
  const resolvedTemp = path.resolve(os.tmpdir());
  const resolvedWork = path.resolve(workDirectory);
  if (!resolvedWork.startsWith(`${resolvedTemp}${path.sep}`)) {
    throw new Error(`Refusing to remove non-temporary test directory: ${resolvedWork}`);
  }
  if (process.env.KEEP_CLANG_TEST_OUTPUT === "1") {
    console.error(`[wasmer-cli-adapter] kept test output: ${resolvedWork}`);
  } else {
    fs.rmSync(resolvedWork, { recursive: true, force: true });
  }
}
