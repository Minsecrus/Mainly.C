import { Files, PanelBottom } from "lucide-react";

import { cn } from "../../lib/cn.js";
import { IconButton } from "../ui/IconButton.js";

interface ActivityRailProps {
  explorerOpen: boolean;
  panelOpen: boolean;
  onToggleExplorer: () => void;
  onTogglePanel: () => void;
}

export function ActivityRail({
  explorerOpen,
  panelOpen,
  onToggleExplorer,
  onTogglePanel,
}: ActivityRailProps) {
  return (
    <aside className="flex w-11 shrink-0 flex-col items-center border-r border-white/[0.12] bg-[#111111] py-1.5">
      <IconButton
        label="文件"
        side="right"
        onClick={onToggleExplorer}
        className={cn("relative size-9 rounded-none", explorerOpen && "text-neutral-100")}
      >
        {explorerOpen && <span className="absolute inset-y-1 left-0 w-px bg-neutral-200" />}
        <Files className="size-[18px]" strokeWidth={1.7} />
      </IconButton>
      <IconButton
        label="输出面板"
        side="right"
        onClick={onTogglePanel}
        className={cn("relative size-9 rounded-none", panelOpen && "text-neutral-100")}
      >
        {panelOpen && <span className="absolute inset-y-1 left-0 w-px bg-neutral-200" />}
        <PanelBottom className="size-[18px]" strokeWidth={1.7} />
      </IconButton>
    </aside>
  );
}
