import { Runtime, init } from "/sdk/index.mjs";
import { ClangCompilerAdapter } from "/compiler/index.js";

const resultElement = document.querySelector("#result");
const timings = [];

function show(status, value) {
  document.title = status;
  resultElement.textContent = JSON.stringify(value, null, 2);
  console.log(status, value.phase || value.message || "done");
}

function log(event) {
  const { source, event: name, args, ...details } = event;
  const summary = args ? { ...details, argumentCount: args.length } : details;
  const suffix = Object.keys(summary).length > 0 ? ` ${JSON.stringify(summary)}` : "";
  console.log(`[${source}] ${name}${suffix}`);
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to fetch ${url}: ${response.status}`);
  return response.text();
}

async function timed(phase, operation) {
  const startedAt = performance.now();
  show("LOADING", { phase, timings });
  const value = await operation();
  timings.push({ phase, elapsedMs: Math.round(performance.now() - startedAt) });
  return value;
}

async function main() {
  await timed("sdk", () =>
    init({
      module: new URL("/sdk/wasmer_js_bg.wasm", location.origin),
      workerUrl: new URL("/sdk/worker.mjs", location.origin),
      sdkUrl: new URL("/sdk/index.mjs", location.origin),
    }),
  );
  const runtime = new Runtime({ registry: null });

  const [
    webcResponse,
    c23Source,
    c23LibrarySource,
    cStandardSource,
    cppStandardSource,
    filesystemSource,
    printSource,
    interactiveSource,
    runConfigurationSource,
    diagnosticSource,
    virtualFilesSource,
  ] =
    await timed("fixtures", () =>
      Promise.all([
        fetch("/clang.webc"),
        fetchText("/fixtures/c23-smoke.c"),
        fetchText("/fixtures/c23-library.c"),
        fetchText("/fixtures/language-standard.c"),
        fetchText("/fixtures/language-standard.cpp"),
        fetchText("/fixtures/filesystem-smoke.cpp"),
        fetchText("/fixtures/print-smoke.cpp"),
        fetchText("/fixtures/interactive.c"),
        fetchText("/fixtures/run-configuration.c"),
        fetchText("/fixtures/diagnostic-error.c"),
        fetchText("/fixtures/virtual-files.c"),
      ]),
    );
  if (!webcResponse.ok) throw new Error(`Unable to fetch WebC: ${webcResponse.status}`);

  const adapter = await timed("toolchain", async () =>
    ClangCompilerAdapter.fromWebc(
      new Uint8Array(await webcResponse.arrayBuffer()),
      { runtime, log, commandTimeoutMs: 60_000 },
    ),
  );

  const scope = new URLSearchParams(location.search).get("scope");
  const shouldRunC = scope !== "cpp" && scope !== "runtime";
  const shouldRunCpp = scope !== "c23" && scope !== "runtime";
  const standardResults = {};
  let compiler;
  let c23Output;
  let c23LibraryOutput;
  if (shouldRunC) {
    for (const [standard, expected] of [
      ["c99", "199901"],
      ["c11", "201112"],
    ]) {
      const result = await timed(`${standard}:compile`, () =>
        adapter.compile({ fileName: "language-standard.c", source: cStandardSource, standard }),
      );
      if (!result.ok || !result.wasm) {
        throw new Error(`${standard} compilation failed:\n${result.stdout}${result.stderr}`);
      }
      const output = await timed(`${standard}:run`, () => adapter.runBatch(result.wasm));
      if (!output.ok || output.stdout.trim() !== expected) {
        throw new Error(`Unexpected ${standard} output: ${JSON.stringify(output)}`);
      }
      standardResults[standard] = output.stdout.trim();
    }

    const c23 = await timed("c23:compile", () =>
      adapter.compile({ fileName: "c23-smoke.c", source: c23Source }),
    );
    if (!c23.ok || !c23.wasm) {
      throw new Error(`C23 compilation failed:\n${c23.stdout}${c23.stderr}`);
    }
    compiler = c23.planOutput
      .split(/\r?\n/)
      .find((line) => line.startsWith("clang version "));
    if (!compiler?.includes("clang version 22.1.0")) {
      throw new Error(`Unexpected compiler version:\n${c23.planOutput}`);
    }
    c23Output = await timed("c23:run", () => adapter.runBatch(c23.wasm));
    if (!c23Output.ok || c23Output.stdout.trim() !== "C23:42:ok") {
      throw new Error(`Unexpected C23 output: ${JSON.stringify(c23Output)}`);
    }

    const c23Library = await timed("c23-library:compile", () =>
      adapter.compile({
        fileName: "c23-library.c",
        source: c23LibrarySource,
        standard: "c23",
        interactive: true,
      }),
    );
    if (!c23Library.ok || !c23Library.wasm) {
      throw new Error(`WASIX C23 library compilation failed:\n${c23Library.stdout}${c23Library.stderr}`);
    }
    c23LibraryOutput = await timed("c23-library:run", () =>
      adapter.runBatch(c23Library.wasm),
    );
    if (!c23LibraryOutput.ok || c23LibraryOutput.stdout.trim() !== "C23-lib:42:ok") {
      throw new Error(`Unexpected WASIX C23 library output: ${JSON.stringify(c23LibraryOutput)}`);
    }
  }

  if (scope === "c23") {
    show("PASS", {
      compiler,
      c23: c23Output.stdout.trim(),
      c23Library: c23LibraryOutput.stdout.trim(),
      timings,
    });
    return;
  }

  let printOutput;
  let filesystemOutput;
  if (shouldRunCpp) {
    for (const [standard, expected] of [
      ["c++11", "201103"],
      ["c++14", "201402"],
      ["c++17", "201703"],
      ["c++20", "202002"],
      ["c++23", "202302"],
      ["c++26", "202400"],
    ]) {
      const result = await timed(`${standard}:compile`, () =>
        adapter.compile({
          fileName: "language-standard.cpp",
          source: cppStandardSource,
          standard,
          interactive: true,
        }),
      );
      if (!result.ok || !result.wasm) {
        throw new Error(`${standard} compilation failed:\n${result.stdout}${result.stderr}`);
      }
      const output = await timed(`${standard}:run`, () => adapter.runBatch(result.wasm));
      if (!output.ok || output.stdout.trim() !== expected) {
        throw new Error(`Unexpected ${standard} output: ${JSON.stringify(output)}`);
      }
      standardResults[standard] = output.stdout.trim();
    }

    const print = await timed("print:compile", () =>
      adapter.compile({
        fileName: "print-smoke.cpp",
        source: printSource,
        standard: "c++23",
        interactive: true,
      }),
    );
    if (!print.ok || !print.wasm) {
      throw new Error(`std::println compilation failed:\n${print.stdout}${print.stderr}`);
    }
    printOutput = await timed("print:run", () => adapter.runBatch(print.wasm));
    if (!printOutput.ok || printOutput.stdout.trim() !== "Hello, C++!") {
      throw new Error(`Unexpected std::println output: ${JSON.stringify(printOutput)}`);
    }

    const filesystem = await timed("filesystem:compile", () =>
      adapter.compile({
        fileName: "filesystem-smoke.cpp",
        source: filesystemSource,
        standard: "c++17",
        interactive: true,
      }),
    );
    if (!filesystem.ok || !filesystem.wasm) {
      throw new Error(
        `std::filesystem compilation failed:\n${filesystem.stdout}${filesystem.stderr}`,
      );
    }
    filesystemOutput = await timed("filesystem:run", () => adapter.runBatch(filesystem.wasm));
    if (
      !filesystemOutput.ok ||
      filesystemOutput.stdout.trim() !==
        "fstream=created by C++,filesystem=ok,space=unsupported" ||
      filesystemOutput.virtualFiles["created.txt"] !== "created by C++\n"
    ) {
      throw new Error(`Unexpected std::filesystem output: ${JSON.stringify(filesystemOutput)}`);
    }
  }

  if (scope === "cpp") {
    show("PASS", {
      standards: standardResults,
      print: printOutput.stdout.trim(),
      filesystem: filesystemOutput.stdout.trim(),
      timings,
    });
    return;
  }

  const virtualFiles = await timed("virtual-files:compile", () =>
    adapter.compile({
      fileName: "virtual-files.c",
      source: virtualFilesSource,
      interactive: true,
    }),
  );
  if (!virtualFiles.ok || !virtualFiles.wasm) {
    throw new Error(`Virtual filesystem compilation failed:\n${virtualFiles.stdout}${virtualFiles.stderr}`);
  }
  const virtualFilesOutput = await timed("virtual-files:run", () =>
    adapter.runBatch(virtualFiles.wasm, {
      virtualFiles: { "seed.txt": "hello from the sandbox\n" },
    }),
  );
  if (
    !virtualFilesOutput.ok ||
    virtualFilesOutput.stdout !== "copied:hello from the sandbox\n" ||
    virtualFilesOutput.virtualFiles["created.txt"] !== "copied:hello from the sandbox\n"
  ) {
    throw new Error(`Unexpected virtual filesystem output: ${JSON.stringify(virtualFilesOutput)}`);
  }

  const interactive = await timed("interactive:compile", () =>
    adapter.compile({
      fileName: "interactive.c",
      source: interactiveSource,
      interactive: true,
    }),
  );
  if (!interactive.ok || !interactive.wasm) {
    throw new Error(`Interactive compilation failed:\n${interactive.stdout}${interactive.stderr}`);
  }

  const interactiveOutput = await timed("interactive:run", () =>
    adapter.runBatch(interactive.wasm, { stdin: "Ada\r" }),
  );
  if (!interactiveOutput.ok || !interactiveOutput.stdout.includes("hello, Ada")) {
    throw new Error(`Unexpected interactive output: ${JSON.stringify(interactiveOutput)}`);
  }

  const runConfiguration = await timed("run-configuration:compile", () =>
    adapter.compile({
      fileName: "run-configuration.c",
      source: runConfigurationSource,
      interactive: true,
    }),
  );
  if (!runConfiguration.ok || !runConfiguration.wasm) {
    throw new Error(
      `Run configuration compilation failed:\n${runConfiguration.stdout}${runConfiguration.stderr}`,
    );
  }
  const runConfigurationOutput = await timed("run-configuration:run", () =>
    adapter.runBatch(runConfiguration.wasm, {
      args: ["alpha", "two words"],
      stdin: "Ada\n",
    }),
  );
  if (
    !runConfigurationOutput.ok ||
    runConfigurationOutput.stdout !== "argv=alpha|two words\nstdin=Ada\n"
  ) {
    throw new Error(
      `Unexpected run configuration output: ${JSON.stringify(runConfigurationOutput)}`,
    );
  }

  const diagnostic = await timed("diagnostic", () =>
    adapter.compile({ fileName: "diagnostic-error.c", source: diagnosticSource }),
  );
  if (diagnostic.ok) throw new Error("The invalid diagnostic fixture unexpectedly compiled");
  const error = diagnostic.diagnostics.find(
    (item) => item.fileName === "diagnostic-error.c" && item.severity === "error",
  );
  if (!error || error.line !== 4 || error.column < 1) {
    throw new Error(`Diagnostic lacked a mapped file, line, and column:\n${diagnostic.stderr}`);
  }

  if (scope === "runtime") {
    show("PASS", {
      virtualFilesystem: virtualFilesOutput.stdout.trim(),
      interactive: interactiveOutput.stdout.trim(),
      runConfiguration: runConfigurationOutput.stdout.trim(),
      diagnostic: `${error.fileName}:${error.line}:${error.column}: error: ${error.message}`,
      timings,
    });
    return;
  }

  show("PASS", {
    compiler,
    c23: c23Output.stdout.trim(),
    c23Library: c23LibraryOutput.stdout.trim(),
    standards: standardResults,
    print: printOutput.stdout.trim(),
    filesystem: filesystemOutput.stdout.trim(),
    virtualFilesystem: virtualFilesOutput.stdout.trim(),
    interactive: interactiveOutput.stdout.trim(),
    runConfiguration: runConfigurationOutput.stdout.trim(),
    diagnostic: `${error.fileName}:${error.line}:${error.column}: error: ${error.message}`,
    timings,
  });
}

main().catch((error) => {
  console.error(error);
  show("FAIL", {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    timings,
  });
});
