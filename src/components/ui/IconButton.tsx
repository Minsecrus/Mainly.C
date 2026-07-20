import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Tooltip } from "radix-ui";

import { cn } from "../../lib/cn.js";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  side?: "top" | "right" | "bottom" | "left";
  children: ReactNode;
}

export function IconButton({
  label,
  side = "bottom",
  className,
  children,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <Tooltip.Root delayDuration={450}>
      <Tooltip.Trigger asChild>
        <button
          type={type}
          aria-label={label}
          className={cn(
            "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-neutral-400 outline-none transition-colors hover:bg-white/[0.1] hover:text-white focus-visible:ring-1 focus-visible:ring-neutral-300 disabled:cursor-not-allowed disabled:opacity-45",
            className,
          )}
          {...props}
        >
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={7}
          className="z-50 rounded-md border border-white/10 bg-neutral-900 px-2 py-1 text-[11px] font-medium text-neutral-200 shadow-xl shadow-black/30 select-none data-[state=delayed-open]:animate-[tooltip-in_120ms_ease-out]"
        >
          {label}
          <Tooltip.Arrow className="fill-neutral-900" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
