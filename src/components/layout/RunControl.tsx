import { ChevronDown, LoaderCircle, Play, Repeat2, Square } from "lucide-react";
import { DropdownMenu, Tooltip } from "radix-ui";

import type { AutoRunInterval, RunState } from "../../types/ui.js";
import { MenuRadioItem, menuContentClass } from "../ui/Menu.js";

interface RunControlProps {
  runState: RunState;
  disabled?: boolean;
  autoRunInterval: AutoRunInterval;
  onRun: () => void;
  onStop: () => void;
  onAutoRunIntervalChange: (interval: AutoRunInterval) => void;
}

const AUTO_RUN_INTERVALS = [5_000, 10_000, 30_000] as const;
const tooltipClass =
  "z-50 rounded-md border border-white/10 bg-neutral-900 px-2 py-1 text-[11px] font-medium text-neutral-200 shadow-xl shadow-black/30 select-none";

function parseRunInterval(value: string): AutoRunInterval {
  if (value === "once") return null;
  const milliseconds = Number(value);
  return milliseconds === 5_000 || milliseconds === 10_000 || milliseconds === 30_000
    ? milliseconds
    : null;
}

export function RunControl({
  runState,
  disabled = false,
  autoRunInterval,
  onRun,
  onStop,
  onAutoRunIntervalChange,
}: RunControlProps) {
  const running = runState === "running";
  const preparing = runState === "loading" || runState === "compiling";
  const runModeLabel = autoRunInterval === null
    ? "单次运行"
    : `每 ${autoRunInterval / 1_000} 秒循环`;

  return (
    <div className="flex h-8 overflow-hidden rounded-md bg-neutral-100 text-neutral-950 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)]">
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            aria-label={running ? "终止当前程序" : "运行当前文件"}
            onClick={running ? onStop : onRun}
            disabled={disabled || preparing}
            className="grid h-full w-9 place-items-center border-r border-black/15 outline-none transition hover:bg-white focus-visible:bg-white disabled:cursor-not-allowed disabled:opacity-55"
          >
            {preparing ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : running ? (
              <Square className="size-3 fill-current" />
            ) : (
              <Play className="size-3.5 fill-current" />
            )}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content side="bottom" sideOffset={7} className={tooltipClass}>
            {running ? "终止程序 · Ctrl+C" : "运行当前文件 · Ctrl+Enter"}
            <Tooltip.Arrow className="fill-neutral-900" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>

      <DropdownMenu.Root>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <DropdownMenu.Trigger
              aria-label="选择执行方式"
              disabled={disabled}
              className="grid h-full w-7 place-items-center outline-none transition hover:bg-white focus-visible:bg-white disabled:cursor-not-allowed disabled:opacity-55"
            >
              <ChevronDown className="size-3.5" strokeWidth={2} />
            </DropdownMenu.Trigger>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content side="bottom" sideOffset={7} className={tooltipClass}>
              {runModeLabel}
              <Tooltip.Arrow className="fill-neutral-900" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="bottom"
            align="end"
            sideOffset={5}
            className={menuContentClass}
          >
            <DropdownMenu.Label className="px-2 py-1.5 text-[10px] font-semibold tracking-[0.08em] text-neutral-400 uppercase">
              执行方式
            </DropdownMenu.Label>
            <DropdownMenu.RadioGroup
              value={autoRunInterval === null ? "once" : String(autoRunInterval)}
              onValueChange={(value) => onAutoRunIntervalChange(parseRunInterval(value))}
            >
              <MenuRadioItem value="once">
                <Play className="size-3.5" />
                <span className="flex-1">单次运行</span>
                <span className="text-[10px] text-neutral-400">不循环</span>
              </MenuRadioItem>
              {AUTO_RUN_INTERVALS.map((milliseconds) => (
                <MenuRadioItem key={milliseconds} value={String(milliseconds)}>
                  <Repeat2 className="size-3.5" />
                  <span className="flex-1">每 {milliseconds / 1_000} 秒</span>
                </MenuRadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
