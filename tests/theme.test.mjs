import assert from "node:assert/strict";
import test from "node:test";

import { contrastRatio, createPalette, DEFAULT_BACKGROUND, normalizeColor, resolveBackground } from "../src/features/theme/palette.ts";
import { hexToHsv, hsvToHex } from "../src/features/theme/colorPicker.ts";
import { monacoTheme, terminalTheme } from "../src/features/theme/editorThemes.ts";

test("hex input accepts shorthand and rejects invalid values", () => {
  assert.equal(normalizeColor(" #Af0 "), "#aaff00");
  assert.equal(normalizeColor("E8F0EA"), "#e8f0ea");
  for (const invalid of [null, {}, "", "#ff", "#gggggg", "#12345678", "red"]) {
    assert.equal(normalizeColor(invalid), undefined);
  }
});

test("contrast calculation matches reference black, white and middle gray", () => {
  assert.equal(contrastRatio("#000000", "#ffffff"), 21);
  assert.equal(contrastRatio("#123456", "#123456"), 1);
  assert.ok(Math.abs(contrastRatio("#777777", "#ffffff") - 4.478) < 0.001);
});

const backgrounds = new Set();
for (let r = 0; r <= 255; r += 17) {
  for (let g = 0; g <= 255; g += 17) {
    for (let b = 0; b <= 255; b += 17) {
      backgrounds.add(`#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`);
    }
  }
}
for (let gray = 0; gray <= 255; gray++) backgrounds.add(`#${gray.toString(16).padStart(2, "0").repeat(3)}`);
// Exercise hues and brightness values between the RGB grid points.
for (let h = 0; h < 360; h += 3) {
  for (const s of [0.25, 0.5, 0.75, 1]) {
    for (const v of [0.3, 0.45, 0.6, 0.75, 0.9]) backgrounds.add(hsvToHex({ h, s, v }));
  }
}

test(`readable text, selections and buttons across ${backgrounds.size} colors`, () => {
  for (const background of backgrounds) {
    const palette = createPalette(background);
    const c = palette.colors;
    assert.equal(c.canvas, background, "The user's background must remain unchanged");
    for (const surface of ["canvas", "panel", "raised", "inset", "hover", "selected"]) {
      for (const text of ["fg", "secondary", "muted", "danger"]) {
        assert.ok(contrastRatio(c[text], c[surface]) >= 4.5, `${background}: ${text} on ${surface}`);
      }
    }
    for (const [text, surface] of [
      ["on-primary", "primary"], ["on-primary", "primary-hover"],
      ["danger", "danger-surface"], ["on-danger", "danger-solid"], ["on-danger", "danger-hover"],
    ]) {
      assert.ok(contrastRatio(c[text], c[surface]) >= 4.5, `${background}: ${text} on ${surface}`);
    }
    const editor = monacoTheme(palette);
    for (const rule of editor.rules) {
      for (const surface of ["canvas", "panel", "hover", "selected"]) {
        assert.ok(contrastRatio(rule.foreground, c[surface]) >= 4.5, `${background}: editor ${rule.token} on ${surface}`);
      }
    }
    const terminal = terminalTheme(palette);
    for (const token of ["foreground", "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white", "brightBlack"]) {
      assert.ok(contrastRatio(terminal[token], terminal.background) >= 4.5, `${background}: terminal ${token}`);
    }
  }
});

test("the color picker can round-trip all tested colors, including grayscale", () => {
  for (const hex of backgrounds) assert.equal(hsvToHex(hexToHsv(hex)), hex);
  assert.equal(hsvToHex({ h: 360, s: 1, v: 1 }), "#ff0000");
});

test("system preference changes only affect follow-system mode", () => {
  for (const systemDark of [false, true]) {
    assert.equal(resolveBackground({ mode: "dark", color: "#abcdef" }, systemDark), DEFAULT_BACKGROUND);
    assert.equal(resolveBackground({ mode: "light", color: "#abcdef" }, systemDark), "#ffffff");
    assert.equal(resolveBackground({ mode: "custom", color: "#abcdef" }, systemDark), "#abcdef");
    assert.equal(resolveBackground({ mode: "system", color: "#abcdef" }, systemDark), systemDark ? DEFAULT_BACKGROUND : "#ffffff");
  }
});
