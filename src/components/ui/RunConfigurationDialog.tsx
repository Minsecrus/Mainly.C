import { useEffect, useId, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { Dialog } from "radix-ui";

import {
  EMPTY_RUN_CONFIGURATION,
  parseProgramArguments,
  type RunConfiguration,
} from "../../features/run/runConfiguration.js";
import { IconButton } from "./IconButton.js";

interface RunConfigurationDialogProps {
  open: boolean;
  configuration: RunConfiguration;
  onOpenChange: (open: boolean) => void;
  onSave: (configuration: RunConfiguration) => void;
}

export function RunConfigurationDialog({
  open,
  configuration,
  onOpenChange,
  onSave,
}: RunConfigurationDialogProps) {
  const argumentInputId = useId();
  const standardInputId = useId();
  const [draft, setDraft] = useState(configuration);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraft(configuration);
    setError("");
  }, [configuration, open]);

  function submit(event: FormEvent): void {
    event.preventDefault();
    try {
      parseProgramArguments(draft.argumentText);
      onSave(draft);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/65 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed top-[22%] left-1/2 z-50 w-[min(520px,calc(100vw-32px))] -translate-x-1/2 rounded-xl border border-white/10 bg-neutral-950 p-5 text-neutral-200 shadow-2xl shadow-black/60 outline-none">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-sm font-semibold text-neutral-100">运行配置</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs leading-5 text-neutral-300">
                配置命令行参数和每次运行时自动发送的标准输入。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <IconButton label="关闭" className="-mt-1 -mr-1">
                <X className="size-4" />
              </IconButton>
            </Dialog.Close>
          </div>

          <form className="mt-5 space-y-4" onSubmit={submit}>
            <div>
              <label htmlFor={argumentInputId} className="mb-2 block text-[11px] font-medium text-neutral-400">
                程序参数
              </label>
              <input
                id={argumentInputId}
                value={draft.argumentText}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  argumentText: event.target.value,
                }))}
                spellCheck={false}
                placeholder={'--name Ada "hello world"'}
                className="h-9 w-full rounded-md border border-white/10 bg-black/40 px-3 font-mono text-sm text-neutral-100 outline-none transition focus:border-neutral-500 focus:ring-1 focus:ring-neutral-600"
              />
              <p className="mt-1.5 text-[10px] text-neutral-500">支持空格、单引号、双引号和反斜杠转义。</p>
            </div>

            <div>
              <label htmlFor={standardInputId} className="mb-2 block text-[11px] font-medium text-neutral-400">
                预置标准输入
              </label>
              <textarea
                id={standardInputId}
                value={draft.standardInput}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  standardInput: event.target.value,
                }))}
                spellCheck={false}
                rows={5}
                placeholder={'Ada\n42'}
                className="w-full resize-y rounded-md border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm leading-5 text-neutral-100 outline-none transition focus:border-neutral-500 focus:ring-1 focus:ring-neutral-600"
              />
              <p className="mt-1.5 text-[10px] text-neutral-500">运行时按行写入，并自动为最后一行补回车；终端之后仍可继续输入。</p>
            </div>

            <div className="min-h-4 text-[11px] text-red-400" role="alert">{error}</div>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                className="h-8 rounded-md px-3 text-xs text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-100"
                onClick={() => {
                  setDraft(EMPTY_RUN_CONFIGURATION);
                  setError("");
                }}
              >
                清空配置
              </button>
              <div className="flex gap-2">
                <Dialog.Close asChild>
                  <button type="button" className="h-8 rounded-md px-3 text-xs text-neutral-400 hover:bg-white/[0.06]">
                    取消
                  </button>
                </Dialog.Close>
                <button type="submit" className="h-8 rounded-md bg-neutral-100 px-3 text-xs font-semibold text-neutral-950 hover:bg-white">
                  保存配置
                </button>
              </div>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
