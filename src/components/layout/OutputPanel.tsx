import type { RefObject } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleX,
  Eraser,
  Info,
  LoaderCircle,
  Maximize2,
  Minimize2,
  TerminalSquare,
} from "lucide-react";
import { Tabs } from "radix-ui";

import type { ClangDiagnostic } from "../../compiler/diagnostics.js";
import type { InteractiveTerminalSession } from "../../compiler/InteractiveTerminalSession.js";
import { cn } from "../../lib/cn.js";
import type { OutputTab, RunState, UiCompilerLog } from "../../types/ui.js";
import { TerminalView, type TerminalViewHandle } from "../terminal/TerminalView.js";
import { IconButton } from "../ui/IconButton.js";

interface OutputPanelProps {
  activeTab: OutputTab;
  runState: RunState;
  diagnostics: ClangDiagnostic[];
  logs: UiCompilerLog[];
  session?: InteractiveTerminalSession;
  maximized: boolean;
  terminalRef: RefObject<TerminalViewHandle | null>;
  terminalNotice?: string;
  onTabChange: (tab: OutputTab) => void;
  onSelectDiagnostic: (diagnostic: ClangDiagnostic) => void;
  onClear: () => void;
  onCollapse: () => void;
  onToggleMaximize: () => void;
  onInputError: (error: Error) => void;
  onInterrupt: () => void;
}

function tabClass(active: boolean): string {
  return cn(
    "relative flex h-full items-center gap-1.5 px-2 text-[10px] font-medium tracking-[0.06em] text-neutral-400 uppercase outline-none hover:text-white",
    active && "text-white after:absolute after:right-2 after:bottom-0 after:left-2 after:h-px after:bg-white",
  );
}

function EmptyProblems({ runState }: { runState: RunState }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral-400">
      {runState === "success" ? <CheckCircle2 className="size-5" strokeWidth={1.4} /> : <Info className="size-5" strokeWidth={1.4} />}
      <span className="text-[11px]">{runState === "success" ? "没有发现问题" : "运行当前文件后显示编译诊断"}</span>
    </div>
  );
}

function Problems({
  diagnostics,
  runState,
  onSelect,
}: {
  diagnostics: ClangDiagnostic[];
  runState: RunState;
  onSelect: (diagnostic: ClangDiagnostic) => void;
}) {
  if (diagnostics.length === 0) return <EmptyProblems runState={runState} />;
  return (
    <div className="h-full overflow-auto py-1">
      {diagnostics.map((diagnostic, index) => (
        <button
          type="button"
          key={`${diagnostic.fileName}:${diagnostic.line}:${diagnostic.column}:${index}`}
          onClick={() => onSelect(diagnostic)}
          className="group flex min-h-8 w-full items-start gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-white/[0.035]"
        >
          {diagnostic.severity === "error" ? (
            <CircleX className="mt-0.5 size-3.5 shrink-0 text-neutral-300" />
          ) : diagnostic.severity === "warning" ? (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-neutral-300" />
          ) : (
            <Info className="mt-0.5 size-3.5 shrink-0 text-neutral-400" />
          )}
          <span className="min-w-0 flex-1 text-neutral-200 group-hover:text-white">{diagnostic.message}</span>
          <span className="shrink-0 font-mono text-[10px] text-neutral-400">
            {diagnostic.fileName}:{diagnostic.line}:{diagnostic.column}
          </span>
        </button>
      ))}
    </div>
  );
}

function CompilerLogs({ logs }: { logs: UiCompilerLog[] }) {
  if (logs.length === 0) {
    return <div className="flex h-full items-center justify-center text-[11px] text-neutral-400">尚无编译器日志</div>;
  }
  return (
    <div className="h-full overflow-auto py-1 font-mono text-[10px] leading-5">
      {logs.map((log) => (
        <div key={log.id} className="flex min-h-5 items-start gap-2 px-3 hover:bg-white/[0.025]">
          <span className="w-16 shrink-0 text-neutral-400">
            {new Date(log.timestamp).toLocaleTimeString("zh-CN", { hour12: false })}
          </span>
          <span className="w-14 shrink-0 text-neutral-300">{log.source}</span>
          <span className="text-neutral-200">{log.event}</span>
          {log.phase && <span className="text-neutral-400">{log.phase}</span>}
          {typeof log.elapsedMs === "number" && <span className="text-neutral-400">{log.elapsedMs}ms</span>}
          {typeof log.exitCode === "number" && <span className="text-neutral-400">exit {log.exitCode}</span>}
        </div>
      ))}
    </div>
  );
}

export function OutputPanel({
  activeTab,
  runState,
  diagnostics,
  logs,
  session,
  maximized,
  terminalRef,
  terminalNotice,
  onTabChange,
  onSelectDiagnostic,
  onClear,
  onCollapse,
  onToggleMaximize,
  onInputError,
  onInterrupt,
}: OutputPanelProps) {
  const errorCount = diagnostics.filter((item) => item.severity === "error").length;
  const warningCount = diagnostics.filter((item) => item.severity === "warning").length;

  return (
    <Tabs.Root
      value={activeTab}
      onValueChange={(value) => onTabChange(value as OutputTab)}
      className="flex h-full min-h-0 flex-col border-t border-white/[0.12] bg-[#101010]"
    >
      <div className="flex h-9 shrink-0 items-center border-b border-white/[0.1] bg-[#141414] px-2">
        <Tabs.List className="flex h-full items-center">
          <Tabs.Trigger value="terminal" className={tabClass(activeTab === "terminal")}>
            {runState === "running" ? <LoaderCircle className="size-3 animate-spin" /> : <TerminalSquare className="size-3" />}
            终端
          </Tabs.Trigger>
          <Tabs.Trigger value="problems" className={tabClass(activeTab === "problems")}>
            问题
            {(errorCount > 0 || warningCount > 0) && (
              <span className="rounded bg-white/[0.07] px-1 py-0.5 text-[9px] text-neutral-400">
                {errorCount + warningCount}
              </span>
            )}
          </Tabs.Trigger>
          <Tabs.Trigger value="logs" className={tabClass(activeTab === "logs")}>
            编译日志
          </Tabs.Trigger>
        </Tabs.List>
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton label="清空当前输出" onClick={onClear} className="size-7 text-red-400 hover:bg-red-500/10 hover:text-red-300">
            <Eraser className="size-3.5" />
          </IconButton>
          <IconButton label={maximized ? "还原面板" : "最大化面板"} onClick={onToggleMaximize} className="size-7">
            {maximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </IconButton>
          <IconButton label="收起面板" onClick={onCollapse} className="size-7">
            <ChevronDown className="size-3.5" />
          </IconButton>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <Tabs.Content
          value="terminal"
          forceMount
          className="absolute inset-0 outline-none data-[state=inactive]:invisible"
        >
          <TerminalView
            ref={terminalRef}
            session={session}
            notice={terminalNotice}
            onInputError={onInputError}
            onInterrupt={onInterrupt}
          />
        </Tabs.Content>
        <Tabs.Content
          value="problems"
          forceMount
          className="absolute inset-0 outline-none data-[state=inactive]:invisible"
        >
          <Problems diagnostics={diagnostics} runState={runState} onSelect={onSelectDiagnostic} />
        </Tabs.Content>
        <Tabs.Content
          value="logs"
          forceMount
          className="absolute inset-0 outline-none data-[state=inactive]:invisible"
        >
          <CompilerLogs logs={logs} />
        </Tabs.Content>
      </div>
    </Tabs.Root>
  );
}
