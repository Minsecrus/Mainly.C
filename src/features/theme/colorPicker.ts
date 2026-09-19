export interface HsvColor { h: number; s: number; v: number }

export function hexToHsv(hex: string): HsvColor {
  const [r, g, b] = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
  }
  return { h: (h * 60 + 360) % 360, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToHex({ h, s, v }: HsvColor): string {
  const sector = ((h % 360) + 360) % 360 / 60;
  const c = v * s;
  const x = c * (1 - Math.abs(sector % 2 - 1));
  const m = v - c;
  const rgb = sector < 1 ? [c, x, 0] : sector < 2 ? [x, c, 0]
    : sector < 3 ? [0, c, x] : sector < 4 ? [0, x, c]
      : sector < 5 ? [x, 0, c] : [c, 0, x];
  return `#${rgb.map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}
