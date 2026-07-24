import {
  CircleHelp,
  Keyboard,
  RotateCcw,
  Settings,
  Trash2,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";

import type { RunConfiguration } from "../../features/run/runConfiguration.js";
import type { LanguageStandard, SourceLanguage } from "../../languages.js";
import type { AutoRunInterval, RunState } from "../../types/ui.js";
import { MenuCheckboxItem, MenuItem, MenuSeparator, menuContentClass } from "../ui/Menu.js";
import { LanguageStandardControl } from "./LanguageStandardControl.js";
import { RunControl } from "./RunControl.js";

interface TopBarProps {
  runState: RunState;
  runDisabled?: boolean;
  autoRunInterval: AutoRunInterval;
  runConfiguration: RunConfiguration;
  sourceLanguage?: SourceLanguage;
  languageStandard?: LanguageStandard;
  languageStandardDisabled?: boolean;
  autoCompletionEnabled: boolean;
  strictCompilationEnabled: boolean;
  onRun: () => void;
  onStop: () => void;
  onAutoRunIntervalChange: (interval: AutoRunInterval) => void;
  onRunConfigurationChange: (configuration: RunConfiguration) => void;
  onLanguageStandardChange: (standard: LanguageStandard) => void;
  onAutoCompletionEnabledChange: (enabled: boolean) => void;
  onStrictCompilationEnabledChange: (enabled: boolean) => void;
  onClearOutput: () => void;
  onResetLayout: () => void;
  onShowShortcuts: () => void;
  onShowAbout: () => void;
}

export function TopBar({
  runState,
  runDisabled = false,
  autoRunInterval,
  runConfiguration,
  sourceLanguage,
  languageStandard,
  languageStandardDisabled = false,
  autoCompletionEnabled,
  strictCompilationEnabled,
  onRun,
  onStop,
  onAutoRunIntervalChange,
  onRunConfigurationChange,
  onLanguageStandardChange,
  onAutoCompletionEnabledChange,
  onStrictCompilationEnabledChange,
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
        <LanguageStandardControl
          language={sourceLanguage}
          standard={languageStandard}
          disabled={languageStandardDisabled}
          onChange={onLanguageStandardChange}
        />

        <RunControl
          runState={runState}
          disabled={runDisabled}
          autoRunInterval={autoRunInterval}
          runConfiguration={runConfiguration}
          onRun={onRun}
          onStop={onStop}
          onAutoRunIntervalChange={onAutoRunIntervalChange}
          onRunConfigurationChange={onRunConfigurationChange}
        />

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label="设置"
              className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium text-neutral-300 outline-none transition-colors hover:bg-white/[0.1] hover:text-white focus-visible:ring-1 focus-visible:ring-neutral-300"
            >
              <Settings className="size-3.5" />
              <span>设置</span>
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content side="bottom" align="end" sideOffset={5} className={menuContentClass}>
              <DropdownMenu.Label className="px-2 py-1.5 text-[10px] font-semibold tracking-[0.08em] text-neutral-400 uppercase">
                编辑器
              </DropdownMenu.Label>
              <MenuCheckboxItem
                checked={autoCompletionEnabled}
                onCheckedChange={(checked) => onAutoCompletionEnabledChange(checked === true)}
                onSelect={(event) => event.preventDefault()}
              >
                <span className="flex-1">自动补全</span>
                <span className="ml-4 text-[10px] text-neutral-400">
                  {autoCompletionEnabled ? "已开启" : "已关闭"}
                </span>
              </MenuCheckboxItem>
              <MenuSeparator />
              <DropdownMenu.Label className="px-2 py-1.5 text-[10px] font-semibold tracking-[0.08em] text-neutral-400 uppercase">
                编译器
              </DropdownMenu.Label>
              <MenuCheckboxItem
                checked={strictCompilationEnabled}
                onCheckedChange={(checked) => onStrictCompilationEnabledChange(checked === true)}
                onSelect={(event) => event.preventDefault()}
              >
                <span className="flex-1">严格编译</span>
                <span className="ml-4 text-[10px] text-neutral-400">
                  {strictCompilationEnabled ? "已开启" : "已关闭"}
                </span>
              </MenuCheckboxItem>
              <MenuSeparator />
              <MenuItem destructive icon={<Trash2 className="size-3.5" />} onSelect={onClearOutput}>清空输出</MenuItem>
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
