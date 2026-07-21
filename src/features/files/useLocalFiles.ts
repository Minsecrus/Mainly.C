import { useEffect, useMemo, useRef, useState } from "react";

import {
  isSourceCodeFileName,
  sourceLanguageForFileName,
  type SourceLanguage,
} from "../../languages.js";

export interface SourceFile {
  id: string;
  name: string;
  content: string;
}

export type SourceFileKind = SourceLanguage | "text";

export interface RuntimeTextFileSyncResult {
  added: string[];
  updated: string[];
  removed: string[];
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
        isSupportedSourceFileName(file.name) &&
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

export function isCSourceFileName(name: string): boolean {
  return sourceLanguageForFileName(name) === "c";
}

export function isCppSourceFileName(name: string): boolean {
  return sourceLanguageForFileName(name) === "cpp";
}

export function isSupportedSourceFileName(name: string): boolean {
  if (!name || name.includes("/") || name.includes("\\")) return false;
  const lowerName = name.toLowerCase();
  if (isSourceCodeFileName(lowerName)) return !lowerName.startsWith(".");
  if (lowerName.endsWith(".txt")) return lowerName !== ".txt";
  return false;
}

export function normalizeSourceFileName(
  value: string,
  defaultKind: SourceFileKind = "c",
): string {
  const trimmed = value.trim().replaceAll(/[/\\]/g, "-");
  if (!trimmed) throw new Error("请输入文件名");
  const lowerName = trimmed.toLowerCase();
  if (isSupportedSourceFileName(trimmed)) {
    return trimmed;
  }
  if (/\.[^.]+$/.test(trimmed)) {
    throw new Error("仅支持 .c、.cpp、.cc、.cxx 和 .txt 文件");
  }
  const extension = defaultKind === "cpp" ? "cpp" : defaultKind === "c" ? "c" : "txt";
  return `${trimmed}.${extension}`;
}

export function useLocalFiles() {
  const [workspace, setWorkspace] = useState<StoredWorkspace>(loadWorkspace);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const [savedContents, setSavedContents] = useState<Record<string, string>>(() =>
    contentSnapshot(workspace.files),
  );
  const savedContentsRef = useRef(savedContents);
  savedContentsRef.current = savedContents;

  const activeFile = useMemo(
    () =>
      workspace.files.find((file) => file.id === workspace.activeFileId) ??
      workspace.files[0],
    [workspace],
  );
  const dirtyFileIds = useMemo(
    () => new Set(
      workspace.files
        .filter((file) => savedContents[file.id] !== file.content)
        .map((file) => file.id),
    ),
    [savedContents, workspace.files],
  );

  useEffect(() => {
    if (dirtyFileIds.size === 0) return;
    const warnAboutUnsavedChanges = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnAboutUnsavedChanges);
    return () => window.removeEventListener("beforeunload", warnAboutUnsavedChanges);
  }, [dirtyFileIds]);

  function persistWorkspace(
    nextWorkspace: StoredWorkspace,
    nextSavedContents: Record<string, string>,
  ): void {
    const storedWorkspace: StoredWorkspace = {
      ...nextWorkspace,
      files: nextWorkspace.files.map((file) => ({
        ...file,
        content: nextSavedContents[file.id] ?? file.content,
      })),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(storedWorkspace));
    } catch (cause) {
      const quotaExceeded = cause instanceof DOMException &&
        (cause.name === "QuotaExceededError" || cause.name === "NS_ERROR_DOM_QUOTA_REACHED");
      throw new Error(
        quotaExceeded
          ? "浏览器存储空间不足，无法保存工作区"
          : `无法保存浏览器工作区：${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );
    }
  }

  function applyCommittedWorkspace(
    nextWorkspace: StoredWorkspace,
    nextSavedContents: Record<string, string>,
  ): void {
    workspaceRef.current = nextWorkspace;
    savedContentsRef.current = nextSavedContents;
    setWorkspace(nextWorkspace);
    setSavedContents(nextSavedContents);
    persistWorkspace(nextWorkspace, nextSavedContents);
  }

  function selectFile(id: string): void {
    const current = workspaceRef.current;
    if (!current.files.some((file) => file.id === id) || current.activeFileId === id) return;
    const next = { ...current, activeFileId: id };
    workspaceRef.current = next;
    setWorkspace(next);
    persistWorkspace(next, savedContentsRef.current);
  }

  function updateFile(id: string, content: string): void {
    const current = workspaceRef.current;
    const next = {
      ...current,
      files: current.files.map((file) => (file.id === id ? { ...file, content } : file)),
    };
    workspaceRef.current = next;
    setWorkspace(next);
  }

  function createFile(rawName: string, defaultKind: SourceFileKind = "c"): SourceFile {
    const name = normalizeSourceFileName(rawName, defaultKind);
    const current = workspaceRef.current;
    if (current.files.some((file) => file.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("同名文件已经存在");
    }
    const file: SourceFile = {
      id: crypto.randomUUID(),
      name,
      content: isCSourceFileName(name)
        ? `#include <stdio.h>\n\nint main(void) {\n    puts("Hello, C!");\n}\n`
        : isCppSourceFileName(name)
          ? `#include <iostream>\n\nint main() {\n    std::cout << "Hello, C++!\\n";\n}\n`
          : "",
    };
    const next = {
      files: [...current.files, file],
      activeFileId: file.id,
    };
    applyCommittedWorkspace(next, { ...savedContentsRef.current, [file.id]: file.content });
    return file;
  }

  function renameFile(id: string, rawName: string): void {
    const current = workspaceRef.current;
    const currentFile = current.files.find((file) => file.id === id);
    const currentLanguage = currentFile
      ? sourceLanguageForFileName(currentFile.name)
      : undefined;
    const name = normalizeSourceFileName(rawName, currentLanguage ?? "text");
    if (
      current.files.some(
        (file) => file.id !== id && file.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      throw new Error("同名文件已经存在");
    }
    const next = {
      ...current,
      files: current.files.map((file) => (file.id === id ? { ...file, name } : file)),
    };
    workspaceRef.current = next;
    setWorkspace(next);
    persistWorkspace(next, savedContentsRef.current);
  }

  function deleteFile(id: string): void {
    const current = workspaceRef.current;
    const files = current.files.filter((file) => file.id !== id);
    const next = files.length > 0
      ? {
          files,
          activeFileId: current.activeFileId === id ? files[0].id : current.activeFileId,
        }
      : starterWorkspace();
    const nextSavedContents = files.length > 0
      ? Object.fromEntries(
          Object.entries(savedContentsRef.current).filter(([fileId]) => fileId !== id),
        )
      : contentSnapshot(next.files);
    applyCommittedWorkspace(next, nextSavedContents);
  }

  function resetWorkspace(): void {
    const next = starterWorkspace();
    applyCommittedWorkspace(next, contentSnapshot(next.files));
  }

  function clearNonCodeFiles(): string[] {
    const current = workspaceRef.current;
    const removedIds = current.files
      .filter((file) => !isSourceCodeFileName(file.name))
      .map((file) => file.id);
    if (removedIds.length === 0) return removedIds;

    const codeFiles = current.files.filter((file) => isSourceCodeFileName(file.name));
    const next = codeFiles.length > 0
      ? {
          files: codeFiles,
          activeFileId: codeFiles.some((file) => file.id === current.activeFileId)
            ? current.activeFileId
            : codeFiles[0].id,
        }
      : starterWorkspace();
    const preservedIds = new Set(next.files.map((file) => file.id));

    const nextSavedContents = codeFiles.length === 0
      ? contentSnapshot(next.files)
      : Object.fromEntries(
          Object.entries(savedContentsRef.current).filter(([id]) => preservedIds.has(id)),
        );
    applyCommittedWorkspace(next, nextSavedContents);
    return removedIds;
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
    applyCommittedWorkspace(next, { ...savedContentsRef.current, [activeId]: content });
  }

  function replaceWorkspace(
    importedFiles: readonly Pick<SourceFile, "name" | "content">[],
    activeFileName?: string,
  ): SourceFile {
    const seenNames = new Set<string>();
    const files = importedFiles.map(({ name, content }) => {
      if (!isSupportedSourceFileName(name)) throw new Error(`不支持的文件名：${name}`);
      const lowerName = name.toLowerCase();
      if (seenNames.has(lowerName)) throw new Error(`存在同名文件：${name}`);
      seenNames.add(lowerName);
      return { id: crypto.randomUUID(), name, content };
    });
    if (files.length === 0) throw new Error("工作区至少需要一个文件");
    const activeFile = files.find(
      (file) => file.name.toLowerCase() === activeFileName?.toLowerCase(),
    ) ?? files[0];
    const next = { files, activeFileId: activeFile.id };
    applyCommittedWorkspace(next, contentSnapshot(files));
    return activeFile;
  }

  function syncRuntimeTextFiles(
    runtimeFiles: Readonly<Record<string, string>>,
  ): RuntimeTextFileSyncResult {
    const result: RuntimeTextFileSyncResult = { added: [], updated: [], removed: [] };
    const current = workspaceRef.current;
    const runtimeByName = new Map(
      Object.entries(runtimeFiles)
        .filter(([name]) => isSupportedSourceFileName(name) && !isSourceCodeFileName(name))
        .map(([name, content]) => [name.toLowerCase(), { name, content }]),
    );
    const nextFiles: SourceFile[] = [];
    const nextSavedContents = { ...savedContentsRef.current };

    for (const file of current.files) {
      if (isSourceCodeFileName(file.name)) {
        nextFiles.push(file);
        continue;
      }

      const runtimeFile = runtimeByName.get(file.name.toLowerCase());
      if (!runtimeFile) {
        delete nextSavedContents[file.id];
        result.removed.push(file.name);
        continue;
      }
      runtimeByName.delete(file.name.toLowerCase());

      if (file.name !== runtimeFile.name || file.content !== runtimeFile.content) {
        nextFiles.push({ ...file, ...runtimeFile });
        nextSavedContents[file.id] = runtimeFile.content;
        result.updated.push(runtimeFile.name);
      } else {
        nextFiles.push(file);
      }
    }

    for (const runtimeFile of runtimeByName.values()) {
      const file: SourceFile = { id: crypto.randomUUID(), ...runtimeFile };
      nextFiles.push(file);
      nextSavedContents[file.id] = file.content;
      result.added.push(file.name);
    }

    if (result.added.length > 0 || result.updated.length > 0 || result.removed.length > 0) {
      if (nextFiles.length === 0) {
        const fallback = starterWorkspace();
        applyCommittedWorkspace(fallback, contentSnapshot(fallback.files));
      } else {
        const activeFileId = nextFiles.some((file) => file.id === current.activeFileId)
          ? current.activeFileId
          : nextFiles[0].id;
        applyCommittedWorkspace({ files: nextFiles, activeFileId }, nextSavedContents);
      }
    }
    return result;
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
    clearNonCodeFiles,
    saveActiveFile,
    replaceWorkspace,
    syncRuntimeTextFiles,
    dirtyFileIds,
  };
}
