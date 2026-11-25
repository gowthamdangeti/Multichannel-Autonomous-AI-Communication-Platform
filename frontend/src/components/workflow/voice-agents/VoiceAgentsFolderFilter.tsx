import { Archive as ArchiveIcon, Folder as FolderIcon, Inbox } from "lucide-react";

import type { FolderResponse } from "@/client/types.gen";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { FolderFilter } from "./hooks/useVoiceAgents";

interface VoiceAgentsFolderFilterProps {
  folders: FolderResponse[];
  selected: FolderFilter;
  selectedLabel: string;
  archivedCount: number;
  onSelect: (folder: FolderFilter) => void;
}

function FilterIcon({ selected }: { selected: FolderFilter }) {
  if (selected === "uncategorized") return <Inbox className="h-4 w-4 text-muted-foreground" />;
  if (selected === "archived") return <ArchiveIcon className="h-4 w-4 text-muted-foreground" />;
  if (selected === "all") return <FolderIcon className="h-4 w-4 text-muted-foreground" />;
  return <FolderIcon className="h-4 w-4 text-status-warning" />;
}

export function VoiceAgentsFolderFilter({
  folders,
  selected,
  selectedLabel,
  archivedCount,
  onSelect,
}: VoiceAgentsFolderFilterProps) {
  const itemClass = (value: FolderFilter) => (selected === value ? "font-semibold" : "");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="flex items-center gap-2">
          <FilterIcon selected={selected} />
          <span>{selectedLabel}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs">Filter by Folder</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onSelect("all")} className={itemClass("all")}>
          <FolderIcon size={14} className="mr-2 text-muted-foreground" />
          All Agents
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSelect("uncategorized")} className={itemClass("uncategorized")}>
          <Inbox size={14} className="mr-2 text-muted-foreground" />
          Uncategorized
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSelect("archived")} className={itemClass("archived")}>
          <ArchiveIcon size={14} className="mr-2 text-muted-foreground" />
          Archived
          {archivedCount > 0 && <span className="ml-auto text-xs text-muted-foreground">{archivedCount}</span>}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {folders.map((folder) => (
          <DropdownMenuItem
            key={folder.id}
            onClick={() => onSelect(Number(folder.id))}
            className={itemClass(Number(folder.id))}
          >
            <FolderIcon size={14} className="mr-2 text-status-warning" />
            <span className="truncate">{folder.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
