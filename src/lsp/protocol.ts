export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspLocation {
  uri: string;
  range: LspRange;
}

export interface LspLocationLink {
  originSelectionRange?: LspRange;
  targetUri: string;
  targetRange: LspRange;
  targetSelectionRange: LspRange;
}

export interface LspDiagnostic {
  range: LspRange;
  severity?: number;
  code?: string | number;
  source?: string;
  message: string;
}

export interface LspPublishDiagnosticsParams {
  uri: string;
  version?: number;
  diagnostics: LspDiagnostic[];
}

export interface LspMarkupContent {
  kind: "plaintext" | "markdown";
  value: string;
}

export interface LspMarkedString {
  language: string;
  value: string;
}

export interface LspHover {
  contents: string | LspMarkedString | LspMarkupContent | Array<string | LspMarkedString>;
  range?: LspRange;
}

export interface LspTextEdit {
  range: LspRange;
  newText: string;
}

export interface LspInsertReplaceEdit {
  insert: LspRange;
  replace: LspRange;
  newText: string;
}

export interface LspCompletionItem {
  label: string | { label: string; detail?: string; description?: string };
  kind?: number;
  tags?: number[];
  detail?: string;
  documentation?: string | LspMarkupContent;
  sortText?: string;
  filterText?: string;
  insertText?: string;
  insertTextFormat?: number;
  textEdit?: LspTextEdit | LspInsertReplaceEdit;
  additionalTextEdits?: LspTextEdit[];
  commitCharacters?: string[];
}

export interface LspCompletionList {
  isIncomplete: boolean;
  items: LspCompletionItem[];
}

export interface LspParameterInformation {
  label: string | [number, number];
  documentation?: string | LspMarkupContent;
}

export interface LspSignatureInformation {
  label: string;
  documentation?: string | LspMarkupContent;
  parameters?: LspParameterInformation[];
  activeParameter?: number;
}

export interface LspSignatureHelp {
  signatures: LspSignatureInformation[];
  activeSignature?: number;
  activeParameter?: number;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: JsonRpcError;
}

export function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  return typeof value === "object" && value !== null &&
    (value as { jsonrpc?: unknown }).jsonrpc === "2.0";
}

export function isLspRange(value: unknown): value is LspRange {
  if (typeof value !== "object" || value === null) return false;
  const range = value as Partial<LspRange>;
  return isLspPosition(range.start) && isLspPosition(range.end);
}

function isLspPosition(value: unknown): value is LspPosition {
  if (typeof value !== "object" || value === null) return false;
  const position = value as Partial<LspPosition>;
  return Number.isInteger(position.line) && Number.isInteger(position.character);
}
