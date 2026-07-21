export const C_STANDARDS = ["c99", "c11", "c23"] as const;
export const CPP_STANDARDS = [
  "c++11",
  "c++14",
  "c++17",
  "c++20",
  "c++23",
  "c++26",
] as const;

export type CStandard = (typeof C_STANDARDS)[number];
export type CppStandard = (typeof CPP_STANDARDS)[number];
export type LanguageStandard = CStandard | CppStandard;
export type SourceLanguage = "c" | "cpp";

export interface LanguageStandardPreferences {
  c: CStandard;
  cpp: CppStandard;
}

export const DEFAULT_LANGUAGE_STANDARDS: LanguageStandardPreferences = {
  c: "c23",
  cpp: "c++23",
};

export function isCStandard(value: unknown): value is CStandard {
  return typeof value === "string" && C_STANDARDS.includes(value as CStandard);
}

export function isCppStandard(value: unknown): value is CppStandard {
  return typeof value === "string" && CPP_STANDARDS.includes(value as CppStandard);
}

export function isLanguageStandardForLanguage(
  language: SourceLanguage,
  standard: unknown,
): standard is LanguageStandard {
  return language === "c" ? isCStandard(standard) : isCppStandard(standard);
}

export function sourceLanguageForFileName(fileName: string): SourceLanguage | undefined {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".c")) return "c";
  if (
    lowerName.endsWith(".cpp") ||
    lowerName.endsWith(".cc") ||
    lowerName.endsWith(".cxx")
  ) return "cpp";
  return undefined;
}

export function isSourceCodeFileName(fileName: string): boolean {
  return sourceLanguageForFileName(fileName) !== undefined;
}

export function languageStandardLabel(standard: LanguageStandard): string {
  return standard.startsWith("c++")
    ? `C++${standard.slice(3)}`
    : `C${standard.slice(1)}`;
}

export function compilerDriverForLanguage(language: SourceLanguage): "clang" | "clang++" {
  return language === "cpp" ? "clang++" : "clang";
}
