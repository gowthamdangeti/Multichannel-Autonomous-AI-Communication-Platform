import type { FolderResponse } from "@/client/types.gen";
import { PageSearchInput } from "@/components/layout/PageSearchInput";
import { CreateFolderButton } from "@/components/workflow/folders/CreateFolderButton";

import type { FolderFilter } from "./hooks/useVoiceAgents";
import { VoiceAgentsFolderFilter } from "./VoiceAgentsFolderFilter";

interface VoiceAgentsToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  folders: FolderResponse[];
  selectedFolder: FolderFilter;
  selectedFolderLabel: string;
  archivedCount: number;
  onFolderSelect: (folder: FolderFilter) => void;
  onFolderCreated: (folder: FolderResponse) => void;
}

export function VoiceAgentsToolbar({
  searchQuery,
  onSearchChange,
  folders,
  selectedFolder,
  selectedFolderLabel,
  archivedCount,
  onFolderSelect,
  onFolderCreated,
}: VoiceAgentsToolbarProps) {
  return (
    <>
      <PageSearchInput placeholder="Search agents..." value={searchQuery} onChange={onSearchChange} />
      {/* The filter only appears once there is a folder to filter by. */}
      {folders.length > 0 && (
        <VoiceAgentsFolderFilter
          folders={folders}
          selected={selectedFolder}
          selectedLabel={selectedFolderLabel}
          archivedCount={archivedCount}
          onSelect={onFolderSelect}
        />
      )}
      <CreateFolderButton onCreated={onFolderCreated} />
    </>
  );
}
