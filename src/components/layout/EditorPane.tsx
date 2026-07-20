import type { RefObject } from "react";
import { Circle, X } from "lucide-react";
import type * as MonacoEditor from "monaco-editor";

import type { ClangDiagnostic } from "../../compiler/diagnostics.js";
import type { SourceFile } from "../../features/files/useLocalFiles.js";
import { CodeEditor } from "../../editor/CodeEditor.js";

interface EditorPaneProps {
  file: SourceFile;
  diagnostics: ClangDiagnostic[];
  dirty: boolean;
  editorRef: RefObject<MonacoEditor.editor.IStandaloneCodeEditor | null>;
  onEditorReady: () => void;
  onChange: (content: string) => void;
}

export function EditorPane({
  file,
  diagnostics,
  dirty,
  editorRef,
  onEditorReady,
  onChange,
}: EditorPaneProps) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#121212]">
      <div className="flex h-9 shrink-0 border-b border-white/[0.1] bg-[#0d0d0d]">
        <div className="flex min-w-[154px] max-w-[240px] items-center gap-2 border-t border-t-white border-r border-r-white/[0.1] bg-[#181818] px-3 text-[11px] text-neutral-100">
          <span className="font-mono text-[9px] font-bold text-neutral-300">C</span>
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          {dirty ? (
            <Circle className="size-2.5 fill-neutral-400 text-neutral-400" />
          ) : (
            <X className="size-3 text-neutral-500" />
          )}
        </div>
        <div className="flex-1" />
      </div>
      <div className="min-h-0 flex-1">
        <CodeEditor
          file={file}
          diagnostics={diagnostics}
          onChange={onChange}
          onReady={(editor) => {
            editorRef.current = editor;
            onEditorReady();
          }}
        />
      </div>
    </section>
  );
}
