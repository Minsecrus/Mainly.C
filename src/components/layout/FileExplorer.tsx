import { useState } from "react";
import {
  FilePlus2,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { AlertDialog, DropdownMenu } from "radix-ui";

import type { SourceFile } from "../../features/files/useLocalFiles.js";
import { cn } from "../../lib/cn.js";
import { FileNameDialog } from "../ui/FileNameDialog.js";
import { IconButton } from "../ui/IconButton.js";
import { MenuItem, MenuSeparator, menuContentClass } from "../ui/Menu.js";

interface FileExplorerProps {
  files: SourceFile[];
  activeFileId: string;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onReset: () => void;
}

export function FileExplorer({
  files,
  activeFileId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onReset,
}: FileExplorerProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<SourceFile | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SourceFile | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  return (
    <>
      <aside className="flex h-full w-[218px] shrink-0 flex-col border-r border-white/[0.12] bg-[#161616]">
        <div className="flex h-9 shrink-0 items-center px-3 text-[10px] font-semibold tracking-[0.14em] text-neutral-300 uppercase">
          <span className="flex-1">文件</span>
          <IconButton label="新建 C 文件" onClick={() => setCreateOpen(true)} className="size-7">
            <Plus className="size-3.5" />
          </IconButton>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <IconButton label="更多文件操作" className="size-7">
                <MoreHorizontal className="size-3.5" />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content side="bottom" align="end" sideOffset={4} className={menuContentClass}>
                <MenuItem icon={<FilePlus2 className="size-3.5" />} onSelect={() => setCreateOpen(true)}>
                  新建 C 文件
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon={<RotateCcw className="size-3.5" />} onSelect={() => setResetOpen(true)}>
                  恢复初始工作区
                </MenuItem>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {files.map((file) => {
            const active = file.id === activeFileId;
            return (
              <div
                key={file.id}
                className={cn(
                  "group flex h-7 items-center pr-1 pl-3 text-[12px] text-neutral-300 transition-colors",
                  active ? "bg-white/[0.12] text-white" : "hover:bg-white/[0.07] hover:text-white",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(file.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
                >
                  <span className={cn("font-mono text-[10px] font-semibold", active ? "text-white" : "text-neutral-400")}>
                    C
                  </span>
                  <span className="truncate">{file.name}</span>
                </button>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      type="button"
                      aria-label={`${file.name} 操作`}
                      className="flex size-6 items-center justify-center rounded text-neutral-400 opacity-0 outline-none group-hover:opacity-100 hover:bg-white/[0.1] hover:text-white focus:opacity-100"
                    >
                      <MoreHorizontal className="size-3.5" />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content side="right" align="start" sideOffset={4} className={menuContentClass}>
                      <MenuItem icon={<Pencil className="size-3.5" />} onSelect={() => setRenameTarget(file)}>
                        重命名
                      </MenuItem>
                      <MenuItem icon={<Trash2 className="size-3.5" />} onSelect={() => setDeleteTarget(file)}>
                        删除
                      </MenuItem>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </div>
            );
          })}
        </div>

      </aside>

      <FileNameDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="新建 C 文件"
        description="文件保存在当前浏览器中，不会上传。"
        submitLabel="创建"
        initialValue="untitled.c"
        onSubmit={onCreate}
      />
      <FileNameDialog
        open={renameTarget !== null}
        onOpenChange={(open) => !open && setRenameTarget(null)}
        title="重命名文件"
        description="文件扩展名将保持为 .c。"
        submitLabel="重命名"
        initialValue={renameTarget?.name}
        onSubmit={(name) => renameTarget && onRename(renameTarget.id, name)}
      />

      <AlertDialog.Root open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/65 backdrop-blur-[2px]" />
          <AlertDialog.Content className="fixed top-[30%] left-1/2 z-50 w-[min(390px,calc(100vw-32px))] -translate-x-1/2 rounded-xl border border-white/10 bg-neutral-950 p-5 shadow-2xl outline-none">
            <AlertDialog.Title className="text-sm font-semibold text-neutral-100">删除 {deleteTarget?.name}？</AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-xs leading-5 text-neutral-300">
              该文件只存储在浏览器中。删除后无法撤销。
            </AlertDialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <button className="h-8 rounded-md px-3 text-xs text-neutral-400 hover:bg-white/[0.06]">取消</button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button
                  className="h-8 rounded-md bg-neutral-100 px-3 text-xs font-semibold text-neutral-950 hover:bg-white"
                  onClick={() => deleteTarget && onDelete(deleteTarget.id)}
                >
                  删除
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      <AlertDialog.Root open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/65 backdrop-blur-[2px]" />
          <AlertDialog.Content className="fixed top-[30%] left-1/2 z-50 w-[min(390px,calc(100vw-32px))] -translate-x-1/2 rounded-xl border border-white/10 bg-neutral-950 p-5 shadow-2xl outline-none">
            <AlertDialog.Title className="text-sm font-semibold text-neutral-100">恢复初始工作区？</AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-xs leading-5 text-neutral-300">
              现有的所有本地 C 文件都会被初始 main.c 替换。
            </AlertDialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <button className="h-8 rounded-md px-3 text-xs text-neutral-400 hover:bg-white/[0.06]">取消</button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button
                  className="h-8 rounded-md bg-neutral-100 px-3 text-xs font-semibold text-neutral-950 hover:bg-white"
                  onClick={onReset}
                >
                  恢复
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
