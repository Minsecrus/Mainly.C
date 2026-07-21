export interface RunConfiguration {
  argumentText: string;
  standardInput: string;
}

const STORAGE_KEY = "mainly.c.run-configuration.v1";

export const EMPTY_RUN_CONFIGURATION: RunConfiguration = {
  argumentText: "",
  standardInput: "",
};

export function loadRunConfiguration(): RunConfiguration {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as
      | Partial<RunConfiguration>
      | null;
    return {
      argumentText: typeof parsed?.argumentText === "string" ? parsed.argumentText : "",
      standardInput: typeof parsed?.standardInput === "string" ? parsed.standardInput : "",
    };
  } catch {
    return EMPTY_RUN_CONFIGURATION;
  }
}

export function saveRunConfiguration(configuration: RunConfiguration): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(configuration));
}

export function parseProgramArguments(value: string): string[] {
  const result: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaping = false;
  let tokenStarted = false;

  for (const character of value) {
    if (escaping) {
      current += character;
      escaping = false;
      tokenStarted = true;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaping = true;
      tokenStarted = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      else current += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      tokenStarted = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (tokenStarted) result.push(current);
      current = "";
      tokenStarted = false;
      continue;
    }
    current += character;
    tokenStarted = true;
  }

  if (escaping) throw new Error("程序参数末尾存在未完成的转义符");
  if (quote) throw new Error("程序参数中存在未闭合的引号");
  if (tokenStarted) result.push(current);
  return result;
}

export function prepareStandardInput(value: string): string[] {
  if (!value) return [];
  const normalized = value.replaceAll(/\r\n?/g, "\n");
  const completeLines = normalized.endsWith("\n") ? normalized : `${normalized}\n`;
  return completeLines
    .slice(0, -1)
    .split("\n")
    .flatMap((line) => line ? [line, "\r"] : ["\r"]);
}
