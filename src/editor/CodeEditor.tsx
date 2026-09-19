import { useEffect, useRef, useState } from "react";
import Editor, { loader, type Monaco, type OnMount } from "@monaco-editor/react";
import * as localMonaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/editor/editor.all";
import "monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

import type { ClangDiagnostic } from "../compiler/diagnostics.js";
import type { SourceFile } from "../features/files/useLocalFiles.js";
import { sourceLanguageForFileName, type LanguageStandard } from "../languages.js";
import {
  clangdClient,
  clangdFileNameFromUri,
  clangdUriForFileName,
  type ClangdStatus,
} from "../lsp/ClangdClient.js";
import { registerClangdProviders } from "../lsp/monacoProviders.js";
import { attachEditorInputDebug } from "./inputDebug.js";
import { useTheme } from "../features/theme/ThemeProvider.js";
import { MONACO_THEME_NAME, monacoTheme } from "../features/theme/editorThemes.js";
import type { ThemePalette } from "../features/theme/palette.js";
import {
  clearModelCompletionContext,
  registerLanguageCompletions,
  setModelCompletionContext,
} from "./languageCompletions.js";

type StandaloneEditor = localMonaco.editor.IStandaloneCodeEditor;

interface CodeEditorProps {
  file: SourceFile;
  diagnostics: ClangDiagnostic[];
  readOnly?: boolean;
  languageStandard?: LanguageStandard;
  autoCompletionEnabled: boolean;
  onChange: (value: string) => void;
  onReady: (editor: StandaloneEditor) => void;
  onOpenFileAtPosition: (
    fileName: string,
    position: localMonaco.IPosition,
  ) => boolean;
}

const monacoGlobal = globalThis as typeof globalThis & {
  MonacoEnvironment?: { getWorker: () => Worker };
};
monacoGlobal.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};
loader.config({ monaco: localMonaco });

let completionsRegistered = false;

function configureMonaco(monaco: Monaco, palette: ThemePalette): void {
  monaco.editor.defineTheme(MONACO_THEME_NAME, monacoTheme(palette));
  if (!completionsRegistered) {
    registerLanguageCompletions(monaco);
    registerClangdProviders(monaco as typeof localMonaco);
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
  readOnly = false,
  languageStandard,
  autoCompletionEnabled,
  onChange,
  onReady,
  onOpenFileAtPosition,
}: CodeEditorProps) {
  const { palette } = useTheme();
  const editorRef = useRef<StandaloneEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationIdsRef = useRef<string[]>([]);
  const editorOpenerRef = useRef<localMonaco.IDisposable | null>(null);
  const [readyEpoch, setReadyEpoch] = useState(0);
  const [clangdStatus, setClangdStatus] = useState<ClangdStatus>(clangdClient.status);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    attachEditorInputDebug(editor, monaco, file.name);
    editorOpenerRef.current?.dispose();
    editorOpenerRef.current = monaco.editor.registerEditorOpener({
      openCodeEditor(source, resource, selectionOrPosition) {
        const targetFileName = clangdFileNameFromUri(resource.toString());
        if (!targetFileName || !selectionOrPosition) return false;
        const position = "lineNumber" in selectionOrPosition
          ? selectionOrPosition
          : {
              lineNumber: selectionOrPosition.startLineNumber,
              column: selectionOrPosition.startColumn,
            };
        if (targetFileName === file.name) {
          source.setPosition(position);
          source.revealPositionInCenter(position);
          source.focus();
          return true;
        }
        return onOpenFileAtPosition(targetFileName, position);
      },
    });
    setReadyEpoch((epoch) => epoch + 1);
    onReady(editor);
    editor.focus();
    void document.fonts.load('14px "Monaspace Neon"').then(() => {
      monaco.editor.remeasureFonts();
      editor.layout();
    });
  };

  useEffect(() => clangdClient.subscribeStatus(setClangdStatus), []);

  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    monaco.editor.defineTheme(MONACO_THEME_NAME, monacoTheme(palette));
    monaco.editor.setTheme(MONACO_THEME_NAME);
  }, [palette, readyEpoch]);

  useEffect(() => () => {
    editorOpenerRef.current?.dispose();
    editorOpenerRef.current = null;
  }, []);

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
        source: diagnostic.source ?? "clang 22",
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
              hoverMessage: { value: `**${diagnostic.source ?? "clang 22"}** — ${diagnostic.message}` },
            },
          },
          messageDecoration,
        ];
      }),
    );
  }, [diagnostics, file.name, readyEpoch]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model) return;
    setModelCompletionContext(model, {
      enabled: autoCompletionEnabled && clangdStatus !== "ready",
      standard: languageStandard,
    });
    return () => clearModelCompletionContext(model);
  }, [autoCompletionEnabled, clangdStatus, file.id, languageStandard, readyEpoch]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    const language = sourceLanguageForFileName(file.name);
    if (!model || !language) return;
    return clangdClient.attachModel(model, language, autoCompletionEnabled).dispose;
  }, [file.id, file.name, readyEpoch]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model) clangdClient.setCompletionEnabled(model, autoCompletionEnabled);
  }, [autoCompletionEnabled, file.id, readyEpoch]);

  useEffect(() => {
    const editorNode = editorRef.current?.getDomNode();
    if (editorNode) editorNode.dataset.clangdStatus = clangdStatus;
  }, [clangdStatus, readyEpoch]);

  return (
    <Editor
      key={`${file.id}:${file.name}`}
      height="100%"
      path={clangdUriForFileName(file.name)}
      language={sourceLanguageForFileName(file.name) ?? "plaintext"}
      theme={MONACO_THEME_NAME}
      value={file.content}
      beforeMount={(monaco) => configureMonaco(monaco, palette)}
      onMount={handleMount}
      onChange={(value) => {
        if (!readOnly) onChange(value ?? "");
      }}
      loading={
        <div className="flex h-full items-center justify-center bg-canvas text-xs text-secondary">
          正在载入编辑器…
        </div>
      }
      options={{
        automaticLayout: true,
        readOnly,
        domReadOnly: readOnly,
        readOnlyMessage: { value: "程序运行期间，文本文件由虚拟文件系统管理并保持只读。" },
        // Keep native input enabled where supported; the textarea fallback can
        // lose its browser selection after mouse clicks in Chromium.
        editContext: true,
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
        suggest: { showWords: autoCompletionEnabled, preview: true, showSnippets: true },
        quickSuggestions: autoCompletionEnabled
          ? { other: true, comments: false, strings: false }
          : false,
        suggestOnTriggerCharacters: autoCompletionEnabled,
        snippetSuggestions: autoCompletionEnabled ? "inline" : "none",
        wordBasedSuggestions: autoCompletionEnabled ? "currentDocument" : "off",
        tabSize: 4,
        insertSpaces: true,
        bracketPairColorization: { enabled: false },
        guides: { bracketPairs: false, indentation: true },
        stickyScroll: { enabled: false },
      }}
    />
  );
}
