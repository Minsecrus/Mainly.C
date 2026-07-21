import { useEffect, useRef, useState } from "react";
import Editor, { loader, type Monaco, type OnMount } from "@monaco-editor/react";
import * as localMonaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/editor/editor.all";
import "monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

import type { ClangDiagnostic } from "../compiler/diagnostics.js";
import {
  isCSourceFileName,
  type SourceFile,
} from "../features/files/useLocalFiles.js";
import { registerCCompletions } from "./cCompletions.js";

type StandaloneEditor = localMonaco.editor.IStandaloneCodeEditor;

interface CodeEditorProps {
  file: SourceFile;
  diagnostics: ClangDiagnostic[];
  onChange: (value: string) => void;
  onReady: (editor: StandaloneEditor) => void;
}

const monacoGlobal = globalThis as typeof globalThis & {
  MonacoEnvironment?: { getWorker: () => Worker };
};
monacoGlobal.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};
loader.config({ monaco: localMonaco });

let completionsRegistered = false;
let themeRegistered = false;

function configureMonaco(monaco: Monaco): void {
  if (!themeRegistered) {
    monaco.editor.defineTheme("mainly-monochrome", {
      base: "vs-dark",
      inherit: false,
      colors: {
        "editor.background": "#121212",
        "editor.foreground": "#ffffff",
        "editorLineNumber.foreground": "#8a8a8a",
        "editorLineNumber.activeForeground": "#e5e5e5",
        "editorCursor.foreground": "#f5f5f5",
        "editor.selectionBackground": "#40404088",
        "editor.inactiveSelectionBackground": "#30303077",
        "editor.lineHighlightBackground": "#1b1b1b",
        "editorIndentGuide.background1": "#383838",
        "editorIndentGuide.activeBackground1": "#737373",
        "editorSuggestWidget.background": "#1d1d1d",
        "editorSuggestWidget.foreground": "#e5e5e5",
        "editorSuggestWidget.border": "#525252",
        "editorSuggestWidget.selectedBackground": "#3a3a3a",
        "editorSuggestWidget.selectedForeground": "#ffffff",
        "editorSuggestWidget.highlightForeground": "#ffffff",
        "editorHoverWidget.background": "#1d1d1d",
        "editorHoverWidget.foreground": "#e5e5e5",
        "editorHoverWidget.border": "#525252",
        "editorWidget.foreground": "#e5e5e5",
        "input.foreground": "#f5f5f5",
        "input.placeholderForeground": "#a3a3a3",
        "list.hoverForeground": "#ffffff",
        "list.activeSelectionForeground": "#ffffff",
        "list.inactiveSelectionForeground": "#ffffff",
        "editorError.foreground": "#f5f5f5",
        "editorWarning.foreground": "#a3a3a3",
        "editorOverviewRuler.border": "#00000000",
      },
      rules: [
        { token: "comment", foreground: "8A8A8A", fontStyle: "italic" },
        { token: "comment.doc", foreground: "969696", fontStyle: "italic" },
        { token: "keyword", foreground: "F5F5F5", fontStyle: "bold" },
        { token: "keyword.directive", foreground: "D4D4D4", fontStyle: "bold" },
        { token: "keyword.directive.include", foreground: "E5E5E5", fontStyle: "bold" },
        { token: "string", foreground: "BDBDBD" },
        { token: "string.include.identifier", foreground: "D4D4D4" },
        { token: "string.escape", foreground: "FFFFFF", fontStyle: "bold" },
        { token: "string.invalid", foreground: "FFFFFF", fontStyle: "underline" },
        { token: "number", foreground: "E5E5E5" },
        { token: "type", foreground: "D4D4D4" },
        { token: "identifier", foreground: "FFFFFF" },
        { token: "annotation", foreground: "B8B8B8" },
        { token: "delimiter", foreground: "A3A3A3" },
        { token: "delimiter.bracket", foreground: "A3A3A3" },
        { token: "delimiter.parenthesis", foreground: "B8B8B8" },
        { token: "operator", foreground: "A3A3A3" },
        { token: "variable", foreground: "FFFFFF" },
        { token: "function", foreground: "FFFFFF" },
      ],
    });
    themeRegistered = true;
  }
  if (!completionsRegistered) {
    registerCCompletions(monaco);
    completionsRegistered = true;
  }
}

function markerSeverity(monaco: Monaco, diagnostic: ClangDiagnostic): number {
  if (diagnostic.severity === "error") return monaco.MarkerSeverity.Error;
  if (diagnostic.severity === "warning") return monaco.MarkerSeverity.Warning;
  return monaco.MarkerSeverity.Info;
}

export function CodeEditor({
  file,
  diagnostics,
  onChange,
  onReady,
}: CodeEditorProps) {
  const editorRef = useRef<StandaloneEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationIdsRef = useRef<string[]>([]);
  const [readyEpoch, setReadyEpoch] = useState(0);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setReadyEpoch((epoch) => epoch + 1);
    onReady(editor);
    editor.focus();
    void document.fonts.load('14px "Monaspace Neon"').then(() => {
      monaco.editor.remeasureFonts();
      editor.layout();
    });
  };

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel();
    if (!editor || !monaco || !model) return;

    const currentDiagnostics = diagnostics.filter((item) => item.fileName === file.name);
    monaco.editor.setModelMarkers(
      model,
      "clang",
      currentDiagnostics.map((diagnostic) => ({
        startLineNumber: diagnostic.line,
        startColumn: diagnostic.column,
        endLineNumber: diagnostic.endLine,
        endColumn: diagnostic.endColumn,
        severity: markerSeverity(monaco, diagnostic),
        message: diagnostic.message,
        code: diagnostic.code,
        source: "clang 22",
      })),
    );

    const firstByLine = new Map<number, ClangDiagnostic>();
    for (const diagnostic of currentDiagnostics) {
      if (!firstByLine.has(diagnostic.line)) firstByLine.set(diagnostic.line, diagnostic);
    }
    decorationIdsRef.current = editor.deltaDecorations(
      decorationIdsRef.current,
      [...firstByLine.values()].flatMap((diagnostic) => {
        const line = Math.min(diagnostic.line, model.getLineCount());
        const maxColumn = model.getLineMaxColumn(line);
        const injectedText = {
          content: `  ${diagnostic.severity === "error" ? "×" : "!"} ${diagnostic.message}`,
          inlineClassName:
            diagnostic.severity === "error"
              ? "mainly-error-lens-message"
              : "mainly-warning-lens-message",
        };
        const messageDecoration = maxColumn > 1
          ? {
              range: new monaco.Range(line, maxColumn - 1, line, maxColumn),
              options: { after: injectedText, showIfCollapsed: true },
            }
          : {
              range: new monaco.Range(line, 1, line, 1),
              options: { before: injectedText, showIfCollapsed: true },
            };
        return [
          {
            range: new monaco.Range(line, 1, line, maxColumn),
            options: {
              isWholeLine: true,
              className:
                diagnostic.severity === "error"
                  ? "mainly-error-lens-line"
                  : "mainly-warning-lens-line",
              glyphMarginClassName:
                diagnostic.severity === "error"
                  ? "mainly-error-glyph"
                  : "mainly-warning-glyph",
              hoverMessage: { value: `**clang 22** — ${diagnostic.message}` },
            },
          },
          messageDecoration,
        ];
      }),
    );
  }, [diagnostics, file.name, readyEpoch]);

  return (
    <Editor
      key={file.id}
      height="100%"
      path={`file:///${file.name}`}
      language={isCSourceFileName(file.name) ? "c" : "plaintext"}
      theme="mainly-monochrome"
      value={file.content}
      beforeMount={configureMonaco}
      onMount={handleMount}
      onChange={(value) => onChange(value ?? "")}
      loading={
        <div className="flex h-full items-center justify-center bg-[#121212] text-xs text-neutral-300">
          正在载入编辑器…
        </div>
      }
      options={{
        automaticLayout: true,
        editContext: false,
        fontFamily: "'Monaspace Neon', 'HarmonyOS Sans SC', ui-monospace, monospace",
        fontSize: 14,
        lineHeight: 22,
        fontLigatures: true,
        minimap: { enabled: false },
        glyphMargin: true,
        folding: true,
        foldingHighlight: false,
        renderLineHighlight: "all",
        renderWhitespace: "selection",
        smoothScrolling: true,
        cursorSmoothCaretAnimation: "on",
        cursorBlinking: "smooth",
        scrollBeyondLastLine: false,
        overviewRulerLanes: 2,
        padding: { top: 14, bottom: 14 },
        suggest: { showWords: false, preview: true },
        quickSuggestions: { other: true, comments: false, strings: false },
        tabSize: 4,
        insertSpaces: true,
        bracketPairColorization: { enabled: false },
        guides: { bracketPairs: false, indentation: true },
        stickyScroll: { enabled: false },
      }}
    />
  );
}
