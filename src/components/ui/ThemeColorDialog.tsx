import { useLayoutEffect, useId, useRef, useState, type PointerEvent } from "react";
import { Check, Monitor, Moon, Sun, X } from "lucide-react";
import { Dialog } from "radix-ui";

import { hexToHsv, hsvToHex, type HsvColor } from "../../features/theme/colorPicker.js";
import { useTheme } from "../../features/theme/ThemeProvider.js";
import { cn } from "../../lib/cn.js";
import { IconButton } from "./IconButton.js";

const MODES = [
  { mode: "light", name: "浅色", icon: Sun },
  { mode: "dark", name: "深色", icon: Moon },
  { mode: "system", name: "跟随系统", icon: Monitor },
] as const;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function ThemeColorDialog({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { palette, mode, setMode, setBackground } = useTheme();
  const background = palette.colors.canvas;
  const [hsv, setHsv] = useState(() => hexToHsv(background));
  const lastPicked = useRef<string | undefined>(undefined);
  const id = useId();

  useLayoutEffect(() => {
    // Preserve hue and saturation at black/white and around the hue slider's end.
    if (background !== lastPicked.current) {
      const next = hexToHsv(background);
      setHsv((current) => ({ ...next, h: next.s === 0 ? current.h : next.h }));
    }
  }, [background, open]);

  function pick(next: HsvColor) {
    const color = hsvToHex(next);
    lastPicked.current = color;
    setHsv(next);
    setBackground(color);
  }

  function pickAtPointer(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    pick({ ...hsv, s: clamp((event.clientX - bounds.left) / bounds.width), v: 1 - clamp((event.clientY - bounds.top) / bounds.height) });
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content aria-describedby={undefined} className="fixed top-1/2 left-1/2 z-50 w-[min(490px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-raised p-5 pt-10 text-fg shadow-2xl outline-none">
          <Dialog.Title className="sr-only">主题色</Dialog.Title>
          <Dialog.Close asChild>
            <IconButton label="关闭主题色设置" className="absolute top-2 right-2"><X className="size-4" /></IconButton>
          </Dialog.Close>

          <div className="flex gap-4">
            <div className="flex w-28 shrink-0 flex-col gap-1.5 border-r border-border pr-3" role="group" aria-label="主题模式">
              {MODES.map(({ mode: value, name, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  onClick={() => { lastPicked.current = undefined; setMode(value); }}
                  className={cn(
                    "flex h-10 items-center gap-2 rounded-md px-2 text-[11px] outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-fg",
                    mode === value ? "bg-selected text-fg" : "text-muted",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span>{name}</span>
                </button>
              ))}
            </div>

            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-center justify-between text-[11px]">
                <span className="text-secondary">自定义背景</span>
                {mode === "custom" && <span className="flex items-center gap-1 text-muted"><Check className="size-3" />已应用</span>}
              </div>
              <div
                role="slider"
                aria-label="颜色明度与饱和度"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(hsv.v * 100)}
                aria-valuetext={`饱和度 ${Math.round(hsv.s * 100)}%，明度 ${Math.round(hsv.v * 100)}%`}
                aria-describedby={`${id}-keys`}
                tabIndex={0}
                className="relative h-40 w-full cursor-crosshair touch-none rounded-md outline-none ring-1 ring-border focus-visible:ring-2 focus-visible:ring-fg"
                style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsv.h} 100% 50%)` }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  event.currentTarget.focus();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  pickAtPointer(event);
                }}
                onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) pickAtPointer(event); }}
                onPointerUp={(event) => {
                  if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                  pickAtPointer(event);
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onKeyDown={(event) => {
                  const step = event.shiftKey ? 0.1 : 0.01;
                  const next = { ...hsv };
                  if (event.key === "ArrowLeft") next.s = clamp(hsv.s - step);
                  else if (event.key === "ArrowRight") next.s = clamp(hsv.s + step);
                  else if (event.key === "ArrowUp") next.v = clamp(hsv.v + step);
                  else if (event.key === "ArrowDown") next.v = clamp(hsv.v - step);
                  else if (event.key === "Home") next.v = 0;
                  else if (event.key === "End") next.v = 1;
                  else return;
                  event.preventDefault();
                  pick(next);
                }}
              >
                <span className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_#0008]" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
              </div>
              <span id={`${id}-keys`} className="sr-only">左右方向键调整饱和度，上下方向键调整明度；按住 Shift 加快调整。</span>
              <input
                type="range"
                min={0}
                max={360}
                step={1}
                aria-label="色相"
                aria-valuetext={`${Math.round(hsv.h)} 度`}
                value={hsv.h}
                onChange={(event) => pick({ ...hsv, h: Number(event.target.value) })}
                className="theme-hue-slider mt-4 block h-3 w-full cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-2 focus-visible:ring-offset-raised"
              />
            </div>
          </div>

        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
