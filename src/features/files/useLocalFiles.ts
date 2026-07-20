import { useEffect, useMemo, useRef, useState } from "react";

export interface SourceFile {
  id: string;
  name: string;
  content: string;
}

interface StoredWorkspace {
  files: SourceFile[];
  activeFileId: string;
}

const STORAGE_KEY = "mainly.c.workspace.v1";

export const DEFAULT_SOURCE = `#include <stdio.h>

int main(void) {
    char name[64];

    printf("What is your name? ");
    fflush(stdout);

    if (fgets(name, sizeof name, stdin) == NULL) {
        return 1;
    }

    printf("Hello, %s", name);
    return 0;
}
`;

function starterWorkspace(): StoredWorkspace {
  return {
    files: [{ id: "main-c", name: "main.c", content: DEFAULT_SOURCE }],
    activeFileId: "main-c",
  };
}

function contentSnapshot(files: readonly SourceFile[]): Record<string, string> {
  return Object.fromEntries(files.map((file) => [file.id, file.content]));
}

function loadWorkspace(): StoredWorkspace {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return starterWorkspace();
    const parsed = JSON.parse(value) as Partial<StoredWorkspace>;
    const files = parsed.files?.filter(
      (file): file is SourceFile =>
        typeof file?.id === "string" &&
        typeof file?.name === "string" &&
        file.name.toLowerCase().endsWith(".c") &&
        typeof file?.content === "string",
    );
    if (!files?.length) return starterWorkspace();
    const activeFileId = files.some((file) => file.id === parsed.activeFileId)
      ? parsed.activeFileId!
      : files[0].id;
    return { files, activeFileId };
  } catch {
    return starterWorkspace();
  }
}

export function normalizeCFileName(value: string): string {
  const trimmed = value.trim().replaceAll(/[/\\]/g, "-");
  return trimmed.toLowerCase().endsWith(".c") ? trimmed : `${trimmed}.c`;
}

export function useLocalFiles() {
  const [workspace, setWorkspace] = useState<StoredWorkspace>(loadWorkspace);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const [savedContents, setSavedContents] = useState<Record<string, string>>(() =>
    contentSnapshot(workspace.files),
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  }, [workspace]);

  const activeFile = useMemo(
    () =>
      workspace.files.find((file) => file.id === workspace.activeFileId) ??
      workspace.files[0],
    [workspace],
  );

  function selectFile(id: string): void {
    setWorkspace((current) =>
      current.files.some((file) => file.id === id)
        ? { ...current, activeFileId: id }
        : current,
    );
  }

  function updateFile(id: string, content: string): void {
    setWorkspace((current) => ({
      ...current,
      files: current.files.map((file) => (file.id === id ? { ...file, content } : file)),
    }));
  }

  function createFile(rawName: string): SourceFile {
    const name = normalizeCFileName(rawName);
    if (!name || name === ".c") throw new Error("请输入文件名");
    if (workspace.files.some((file) => file.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("同名文件已经存在");
    }
    const file: SourceFile = {
      id: crypto.randomUUID(),
      name,
      content: `#include <stdio.h>\n\nint main(void) {\n    puts("Hello, C23!");\n    return 0;\n}\n`,
    };
    setWorkspace((current) => ({
      files: [...current.files, file],
      activeFileId: file.id,
    }));
    return file;
  }

  function renameFile(id: string, rawName: string): void {
    const name = normalizeCFileName(rawName);
    if (!name || name === ".c") throw new Error("请输入文件名");
    if (
      workspace.files.some(
        (file) => file.id !== id && file.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      throw new Error("同名文件已经存在");
    }
    setWorkspace((current) => ({
      ...current,
      files: current.files.map((file) => (file.id === id ? { ...file, name } : file)),
    }));
  }

  function deleteFile(id: string): void {
    setSavedContents((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setWorkspace((current) => {
      const files = current.files.filter((file) => file.id !== id);
      if (files.length === 0) return starterWorkspace();
      return {
        files,
        activeFileId:
          current.activeFileId === id ? files[0].id : current.activeFileId,
      };
    });
  }

  function resetWorkspace(): void {
    const next = starterWorkspace();
    setWorkspace(next);
    setSavedContents(contentSnapshot(next.files));
  }

  function saveActiveFile(content = activeFile.content): void {
    const current = workspaceRef.current;
    const activeId = current.activeFileId;
    const next = {
      ...current,
      files: current.files.map((file) =>
        file.id === activeId ? { ...file, content } : file,
      ),
    };
    workspaceRef.current = next;
    setWorkspace(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSavedContents((current) => ({
      ...current,
      [activeId]: content,
    }));
  }

  return {
    files: workspace.files,
    activeFile,
    activeFileId: workspace.activeFileId,
    selectFile,
    updateFile,
    createFile,
    renameFile,
    deleteFile,
    resetWorkspace,
    saveActiveFile,
    activeFileDirty: savedContents[activeFile.id] !== activeFile.content,
  };
}
