import {
  CircleHelp,
  Ellipsis,
  Keyboard,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";

import type { AutoRunInterval, RunState } from "../../types/ui.js";
import { IconButton } from "../ui/IconButton.js";
import { MenuItem, MenuSeparator, menuContentClass } from "../ui/Menu.js";
import { RunControl } from "./RunControl.js";

interface TopBarProps {
  runState: RunState;
  runDisabled?: boolean;
  autoRunInterval: AutoRunInterval;
  onRun: () => void;
  onStop: () => void;
  onAutoRunIntervalChange: (interval: AutoRunInterval) => void;
  onClearOutput: () => void;
  onResetLayout: () => void;
  onShowShortcuts: () => void;
  onShowAbout: () => void;
}

export function TopBar({
  runState,
  runDisabled = false,
  autoRunInterval,
  onRun,
  onStop,
  onAutoRunIntervalChange,
  onClearOutput,
  onResetLayout,
  onShowShortcuts,
  onShowAbout,
}: TopBarProps) {
  return (
    <header className="flex h-11 shrink-0 items-center border-b border-white/[0.12] bg-[#101010] px-2">
      <div className="flex h-8 items-center px-1.5">
        <span className="text-[17px] font-bold leading-none tracking-[-0.055em] text-white">Mainly.C</span>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <RunControl
          runState={runState}
          disabled={runDisabled}
          autoRunInterval={autoRunInterval}
          onRun={onRun}
          onStop={onStop}
          onAutoRunIntervalChange={onAutoRunIntervalChange}
        />

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <IconButton label="更多操作">
              <Ellipsis className="size-4" />
            </IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content side="bottom" align="end" sideOffset={5} className={menuContentClass}>
              <MenuItem icon={<Trash2 className="size-3.5" />} onSelect={onClearOutput}>清空输出</MenuItem>
              <MenuItem icon={<RotateCcw className="size-3.5" />} onSelect={onResetLayout}>重置面板布局</MenuItem>
              <MenuSeparator />
              <MenuItem icon={<Keyboard className="size-3.5" />} onSelect={onShowShortcuts}>键盘快捷键</MenuItem>
              <MenuItem icon={<CircleHelp className="size-3.5" />} onSelect={onShowAbout}>关于</MenuItem>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  );
}
