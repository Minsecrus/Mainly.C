export type ClangDiagnosticSeverity = "error" | "warning" | "info";

export interface ClangDiagnostic {
  fileName: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: ClangDiagnosticSeverity;
  message: string;
  code?: string;
  raw: string;
}

export interface MonacoMarkerLike {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  severity: ClangDiagnosticSeverity;
  message: string;
  code?: string;
}

const ANSI_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const WITH_COLUMN = /^(.*?):(\d+):(\d+):\s+(fatal error|error|warning|note|remark):\s*(.*)$/;
const WITHOUT_COLUMN = /^(.*?):(\d+):\s+(fatal error|error|warning|note|remark):\s*(.*)$/;
const DIAGNOSTIC_CODE = /\s+\[(-W[^\]]+)\]\s*$/;

function normalizeFileName(fileName: string): string {
  const normalized = fileName.replaceAll("\\", "/");
  return normalized.startsWith("/workspace/")
    ? normalized.slice("/workspace/".length)
    : normalized;
}

function normalizeSeverity(kind: string): ClangDiagnosticSeverity {
  if (kind === "fatal error" || kind === "error") return "error";
  if (kind === "warning") return "warning";
  return "info";
}

export function parseClangDiagnostics(output: string): ClangDiagnostic[] {
  const diagnostics: ClangDiagnostic[] = [];

  for (const unstrippedLine of output.split(/\r?\n/)) {
    const raw = unstrippedLine.replace(ANSI_ESCAPE, "");
    const match = raw.match(WITH_COLUMN) ?? raw.match(WITHOUT_COLUMN);
    if (!match) continue;

    const hasColumn = match.length === 6;
    const [, path, lineText] = match;
    const columnText = hasColumn ? match[3] : "1";
    const kind = hasColumn ? match[4] : match[3];
    let message = hasColumn ? match[5] : match[4];
    const codeMatch = message.match(DIAGNOSTIC_CODE);
    const code = codeMatch?.[1];
    if (codeMatch) message = message.slice(0, codeMatch.index).trimEnd();

    const line = Math.max(1, Number.parseInt(lineText, 10));
    const column = Math.max(1, Number.parseInt(columnText, 10));
    diagnostics.push({
      fileName: normalizeFileName(path),
      line,
      column,
      endLine: line,
      endColumn: column + 1,
      severity: normalizeSeverity(kind),
      message,
      code,
      raw,
    });
  }

  return diagnostics;
}

export function toMonacoMarker(diagnostic: ClangDiagnostic): MonacoMarkerLike {
  return {
    startLineNumber: diagnostic.line,
    startColumn: diagnostic.column,
    endLineNumber: diagnostic.endLine,
    endColumn: diagnostic.endColumn,
    severity: diagnostic.severity,
    message: diagnostic.message,
    code: diagnostic.code,
  };
}
