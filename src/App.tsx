import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as MonacoEditor from "monaco-editor";

import type { ClangCompilerAdapter } from "./compiler/ClangCompilerAdapter.js";
import type { ClangDiagnostic } from "./compiler/diagnostics.js";
import {
  TerminalTerminatedError,
  type InteractiveTerminalSession,
} from "./compiler/InteractiveTerminalSession.js";
import { MAINLY_EXIT_MARKER } from "./compiler/runtimeProtocol.js";
import type { CompilerLogEvent } from "./compiler/types.js";
import { ActivityRail } from "./components/layout/ActivityRail.js";
import { EditorPane } from "./components/layout/EditorPane.js";
import { FileExplorer } from "./components/layout/FileExplorer.js";
import { OutputPanel } from "./components/layout/OutputPanel.js";
import { TopBar } from "./components/layout/TopBar.js";
import type { TerminalViewHandle } from "./components/terminal/TerminalView.js";
import { InfoDialog } from "./components/ui/InfoDialog.js";
import { formatSource, preloadFormatter } from "./editor/cFormatter.js";
import {
  useLocalFiles,
} from "./features/files/useLocalFiles.js";
import {
  downloadWorkspace,
  serializeWorkspace,
  type WorkspaceTransferData,
} from "./features/files/workspaceTransfer.js";
import {
  loadRunConfiguration,
  parseProgramArguments,
  prepareStandardInput,
  saveRunConfiguration,
  type RunConfiguration,
} from "./features/run/runConfiguration.js";
import {
  loadEditorPreferences,
  saveEditorPreferences,
} from "./features/settings/editorPreferences.js";
import {
  compilerDriverForLanguage,
  DEFAULT_LANGUAGE_STANDARDS,
  isCStandard,
  isCppStandard,
  isLanguageStandardForLanguage,
  isSourceCodeFileName,
  languageStandardLabel,
  sourceLanguageForFileName,
  type LanguageStandard,
  type LanguageStandardPreferences,
} from "./languages.js";
import type { AutoRunInterval, OutputTab, RunState, UiCompilerLog } from "./types/ui.js";

type InfoDialogKind = "shortcuts" | "about" | null;

const PANEL_HEIGHT_KEY = "mainly.c.panel-height.v1";
const LANGUAGE_STANDARDS_KEY = "mainly.c.language-standards.v1";
const ANSI_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]/g;

function loadLanguageStandards(): LanguageStandardPreferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(LANGUAGE_STANDARDS_KEY) ?? "null") as Partial<LanguageStandardPreferences> | null;
    return {
      c: isCStandard(parsed?.c) ? parsed.c : DEFAULT_LANGUAGE_STANDARDS.c,
      cpp: isCppStandard(parsed?.cpp) ? parsed.cpp : DEFAULT_LANGUAGE_STANDARDS.cpp,
    };
  } catch {
    return { ...DEFAULT_LANGUAGE_STANDARDS };
  }
}

function initialPanelHeight(): number {
  const stored = Number.parseInt(localStorage.getItem(PANEL_HEIGHT_KEY) ?? "", 10);
  return Number.isFinite(stored) ? Math.max(140, Math.min(420, stored)) : 238;
}

function terminalText(text: string): string {
  return text.replace(ANSI_ESCAPE, "").replaceAll(/\r?\n/g, "\r\n");
}

export default function App() {
  const workspace = useLocalFiles();
  const [runState, setRunState] = useState<RunState>("idle");
  const [autoRunInterval, setAutoRunInterval] = useState<AutoRunInterval>(null);
  const [runConfiguration, setRunConfiguration] = useState(loadRunConfiguration);
  const [languageStandards, setLanguageStandards] = useState(loadLanguageStandards);
  const [editorPreferences, setEditorPreferences] = useState(loadEditorPreferences);
  const [diagnosticsByFile, setDiagnosticsByFile] = useState<Record<string, ClangDiagnostic[]>>({});
  const [logs, setLogs] = useState<UiCompilerLog[]>([]);
  const [session, setSession] = useState<InteractiveTerminalSession>();
  const [activeTab, setActiveTab] = useState<OutputTab>("terminal");
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelMaximized, setPanelMaximized] = useState(false);
  const [panelHeight, setPanelHeight] = useState(initialPanelHeight);
  const [panelResizing, setPanelResizing] = useState(false);
  const [infoDialog, setInfoDialog] = useState<InfoDialogKind>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [formatterReady, setFormatterReady] = useState(false);
  const [compilerReady, setCompilerReady] = useState(false);
  const [compilerProgress, setCompilerProgress] = useState<number>();
  const [environmentError, setEnvironmentError] = useState<string>();
  const [openFileIds, setOpenFileIds] = useState<string[]>(() => [workspace.activeFile.id]);
  const editorRef = useRef<MonacoEditor.editor.IStandaloneCodeEditor | null>(null);
  const activeFileIdRef = useRef(workspace.activeFile.id);
  activeFileIdRef.current = workspace.activeFile.id;
  const terminalRef = useRef<TerminalViewHandle | null>(null);
  const sessionRef = useRef<InteractiveTerminalSession | undefined>(undefined);
  const logId = useRef(0);
  const compilerProgressRef = useRef<number | undefined>(undefined);

  const activeEditorFile = openFileIds.includes(workspace.activeFile.id)
    ? workspace.activeFile
    : undefined;
  const activeDiagnostics = activeEditorFile
    ? diagnosticsByFile[activeEditorFile.id] ?? []
    : [];
  const activeSourceLanguage = activeEditorFile
    ? sourceLanguageForFileName(activeEditorFile.name)
    : undefined;
  const activeLanguageStandard = activeSourceLanguage
    ? languageStandards[activeSourceLanguage]
    : undefined;
  const activeFileRunnable = activeSourceLanguage !== undefined;
  const busy = runState === "loading" || runState === "compiling" || runState === "running";
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const openFiles = useMemo(
    () => openFileIds.flatMap((id) => {
      const file = workspace.files.find((candidate) => candidate.id === id);
      return file ? [file] : [];
    }),
    [openFileIds, workspace.files],
  );
  const environmentReady = editorReady && formatterReady && compilerReady && !environmentError;
  const environmentReadyRef = useRef(environmentReady);
  environmentReadyRef.current = environmentReady;

  const terminalNotice = useMemo(() => {
    if (environmentError) return `[初始化失败] ${environmentError}；请刷新页面重试。`;
    if (!editorReady) return "[初始化] 正在加载代码编辑器…";
    if (!formatterReady && !compilerReady) {
      return compilerProgress === undefined
        ? "[初始化] 正在加载 Clang-format 与 Clang 22 工具链…"
        : `[初始化] 正在加载 Clang-format 与 Clang 22 工具链… ${compilerProgress}%`;
    }
    if (!formatterReady) return "[初始化] 正在加载 Clang-format 22…";
    if (!compilerReady) {
      return compilerProgress === undefined
        ? "[初始化] 正在加载 Clang 22 工具链…"
        : `[初始化] 正在加载 Clang 22 工具链… ${compilerProgress}%`;
    }
    return undefined;
  }, [compilerProgress, compilerReady, editorReady, environmentError, formatterReady]);

  useEffect(() => {
    localStorage.setItem(PANEL_HEIGHT_KEY, String(panelHeight));
  }, [panelHeight]);

  useEffect(() => {
    localStorage.setItem(LANGUAGE_STANDARDS_KEY, JSON.stringify(languageStandards));
  }, [languageStandards]);

  useEffect(() => {
    setOpenFileIds((current) => {
      const validIds = current.filter((id) =>
        workspace.files.some((file) => file.id === id),
      );
      return validIds.length === current.length ? current : validIds;
    });
  }, [workspace.files]);

  const appendLog = useCallback((event: CompilerLogEvent) => {
    setLogs((current) => [
      ...current.slice(-399),
      { ...event, id: ++logId.current, timestamp: Date.now() },
    ]);
  }, []);

  useEffect(() => {
    if (!editorReady || !crossOriginIsolated) return;

    let active = true;
    let startTimer: number | undefined;
    const frame = requestAnimationFrame(() => {
      startTimer = window.setTimeout(() => {
        if (!active) return;
        setEnvironmentError(undefined);

        const formatterInitialization = preloadFormatter()
          .then(() => {
            if (active) setFormatterReady(true);
          })
          .catch((cause) => {
            const error = cause instanceof Error ? cause : new Error(String(cause));
            if (active) setEnvironmentError(`Clang-format 加载失败：${error.message}`);
          });

        const compilerInitialization = import("./compiler/runtime.js")
          .then(({ loadCompiler }) => loadCompiler({
            log: appendLog,
            onProgress: ({ percent }) => {
              if (
                active &&
                percent !== undefined &&
                percent !== compilerProgressRef.current
              ) {
                compilerProgressRef.current = percent;
                setCompilerProgress(percent);
              }
            },
          }))
          .then(() => {
            if (active) {
              setCompilerProgress(100);
              setCompilerReady(true);
            }
          })
          .catch((cause) => {
            const error = cause instanceof Error ? cause : new Error(String(cause));
            if (active) setEnvironmentError(`Clang 22 加载失败：${error.message}`);
          });

        void Promise.allSettled([formatterInitialization, compilerInitialization]);
      }, 0);
    });

    return () => {
      active = false;
      cancelAnimationFrame(frame);
      if (startTimer !== undefined) window.clearTimeout(startTimer);
    };
  }, [appendLog, editorReady]);

  const reportRuntimeError = useCallback(
    (cause: unknown) => {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      appendLog({ source: "terminal", event: "runtime:error", message: error.message });
      terminalRef.current?.writeln(`\r\n\x1b[2m[运行时错误] ${error.message}\x1b[0m`);
      setRunState("error");
      sessionRef.current = undefined;
      setSession(undefined);
    },
    [appendLog],
  );

  const runCurrentFile = useCallback(async () => {
    if (
      !environmentReadyRef.current ||
      busyRef.current ||
      !activeEditorFile ||
      !activeSourceLanguage ||
      !activeLanguageStandard
    ) return;
    busyRef.current = true;
    const file = activeEditorFile;
    const source = file.content;
    const syncedTextFileNames = new Set<string>();
    let previousVirtualFileSyncError: string | undefined;
    const reportVirtualFileSyncError = (cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (message === previousVirtualFileSyncError) return;
      previousVirtualFileSyncError = message;
      terminalRef.current?.writeln(
        `\r\n\x1b[2m[虚拟文件] 同步失败：${terminalText(message)}\x1b[0m`,
      );
    };
    const syncRuntimeTextFiles = (virtualFiles: Readonly<Record<string, string>>) => {
      try {
        const result = workspace.syncRuntimeTextFiles(virtualFiles);
        previousVirtualFileSyncError = undefined;
        for (const name of [...result.added, ...result.updated, ...result.removed]) {
          syncedTextFileNames.add(name.toLowerCase());
        }
        return result;
      } catch (cause) {
        reportVirtualFileSyncError(cause);
        return { added: [], updated: [], removed: [] };
      }
    };
    setPanelOpen(true);
    setPanelMaximized(false);
    setActiveTab("terminal");
    setDiagnosticsByFile((current) => ({ ...current, [file.id]: [] }));
    terminalRef.current?.clear();
    const compilerDriver = compilerDriverForLanguage(activeSourceLanguage);
    const standardLabel = languageStandardLabel(activeLanguageStandard);
    terminalRef.current?.writeln(
      `\x1b[1m${file.name}\x1b[0m  ·  ${standardLabel}  ·  ${compilerDriver} 22.1.0`,
    );
    terminalRef.current?.writeln("\x1b[2m编译和运行均在当前浏览器中完成。\x1b[0m\r\n");

    try {
      const programArguments = parseProgramArguments(runConfiguration.argumentText);
      setRunState("loading");
      const { loadCompiler } = await import("./compiler/runtime.js");
      const adapter: ClangCompilerAdapter = await loadCompiler({
        log: appendLog,
      });

      setRunState("compiling");
      terminalRef.current?.writeln(`\x1b[2m[${compilerDriver}] 正在编译…\x1b[0m`);
      const result = await adapter.compile({
        fileName: file.name,
        source,
        standard: activeLanguageStandard,
        interactive: true,
      });
      setDiagnosticsByFile((current) => ({ ...current, [file.id]: result.diagnostics }));

      if (!result.ok || !result.wasm) {
        setRunState("error");
        terminalRef.current?.writeln(`\x1b[1m[${compilerDriver}] 编译失败\x1b[0m`);
        terminalRef.current?.write(terminalText(`${result.stdout}${result.stderr}`));
        if (result.diagnostics.length > 0) setActiveTab("problems");
        return;
      }

      terminalRef.current?.writeln(
        `\x1b[2m[${compilerDriver}] 编译完成 · ${result.elapsedMs}ms\x1b[0m\r\n`,
      );
      const virtualFiles = Object.fromEntries(
        workspace.files.map((workspaceFile) => [workspaceFile.name, workspaceFile.content]),
      );
      const nextSession = await adapter.startInteractive(result.wasm, {
        args: programArguments,
        virtualFiles,
        log: appendLog,
        onStdout: (text) => terminalRef.current?.write(text),
        onStderr: (text) => terminalRef.current?.write(terminalText(text)),
        onVirtualFiles: syncRuntimeTextFiles,
        onVirtualFilesError: reportVirtualFileSyncError,
        hiddenStderrSequences: [MAINLY_EXIT_MARKER],
      });
      const presetInput = prepareStandardInput(runConfiguration.standardInput);
      for (const inputChunk of presetInput) await nextSession.write(inputChunk);
      sessionRef.current = nextSession;
      setSession(nextSession);
      setRunState("running");
      terminalRef.current?.focus();

      void nextSession
        .waitForStderr(MAINLY_EXIT_MARKER)
        .then(() => nextSession.finish())
        .then((output) => {
          if (nextSession.terminated) return;
          syncRuntimeTextFiles(output.virtualFiles);
          if (sessionRef.current === nextSession) sessionRef.current = undefined;
          setSession((current) => (current === nextSession ? undefined : current));
          setRunState(output.ok ? "success" : "error");
          terminalRef.current?.writeln(
            `\r\n\x1b[2m[进程结束] 退出码 ${output.code}\x1b[0m`,
          );
          const syncedCount = syncedTextFileNames.size;
          if (syncedCount > 0) {
            terminalRef.current?.writeln(
              `\x1b[2m[虚拟文件] 已同步 ${syncedCount} 个文本文件\x1b[0m`,
            );
          }
        })
        .catch((cause) => {
          if (nextSession.terminated || cause instanceof TerminalTerminatedError) return;
          reportRuntimeError(cause);
        });
    } catch (cause) {
      reportRuntimeError(cause);
    }
  }, [
    activeEditorFile,
    activeLanguageStandard,
    activeSourceLanguage,
    appendLog,
    reportRuntimeError,
    runConfiguration,
    workspace.files,
  ]);

  const runCurrentFileRef = useRef(runCurrentFile);
  runCurrentFileRef.current = runCurrentFile;

  useEffect(() => {
    if (autoRunInterval === null) return;
    const timer = window.setInterval(() => {
      if (!busyRef.current) void runCurrentFileRef.current();
    }, autoRunInterval);
    return () => window.clearInterval(timer);
  }, [autoRunInterval]);

  const stopCurrentRun = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    setAutoRunInterval(null);
    sessionRef.current = undefined;
    setSession(undefined);
    terminalRef.current?.writeln("\r\n^C");
    try {
      await current.terminate();
    } finally {
      setRunState("stopped");
      terminalRef.current?.writeln("\x1b[2m[进程已终止]\x1b[0m");
    }
  }, []);

  const formatAndSaveCurrentFile = useCallback(async () => {
    const file = activeEditorFile;
    if (!file) return;
    if (busyRef.current && !isSourceCodeFileName(file.name)) return;
    const editor = editorRef.current;
    const model = editor?.getModel();
    let source = model?.getValue() ?? file.content;
    let formatted = source;

    if (!isSourceCodeFileName(file.name)) {
      workspace.saveActiveFile(source);
      return;
    }

    try {
      formatted = await formatSource(source, file.name);
      if (model && model.getValue() !== source) {
        source = model.getValue();
        formatted = await formatSource(source, file.name);
      }
    } catch (cause) {
      console.error("[mainly.c] format-on-save failed", cause);
      formatted = source;
    }

    if (activeFileIdRef.current !== file.id) return;
    if (model && model.getValue() !== source) {
      workspace.saveActiveFile(model.getValue());
      return;
    }
    if (editor && model && formatted !== source) {
      editor.pushUndoStop();
      editor.executeEdits("format-on-save", [
        {
          range: model.getFullModelRange(),
          text: formatted,
          forceMoveMarkers: true,
        },
      ]);
      editor.pushUndoStop();
    }
    workspace.saveActiveFile(formatted);
  }, [activeEditorFile, workspace]);

  function changeAutoRunInterval(interval: AutoRunInterval): void {
    setAutoRunInterval(interval);
    if (interval !== null && !busyRef.current) void runCurrentFileRef.current();
  }

  function changeRunConfiguration(configuration: RunConfiguration): void {
    setRunConfiguration(configuration);
    saveRunConfiguration(configuration);
  }

  function changeLanguageStandard(standard: LanguageStandard): void {
    if (!activeSourceLanguage || !isLanguageStandardForLanguage(activeSourceLanguage, standard)) {
      return;
    }
    setLanguageStandards((current) => ({ ...current, [activeSourceLanguage]: standard }));
    if (activeEditorFile) {
      setDiagnosticsByFile((current) => ({ ...current, [activeEditorFile.id]: [] }));
    }
    if (!busy) setRunState("idle");
  }

  function changeAutoCompletionEnabled(enabled: boolean): void {
    setEditorPreferences((current) => {
      const next = { ...current, autoCompletion: enabled };
      saveEditorPreferences(next);
      return next;
    });
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void formatAndSaveCurrentFile();
      } else if (event.ctrlKey && event.key === "Enter") {
        event.preventDefault();
        void runCurrentFile();
      } else if (event.ctrlKey && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setExplorerOpen((open) => !open);
      } else if (event.ctrlKey && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setPanelOpen((open) => !open);
      } else if (event.ctrlKey && event.key === "`") {
        event.preventDefault();
        setPanelOpen(true);
        setActiveTab("terminal");
        requestAnimationFrame(() => terminalRef.current?.focus());
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [formatAndSaveCurrentFile, runCurrentFile]);

  function updateActiveFile(content: string): void {
    const id = activeEditorFile?.id;
    if (!id) return;
    if (busyRef.current && !isSourceCodeFileName(activeEditorFile.name)) return;
    workspace.updateFile(id, content);
    setDiagnosticsByFile((current) => ({ ...current, [id]: [] }));
    if (!busy) setRunState("idle");
  }

  function openFile(id: string): void {
    if (!workspace.files.some((file) => file.id === id)) return;
    setOpenFileIds((current) => current.includes(id) ? current : [...current, id]);
    workspace.selectFile(id);
    if (!busy) setRunState("idle");
  }

  function closeFile(id: string): void {
    const index = openFileIds.indexOf(id);
    if (index < 0) return;
    const remainingIds = openFileIds.filter((fileId) => fileId !== id);
    if (workspace.activeFile.id === id) {
      const nextId = remainingIds[Math.min(index, remainingIds.length - 1)];
      if (nextId) workspace.selectFile(nextId);
      else editorRef.current = null;
      if (!busy) setRunState("idle");
    }
    setOpenFileIds(remainingIds);
  }

  function deleteFile(id: string): void {
    const target = workspace.files.find((file) => file.id === id);
    if (busyRef.current && target && !isSourceCodeFileName(target.name)) return;
    const index = openFileIds.indexOf(id);
    const remainingIds = openFileIds.filter((fileId) => fileId !== id);
    const deletingActiveFile = workspace.activeFile.id === id;
    const nextId = deletingActiveFile && index >= 0
      ? remainingIds[Math.min(index, remainingIds.length - 1)]
      : undefined;

    setOpenFileIds(remainingIds);
    workspace.deleteFile(id);
    if (nextId) workspace.selectFile(nextId);
    else if (deletingActiveFile) editorRef.current = null;
    if (!busy) setRunState("idle");

    setDiagnosticsByFile((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function clearNonCodeFiles(): void {
    if (busyRef.current) return;
    const removedIds = new Set(
      workspace.files
        .filter((file) => !isSourceCodeFileName(file.name))
        .map((file) => file.id),
    );
    if (removedIds.size === 0) return;

    const activeIndex = openFileIds.indexOf(workspace.activeFile.id);
    const remainingOpenIds = openFileIds.filter((id) => !removedIds.has(id));
    const removingActiveFile = removedIds.has(workspace.activeFile.id);
    const nextId = removingActiveFile && activeIndex >= 0
      ? remainingOpenIds[Math.min(activeIndex, remainingOpenIds.length - 1)]
      : undefined;

    setOpenFileIds(remainingOpenIds);
    workspace.clearNonCodeFiles();
    if (nextId) workspace.selectFile(nextId);
    else if (removingActiveFile) editorRef.current = null;
    if (!busy) setRunState("idle");
    setDiagnosticsByFile((current) => Object.fromEntries(
      Object.entries(current).filter(([id]) => !removedIds.has(id)),
    ));
  }

  function importWorkspace(importedWorkspace: WorkspaceTransferData): void {
    if (busyRef.current) return;
    const activeFile = workspace.replaceWorkspace(
      importedWorkspace.files,
      importedWorkspace.activeFileName,
    );
    editorRef.current = null;
    setOpenFileIds([activeFile.id]);
    setDiagnosticsByFile({});
    setRunState("idle");
  }

  function exportWorkspace(): void {
    downloadWorkspace(
      serializeWorkspace(workspace.files, activeEditorFile?.name ?? workspace.activeFile.name),
    );
  }

  function selectDiagnostic(diagnostic: ClangDiagnostic): void {
    const file = workspace.files.find((candidate) => candidate.name === diagnostic.fileName);
    if (file) openFile(file.id);
    setPanelOpen(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        editorRef.current?.setPosition({ lineNumber: diagnostic.line, column: diagnostic.column });
        editorRef.current?.revealPositionInCenter({
          lineNumber: diagnostic.line,
          column: diagnostic.column,
        });
        editorRef.current?.focus();
      });
    });
  }

  function startPanelResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (panelMaximized) return;
    event.preventDefault();
    setPanelResizing(true);
    const startY = event.clientY;
    const startHeight = panelHeight;
    const move = (moveEvent: PointerEvent) => {
      const next = Math.max(140, Math.min(window.innerHeight - 180, startHeight + startY - moveEvent.clientY));
      setPanelHeight(next);
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      setPanelResizing(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  }

  function clearOutput(): void {
    if (activeTab === "logs") setLogs([]);
    else if (activeTab === "problems") {
      setDiagnosticsByFile((current) => ({ ...current, [workspace.activeFile.id]: [] }));
    } else terminalRef.current?.clear();
  }

  function resetLayout(): void {
    setExplorerOpen(true);
    setPanelOpen(true);
    setPanelMaximized(false);
    setPanelHeight(238);
    setActiveTab("terminal");
  }

  const dialogContent = useMemo(() => {
    if (infoDialog === "about") {
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="font-medium text-neutral-100">Mainly.C 是面向 C 与 C++ 学习者的纯浏览器多文件编辑器。</p>
            <p>代码在当前浏览器中完成编译、链接和运行，不会发送到远程编译服务器。</p>
          </div>

          <dl className="grid grid-cols-[78px_1fr] gap-x-3 gap-y-1.5 rounded-lg border border-white/[0.12] bg-white/[0.045] px-3 py-2.5 text-[11px]">
            <dt className="text-neutral-400">C 标准</dt><dd className="text-neutral-100">C99 / C11 / C23</dd>
            <dt className="text-neutral-400">C++ 标准</dt><dd className="text-neutral-100">C++11 / 14 / 17 / 20 / 23 / 26</dd>
            <dt className="text-neutral-400">编译器</dt><dd className="text-neutral-100">Clang / LLD 22.1.0</dd>
            <dt className="text-neutral-400">C 标准库</dt><dd className="text-neutral-100">WASIX libc v2026-07-03.1（C23 部分支持）</dd>
            <dt className="text-neutral-400">C++ 标准库</dt><dd className="text-neutral-100">libc++ 22.1.0（WASIX）</dd>
            <dt className="text-neutral-400">格式化器</dt><dd className="text-neutral-100">Clang-format 22.1.8</dd>
            <dt className="text-neutral-400">编译目标</dt><dd className="font-mono text-[10px] text-neutral-100">wasm32-wasip1 + WASIX</dd>
            <dt className="text-neutral-400">编辑器</dt><dd className="text-neutral-100">Monaco Editor 0.53.0</dd>
            <dt className="text-neutral-400">运行时</dt><dd className="text-neutral-100">Wasmer SDK 0.8.0</dd>
          </dl>

          <div className="space-y-2 text-neutral-300">
            <p>首次打开时，编辑器显示后会在后台加载约 32 MB 的本地 Clang 工具链；准备完成前运行按钮保持禁用。文件内容、标准输入输出和诊断信息仅保存在当前浏览器。</p>
            <p>每次只构建当前文件。C23 语言模式可用，但 C23 标准库仍为部分支持；C++23 起支持 &lt;print&gt; 与 std::println，C++17 起支持常用 std::filesystem 操作。C++ 异常未启用，std::filesystem::space() 因 WASIX statvfs 限制会报告不支持，C++26 为实验性草案模式。程序运行时，文本文件由虚拟文件系统管理并每 100ms 同步到工作区，期间在编辑器中保持只读；退出或手动终止前会最终同步，失败时在终端提示。</p>
          </div>

          <div className="flex items-center justify-between border-t border-white/[0.1] pt-3 text-[10px] text-neutral-400">
            <span>© 2026 Minsecrus · MIT License</span>
            <a
              href="https://github.com/Minsecrus/Mainly.C"
              target="_blank"
              rel="noreferrer"
              className="text-neutral-200 underline decoration-white/25 underline-offset-2 hover:text-white"
            >
              GitHub
            </a>
          </div>
        </div>
      );
    }
    return (
      <div className="grid grid-cols-[1fr_auto] gap-x-8 gap-y-2">
        <span>运行当前文件</span><kbd>Ctrl + Enter</kbd>
        <span>保存当前文件</span><kbd>Ctrl + S</kbd>
        <span>切换文件侧栏</span><kbd>Ctrl + B</kbd>
        <span>切换底部面板</span><kbd>Ctrl + J</kbd>
        <span>聚焦终端</span><kbd>Ctrl + `</kbd>
        <span>终止当前程序</span><kbd>Ctrl + C</kbd>
        <span>终端发送 EOF</span><kbd>Ctrl + D</kbd>
      </div>
    );
  }, [infoDialog]);

  const dialogTitle = infoDialog === "about" ? "关于" : "键盘快捷键";

  return (
    <div className="flex h-dvh min-h-[480px] min-w-[720px] flex-col overflow-hidden bg-[#090909] text-neutral-200">
      <TopBar
        runState={runState}
        runDisabled={!environmentReady || !activeEditorFile || !activeFileRunnable}
        autoRunInterval={autoRunInterval}
        runConfiguration={runConfiguration}
        sourceLanguage={activeSourceLanguage}
        languageStandard={activeLanguageStandard}
        languageStandardDisabled={busy}
        autoCompletionEnabled={editorPreferences.autoCompletion}
        onRun={() => void runCurrentFile()}
        onStop={stopCurrentRun}
        onAutoRunIntervalChange={changeAutoRunInterval}
        onRunConfigurationChange={changeRunConfiguration}
        onLanguageStandardChange={changeLanguageStandard}
        onAutoCompletionEnabledChange={changeAutoCompletionEnabled}
        onClearOutput={clearOutput}
        onResetLayout={resetLayout}
        onShowShortcuts={() => setInfoDialog("shortcuts")}
        onShowAbout={() => setInfoDialog("about")}
      />

      <div className="flex min-h-0 flex-1">
        <ActivityRail
          explorerOpen={explorerOpen}
          panelOpen={panelOpen}
          onToggleExplorer={() => setExplorerOpen((open) => !open)}
          onTogglePanel={() => setPanelOpen((open) => !open)}
        />
        {explorerOpen && (
          <FileExplorer
            files={workspace.files}
            activeFileId={workspace.activeFileId}
            textFilesLocked={busy}
            onSelect={openFile}
            onCreate={(name, kind) => {
              if (busyRef.current && kind === "text") return;
              const file = workspace.createFile(name, kind);
              setOpenFileIds((current) => current.includes(file.id) ? current : [...current, file.id]);
            }}
            onRename={(id, name) => {
              if (busyRef.current) return;
              workspace.renameFile(id, name);
              setDiagnosticsByFile((current) => ({ ...current, [id]: [] }));
            }}
            onDelete={deleteFile}
            onImportWorkspace={importWorkspace}
            onExportWorkspace={exportWorkspace}
            onClearNonCodeFiles={clearNonCodeFiles}
            onReset={() => {
              if (busyRef.current) return;
              workspace.resetWorkspace();
              setOpenFileIds(["main-c"]);
              setDiagnosticsByFile({});
              setRunState("idle");
            }}
          />
        )}

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <EditorPane
            file={activeEditorFile}
            openFiles={openFiles}
            dirtyFileIds={workspace.dirtyFileIds}
            diagnostics={activeDiagnostics}
            editorRef={editorRef}
            textFileReadOnly={busy}
            languageStandard={activeLanguageStandard}
            autoCompletionEnabled={editorPreferences.autoCompletion}
            onEditorReady={() => setEditorReady(true)}
            onChange={updateActiveFile}
            onSelectFile={openFile}
            onCloseFile={closeFile}
          />
          {panelOpen && !panelMaximized && (
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="调整输出面板高度"
              onPointerDown={startPanelResize}
              className="group relative z-10 h-1 shrink-0 cursor-row-resize bg-[#1f1f1f]"
            >
              <div className="absolute inset-x-0 -top-0.5 h-1.5 transition-colors group-hover:bg-white/10" />
            </div>
          )}
          <div
            className={`shrink-0 overflow-hidden ${
              panelResizing ? "transition-none" : "transition-[height] duration-150"
            }`}
            style={{
              height: panelOpen
                ? panelMaximized
                  ? "calc(100% - 38px)"
                  : panelHeight
                : 0,
            }}
          >
            <OutputPanel
              activeTab={activeTab}
              runState={runState}
              diagnostics={activeDiagnostics}
              logs={logs}
              session={session}
              maximized={panelMaximized}
              terminalRef={terminalRef}
              terminalNotice={terminalNotice}
              onTabChange={setActiveTab}
              onSelectDiagnostic={selectDiagnostic}
              onClear={clearOutput}
              onCollapse={() => setPanelOpen(false)}
              onToggleMaximize={() => {
                setPanelOpen(true);
                setPanelMaximized((maximized) => !maximized);
              }}
              onInputError={reportRuntimeError}
              onInterrupt={stopCurrentRun}
            />
          </div>
        </main>
      </div>

      <InfoDialog open={infoDialog !== null} title={dialogTitle} onOpenChange={(open) => !open && setInfoDialog(null)}>
        {dialogContent}
      </InfoDialog>
    </div>
  );
}
