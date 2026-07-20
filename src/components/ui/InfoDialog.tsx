import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Dialog } from "radix-ui";

import { IconButton } from "./IconButton.js";

interface InfoDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  onOpenChange: (open: boolean) => void;
}

export function InfoDialog({ open, title, children, onOpenChange }: InfoDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/65 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/10 bg-neutral-950 p-5 text-neutral-300 shadow-2xl outline-none">
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="text-sm font-semibold text-neutral-100">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label="关闭" className="-mt-1 -mr-1"><X className="size-4" /></IconButton>
            </Dialog.Close>
          </div>
          <Dialog.Description asChild>
            <div className="mt-4 text-xs leading-6 text-neutral-300">{children}</div>
          </Dialog.Description>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
