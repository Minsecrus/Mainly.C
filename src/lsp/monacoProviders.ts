import type * as MonacoEditor from "monaco-editor/esm/vs/editor/editor.api";

import { clangdClient, lspPosition } from "./ClangdClient.js";
import {
  isLspRange,
  type LspCompletionItem,
  type LspCompletionList,
  type LspHover,
  type LspInsertReplaceEdit,
  type LspLocation,
  type LspLocationLink,
  type LspMarkupContent,
  type LspMarkedString,
  type LspRange,
  type LspSignatureHelp,
  type LspTextEdit,
} from "./protocol.js";

let providersRegistered = false;

function toMonacoRange(range: LspRange): MonacoEditor.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}

function markdown(value: string | LspMarkupContent | undefined): MonacoEditor.IMarkdownString | undefined {
  if (value === undefined) return undefined;
  return {
    value: typeof value === "string" ? value : value.value,
    isTrusted: false,
    supportHtml: false,
  };
}

function completionKind(
  monaco: typeof MonacoEditor,
  kind: number | undefined,
): MonacoEditor.languages.CompletionItemKind {
  const kinds = monaco.languages.CompletionItemKind;
  switch (kind) {
    case 2: return kinds.Method;
    case 3: return kinds.Function;
    case 4: return kinds.Constructor;
    case 5: return kinds.Field;
    case 6: return kinds.Variable;
    case 7: return kinds.Class;
    case 8: return kinds.Interface;
    case 9: return kinds.Module;
    case 10: return kinds.Property;
    case 11: return kinds.Unit;
    case 12: return kinds.Value;
    case 13: return kinds.Enum;
    case 14: return kinds.Keyword;
    case 15: return kinds.Snippet;
    case 16: return kinds.Color;
    case 17: return kinds.File;
    case 18: return kinds.Reference;
    case 19: return kinds.Folder;
    case 20: return kinds.EnumMember;
    case 21: return kinds.Constant;
    case 22: return kinds.Struct;
    case 23: return kinds.Event;
    case 24: return kinds.Operator;
    case 25: return kinds.TypeParameter;
    default: return kinds.Text;
  }
}

function isTextEdit(value: unknown): value is LspTextEdit {
  if (typeof value !== "object" || value === null) return false;
  const edit = value as Partial<LspTextEdit>;
  return typeof edit.newText === "string" && isLspRange(edit.range);
}

function isInsertReplaceEdit(value: unknown): value is LspInsertReplaceEdit {
  if (typeof value !== "object" || value === null) return false;
  const edit = value as Partial<LspInsertReplaceEdit>;
  return typeof edit.newText === "string" && isLspRange(edit.insert) && isLspRange(edit.replace);
}

function completionItem(
  monaco: typeof MonacoEditor,
  item: LspCompletionItem,
  defaultRange: MonacoEditor.IRange,
): MonacoEditor.languages.CompletionItem {
  const edit = item.textEdit;
  const label = typeof item.label === "string" ? item.label : item.label;
  let range: MonacoEditor.languages.CompletionItem["range"] = defaultRange;
  let insertText = item.insertText ?? (typeof item.label === "string" ? item.label : item.label.label);
  if (isTextEdit(edit)) {
    range = toMonacoRange(edit.range);
    insertText = edit.newText;
  } else if (isInsertReplaceEdit(edit)) {
    range = { insert: toMonacoRange(edit.insert), replace: toMonacoRange(edit.replace) };
    insertText = edit.newText;
  }

  return {
    label,
    kind: completionKind(monaco, item.kind),
    tags: item.tags?.includes(1) ? [monaco.languages.CompletionItemTag.Deprecated] : undefined,
    detail: item.detail,
    documentation: markdown(item.documentation),
    sortText: item.sortText,
    filterText: item.filterText,
    insertText,
    insertTextRules: item.insertTextFormat === 2
      ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
      : undefined,
    range,
    commitCharacters: item.commitCharacters,
    additionalTextEdits: item.additionalTextEdits?.filter(isTextEdit).map((additionalEdit) => ({
      range: toMonacoRange(additionalEdit.range),
      text: additionalEdit.newText,
    })),
  };
}

function hoverContents(contents: LspHover["contents"]): MonacoEditor.IMarkdownString[] {
  const values = Array.isArray(contents) ? contents : [contents];
  return values.map((value) => {
    if (typeof value === "string") return markdown(value)!;
    if ("kind" in value) return markdown(value)!;
    const marked = value as LspMarkedString;
    return markdown(`\`\`\`${marked.language}\n${marked.value}\n\`\`\``)!;
  });
}

async function request(method: string, params: unknown, token: MonacoEditor.CancellationToken) {
  try {
    return await clangdClient.request(method, params, token);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") return null;
    console.debug(`clangd ${method} failed`, cause);
    return null;
  }
}

function textDocumentPosition(model: MonacoEditor.editor.ITextModel, position: MonacoEditor.Position) {
  return {
    textDocument: { uri: model.uri.toString() },
    position: lspPosition(position.lineNumber, position.column),
  };
}

function locationArray(value: unknown): Array<LspLocation | LspLocationLink> {
  if (Array.isArray(value)) return value as Array<LspLocation | LspLocationLink>;
  return value && typeof value === "object" ? [value as LspLocation | LspLocationLink] : [];
}

function toLocations(
  monaco: typeof MonacoEditor,
  value: unknown,
): MonacoEditor.languages.Location[] {
  const locations: MonacoEditor.languages.Location[] = [];
  for (const item of locationArray(value)) {
    const isLink = "targetUri" in item;
    const uriText = isLink ? item.targetUri : item.uri;
    const range = isLink ? item.targetSelectionRange : item.range;
    if (typeof uriText !== "string" || !isLspRange(range)) continue;
    clangdClient.ensureWorkspaceModel(monaco, uriText);
    locations.push({ uri: monaco.Uri.parse(uriText), range: toMonacoRange(range) });
  }
  return locations;
}

function registerForLanguage(monaco: typeof MonacoEditor, language: "c" | "cpp"): void {
  monaco.languages.registerCompletionItemProvider(language, {
    triggerCharacters: [".", ">", ":", "#", "<", '"'],
    async provideCompletionItems(model, position, context, token) {
      if (!clangdClient.isCompletionEnabled(model)) return { suggestions: [] };
      const result = await request("textDocument/completion", {
        ...textDocumentPosition(model, position),
        context: {
          triggerKind: context.triggerKind + 1,
          triggerCharacter: context.triggerCharacter,
        },
      }, token);
      const list = Array.isArray(result)
        ? { isIncomplete: false, items: result as LspCompletionItem[] }
        : result as LspCompletionList | null;
      if (!list || !Array.isArray(list.items)) return { suggestions: [] };
      const word = model.getWordUntilPosition(position);
      const defaultRange: MonacoEditor.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      return {
        incomplete: list.isIncomplete,
        suggestions: list.items.map((item) => completionItem(monaco, item, defaultRange)),
      };
    },
  });

  monaco.languages.registerHoverProvider(language, {
    async provideHover(model, position, token) {
      const result = await request(
        "textDocument/hover",
        textDocumentPosition(model, position),
        token,
      ) as LspHover | null;
      if (!result?.contents) return null;
      return {
        contents: hoverContents(result.contents),
        range: result.range && isLspRange(result.range) ? toMonacoRange(result.range) : undefined,
      };
    },
  });

  monaco.languages.registerDefinitionProvider(language, {
    async provideDefinition(model, position, token) {
      const result = await request(
        "textDocument/definition",
        textDocumentPosition(model, position),
        token,
      );
      const locations = toLocations(monaco, result);
      return locations.length > 0 ? locations : null;
    },
  });

  monaco.languages.registerReferenceProvider(language, {
    async provideReferences(model, position, context, token) {
      const result = await request("textDocument/references", {
        ...textDocumentPosition(model, position),
        context: { includeDeclaration: context.includeDeclaration },
      }, token);
      return toLocations(monaco, result);
    },
  });

  monaco.languages.registerDocumentHighlightProvider(language, {
    async provideDocumentHighlights(model, position, token) {
      const result = await request(
        "textDocument/documentHighlight",
        textDocumentPosition(model, position),
        token,
      );
      if (!Array.isArray(result)) return [];
      return result.flatMap((item) => {
        const highlight = item as { range?: unknown; kind?: number };
        if (!isLspRange(highlight.range)) return [];
        const kind = highlight.kind === 2
          ? monaco.languages.DocumentHighlightKind.Read
          : highlight.kind === 3
            ? monaco.languages.DocumentHighlightKind.Write
            : monaco.languages.DocumentHighlightKind.Text;
        return [{ range: toMonacoRange(highlight.range), kind }];
      });
    },
  });

  monaco.languages.registerSignatureHelpProvider(language, {
    signatureHelpTriggerCharacters: ["(", ","],
    signatureHelpRetriggerCharacters: [","],
    async provideSignatureHelp(model, position, token, context) {
      const result = await request("textDocument/signatureHelp", {
        ...textDocumentPosition(model, position),
        context: {
          triggerKind: context.triggerKind,
          triggerCharacter: context.triggerCharacter,
          isRetrigger: context.isRetrigger,
        },
      }, token) as LspSignatureHelp | null;
      if (!result || !Array.isArray(result.signatures)) return null;
      return {
        value: {
          activeSignature: result.activeSignature ?? 0,
          activeParameter: result.activeParameter ?? 0,
          signatures: result.signatures.map((signature) => ({
            label: signature.label,
            documentation: markdown(signature.documentation),
            activeParameter: signature.activeParameter,
            parameters: (signature.parameters ?? []).map((parameter) => ({
              label: parameter.label,
              documentation: markdown(parameter.documentation),
            })),
          })),
        },
        dispose() {},
      };
    },
  });
}

export function registerClangdProviders(monaco: typeof MonacoEditor): void {
  if (providersRegistered) return;
  providersRegistered = true;
  registerForLanguage(monaco, "c");
  registerForLanguage(monaco, "cpp");
}
