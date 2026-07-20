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

  const [webcResponse, c23Source, interactiveSource, diagnosticSource] =
    await timed("fixtures", () =>
      Promise.all([
        fetch("/clang.webc"),
        fetchText("/fixtures/c23-smoke.c"),
        fetchText("/fixtures/interactive.c"),
        fetchText("/fixtures/diagnostic-error.c"),
      ]),
    );
  if (!webcResponse.ok) throw new Error(`Unable to fetch WebC: ${webcResponse.status}`);

  const adapter = await timed("toolchain", async () =>
    ClangCompilerAdapter.fromWebc(
      new Uint8Array(await webcResponse.arrayBuffer()),
      { runtime, log, commandTimeoutMs: 60_000 },
    ),
  );

  const c23 = await timed("c23:compile", () =>
    adapter.compile({ fileName: "c23-smoke.c", source: c23Source }),
  );
  if (!c23.ok || !c23.wasm) {
    throw new Error(`C23 compilation failed:\n${c23.stdout}${c23.stderr}`);
  }
  const compiler = c23.planOutput
    .split(/\r?\n/)
    .find((line) => line.startsWith("clang version "));
  if (!compiler?.includes("clang version 22.1.0")) {
    throw new Error(`Unexpected compiler version:\n${c23.planOutput}`);
  }
  const c23Output = await timed("c23:run", () => adapter.runBatch(c23.wasm));
  if (!c23Output.ok || c23Output.stdout.trim() !== "C23:42:ok") {
    throw new Error(`Unexpected C23 output: ${JSON.stringify(c23Output)}`);
  }

  if (new URLSearchParams(location.search).get("scope") === "c23") {
    show("PASS", { compiler, c23: c23Output.stdout.trim(), timings });
    return;
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

  const terminal = await timed("interactive:start", () =>
    adapter.startInteractive(interactive.wasm, { log }),
  );
  await terminal.waitForOutput("name> ");
  for (const key of ["A", "d", "a", "\r"]) await terminal.write(key);
  await terminal.waitForOutput("hello, Ada");
  const interactiveOutput = await timed("interactive:finish", () => terminal.finish());
  if (!interactiveOutput.ok || !interactiveOutput.stdout.includes("hello, Ada")) {
    throw new Error(`Unexpected interactive output: ${JSON.stringify(interactiveOutput)}`);
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

  show("PASS", {
    compiler,
    c23: c23Output.stdout.trim(),
    interactive: interactiveOutput.stdout.trim(),
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
