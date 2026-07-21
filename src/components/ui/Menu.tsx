import type { ComponentProps, ReactNode } from "react";
import { Check, ChevronRight } from "lucide-react";
import { DropdownMenu } from "radix-ui";

import { cn } from "../../lib/cn.js";

export const menuContentClass =
  "z-50 min-w-52 overflow-hidden rounded-lg border border-white/15 bg-neutral-900/98 p-1 text-[12px] text-neutral-100 shadow-2xl shadow-black/50 backdrop-blur-xl data-[state=open]:animate-[menu-in_120ms_ease-out]";

export function MenuItem({
  className,
  inset,
  icon,
  shortcut,
  destructive,
  children,
  ...props
}: ComponentProps<typeof DropdownMenu.Item> & {
  inset?: boolean;
  icon?: ReactNode;
  shortcut?: string;
  destructive?: boolean;
}) {
  return (
    <DropdownMenu.Item
      className={cn(
        "flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-35",
        destructive
          ? "text-red-400 data-[highlighted]:bg-red-500/10 data-[highlighted]:text-red-300"
          : "data-[highlighted]:bg-white/[0.08] data-[highlighted]:text-white",
        inset && "pl-8",
        className,
      )}
      {...props}
    >
      {icon && <span className="flex size-4 items-center justify-center">{icon}</span>}
      <span className="min-w-0 flex-1">{children}</span>
      {shortcut && <span className="ml-4 text-[10px] tracking-wide text-neutral-400">{shortcut}</span>}
    </DropdownMenu.Item>
  );
}

export function MenuCheckboxItem({
  children,
  className,
  ...props
}: ComponentProps<typeof DropdownMenu.CheckboxItem>) {
  return (
    <DropdownMenu.CheckboxItem
      className={cn(
        "relative flex h-8 cursor-pointer items-center rounded-md pr-2 pl-8 outline-none select-none data-[disabled]:cursor-not-allowed data-[highlighted]:bg-white/[0.08] data-[highlighted]:text-white data-[disabled]:opacity-35",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <DropdownMenu.ItemIndicator>
          <Check className="size-3.5" strokeWidth={2} />
        </DropdownMenu.ItemIndicator>
      </span>
      {children}
    </DropdownMenu.CheckboxItem>
  );
}

export function MenuRadioItem({
  children,
  className,
  ...props
}: ComponentProps<typeof DropdownMenu.RadioItem>) {
  return (
    <DropdownMenu.RadioItem
      className={cn(
        "relative flex h-8 cursor-pointer items-center gap-2 rounded-md pr-2 pl-8 outline-none select-none data-[disabled]:cursor-not-allowed data-[highlighted]:bg-white/[0.08] data-[highlighted]:text-white data-[disabled]:opacity-35",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <DropdownMenu.ItemIndicator>
          <Check className="size-3.5" strokeWidth={2} />
        </DropdownMenu.ItemIndicator>
      </span>
      {children}
    </DropdownMenu.RadioItem>
  );
}

export function MenuSubTrigger({
  children,
  className,
  ...props
}: ComponentProps<typeof DropdownMenu.SubTrigger>) {
  return (
    <DropdownMenu.SubTrigger
      className={cn(
        "flex h-8 cursor-pointer items-center rounded-md px-2 outline-none select-none data-[disabled]:cursor-not-allowed data-[highlighted]:bg-white/[0.08] data-[state=open]:bg-white/[0.08] data-[disabled]:opacity-35",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto size-3.5 text-neutral-400" />
    </DropdownMenu.SubTrigger>
  );
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="my-1 h-px bg-white/[0.07]" />;
}
