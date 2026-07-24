export interface EditorPreferences {
  autoCompletion: boolean;
  strictCompilation: boolean;
}

const STORAGE_KEY = "mainly.c.editor-preferences.v1";

export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = {
  autoCompletion: false,
  strictCompilation: true,
};

export function loadEditorPreferences(): EditorPreferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<EditorPreferences> | null;
    return {
      autoCompletion: typeof parsed?.autoCompletion === "boolean"
        ? parsed.autoCompletion
        : DEFAULT_EDITOR_PREFERENCES.autoCompletion,
      strictCompilation: typeof parsed?.strictCompilation === "boolean"
        ? parsed.strictCompilation
        : DEFAULT_EDITOR_PREFERENCES.strictCompilation,
    };
  } catch {
    return { ...DEFAULT_EDITOR_PREFERENCES };
  }
}

export function saveEditorPreferences(preferences: EditorPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // 设置仍在当前页面生效；存储不可用时不阻断编辑器操作。
  }
}
