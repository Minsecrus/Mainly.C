import type { Directory } from "@wasmer/sdk";

export const VIRTUAL_WORKSPACE_PATH = "/workspace";

export type VirtualFileContents = string | Uint8Array;
export type VirtualFileMap = Record<string, VirtualFileContents>;
export type VirtualTextFileMap = Record<string, string>;

export async function readVirtualTextFiles(
  directory: Directory,
): Promise<VirtualTextFileMap> {
  const entries = await directory.readDir(".");
  const textFiles = entries.filter(
    (entry) => entry.type === "file" && entry.name.toLowerCase().endsWith(".txt"),
  );
  return Object.fromEntries(
    await Promise.all(
      textFiles.map(async (entry) => [entry.name, await directory.readTextFile(entry.name)]),
    ),
  );
}
