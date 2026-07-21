import { cn } from "../../lib/cn.js";

interface FileLabelProps {
  name: string;
  className?: string;
  markerClassName?: string;
  nameClassName?: string;
}

export function FileLabel({
  name,
  className,
  markerClassName,
  nameClassName,
}: FileLabelProps) {
  const marker = name.toLowerCase().endsWith(".txt") ? "T" : "C";

  return (
    <span className={cn("flex min-w-0 items-baseline gap-2", className)}>
      <span className={cn("shrink-0 font-mono", markerClassName)}>{marker}</span>
      <span className={cn("min-w-0 flex-1 truncate", nameClassName)}>{name}</span>
    </span>
  );
}
