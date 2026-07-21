import type { RefObject } from "react";
import { Circle, X } from "lucide-react";
import type * as MonacoEditor from "monaco-editor";

import type { ClangDiagnostic } from "../../compiler/diagnostics.js";
import type { SourceFile } from "../../features/files/useLocalFiles.js";
import { CodeEditor } from "../../editor/CodeEditor.js";
import { FileLabel } from "../ui/FileLabel.js";

interface EditorPaneProps {
  file?: SourceFile;
  openFiles: SourceFile[];
  dirtyFileIds: ReadonlySet<string>;
  diagnostics: ClangDiagnostic[];
  editorRef: RefObject<MonacoEditor.editor.IStandaloneCodeEditor | null>;
  onEditorReady: () => void;
  onChange: (content: string) => void;
  onSelectFile: (id: string) => void;
  onCloseFile: (id: string) => void;
}

export function EditorPane({
  file,
  openFiles,
  dirtyFileIds,
  diagnostics,
  editorRef,
  onEditorReady,
  onChange,
  onSelectFile,
  onCloseFile,
}: EditorPaneProps) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#121212]">
      <div className="flex h-9 shrink-0 overflow-x-auto overflow-y-hidden border-b border-white/[0.1] bg-[#0d0d0d]">
        {openFiles.map((openFile) => {
          const active = openFile.id === file?.id;
          return (
            <div
              key={openFile.id}
              className={
                `group flex min-w-[154px] max-w-[240px] shrink-0 items-center border-r border-r-white/[0.1] px-3 text-[11px] ${
                  active
                    ? "border-t border-t-white bg-[#181818] text-neutral-100"
                    : "border-t border-t-transparent bg-[#101010] text-neutral-400 hover:bg-[#151515] hover:text-neutral-200"
                }`
              }
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
                onClick={() => onSelectFile(openFile.id)}
              >
                <FileLabel
                  name={openFile.name}
                  className="flex-1"
                  markerClassName="text-[9px] font-bold text-neutral-300"
                />
                {dirtyFileIds.has(openFile.id) && (
                  <Circle
                    aria-label="未保存"
                    className="size-2 shrink-0 fill-neutral-400 text-neutral-400"
                  />
                )}
              </button>
              <button
                type="button"
                aria-label={`关闭 ${openFile.name}`}
                className="ml-2 grid size-5 shrink-0 place-items-center rounded text-neutral-500 outline-none hover:bg-white/[0.1] hover:text-neutral-100 focus-visible:bg-white/[0.1] focus-visible:text-neutral-100"
                onClick={() => onCloseFile(openFile.id)}
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
        <div className="min-w-4 flex-1" />
      </div>
      <div className="min-h-0 flex-1">
        {file && (
          <CodeEditor
            file={file}
            diagnostics={diagnostics}
            onChange={onChange}
            onReady={(editor) => {
              editorRef.current = editor;
              onEditorReady();
            }}
          />
        )}
      </div>
    </section>
  );
}
