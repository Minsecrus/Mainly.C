export const DEFAULT_BACKGROUND = "#121212";
export const THEME_STORAGE_KEY = "mainly.c.theme.v1";

export type ThemeMode = "light" | "dark" | "system" | "custom";
export interface ThemePreference {
  mode: ThemeMode;
  color: string;
}

export function normalizeColor(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const hex = value.trim().replace(/^#/, "");
  if (/^[\da-f]{6}$/i.test(hex)) return `#${hex.toLowerCase()}`;
  if (/^[\da-f]{3}$/i.test(hex)) {
    return `#${[...hex].map((digit) => digit + digit).join("").toLowerCase()}`;
  }
}

function channels(hex: string): number[] {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
}

function mix(from: string, to: string, amount: number): string {
  const target = channels(to);
  return `#${channels(from).map((channel, index) =>
    Math.round(channel + (target[index] - channel) * amount).toString(16).padStart(2, "0"),
  ).join("")}`;
}

function luminance(color: string): number {
  const [red, green, blue] = channels(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// Find a readable shade against every surface, including hovered/selected rows.
function readable(color: string, ink: string, surfaces: string[], ratio: number): string {
  const passes = (candidate: string) => surfaces.every((surface) => contrastRatio(candidate, surface) >= ratio);
  if (passes(color)) return color;
  if (!passes(ink)) return ink;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 16; step++) {
    const middle = (low + high) / 2;
    if (passes(mix(color, ink, middle))) high = middle;
    else low = middle;
  }
  return mix(color, ink, high);
}

export function createPalette(value: string) {
  const canvas = normalizeColor(value) ?? DEFAULT_BACKGROUND;
  const dark = contrastRatio(canvas, "#ffffff") > contrastRatio(canvas, "#000000");
  const ink = dark ? "#ffffff" : "#000000";
  const paper = dark ? "#000000" : "#ffffff";
  // Mid-tone backgrounds need surfaces to move away from the text color.
  // For very dark/light backgrounds, raised surfaces can move toward it.
  const surfaceDirection = contrastRatio(canvas, ink) >= 7 ? ink : paper;
  const surface = (amount: number) => {
    const candidate = mix(canvas, surfaceDirection, amount);
    return contrastRatio(candidate, ink) >= 4.5 ? candidate : mix(canvas, paper, amount);
  };
  const panel = surface(0.02);
  const raised = surface(0.045);
  const hover = surface(0.08);
  const selected = surface(0.14);
  const inset = mix(canvas, paper, 0.25);
  const surfaces = [canvas, panel, raised, hover, selected, inset];
  const fg = readable(mix(canvas, ink, 0.94), ink, surfaces, 7);
  const secondary = readable(mix(canvas, ink, 0.78), ink, surfaces, 5.5);
  const muted = readable(mix(canvas, ink, 0.56), ink, surfaces, 4.5);
  const dangerBase = dark ? "#fca5a5" : "#9f1239";
  const dangerTint = mix(raised, dangerBase, 0.1);
  const dangerSurface = contrastRatio(dangerTint, ink) >= 4.5 ? dangerTint : hover;
  const danger = readable(dangerBase, ink, [...surfaces, dangerSurface], 4.5);
  const onDanger = dark ? "#450a0a" : "#ffffff";

  return {
    mode: dark ? "dark" as const : "light" as const,
    colors: {
      canvas, panel, raised, inset, hover, selected, fg, secondary, muted,
      border: mix(canvas, ink, 0.16),
      "border-strong": mix(canvas, ink, 0.36),
      primary: fg,
      "primary-hover": ink,
      "on-primary": canvas,
      danger,
      "danger-surface": dangerSurface,
      "danger-solid": dangerBase,
      "danger-hover": mix(dangerBase, onDanger, 0.08),
      "on-danger": onDanger,
    },
  };
}

export type ThemePalette = ReturnType<typeof createPalette>;

export function loadThemePreference(): ThemePreference {
  try {
    const stored = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) ?? "null") as Partial<ThemePreference> | null;
    if (stored && ["light", "dark", "system", "custom"].includes(stored.mode ?? "")) {
      return { mode: stored.mode as ThemeMode, color: normalizeColor(stored.color) ?? DEFAULT_BACKGROUND };
    }
  } catch { /* Use the default when storage is unavailable or malformed. */ }
  return { mode: "dark", color: DEFAULT_BACKGROUND };
}

export function resolveBackground(preference: ThemePreference, systemDark: boolean): string {
  if (preference.mode === "custom") return preference.color;
  const dark = preference.mode === "system" ? systemDark : preference.mode === "dark";
  return dark ? DEFAULT_BACKGROUND : "#ffffff";
}

export function applyPalette(palette: ThemePalette): void {
  const root = document.documentElement;
  for (const [token, color] of Object.entries(palette.colors)) {
    root.style.setProperty(`--theme-${token}`, color);
  }
  root.style.colorScheme = palette.mode;
  root.dataset.theme = palette.mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", palette.colors.canvas);
}
