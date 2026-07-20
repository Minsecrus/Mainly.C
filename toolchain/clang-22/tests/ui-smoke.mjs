import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

import { chromium } from "playwright-core";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const outputRoot = path.join(repositoryRoot, "web-dist");
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/").at(-1);
const siteBase = process.env.GITHUB_ACTIONS === "true" && repositoryName
  ? `/${repositoryName}/`
  : "/";
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
  const requestedPaths = [];
  let compressedToolchain;
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
    if (filePath.endsWith(".webc")) {
      compressedToolchain ??= zlib.gzipSync(fs.readFileSync(filePath), { level: 1 });
      response.writeHead(200, {
        "Content-Type": contentType(filePath),
        "Content-Encoding": "gzip",
        "Content-Length": compressedToolchain.byteLength,
        "Cache-Control": "no-store",
        Vary: "Accept-Encoding",
      });
      response.end(compressedToolchain);
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentType(filePath),
      "Content-Length": stat.size,
    });
    fs.createReadStream(filePath).pipe(response);
  });
  let browser;

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
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        console.log(`[browser:${message.type()}] ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => console.error(`[browser:error] ${error.stack || error}`));

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

    const moreButton = page.getByRole("button", { name: "更多操作" });
    if ((await moreButton.evaluate((element) => getComputedStyle(element).cursor)) !== "pointer") {
      throw new Error("Enabled icon button does not use the pointer cursor");
    }
    await moreButton.click();
    const aboutMenuItem = page.getByRole("menuitem", { name: "关于" });
    if ((await aboutMenuItem.evaluate((element) => getComputedStyle(element).cursor)) !== "pointer") {
      throw new Error("Menu item does not use the pointer cursor");
    }
    await aboutMenuItem.click();
    const aboutDialog = page.getByRole("dialog", { name: "关于" });
    await aboutDialog.getByText("Clang / LLD 22.1.0").waitFor({ state: "visible" });
    await aboutDialog.getByText("© 2026 Minsecrus · MIT License").waitFor({ state: "visible" });
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
    if (!requestedPaths.some((pathname) => /toolchain\/.+\.webc/.test(pathname))) {
      throw new Error("Clang WebC was not loaded after the UI became ready");
    }
    if (!requestedPaths.some((pathname) => /clang-format.*\.wasm/.test(pathname))) {
      throw new Error("Clang-format was not loaded with the compiler");
    }
    console.log("[ui-smoke] editor, formatter, and gzip-delivered compiler are ready");

    await page.getByRole("button", { name: "选择执行方式" }).click();
    await page.getByRole("menuitemradio", { name: /单次运行/ }).waitFor({ state: "visible" });
    await page.getByRole("menuitemradio", { name: /每 10 秒/ }).waitFor({ state: "visible" });
    await page.keyboard.press("Escape");

    console.log("[ui-smoke] compile and run interactive C23 program");
    await runButton.click();
    await page.waitForFunction(
      () => document.querySelector(".xterm-rows")?.textContent?.includes("What is your name?"),
      undefined,
      { timeout: 25_000 },
    );
    await page.locator(".xterm-helper-textarea").click();
    await page.keyboard.type("Ada");
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => document.querySelector(".xterm-rows")?.textContent?.includes("Hello, Ada"),
      undefined,
      { timeout: 10_000 },
    );
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
    await page.waitForFunction(
      () => {
        const stored = localStorage.getItem("mainly.c.workspace.v1");
        if (!stored) return false;
        const workspace = JSON.parse(stored);
        return workspace.files?.some((file) => file.content === "int main(void) { return 0 }");
      },
      undefined,
      { timeout: 5_000 },
    );
    console.log("[ui-smoke] map a Clang diagnostic into Error Lens");
    await page.getByRole("button", { name: "运行当前文件" }).click();
    await page.waitForFunction(
      () => document.querySelector('[role="tab"][data-state="active"]')?.textContent?.includes("问题"),
      undefined,
      { timeout: 10_000 },
    );
    try {
      await page.locator(".mainly-error-lens-message").waitFor({ state: "visible", timeout: 10_000 });
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
    await page.waitForFunction(
      (expected) => {
        const stored = localStorage.getItem("mainly.c.workspace.v1");
        if (!stored) return false;
        const workspace = JSON.parse(stored);
        return workspace.files?.some((file) => file.content === expected);
      },
      unformatted,
      { timeout: 5_000 },
    );
    await page.locator("section svg.lucide-circle").waitFor({ state: "visible", timeout: 5_000 });
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
    await page.locator("section svg.lucide-x").waitFor({ state: "visible", timeout: 5_000 });

    const toolchainRequestCount = requestedPaths.filter((pathname) => /toolchain\/.+\.webc/.test(pathname)).length;
    if (toolchainRequestCount !== 1) {
      throw new Error(`Expected one initial Clang WebC request, received ${toolchainRequestCount}`);
    }
    await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.locator(".monaco-editor").waitFor({ state: "visible", timeout: 20_000 });
    await page.locator("[data-terminal-notice]").waitFor({ state: "hidden", timeout: 25_000 });
    const requestsAfterReload = requestedPaths.filter((pathname) => /toolchain\/.+\.webc/.test(pathname)).length;
    if (requestsAfterReload !== toolchainRequestCount) {
      throw new Error("Clang WebC was downloaded again instead of being read from Cache Storage");
    }
    console.log("[ui-smoke] persistent toolchain cache reused after reload");

    console.log(
      JSON.stringify(
        {
          crossOriginIsolated: true,
          editor: "monaco",
          standard: "C23",
          base: siteBase,
          compilerLazyLoad: true,
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
