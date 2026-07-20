const C_FORMAT_STYLE = JSON.stringify({
  BasedOnStyle: "LLVM",
  IndentWidth: 4,
  TabWidth: 4,
  UseTab: "Never",
  ColumnLimit: 100,
  BreakBeforeBraces: "Attach",
  AllowShortBlocksOnASingleLine: "Never",
  AllowShortFunctionsOnASingleLine: "None",
  AllowShortIfStatementsOnASingleLine: "Never",
  AllowShortLoopsOnASingleLine: false,
  SortIncludes: "Never",
});

type ClangFormatModule = typeof import("@wasm-fmt/clang-format/vite");

let formatterModule: Promise<ClangFormatModule> | undefined;

async function loadFormatter(): Promise<ClangFormatModule> {
  formatterModule ??= import("@wasm-fmt/clang-format/vite").then(async (module) => {
    await module.default();
    return module;
  }).catch((cause) => {
    formatterModule = undefined;
    throw cause;
  });
  return formatterModule;
}

export async function preloadCFormatter(): Promise<void> {
  await loadFormatter();
}

export async function formatCSource(source: string, fileName: string): Promise<string> {
  const formatter = await loadFormatter();
  return formatter.format(source, fileName, C_FORMAT_STYLE);
}
