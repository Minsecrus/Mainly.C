import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const sdkRoot = path.join(repositoryRoot, "node_modules", "@wasmer", "sdk", "dist");
const compilerRoot = path.join(repositoryRoot, ".cache", "browser-adapter", "compiler");
const typescriptPath = path.join(repositoryRoot, "node_modules", "typescript", "bin", "tsc");
const sdkWorkerPath = fs.existsSync(path.join(sdkRoot, "worker.mjs"))
  ? path.join(sdkRoot, "worker.mjs")
  : path.join(sdkRoot, "index.mjs");
const webcPath = process.env.CLANG_WEBC || path.join(
  repositoryRoot,
  "dist",
  "mainly-c-clang-22.1.0-4.webc",
);
const chromePath =
  process.env.CHROME_PATH ||
  path.join(process.env.ProgramFiles || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe");

const compileAdapter = spawnSync(
  process.execPath,
  [typescriptPath, "--project", path.join(repositoryRoot, "tsconfig.browser-smoke.json")],
  { cwd: repositoryRoot, encoding: "utf8", timeout: 30_000 },
);
if (compileAdapter.error) throw compileAdapter.error;
if (compileAdapter.status !== 0) {
  throw new Error(`Unable to build the browser Compiler Adapter:\n${compileAdapter.stdout}${compileAdapter.stderr}`);
}

const routes = new Map([
  ["/probe.mjs", path.join(scriptDirectory, "browser-probe.mjs")],
  ["/sdk/index.mjs", path.join(sdkRoot, "index.mjs")],
  ["/sdk/worker.mjs", sdkWorkerPath],
  ["/sdk/wasmer_js_bg.wasm", path.join(sdkRoot, "wasmer_js_bg.wasm")],
  ["/compiler/ClangCompilerAdapter.js", path.join(compilerRoot, "ClangCompilerAdapter.js")],
  ["/compiler/InteractiveTerminalSession.js", path.join(compilerRoot, "InteractiveTerminalSession.js")],
  ["/compiler/diagnostics.js", path.join(compilerRoot, "diagnostics.js")],
  ["/compiler/index.js", path.join(compilerRoot, "index.js")],
  ["/compiler/runtimeProtocol.js", path.join(compilerRoot, "runtimeProtocol.js")],
  ["/compiler/types.js", path.join(compilerRoot, "types.js")],
  ["/compiler/virtualFilesystem.js", path.join(compilerRoot, "virtualFilesystem.js")],
  ["/languages.js", path.join(repositoryRoot, ".cache", "browser-adapter", "languages.js")],
  ["/clang.webc", webcPath],
  ["/fixtures/c23-smoke.c", path.join(scriptDirectory, "c23-smoke.c")],
  ["/fixtures/c23-library.c", path.join(scriptDirectory, "c23-library.c")],
  ["/fixtures/language-standard.c", path.join(scriptDirectory, "language-standard.c")],
  ["/fixtures/language-standard.cpp", path.join(scriptDirectory, "language-standard.cpp")],
  ["/fixtures/filesystem-smoke.cpp", path.join(scriptDirectory, "filesystem-smoke.cpp")],
  ["/fixtures/print-smoke.cpp", path.join(scriptDirectory, "print-smoke.cpp")],
  ["/fixtures/interactive.c", path.join(scriptDirectory, "interactive.c")],
  ["/fixtures/run-configuration.c", path.join(scriptDirectory, "run-configuration.c")],
  ["/fixtures/diagnostic-error.c", path.join(scriptDirectory, "diagnostic-error.c")],
  ["/fixtures/virtual-files.c", path.join(scriptDirectory, "virtual-files.c")],
]);

for (const requiredPath of [chromePath, ...routes.values()]) {
  if (!fs.existsSync(requiredPath)) {
    throw new Error(`Browser smoke-test dependency is missing: ${requiredPath}`);
  }
}

function contentType(filePath) {
  if (filePath.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".wasm")) return "application/wasm";
  if (filePath.endsWith(".c") || filePath.endsWith(".cpp")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

const server = http.createServer((request, response) => {
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Cache-Control", "no-store");

  const pathname = new URL(request.url || "/", "http://localhost").pathname;

  if (pathname === "/") {
    const html =
      '<!doctype html><meta charset="utf-8"><title>LOADING</title>' +
      '<script type="importmap">{"imports":{"@wasmer/sdk":"/sdk/index.mjs"}}</script>' +
      '<pre id="result">starting</pre><script type="module" src="/probe.mjs"></script>';
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": Buffer.byteLength(html),
    });
    response.end(html);
    return;
  }

  if (pathname === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }

  const filePath = routes.get(pathname);
  if (!filePath) {
    console.error(`[server:404] ${request.method} ${request.url}`);
    response.writeHead(404);
    response.end("not found");
    return;
  }

  const stat = fs.statSync(filePath);
  response.writeHead(200, {
    "Content-Type": contentType(filePath),
    "Content-Length": stat.size,
  });
  fs.createReadStream(filePath).pipe(response);
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("Unable to determine browser smoke-test server address");
}

let browser;
const testStartedAt = Date.now();
try {
  browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: ["--disable-gpu", "--no-first-run"],
  });
  const requestedScope = process.env.BROWSER_SCOPE;
  const scopes = requestedScope && requestedScope !== "all"
    ? [requestedScope]
    : ["c23", "cpp", "runtime"];
  for (const scope of scopes) {
    const scopeStartedAt = Date.now();
    const page = await browser.newPage();
    page.on("console", (message) =>
      console.log(`[browser:${scope}:${message.type()}] ${message.text()}`),
    );
    page.on("pageerror", (error) =>
      console.error(`[browser:${scope}:error] ${error.stack || error}`),
    );
    try {
      const testUrl = `http://127.0.0.1:${address.port}/?scope=${encodeURIComponent(scope)}`;
      await page.goto(testUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      try {
        await page.waitForFunction(
          () => document.title === "PASS" || document.title === "FAIL",
          undefined,
          { timeout: 60_000 },
        );
      } catch (error) {
        const title = await page.title();
        const resultText = await page
          .locator("#result")
          .textContent({ timeout: 1_000 })
          .catch(() => "result element unavailable");
        throw new Error(
          `Browser smoke test scope ${scope} timed out in ${title}:\n${resultText}\n${error}`,
        );
      }

      const title = await page.title();
      const resultText = await page.locator("#result").textContent();
      if (title !== "PASS") {
        throw new Error(`Browser smoke test scope ${scope} failed:\n${resultText}`);
      }
      console.log(`[browser:${scope}] completed in ${Date.now() - scopeStartedAt}ms`);
      console.log(resultText);
    } finally {
      await page.close();
    }
  }
  console.log(`[browser] all scopes completed in ${Date.now() - testStartedAt}ms`);
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
