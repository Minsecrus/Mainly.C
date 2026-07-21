import {
  isSupportedSourceFileName,
  type SourceFile,
} from "./useLocalFiles.js";

const WORKSPACE_FORMAT = "mainly.c-workspace";
const WORKSPACE_VERSION = 1;

export interface WorkspaceTransferData {
  files: Pick<SourceFile, "name" | "content">[];
  activeFileName?: string;
}

interface WorkspaceExportDocument extends WorkspaceTransferData {
  format: typeof WORKSPACE_FORMAT;
  version: typeof WORKSPACE_VERSION;
  exportedAt: string;
}

export function serializeWorkspace(
  files: readonly SourceFile[],
  activeFileName?: string,
): string {
  const document: WorkspaceExportDocument = {
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    exportedAt: new Date().toISOString(),
    files: files.map(({ name, content }) => ({ name, content })),
    activeFileName,
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function parseWorkspace(value: string): WorkspaceTransferData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("所选文件不是有效的 JSON 工作区文件");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("工作区文件格式不正确");
  const document = parsed as Partial<WorkspaceExportDocument>;
  if (document.format !== WORKSPACE_FORMAT || document.version !== WORKSPACE_VERSION) {
    throw new Error("不支持该工作区文件的格式或版本");
  }
  if (!Array.isArray(document.files) || document.files.length === 0) {
    throw new Error("工作区文件中没有可导入的文件");
  }

  const seenNames = new Set<string>();
  const files = document.files.map((file) => {
    if (!file || typeof file.name !== "string" || typeof file.content !== "string") {
      throw new Error("工作区包含无效的文件记录");
    }
    if (!isSupportedSourceFileName(file.name)) {
      throw new Error(`不支持的文件名：${file.name}`);
    }
    const lowerName = file.name.toLowerCase();
    if (seenNames.has(lowerName)) throw new Error(`存在同名文件：${file.name}`);
    seenNames.add(lowerName);
    return { name: file.name, content: file.content };
  });

  return {
    files,
    activeFileName: typeof document.activeFileName === "string"
      ? document.activeFileName
      : undefined,
  };
}

export function downloadWorkspace(value: string): void {
  const blob = new Blob([value], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `mainly-c-workspace-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
