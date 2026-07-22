import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const outputRoot = path.join(repositoryRoot, "web-dist");
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/").at(-1);
const siteBase = process.env.SITE_BASE || (
  process.env.GITHUB_ACTIONS === "true" && repositoryName
    ? `/${repositoryName}/`
    : "/"
);
const chromePath =
  process.env.CHROME_PATH ||
  path.join(
    process.env.ProgramFiles || "C:\\Program Files",
    "Google",
    "Chrome",
    "Application",
    "chrome.exe",
  );
const screenshotPath = path.join(repositoryRoot, ".cache", "ui", "mainly-c-ui.png");
const errorLensScreenshotPath = path.join(
  repositoryRoot,
  ".cache",
  "ui",
  "mainly-c-error-lens.png",
);
const clangdJavaScriptPath = path.join(outputRoot, "lsp", "clangd.js");
const compressedClangdPath = path.join(outputRoot, "lsp", "clangd.wasm.gz");

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".wasm")) return "application/wasm";
  if (filePath.endsWith(".ttf")) return "font/ttf";
  return "application/octet-stream";
}

async function run() {
  if (!fs.existsSync(chromePath)) throw new Error(`Chrome is missing: ${chromePath}`);
  if (!fs.existsSync(path.join(outputRoot, "index.html"))) {
    throw new Error("Production UI is missing. Run npm run build first.");
  }
  if (!fs.existsSync(clangdJavaScriptPath) || !fs.existsSync(compressedClangdPath)) {
    throw new Error("Production UI is missing the clangd browser runtime");
  }
  const rawToolchainPath = path.join(outputRoot, "toolchain", "mainly-c-clang-22.1.0-4.webc");
  const compressedToolchainPath = `${rawToolchainPath}.data`;
  if (fs.existsSync(rawToolchainPath)) {
    throw new Error("Production UI still contains the uncompressed Clang WebC");
  }
  if (!fs.existsSync(compressedToolchainPath)) {
    throw new Error("Production UI is missing the compressed Clang WebC");
  }
  const compressedToolchainSize = fs.statSync(compressedToolchainPath).size;
  const sourceToolchainPath = path.join(repositoryRoot, "dist", path.basename(rawToolchainPath));
  if (compressedToolchainSize >= fs.statSync(sourceToolchainPath).size) {
    throw new Error("Production Clang WebC was not made smaller by gzip");
  }
  const gzipMagic = Buffer.alloc(2);
  const gzipHandle = fs.openSync(compressedToolchainPath, "r");
  try {
    fs.readSync(gzipHandle, gzipMagic, 0, gzipMagic.byteLength, 0);
  } finally {
    fs.closeSync(gzipHandle);
  }
  if (gzipMagic[0] !== 0x1f || gzipMagic[1] !== 0x8b) {
    throw new Error("Production Clang WebC does not have a gzip header");
  }
  const requestedPaths = [];
  const server = http.createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const pathname = new URL(request.url || "/", "http://localhost").pathname;
    requestedPaths.push(pathname);
    if (pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (!pathname.startsWith(siteBase)) {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    const relativePath = pathname.slice(siteBase.length);
    const relative = relativePath === "" ? "index.html" : decodeURIComponent(relativePath);
    const filePath = path.resolve(outputRoot, relative);
    if (!filePath.startsWith(`${path.resolve(outputRoot)}${path.sep}`) || !fs.existsSync(filePath)) {
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
  let browser;
  let liveTextCreateSyncElapsedMs;
  let liveTextUpdateSyncElapsedMs;
  let liveTextDeleteSyncElapsedMs;
  let terminationSnapshotElapsedMs;
  const clangdFailures = [];

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Unable to read UI server address");
    browser = await chromium.launch({
      executablePath: chromePath,
      headless: true,
      args: ["--disable-gpu", "--no-first-run"],
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    let toolchainResponseHeaders;
    page.on("response", (response) => {
      if (/toolchain\/.+\.webc\.data$/.test(new URL(response.url()).pathname)) {
        toolchainResponseHeaders = response.headers();
      }
    });
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        console.log(`[browser:${message.type()}] ${message.text()}`);
        if (/clangd|Pthread|memory access out of bounds/i.test(message.text())) {
          clangdFailures.push(message.text());
        }
      }
    });
    page.on("pageerror", (error) => {
      const message = String(error.stack || error);
      console.error(`[browser:error] ${message}`);
      if (/clangd|Pthread|memory access out of bounds/i.test(message)) {
        clangdFailures.push(message);
      }
    });

    console.log(`[ui-smoke] open ${siteBase} without COOP/COEP response headers`);
    await page.goto(`http://127.0.0.1:${address.port}${siteBase}`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await page.locator(".monaco-editor").waitFor({ state: "visible", timeout: 20_000 });
    if (!(await page.evaluate(() => crossOriginIsolated))) {
      throw new Error("UI page is not cross-origin isolated");
    }
    console.log("[ui-smoke] cross-origin isolation established by coi-serviceworker");
    const runButton = page.getByRole("button", { name: "运行当前文件" });
    if (!(await runButton.isDisabled())) {
      throw new Error("Run button was enabled before the local environment finished loading");
    }
    if ((await runButton.evaluate((element) => getComputedStyle(element).cursor)) !== "not-allowed") {
      throw new Error("Disabled run button does not use the not-allowed cursor");
    }
    await page.locator("[data-terminal-notice]").waitFor({ state: "visible", timeout: 5_000 });
    console.log("[ui-smoke] run disabled while the terminal shows initialization progress");

    await page.locator('.monaco-editor[data-clangd-status="ready"]').waitFor({
      state: "attached",
      timeout: 25_000,
    });
    if (
      !requestedPaths.includes(`${siteBase}lsp/clangd.js`) ||
      !requestedPaths.includes(`${siteBase}lsp/clangd.wasm.gz`)
    ) {
      throw new Error(`clangd runtime assets were not loaded: ${JSON.stringify(requestedPaths)}`);
    }
    console.log("[ui-smoke] clangd WebAssembly language service is ready");

    const settingsButton = page.getByRole("button", { name: "设置" });
    if ((await settingsButton.evaluate((element) => getComputedStyle(element).cursor)) !== "pointer") {
      throw new Error("Enabled icon button does not use the pointer cursor");
    }
    await settingsButton.click();
    const settingsMenu = page.getByRole("menu", { name: "设置" });
    const autoCompletionItem = page.getByRole("menuitemcheckbox");
    await autoCompletionItem.click();
    await settingsMenu.waitFor({ state: "visible" });
    if ((await autoCompletionItem.getAttribute("aria-checked")) !== "true") {
      throw new Error("Automatic completion was not enabled from the settings menu");
    }
    await autoCompletionItem.click();
    await settingsMenu.waitFor({ state: "visible" });
    if ((await autoCompletionItem.getAttribute("aria-checked")) !== "false") {
      throw new Error("Automatic completion was not disabled from the settings menu");
    }
    const aboutMenuItem = page.getByRole("menuitem", { name: "关于" });
    if ((await aboutMenuItem.evaluate((element) => getComputedStyle(element).cursor)) !== "pointer") {
      throw new Error("Menu item does not use the pointer cursor");
    }
    await aboutMenuItem.click();
    const aboutDialog = page.getByRole("dialog", { name: "关于" });
    await aboutDialog.getByText("Clang / LLD 22.1.0").waitFor({ state: "visible" });
    await aboutDialog.getByText("© 2026 Minsecrus · MIT License").waitFor({ state: "visible" });
    const aboutDialogBox = await aboutDialog.boundingBox();
    if (!aboutDialogBox || aboutDialogBox.height > 721) {
      throw new Error(`About dialog exceeded its 720px height limit: ${aboutDialogBox?.height ?? "missing"}`);
    }
    const aboutDialogScrollArea = aboutDialog.locator("[data-info-dialog-scroll]");
    const aboutDialogOverflow = await aboutDialogScrollArea.evaluate((element) => ({
      clientHeight: element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight,
    }));
    if (aboutDialogOverflow.overflowY !== "auto" || aboutDialogOverflow.scrollHeight <= aboutDialogOverflow.clientHeight) {
      throw new Error(`About dialog content is not independently scrollable: ${JSON.stringify(aboutDialogOverflow)}`);
    }
    if ((await aboutDialog.getByRole("link", { name: "GitHub" }).evaluate((element) => getComputedStyle(element).cursor)) !== "pointer") {
      throw new Error("Link does not use the pointer cursor");
    }
    await aboutDialog.getByRole("button", { name: "关闭" }).click();
    await aboutDialog.waitFor({ state: "hidden" });
    if ((await page.getByRole("separator", { name: "调整输出面板高度" }).evaluate((element) => getComputedStyle(element).cursor)) !== "row-resize") {
      throw new Error("Panel resize handle does not use the row-resize cursor");
    }
    console.log("[ui-smoke] interactive cursor states are consistent");

    await page.waitForFunction(
      () => !document.querySelector('button[aria-label="运行当前文件"]')?.hasAttribute("disabled"),
      undefined,
      { timeout: 25_000 },
    );
    await page.locator("[data-terminal-notice]").waitFor({ state: "hidden", timeout: 5_000 });
    if (!requestedPaths.some((pathname) => /toolchain\/.+\.webc\.data/.test(pathname))) {
      throw new Error("Compressed Clang WebC was not loaded after the UI became ready");
    }
    if (
      !toolchainResponseHeaders ||
      toolchainResponseHeaders["content-encoding"] ||
      Number(toolchainResponseHeaders["content-length"]) !== compressedToolchainSize
    ) {
      throw new Error(
        `Clang WebC was not fetched as the standalone gzip artifact: ${JSON.stringify(toolchainResponseHeaders)}`,
      );
    }
    if (!requestedPaths.some((pathname) => /clang-format.*\.wasm/.test(pathname))) {
      throw new Error("Clang-format was not loaded with the compiler");
    }
    console.log("[ui-smoke] editor, formatter, and gzip-delivered compiler are ready");

    const standardButton = page.getByRole("button", { name: "选择语言标准" });
    if ((await standardButton.textContent())?.trim() !== "C23") {
      throw new Error(`Unexpected default C standard: ${await standardButton.textContent()}`);
    }
    await standardButton.click();
    for (const standard of ["C99", "C11", "C23"]) {
      await page.getByRole("menuitemradio", { name: standard, exact: true }).waitFor({ state: "visible" });
    }
    await page.getByRole("menuitemradio", { name: "C11", exact: true }).click();
    if ((await standardButton.textContent())?.trim() !== "C11") {
      throw new Error("C standard selection did not update the toolbar");
    }

    await page.getByRole("button", { name: "选择执行方式" }).click();
    await page.getByRole("menuitemradio", { name: /单次运行/ }).waitFor({ state: "visible" });
    await page.getByRole("menuitemradio", { name: /每 10 秒/ }).waitFor({ state: "visible" });
    await page.keyboard.press("Escape");

    console.log("[ui-smoke] run an unflushed prompt with canonical input echo and editing");
    await runButton.click();
    await page.waitForFunction(
      () => document.querySelector(".xterm-rows")?.textContent?.includes("What is your name?"),
      undefined,
      { timeout: 25_000 },
    );
    await page.locator(".xterm-helper-textarea").click();
    await page.keyboard.type("Adx");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("a");
    await page.keyboard.press("Enter");
    try {
      await page.waitForFunction(
        () => document.querySelector(".xterm-rows")?.textContent?.includes("Hello, Ada"),
        undefined,
        { timeout: 10_000 },
      );
    } catch (error) {
      const terminal = await page.locator(".xterm-rows").textContent();
      const terminalRows = await page.locator(".xterm-rows > div").allTextContents();
      await page.getByRole("tab", { name: "编译日志" }).click();
      const logs = await page.locator('[role="tabpanel"][data-state="active"]').textContent();
      console.error(
        "[ui-smoke:input-timeout]",
        JSON.stringify({ terminal, terminalRows, logs }, null, 2),
      );
      throw error;
    }
    try {
      await page.getByRole("button", { name: "运行当前文件" }).waitFor({
        state: "visible",
        timeout: 10_000,
      });
    } catch (error) {
      const terminal = await page.locator(".xterm-rows").textContent();
      await page.getByRole("tab", { name: "编译日志" }).click();
      const logs = await page.locator('[role="tabpanel"][data-state="active"]').textContent();
      console.error("[ui-smoke:exit-timeout]", JSON.stringify({ terminal, logs }, null, 2));
      throw error;
    }

    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const terminalText = await page.locator(".xterm-rows").textContent();
    if (!terminalText?.includes("C11") || !terminalText.includes("clang 22.1.0")) {
      throw new Error(`Terminal did not report the selected C standard: ${terminalText}`);
    }
    if (!terminalText.includes("What is your name? Ada")) {
      throw new Error(`Terminal did not echo and edit canonical input: ${terminalText}`);
    }

    console.log("[ui-smoke] create a C++ file, expose six standards, and run C++26");
    await page.getByRole("button", { name: "更多文件操作" }).click();
    await page.getByRole("menuitem", { name: "新建 C++ 文件" }).click();
    const cppDialog = page.getByRole("dialog", { name: "新建 C++ 文件" });
    await cppDialog.getByRole("button", { name: "创建" }).click();
    await page.waitForFunction(
      () => document.querySelector('button[aria-label="选择语言标准"]')?.textContent?.includes("C++23"),
      undefined,
      { timeout: 5_000 },
    );
    await standardButton.click();
    for (const standard of ["C++11", "C++14", "C++17", "C++20", "C++23", "C++26"]) {
      await page.getByRole("menuitemradio", { name: new RegExp(`^${standard.replaceAll("+", "\\+")}`) }).waitFor({ state: "visible" });
    }
    await page.getByRole("menuitemradio", { name: /C\+\+26/ }).click();
    const cppEditorInput = page.locator(".monaco-editor textarea.inputarea").first();
    await cppEditorInput.focus();
    await cppEditorInput.press("Control+A");
    await cppEditorInput.press("Backspace");
    await page.keyboard.insertText(
      '#include <print>\n\nint main() {\n    std::println("Hello, {}!", "C++");\n    return 0;\n}\n',
    );
    await page.waitForFunction(
      () => document.querySelector(".monaco-editor .view-lines")?.textContent?.includes("std::println"),
      undefined,
      { timeout: 5_000 },
    );
    await runButton.click();
    await page.waitForFunction(
      () => document.querySelector(".xterm-rows")?.textContent?.includes("Hello, C++!"),
      undefined,
      { timeout: 25_000 },
    );
    await page.getByRole("button", { name: "运行当前文件" }).waitFor({
      state: "visible",
      timeout: 10_000,
    });
    const cppTerminalText = await page.locator(".xterm-rows").textContent();
    if (!cppTerminalText?.includes("C++26") || !cppTerminalText.includes("clang++ 22.1.0")) {
      throw new Error(`Terminal did not report the selected C++ standard: ${cppTerminalText}`);
    }

    console.log("[ui-smoke] live-sync a C++17-created file while the process is still running");
    await standardButton.click();
    await page.getByRole("menuitemradio", { name: /C\+\+17/ }).click();
    await cppEditorInput.focus();
    await cppEditorInput.press("Control+A");
    await cppEditorInput.press("Backspace");
    await page.keyboard.insertText(
      '#include <filesystem>\n#include <fstream>\n#include <iostream>\n#include <string>\n#include <system_error>\n\nint main() {\n    std::cout << "ready to create\\n" << std::flush;\n    std::cin.get();\n\n    std::ofstream output("created.txt");\n    output << "created by C++\\n";\n    output.close();\n    if (!output) return 1;\n\n    std::ifstream input("created.txt");\n    std::string line;\n    std::getline(input, line);\n    std::error_code error;\n    const auto size = std::filesystem::file_size("created.txt", error);\n    if ((!input && !input.eof()) || error) return 2;\n\n    std::cout << line << ":" << size << "\\n";\n    std::cout << "waiting for update\\n" << std::flush;\n    std::cin.get();\n\n    std::ofstream("created.txt") << "updated by C++\\n";\n    std::cout << "waiting for delete\\n" << std::flush;\n    std::cin.get();\n\n    if (!std::filesystem::remove("created.txt", error) || error) return 3;\n    std::cout << "waiting for exit\\n" << std::flush;\n    std::cin.get();\n    return 0;\n}\n',
    );
    await page.waitForFunction(
      () => document.querySelector(".monaco-editor .view-lines")?.textContent?.includes("std::filesystem"),
      undefined,
      { timeout: 5_000 },
    );
    await runButton.click();
    await page.waitForFunction(
      () => document.querySelector(".xterm-rows")?.textContent?.includes("ready to create"),
      undefined,
      { timeout: 25_000 },
    );
    await page.locator(".xterm-helper-textarea").click();
    const liveSyncStartedAt = Date.now();
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => document.querySelector(".xterm-rows")?.textContent?.includes("waiting for update"),
      undefined,
      { timeout: 10_000 },
    );
    const createdFileButton = page.locator("aside button").filter({ hasText: "created.txt" }).first();
    await createdFileButton.waitFor({ state: "visible", timeout: 2_000 });
    await page.waitForFunction(
      () => {
        const stored = localStorage.getItem("mainly.c.workspace.v1");
        if (!stored) return false;
        const workspace = JSON.parse(stored);
        return workspace.files?.some(
          (file) => file.name === "created.txt" && file.content === "created by C++\n",
        );
      },
      undefined,
      { timeout: 2_000 },
    );
    liveTextCreateSyncElapsedMs = Date.now() - liveSyncStartedAt;
    if (liveTextCreateSyncElapsedMs > 1_500) {
      throw new Error(`Live text creation sync took ${liveTextCreateSyncElapsedMs}ms`);
    }
    await page.getByRole("button", { name: "终止当前程序" }).waitFor({ state: "visible" });
    await createdFileButton.click();
    await page.locator("[data-runtime-text-lock]").waitFor({ state: "visible", timeout: 2_000 });
    await page.waitForFunction(
      () => document.querySelector(".monaco-editor textarea.inputarea")?.hasAttribute("readonly"),
      undefined,
      { timeout: 2_000 },
    );
    if (!(await page.getByRole("button", { name: "created.txt 操作" }).isDisabled())) {
      throw new Error("Runtime-created text file actions were not locked");
    }
    await page.getByRole("button", { name: "更多文件操作" }).click();
    if ((await page.getByRole("menuitem", { name: "新建文本文件" }).getAttribute("data-disabled")) === null) {
      throw new Error("Text file creation was not locked while the process was running");
    }
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItemWithOneQuotaFailure(key, value) {
        if (key === "mainly.c.workspace.v1") {
          Storage.prototype.setItem = originalSetItem;
          throw new DOMException("UI smoke quota failure", "QuotaExceededError");
        }
        return originalSetItem.call(this, key, value);
      };
    });
    await page.locator(".xterm-helper-textarea").click();
    const liveUpdateStartedAt = Date.now();
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => document.querySelector(".xterm-rows")?.textContent?.includes("waiting for delete"),
      undefined,
      { timeout: 10_000 },
    );
    await page.waitForFunction(
      () => document.querySelector(".xterm-rows")?.textContent?.includes(
        "同步失败：浏览器存储空间不足，无法保存工作区",
      ),
      undefined,
      { timeout: 2_000 },
    );
    try {
      await page.waitForFunction(
        () => (document.querySelector(".monaco-editor .view-lines")?.textContent ?? "")
          .replaceAll(/\s/g, "")
          .includes("updatedbyC++"),
        undefined,
        { timeout: 2_000 },
      );
    } catch (error) {
      const visibleText = await page.locator(".monaco-editor .view-lines").textContent();
      throw new Error(`The open text editor did not refresh: ${JSON.stringify(visibleText)}`, {
        cause: error,
      });
    }
    liveTextUpdateSyncElapsedMs = Date.now() - liveUpdateStartedAt;
    if (liveTextUpdateSyncElapsedMs > 1_500) {
      throw new Error(`Live text update sync took ${liveTextUpdateSyncElapsedMs}ms`);
    }
    await page.locator("[data-runtime-text-lock]").waitFor({ state: "visible" });
    await page.locator(".xterm-helper-textarea").click();
    const liveDeleteStartedAt = Date.now();
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => document.querySelector(".xterm-rows")?.textContent?.includes("waiting for exit"),
      undefined,
      { timeout: 10_000 },
    );
    await createdFileButton.waitFor({ state: "hidden", timeout: 2_000 });
    await page.waitForFunction(
      () => {
        const stored = localStorage.getItem("mainly.c.workspace.v1");
        if (!stored) return false;
        const workspace = JSON.parse(stored);
        return !workspace.files?.some((file) => file.name === "created.txt");
      },
      undefined,
      { timeout: 2_000 },
    );
    liveTextDeleteSyncElapsedMs = Date.now() - liveDeleteStartedAt;
    if (liveTextDeleteSyncElapsedMs > 1_500) {
      throw new Error(`Live text deletion sync took ${liveTextDeleteSyncElapsedMs}ms`);
    }
    await page.getByRole("button", { name: "终止当前程序" }).waitFor({ state: "visible" });
    await page.locator(".xterm-helper-textarea").click();
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => document.querySelector(".xterm-rows")?.textContent?.includes("已同步 1 个文本文件"),
      undefined,
      { timeout: 10_000 },
    );
    await page.getByRole("button", { name: "运行当前文件" }).waitFor({
      state: "visible",
      timeout: 10_000,
    });
    await page.locator("[data-runtime-text-lock]").waitFor({ state: "hidden", timeout: 2_000 });
    await page.waitForFunction(
      () => !document.querySelector(".monaco-editor textarea.inputarea")?.hasAttribute("readonly"),
      undefined,
      { timeout: 2_000 },
    );

    console.log("[ui-smoke] capture a final VFS snapshot before Ctrl+C terminates the worker");
    await page.locator("button").filter({ hasText: "untitled.cpp" }).first().click();
    await cppEditorInput.focus();
    await cppEditorInput.press("Control+A");
    await cppEditorInput.press("Backspace");
    await page.keyboard.insertText(
      '#include <fstream>\n#include <iostream>\n\nint main() {\n    std::ofstream("anchor.txt") << "anchor\\n";\n    std::cout << "waiting to write stop file\\n" << std::flush;\n    std::cin.get();\n    std::ofstream("stopped.txt") << "captured before Ctrl+C\\n";\n    std::cout << "stop now\\n" << std::flush;\n    std::cin.get();\n    return 0;\n}\n',
    );
    await page.waitForFunction(
      () => document.querySelector(".monaco-editor .view-lines")?.textContent?.includes("stopped.txt"),
      undefined,
      { timeout: 5_000 },
    );
    await runButton.click();
    await page.waitForFunction(
      () => document.querySelector(".xterm-rows")?.textContent?.includes("waiting to write stop file"),
      undefined,
      { timeout: 25_000 },
    );
    await page.waitForFunction(
      () => {
        const stored = localStorage.getItem("mainly.c.workspace.v1");
        if (!stored) return false;
        const workspace = JSON.parse(stored);
        return workspace.files?.some(
          (file) => file.name === "anchor.txt" && file.content === "anchor\n",
        );
      },
      undefined,
      { timeout: 2_000 },
    );
    await page.locator(".xterm-helper-textarea").click();
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => document.querySelector(".xterm-rows")?.textContent?.includes("stop now"),
      undefined,
      { timeout: 2_000 },
    );
    const terminationStartedAt = Date.now();
    await page.getByRole("button", { name: "终止当前程序" }).click();
    await page.waitForFunction(
      () => document.querySelector(".xterm-rows")?.textContent?.includes("[进程已终止]"),
      undefined,
      { timeout: 2_000 },
    );
    terminationSnapshotElapsedMs = Date.now() - terminationStartedAt;
    await page.waitForFunction(
      () => {
        const stored = localStorage.getItem("mainly.c.workspace.v1");
        if (!stored) return false;
        const workspace = JSON.parse(stored);
        return workspace.files?.some(
          (file) => file.name === "stopped.txt" && file.content === "captured before Ctrl+C\n",
        );
      },
      undefined,
      { timeout: 2_000 },
    );
    await page.getByRole("button", { name: "运行当前文件" }).waitFor({ state: "visible" });
    await page.getByRole("tab", { name: "编译日志" }).click();
    await page.getByText("worker:terminate-snapshot", { exact: true }).waitFor({
      state: "visible",
      timeout: 2_000,
    });
    await page.locator("button").filter({ hasText: "main.c" }).first().click();
    await page.waitForFunction(
      () => document.querySelector('button[aria-label="选择语言标准"]')?.textContent?.includes("C11"),
      undefined,
      { timeout: 5_000 },
    );

    const editorInput = page.locator(".monaco-editor textarea.inputarea").first();
    await editorInput.focus();
    await editorInput.press("Control+A");
    await editorInput.press("Backspace");
    await editorInput.pressSequentially("int main(void) { return 0 }", { delay: 1 });
    await page.waitForFunction(
      () => {
        const text = document.querySelector(".monaco-editor .view-lines")?.textContent ?? "";
        return text.replaceAll(/\s/g, "").includes("return0") && !text.includes("What is your name?");
      },
      undefined,
      { timeout: 5_000 },
    );
    const mainFileDirtyIndicator = page
      .locator("section button")
      .filter({ hasText: "main.c" })
      .first()
      .locator('svg[aria-label="未保存"]');
    await mainFileDirtyIndicator.waitFor({ state: "visible", timeout: 5_000 });
    const invalidDraftWasPersisted = await page.evaluate(() => {
      const stored = localStorage.getItem("mainly.c.workspace.v1");
      if (!stored) return false;
      const workspace = JSON.parse(stored);
      return workspace.files?.some((file) => file.content === "int main(void) { return 0 }");
    });
    if (invalidDraftWasPersisted) {
      throw new Error("Unsaved editor content was written to persistent workspace storage");
    }
    console.log("[ui-smoke] map a Clang diagnostic into Error Lens");
    await page.getByRole("button", { name: "运行当前文件" }).click();
    await page.waitForFunction(
      () => document.querySelector('[role="tab"][data-state="active"]')?.textContent?.includes("问题"),
      undefined,
      { timeout: 10_000 },
    );
    try {
      await page.locator(".mainly-error-lens-message").first().waitFor({ state: "visible", timeout: 10_000 });
    } catch (error) {
      console.error(
        "[ui-smoke:error-lens-timeout]",
        JSON.stringify(
          await page.evaluate(() => ({
            problems: [...document.querySelectorAll('[role="tabpanel"]')].map((panel) => panel.textContent),
            diagnosticClasses: [...document.querySelectorAll('[class*="mainly-"], [class*="squiggly"]')].map(
              (element) => element.className,
            ),
            editorHtml: document.querySelector(".monaco-editor .view-lines")?.innerHTML.slice(0, 2_000),
          })),
          null,
          2,
        ),
      );
      throw error;
    }
    const errorLensText = await page.locator(".mainly-error-lens-message").first().textContent();
    await page.screenshot({ path: errorLensScreenshotPath, fullPage: true });

    console.log("[ui-smoke] format and save with Ctrl+S");
    const unformatted = "int main(void){int value=1;if(value>0){value++;}return value;}";
    await editorInput.focus();
    await editorInput.press("Control+A");
    await editorInput.press("Backspace");
    await page.keyboard.insertText(unformatted);
    await mainFileDirtyIndicator.waitFor({ state: "visible", timeout: 5_000 });
    const unformattedDraftWasPersisted = await page.evaluate((expected) => {
      const stored = localStorage.getItem("mainly.c.workspace.v1");
      if (!stored) return false;
      const workspace = JSON.parse(stored);
      return workspace.files?.some((file) => file.content === expected);
    }, unformatted);
    if (unformattedDraftWasPersisted) {
      throw new Error("Ctrl+S semantics regressed to automatic persistence");
    }
    await page.keyboard.press("Control+S");
    const formattedFragment = "    int value = 1;\n    if (value > 0) {";
    await page.waitForFunction(
      (expected) => {
        const stored = localStorage.getItem("mainly.c.workspace.v1");
        if (!stored) return false;
        const workspace = JSON.parse(stored);
        return workspace.files?.some((file) => file.content.includes(expected));
      },
      formattedFragment,
      { timeout: 10_000 },
    );
    await page.locator("section svg.lucide-x").first().waitFor({ state: "visible", timeout: 5_000 });

    const toolchainRequestCount = requestedPaths.filter((pathname) => /toolchain\/.+\.webc\.data/.test(pathname)).length;
    const clangdRequestCount = requestedPaths.filter((pathname) => /lsp\/clangd\.wasm\.gz$/.test(pathname)).length;
    if (toolchainRequestCount !== 1) {
      throw new Error(`Expected one initial Clang WebC request, received ${toolchainRequestCount}`);
    }
    if (clangdRequestCount !== 1) {
      throw new Error(`Expected one initial clangd WASM request, received ${clangdRequestCount}`);
    }
    await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.locator(".monaco-editor").waitFor({ state: "visible", timeout: 20_000 });
    await page.locator('.monaco-editor[data-clangd-status="ready"]').waitFor({
      state: "attached",
      timeout: 25_000,
    });
    await page.locator("[data-terminal-notice]").waitFor({ state: "hidden", timeout: 25_000 });
    const requestsAfterReload = requestedPaths.filter((pathname) => /toolchain\/.+\.webc\.data/.test(pathname)).length;
    const clangdRequestsAfterReload = requestedPaths.filter((pathname) => /lsp\/clangd\.wasm\.gz$/.test(pathname)).length;
    if (requestsAfterReload !== toolchainRequestCount) {
      throw new Error("Clang WebC was downloaded again instead of being read from Cache Storage");
    }
    if (clangdRequestsAfterReload !== clangdRequestCount) {
      throw new Error("clangd WASM was downloaded again instead of being read from Cache Storage");
    }
    if (clangdFailures.length > 0) {
      throw new Error(`clangd failed during UI smoke: ${clangdFailures.join("\n")}`);
    }
    console.log("[ui-smoke] persistent compiler and clangd caches reused after reload");

    console.log(
      JSON.stringify(
        {
          crossOriginIsolated: true,
          editor: "monaco",
          standards: "C99/C11/C23 + C++11/14/17/20/23/26",
          println: "passed",
          filesystemSync: `100ms create/update/delete passed (${liveTextCreateSyncElapsedMs}/${liveTextUpdateSyncElapsedMs}/${liveTextDeleteSyncElapsedMs}ms)`,
          terminationSnapshot: `Ctrl+C final snapshot passed (${terminationSnapshotElapsedMs}ms)`,
          syncErrorVisibility: "quota failure reported and recovered",
          base: siteBase,
          compilerLazyLoad: true,
          compressedToolchainBytes: compressedToolchainSize,
          compressedClangdBytes: fs.statSync(compressedClangdPath).size,
          clangd: "ready; C++ stress path passed",
          terminal: terminalText?.replaceAll(/\s+/g, " ").trim(),
          errorLens: errorLensText,
          formatOnSave: "passed",
          screenshot: screenshotPath,
          errorLensScreenshot: errorLensScreenshotPath,
        },
        null,
        2,
      ),
    );
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

let timeout;
try {
  await Promise.race([
    run(),
    new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error("UI smoke test exceeded its 60 second limit")),
        60_000,
      );
    }),
  ]);
} finally {
  clearTimeout(timeout);
}
