import { useEffect, useId, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { Dialog } from "radix-ui";

import { IconButton } from "./IconButton.js";

interface FileNameDialogProps {
  open: boolean;
  title: string;
  description: string;
  initialValue?: string;
  placeholder?: string;
  submitLabel: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => void;
}

export function FileNameDialog({
  open,
  title,
  description,
  initialValue = "",
  placeholder = "main.c",
  submitLabel,
  onOpenChange,
  onSubmit,
}: FileNameDialogProps) {
  const inputId = useId();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setError("");
    }
  }, [initialValue, open]);

  function submit(event: FormEvent): void {
    event.preventDefault();
    try {
      onSubmit(value);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/65 backdrop-blur-[2px] data-[state=open]:animate-[fade-in_120ms_ease-out]" />
        <Dialog.Content className="fixed top-[28%] left-1/2 z-50 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 rounded-xl border border-border bg-raised p-5 text-fg shadow-2xl shadow-black/60 outline-none data-[state=open]:animate-[dialog-in_150ms_ease-out]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-sm font-semibold text-fg">{title}</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs leading-5 text-secondary">
                {description}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <IconButton label="关闭" className="-mt-1 -mr-1">
                <X className="size-4" />
              </IconButton>
            </Dialog.Close>
          </div>
          <form onSubmit={submit} className="mt-5">
            <label htmlFor={inputId} className="mb-2 block text-[11px] font-medium text-muted">
              文件名
            </label>
            <input
              id={inputId}
              autoFocus
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              spellCheck={false}
              className="h-9 w-full rounded-md border border-border bg-inset px-3 font-mono text-sm text-fg outline-none transition focus:border-border-strong focus:ring-1 focus:ring-fg"
              placeholder={placeholder}
            />
            <div className="mt-2 min-h-4 text-[11px] text-muted" role="alert">
              {error}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="h-8 rounded-md px-3 text-xs text-muted hover:bg-hover hover:text-fg"
                >
                  取消
                </button>
              </Dialog.Close>
              <button
                type="submit"
                className="h-8 rounded-md bg-primary px-3 text-xs font-semibold text-on-primary hover:bg-primary-hover"
              >
                {submitLabel}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
