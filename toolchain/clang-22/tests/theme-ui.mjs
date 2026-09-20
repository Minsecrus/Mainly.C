import assert from "node:assert/strict";
import path from "node:path";

export async function checkTheme(page, screenshotDirectory) {
  const editor = page.locator(".monaco-editor").getByRole("textbox", { name: /Editor content/ }).first();
  const editorNode = await page.locator(".monaco-editor").elementHandle();
  const terminalNode = await page.locator(".xterm").elementHandle();
  const terminalText = await page.locator(".xterm-rows").textContent();
  const storedWorkspace = await page.evaluate(() => localStorage.getItem("mainly.c.workspace.v1"));
  await editor.focus();
  await editor.press("Control+End");
  await page.keyboard.insertText("\n// unsaved theme check");

  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("menuitem", { name: "主题色", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "主题色", exact: true });
  await dialog.waitFor({ state: "visible" });
  const currentBackground = () => page.evaluate(() => document.documentElement.style.getPropertyValue("--theme-canvas"));

  const expectBackground = async (color) => {
    await page.waitForFunction((expected) => {
      const canvas = document.documentElement.style.getPropertyValue("--theme-canvas");
      const editorBackground = getComputedStyle(document.querySelector(".monaco-editor .monaco-editor-background")).backgroundColor;
      const rgb = expected.slice(1).match(/../g).map((value) => parseInt(value, 16));
      return canvas === expected && editorBackground === `rgb(${rgb.join(", ")})`;
    }, color, { timeout: 2_000 });
  };

  const checkRenderedContrast = async () => {
    const failures = await page.evaluate(() => {
      const parse = (color) => color.match(/[\d.]+/g)?.map(Number);
      const luma = (rgb) => rgb.slice(0, 3).map((channel) => {
        const c = channel / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const failures = [];
      for (const element of document.querySelectorAll('.monaco-editor .view-lines span, .xterm-rows span, [role="dialog"] button, [role="dialog"] input[type="text"], [role="dialog"] p')) {
        if ((element.children.length || !element.textContent.trim()) && !(element instanceof HTMLInputElement)) continue;
        let ancestor = element;
        let bg;
        while (ancestor) {
          const candidate = parse(getComputedStyle(ancestor).backgroundColor);
          if (candidate && (candidate[3] ?? 1) === 1) { bg = candidate; break; }
          ancestor = ancestor.parentElement;
        }
        const foreground = parse(getComputedStyle(element).color);
        if (!bg || !foreground) continue;
        const alpha = foreground[3] ?? 1;
        const fg = foreground.map((value, index) => value * alpha + bg[index] * (1 - alpha));
        const a = luma(fg), b = luma(bg);
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        if (ratio < 4.5) failures.push({ text: element.textContent.slice(0, 35), class: element.className, color: foreground, background: bg, ratio });
      }
      return failures;
    });
    assert.deepEqual(failures, [], `Rendered text contrast: ${await currentBackground()}`);
  };

  await dialog.getByRole("button", { name: "浅色", exact: true }).click();
  await expectBackground("#ffffff");
  await checkRenderedContrast();
  await page.screenshot({ path: path.join(screenshotDirectory, "theme-light.png") });
  await dialog.getByRole("button", { name: "深色", exact: true }).click();
  await expectBackground("#121212");
  await checkRenderedContrast();
  await page.screenshot({ path: path.join(screenshotDirectory, "theme-dark.png") });

  await page.emulateMedia({ colorScheme: "dark" });
  await dialog.getByRole("button", { name: "跟随系统", exact: true }).click();
  await expectBackground("#121212");
  await page.emulateMedia({ colorScheme: "light" });
  await expectBackground("#ffffff");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectBackground("#121212");
  assert.equal(await dialog.getByRole("button", { name: "跟随系统" }).getAttribute("aria-pressed"), "true");

  const plane = dialog.getByRole("slider", { name: "颜色明度与饱和度" });
  const bounds = await plane.boundingBox();
  await plane.click({ position: { x: bounds.width / 2, y: bounds.height / 3 } });
  const beforeHue = await currentBackground();
  const hue = dialog.getByRole("slider", { name: "色相", exact: true });
  await hue.focus();
  await hue.press("ArrowRight");
  await page.waitForFunction((previous) => document.documentElement.style.getPropertyValue("--theme-canvas") !== previous, beforeHue, { timeout: 2_000 });
  await plane.focus();
  await plane.press("ArrowDown");
  await plane.press("Shift+ArrowRight");
  await page.mouse.move(bounds.x + bounds.width / 3, bounds.y + bounds.height / 3);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width + 20, bounds.y + bounds.height + 20, { steps: 4 });
  await page.mouse.up();
  await expectBackground("#000000");

  await hue.press("Home");
  for (const position of [
    { x: 1, y: bounds.height / 2 },
    { x: bounds.width - 1, y: 1 },
    { x: bounds.width / 3, y: bounds.height / 4 },
  ]) {
    await plane.click({ position });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expectBackground(await currentBackground());
    await checkRenderedContrast();
  }
  const customBackground = await currentBackground();
  await page.emulateMedia({ colorScheme: "light" });
  await expectBackground(customBackground);
  await page.screenshot({ path: path.join(screenshotDirectory, "theme-custom.png") });

  assert.ok(await editorNode.evaluate((element) => element.isConnected), "Changing colors recreated the editor");
  assert.ok(await terminalNode.evaluate((element) => element.isConnected), "Changing colors recreated the terminal");
  assert.equal(await page.locator(".xterm-rows").textContent(), terminalText, "Changing colors cleared terminal output");
  assert.ok((await page.locator(".monaco-editor .view-lines").textContent()).replaceAll("\u00a0", " ").includes("unsaved theme check"));
  assert.equal(await page.evaluate(() => localStorage.getItem("mainly.c.workspace.v1")), storedWorkspace, "Changing colors saved the unsaved draft");
  await dialog.getByRole("button", { name: "关闭主题色设置", exact: true }).click();
  await editor.focus();
  await editor.press("Control+Z");
  await page.waitForFunction(() => !document.querySelector(".monaco-editor .view-lines").textContent.replaceAll("\u00a0", " ").includes("unsaved theme check"));
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("mainly.c.theme.v1"))), { mode: "custom", color: customBackground });
  await editorNode.dispose();
  await terminalNode.dispose();
  console.log("[ui-smoke] theme modes, live system changes, pointer/keyboard picker, unsaved draft and terminal preservation passed");
  return customBackground;
}
