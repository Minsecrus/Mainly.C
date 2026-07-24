import type * as MonacoEditor from "monaco-editor/esm/vs/editor/editor.api";

import type { ClangDiagnostic } from "../compiler/diagnostics.js";
import type { SourceFile } from "../features/files/useLocalFiles.js";
import {
  sourceLanguageForFileName,
  type LanguageStandardPreferences,
  type SourceLanguage,
} from "../languages.js";
import {
  isJsonRpcMessage,
  type JsonRpcMessage,
  type LspDiagnostic,
  type LspPublishDiagnosticsParams,
  type LspPosition,
} from "./protocol.js";

export type ClangdStatus = "idle" | "loading" | "ready" | "error";

interface WorkspaceState {
  files: Array<Pick<SourceFile, "name" | "content">>;
  standards: LanguageStandardPreferences;
  strictCompilation: boolean;
}

interface OpenDocument {
  model: MonacoEditor.editor.ITextModel;
  language: SourceLanguage;
  version: number;
  references: number;
  completionEnabled: boolean;
  opened: boolean;
  changeSubscription: MonacoEditor.IDisposable;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
  timeout: number;
  cancellation?: MonacoEditor.IDisposable;
}

interface CancellationLike {
  isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): MonacoEditor.IDisposable;
}

interface WorkerControlMessage {
  channel: "control";
  type: string;
  message?: string;
}

interface WorkerLspMessage {
  channel: "lsp";
  message: unknown;
}

type WorkerMessage = WorkerControlMessage | WorkerLspMessage;

const WORKSPACE_PATH = "/workspace";
const WORKSPACE_URI = "file:///workspace";
const DEFAULT_WORKSPACE: WorkspaceState = {
  files: [],
  standards: { c: "c23", cpp: "c++23" },
  strictCompilation: true,
};

function languageStandardFlag(standard: string): string {
  return standard === "c++26" ? "c++2c" : standard;
}

function strictDiagnosticFlags(): string[] {
  return [
    "-Wall",
    "-Wextra",
    "-Werror",
    "-pedantic",
    "-Wshadow",
    "-Wconversion",
    "-Wfloat-equal",
    "-Wcast-align",
    "-Wcast-qual",
    "-Wwrite-strings",
    "-Wswitch-default",
    "-Wswitch-enum",
  ];
}

function compileCommand(
  fileName: string,
  language: SourceLanguage,
  standards: LanguageStandardPreferences,
  strictCompilation: boolean,
): string[] {
  const filePath = `${WORKSPACE_PATH}/${fileName}`;
  const standard = languageStandardFlag(standards[language]);
  const common = [
    `-x${language === "cpp" ? "c++" : "c"}`,
    `-std=${standard}`,
    "--target=wasm32-wasi",
    "-isystem/usr/include",
    "-isystem/usr/include/wasm32-wasi",
    // clangd's incremental preamble patch can otherwise report a non-empty file as empty.
    "-Wno-empty-translation-unit",
    ...(strictCompilation ? strictDiagnosticFlags() : []),
  ];
  if (language === "cpp") {
    common.splice(3, 0, "-isystem/usr/include/c++/v1", "-isystem/usr/include/wasm32-wasi/c++/v1");
    common.push("-fno-exceptions");
  }
  return [language === "cpp" ? "clang++" : "clang", ...common, filePath];
}

export function clangdUriForFileName(fileName: string): string {
  return `${WORKSPACE_URI}/${encodeURIComponent(fileName)}`;
}

export function clangdFileNameFromUri(uri: string): string | undefined {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== "file:") return undefined;
    const decodedPath = decodeURIComponent(parsed.pathname);
    const prefix = `${WORKSPACE_PATH}/`;
    if (!decodedPath.startsWith(prefix)) return undefined;
    const name = decodedPath.slice(prefix.length);
    return name && !name.includes("/") && !name.includes("\\") ? name : undefined;
  } catch {
    return undefined;
  }
}

function severityForDiagnostic(value: number | undefined): ClangDiagnostic["severity"] {
  if (value === 1) return "error";
  if (value === 2) return "warning";
  return "info";
}

function toClangDiagnostic(fileName: string, diagnostic: LspDiagnostic): ClangDiagnostic {
  const severity = severityForDiagnostic(diagnostic.severity);
  const line = diagnostic.range.start.line + 1;
  const column = diagnostic.range.start.character + 1;
  return {
    fileName,
    line,
    column,
    endLine: diagnostic.range.end.line + 1,
    endColumn: diagnostic.range.end.character + 1,
    severity,
    message: diagnostic.message,
    code: diagnostic.code === undefined ? undefined : String(diagnostic.code),
    source: diagnostic.source ?? "clangd 21",
    raw: `${fileName}:${line}:${column}: ${severity}: ${diagnostic.message}`,
  };
}

function isPublishDiagnosticsParams(value: unknown): value is LspPublishDiagnosticsParams {
  if (typeof value !== "object" || value === null) return false;
  const params = value as Partial<LspPublishDiagnosticsParams>;
  return typeof params.uri === "string" && Array.isArray(params.diagnostics);
}

class ClangdClient {
  #worker?: Worker;
  #startPromise?: Promise<void>;
  #startResolve?: () => void;
  #startReject?: (reason: unknown) => void;
  #initialized = false;
  #status: ClangdStatus = "idle";
  #requestId = 0;
  #pendingRequests = new Map<string, PendingRequest>();
  #documents = new Map<string, OpenDocument>();
  #workspace: WorkspaceState = DEFAULT_WORKSPACE;
  #configurationSignature = "";
  #statusListeners = new Set<(status: ClangdStatus) => void>();
  #diagnosticListeners = new Set<(fileName: string, diagnostics: ClangDiagnostic[]) => void>();

  get status(): ClangdStatus {
    return this.#status;
  }

  subscribeStatus(listener: (status: ClangdStatus) => void): () => void {
    this.#statusListeners.add(listener);
    listener(this.#status);
    return () => {
      this.#statusListeners.delete(listener);
    };
  }

  subscribeDiagnostics(
    listener: (fileName: string, diagnostics: ClangDiagnostic[]) => void,
  ): () => void {
    this.#diagnosticListeners.add(listener);
    return () => {
      this.#diagnosticListeners.delete(listener);
    };
  }

  syncWorkspace(
    files: readonly Pick<SourceFile, "name" | "content">[],
    standards: LanguageStandardPreferences,
    strictCompilation = true,
  ): void {
    const sourceFiles = files.filter((file) => sourceLanguageForFileName(file.name) !== undefined);
    const previousNames = new Set(this.#workspace.files.map((file) => file.name));
    const nextNames = new Set(sourceFiles.map((file) => file.name));
    this.#workspace = {
      files: sourceFiles.map((file) => ({ name: file.name, content: file.content })),
      standards: { ...standards },
      strictCompilation,
    };

    for (const oldName of previousNames) {
      if (!nextNames.has(oldName)) this.#emitDiagnostics(oldName, []);
    }
    this.#postWorkspace();

    const nextSignature = JSON.stringify({
      files: sourceFiles.map((file) => file.name),
      standards,
      strictCompilation,
    });
    if (nextSignature !== this.#configurationSignature) {
      this.#configurationSignature = nextSignature;
      if (this.#initialized) this.#updateConfiguration();
    }
  }

  attachModel(
    model: MonacoEditor.editor.ITextModel,
    language: SourceLanguage,
    completionEnabled: boolean,
  ): MonacoEditor.IDisposable {
    const uri = model.uri.toString();
    const existing = this.#documents.get(uri);
    if (existing?.model === model) {
      existing.references++;
      existing.completionEnabled = completionEnabled;
      return { dispose: () => this.#detachModel(uri, existing) };
    }

    const document: OpenDocument = {
      model,
      language,
      version: Math.max(1, model.getVersionId()),
      references: 1,
      completionEnabled,
      opened: false,
      changeSubscription: model.onDidChangeContent(() => {
        document.version++;
        if (!document.opened || !this.#initialized) return;
        this.#notify("textDocument/didChange", {
          textDocument: { uri, version: document.version },
          contentChanges: [{ text: model.getValue() }],
        });
      }),
    };
    this.#documents.set(uri, document);
    if (this.#initialized) this.#openDocument(uri, document);
    void this.start().catch(() => undefined);
    return { dispose: () => this.#detachModel(uri, document) };
  }

  setCompletionEnabled(model: MonacoEditor.editor.ITextModel, enabled: boolean): void {
    const document = this.#documents.get(model.uri.toString());
    if (document?.model === model) document.completionEnabled = enabled;
  }

  isCompletionEnabled(model: MonacoEditor.editor.ITextModel): boolean {
    return this.#documents.get(model.uri.toString())?.completionEnabled === true;
  }

  ensureWorkspaceModel(
    monaco: typeof MonacoEditor,
    uriText: string,
  ): MonacoEditor.editor.ITextModel | undefined {
    const uri = monaco.Uri.parse(uriText);
    const existing = monaco.editor.getModel(uri);
    if (existing) return existing;
    const fileName = clangdFileNameFromUri(uriText);
    const file = this.#workspace.files.find((candidate) => candidate.name === fileName);
    const language = fileName ? sourceLanguageForFileName(fileName) : undefined;
    if (!file || !language) return undefined;
    return monaco.editor.createModel(file.content, language, uri);
  }

  async request(
    method: string,
    params: unknown,
    cancellation?: CancellationLike,
  ): Promise<unknown> {
    if (!this.#initialized || this.#status !== "ready") return null;
    return this.#rawRequest(method, params, 20_000, cancellation);
  }

  private start(): Promise<void> {
    if (this.#startPromise) return this.#startPromise;
    if (!crossOriginIsolated) {
      const error = new Error("clangd requires cross-origin isolation");
      this.#setStatus("error");
      return Promise.reject(error);
    }

    this.#setStatus("loading");
    this.#startPromise = new Promise<void>((resolve, reject) => {
      this.#startResolve = resolve;
      this.#startReject = reject;
    });
    const worker = new Worker(new URL("./clangd.worker.ts", import.meta.url), {
      type: "module",
      name: "clangd language server",
    });
    this.#worker = worker;
    worker.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
      this.#handleWorkerMessage(event.data);
    });
    worker.addEventListener("error", (event) => {
      this.#fail(new Error(event.message || "clangd Worker failed"));
    });
    this.#postWorkspace();
    return this.#startPromise;
  }

  #handleWorkerMessage(data: WorkerMessage): void {
    if (data?.channel === "lsp") {
      if (isJsonRpcMessage(data.message)) this.#handleJsonRpc(data.message);
      return;
    }
    if (data?.channel !== "control") return;
    if (data.type === "ready") {
      void this.#initialize().catch((cause) => this.#fail(cause));
    } else if (data.type === "error") {
      this.#fail(new Error(data.message ?? "clangd failed"));
    } else if (data.type === "log" && data.message) {
      console.debug(`[clangd] ${data.message}`);
    }
  }

  async #initialize(): Promise<void> {
    const result = await this.#rawRequest("initialize", {
      processId: null,
      clientInfo: { name: "Mainly.C", version: "0.1.0" },
      locale: "zh-CN",
      rootUri: WORKSPACE_URI,
      capabilities: {
        general: { positionEncodings: ["utf-16"] },
        workspace: { configuration: true, workspaceFolders: true },
        textDocument: {
          synchronization: { didSave: true },
          completion: {
            contextSupport: true,
            completionItem: {
              snippetSupport: true,
              commitCharactersSupport: true,
              documentationFormat: ["markdown", "plaintext"],
              deprecatedSupport: true,
              tagSupport: { valueSet: [1] },
              insertReplaceSupport: true,
            },
          },
          hover: { contentFormat: ["markdown", "plaintext"] },
          definition: { linkSupport: true },
          references: {},
          documentHighlight: {},
          signatureHelp: {
            contextSupport: true,
            signatureInformation: {
              documentationFormat: ["markdown", "plaintext"],
              parameterInformation: { labelOffsetSupport: true },
              activeParameterSupport: true,
            },
          },
          publishDiagnostics: {
            relatedInformation: true,
            versionSupport: true,
            codeDescriptionSupport: true,
            dataSupport: true,
          },
        },
      },
      initializationOptions: {
        clangdFileStatus: true,
        fallbackFlags: compileCommand(
          "fallback.cpp",
          "cpp",
          this.#workspace.standards,
          this.#workspace.strictCompilation,
        ).slice(1, -1),
        compilationDatabaseChanges: this.#compilationDatabaseChanges(),
      },
      workspaceFolders: [{ uri: WORKSPACE_URI, name: "Mainly.C" }],
    }, 120_000);
    if (typeof result !== "object" || result === null) {
      throw new Error("clangd returned an invalid initialize response");
    }

    this.#notify("initialized", {});
    this.#initialized = true;
    this.#updateConfiguration(false);
    for (const [uri, document] of this.#documents) this.#openDocument(uri, document);
    this.#setStatus("ready");
    this.#startResolve?.();
    this.#startResolve = undefined;
    this.#startReject = undefined;
  }

  #updateConfiguration(refreshDocuments = true): void {
    this.#notify("workspace/didChangeConfiguration", {
      settings: { compilationDatabaseChanges: this.#compilationDatabaseChanges() },
    });
    if (!refreshDocuments) return;
    for (const [uri, document] of this.#documents) {
      if (!document.opened) continue;
      document.version++;
      this.#notify("textDocument/didChange", {
        textDocument: { uri, version: document.version },
        contentChanges: [{ text: document.model.getValue() }],
      });
    }
  }

  #compilationDatabaseChanges(): Record<string, unknown> {
    return Object.fromEntries(this.#workspace.files.flatMap((file) => {
      const language = sourceLanguageForFileName(file.name);
      if (!language) return [];
      const path = `${WORKSPACE_PATH}/${file.name}`;
      return [[path, {
        workingDirectory: WORKSPACE_PATH,
        compilationCommand: compileCommand(
          file.name,
          language,
          this.#workspace.standards,
          this.#workspace.strictCompilation,
        ),
      }]];
    }));
  }

  #openDocument(uri: string, document: OpenDocument): void {
    if (document.opened || !this.#initialized) return;
    document.opened = true;
    this.#notify("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: document.language,
        version: document.version,
        text: document.model.getValue(),
      },
    });
  }

  #detachModel(uri: string, document: OpenDocument): void {
    if (this.#documents.get(uri) !== document) return;
    document.references--;
    if (document.references > 0) return;
    document.changeSubscription.dispose();
    if (document.opened && this.#initialized) {
      this.#notify("textDocument/didClose", { textDocument: { uri } });
    }
    this.#documents.delete(uri);
    this.#postWorkspace();
  }

  #postWorkspace(): void {
    const openFileNames = [...this.#documents.entries()].flatMap(([uri, document]) => {
      if (!document.opened) return [];
      const fileName = clangdFileNameFromUri(uri);
      return fileName ? [fileName] : [];
    });
    this.#worker?.postMessage({
      channel: "workspace",
      files: this.#workspace.files,
      openFileNames,
    });
  }

  #notify(method: string, params: unknown): void {
    this.#post({ jsonrpc: "2.0", method, params });
  }

  #post(message: JsonRpcMessage): void {
    this.#worker?.postMessage({ channel: "lsp", message });
  }

  #rawRequest(
    method: string,
    params: unknown,
    timeoutMs: number,
    cancellation?: CancellationLike,
  ): Promise<unknown> {
    if (cancellation?.isCancellationRequested) {
      return Promise.reject(new DOMException("Request cancelled", "AbortError"));
    }
    const id = ++this.#requestId;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.#pendingRequests.delete(String(id));
        reject(new Error(`clangd request timed out: ${method}`));
      }, timeoutMs);
      const pending: PendingRequest = { resolve, reject, timeout };
      if (cancellation) {
        pending.cancellation = cancellation.onCancellationRequested(() => {
          if (!this.#pendingRequests.delete(String(id))) return;
          window.clearTimeout(timeout);
          this.#notify("$/cancelRequest", { id });
          reject(new DOMException("Request cancelled", "AbortError"));
        });
      }
      this.#pendingRequests.set(String(id), pending);
      this.#post({ jsonrpc: "2.0", id, method, params });
    });
  }

  #handleJsonRpc(message: JsonRpcMessage): void {
    if (message.id !== undefined && message.id !== null &&
      (Object.hasOwn(message, "result") || message.error !== undefined)) {
      const pending = this.#pendingRequests.get(String(message.id));
      if (!pending) return;
      this.#pendingRequests.delete(String(message.id));
      window.clearTimeout(pending.timeout);
      pending.cancellation?.dispose();
      if (message.error) {
        pending.reject(new Error(`clangd ${message.error.code}: ${message.error.message}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (!message.method) return;
    if (message.id !== undefined && message.id !== null) {
      this.#handleServerRequest(message);
      return;
    }
    this.#handleServerNotification(message.method, message.params);
  }

  #handleServerRequest(message: JsonRpcMessage): void {
    let result: unknown = null;
    if (message.method === "workspace/configuration") {
      const items = (message.params as { items?: unknown[] } | undefined)?.items;
      result = Array.isArray(items) ? items.map(() => null) : [];
    } else if (message.method === "workspace/applyEdit") {
      result = { applied: false, failureReason: "Workspace edits are not enabled" };
    } else if (
      message.method !== "client/registerCapability" &&
      message.method !== "window/workDoneProgress/create"
    ) {
      this.#post({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: `Unsupported server request: ${message.method}` },
      });
      return;
    }
    this.#post({ jsonrpc: "2.0", id: message.id, result });
  }

  #handleServerNotification(method: string, params: unknown): void {
    if (method === "textDocument/publishDiagnostics" && isPublishDiagnosticsParams(params)) {
      const fileName = clangdFileNameFromUri(params.uri);
      if (!fileName) return;
      const document = this.#documents.get(params.uri);
      if (
        params.version !== undefined &&
        document &&
        params.version < document.version
      ) return;
      this.#emitDiagnostics(
        fileName,
        params.diagnostics.map((diagnostic) => toClangDiagnostic(fileName, diagnostic)),
      );
    } else if (method === "window/logMessage") {
      const message = (params as { message?: unknown } | undefined)?.message;
      if (typeof message === "string") console.debug(`[clangd] ${message}`);
    }
  }

  #emitDiagnostics(fileName: string, diagnostics: ClangDiagnostic[]): void {
    for (const listener of this.#diagnosticListeners) listener(fileName, diagnostics);
  }

  #setStatus(status: ClangdStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    for (const listener of this.#statusListeners) listener(status);
  }

  #fail(cause: unknown): void {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    this.#setStatus("error");
    this.#startReject?.(error);
    this.#startResolve = undefined;
    this.#startReject = undefined;
    for (const pending of this.#pendingRequests.values()) {
      window.clearTimeout(pending.timeout);
      pending.cancellation?.dispose();
      pending.reject(error);
    }
    this.#pendingRequests.clear();
    console.error("Unable to start clangd", error);
  }
}

export const clangdClient = new ClangdClient();

export function lspPosition(lineNumber: number, column: number): LspPosition {
  return { line: Math.max(0, lineNumber - 1), character: Math.max(0, column - 1) };
}
