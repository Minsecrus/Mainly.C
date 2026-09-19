import type * as MonacoEditor from "monaco-editor";

function describeTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return `${target.tagName.toLowerCase()}${target.id ? `#${target.id}` : ""}${
    target.classList.length ? `.${[...target.classList].join(".")}` : ""
  }`;
}

export function attachEditorInputDebug(
  editor: MonacoEditor.editor.IStandaloneCodeEditor,
  monaco: typeof MonacoEditor,
  fileName: string,
): void {
  if (!import.meta.env.DEV || !new URLSearchParams(location.search).has("editorDebug")) return;
  const container = editor.getDomNode();
  if (!container) return;

  const abort = new AbortController();
  let sequence = 0;
  const log = (event: string, details: Record<string, unknown> = {}) => {
    const input = container.querySelector<HTMLTextAreaElement>("textarea.inputarea");
    const browserSelection = document.getSelection();
    console.log("[editor-input]", JSON.stringify({
      sequence: ++sequence,
      time: Math.round(performance.now()),
      file: fileName,
      event,
      ...details,
      activeElement: describeTarget(document.activeElement),
      documentFocus: document.hasFocus(),
      textFocus: editor.hasTextFocus(),
      widgetFocus: editor.hasWidgetFocus(),
      readOnly: editor.getOption(monaco.editor.EditorOption.readOnly),
      inputEngine: editor.getOption(monaco.editor.EditorOption.effectiveEditContext)
        ? "native" : "textarea",
      browserSelection: {
        rangeCount: browserSelection?.rangeCount,
        type: browserSelection?.type,
      },
      position: editor.getPosition(),
      modelVersion: editor.getModel()?.getVersionId(),
      input: input ? {
        readOnly: input.readOnly,
        valueLength: input.value.length,
        selectionStart: input.selectionStart,
        selectionEnd: input.selectionEnd,
      } : null,
    }));
  };
  const keyDetails = (event: KeyboardEvent) => ({
    key: event.key,
    code: event.code,
    keyCode: event.keyCode,
    isComposing: event.isComposing,
    defaultPrevented: event.defaultPrevented,
    target: describeTarget(event.target),
  });

  window.addEventListener("keydown", (event) => {
    if (event.target !== document.body && !container.contains(event.target as Node)) return;
    log("keydown:window", keyDetails(event));
    window.setTimeout(() => {
      if (!abort.signal.aborted) log("keydown:settled", keyDetails(event));
    }, 0);
  }, { capture: true, signal: abort.signal });

  for (const name of ["pointerdown", "focusin", "focusout", "beforeinput", "input",
    "compositionstart", "compositionupdate", "compositionend"]) {
    container.addEventListener(name, (event) => log(`dom:${name}`, {
      target: describeTarget(event.target),
      defaultPrevented: event.defaultPrevented,
      ...(event instanceof InputEvent ? {
        inputType: event.inputType,
        isComposing: event.isComposing,
        dataLength: event.data?.length ?? 0,
      } : {}),
    }), { capture: true, signal: abort.signal });
  }

  const subscriptions = [
    editor.onKeyDown((event) => log("keydown:monaco", keyDetails(event.browserEvent))),
    editor.onDidFocusEditorText(() => log("monaco:focus")),
    editor.onDidBlurEditorText(() => log("monaco:blur")),
    editor.onDidCompositionStart(() => log("monaco:compositionstart")),
    editor.onDidCompositionEnd(() => log("monaco:compositionend")),
    editor.onDidAttemptReadOnlyEdit(() => log("monaco:readonly-attempt")),
    editor.onDidChangeModelContent((event) => log("monaco:content-change", {
      isUndoing: event.isUndoing,
      isRedoing: event.isRedoing,
      changes: event.changes.map((change) => ({
        rangeOffset: change.rangeOffset,
        removedLength: change.rangeLength,
        insertedLength: change.text.length,
      })),
    })),
  ];
  editor.onDidDispose(() => {
    abort.abort();
    subscriptions.forEach((subscription) => subscription.dispose());
  });
  log("mount");
}
