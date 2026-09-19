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
    <aside className="flex w-11 shrink-0 flex-col items-center border-r border-border bg-panel py-1.5">
      <IconButton
        label="文件"
        side="right"
        onClick={onToggleExplorer}
        className={cn("relative size-9 rounded-none", explorerOpen && "text-fg")}
      >
        {explorerOpen && <span className="absolute inset-y-1 left-0 w-px bg-fg" />}
        <Files className="size-[18px]" strokeWidth={1.7} />
      </IconButton>
      <IconButton
        label="输出面板"
        side="right"
        onClick={onTogglePanel}
        className={cn("relative size-9 rounded-none", panelOpen && "text-fg")}
      >
        {panelOpen && <span className="absolute inset-y-1 left-0 w-px bg-fg" />}
        <PanelBottom className="size-[18px]" strokeWidth={1.7} />
      </IconButton>
    </aside>
  );
}
