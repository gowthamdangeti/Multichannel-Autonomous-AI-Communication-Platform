import type { ChatAgentRow } from "@/client/types.gen";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { ChatAgentTableRow } from "./ChatAgentTableRow";

const HEAD = "h-10 px-4";

export function ChatAgentTable({ agents }: { agents: ChatAgentRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={HEAD}>Agent</TableHead>
          <TableHead className={HEAD}>Status</TableHead>
          <TableHead className={`${HEAD} text-right`}>Conversations</TableHead>
          <TableHead className={`${HEAD} hidden lg:table-cell`}>Share</TableHead>
          <TableHead className={`${HEAD} hidden text-right lg:table-cell`}>Messages</TableHead>
          <TableHead className={`${HEAD} hidden text-right xl:table-cell`}>Avg per chat</TableHead>
          <TableHead className={`${HEAD} text-right`}>Engaged</TableHead>
          <TableHead className={`${HEAD} hidden text-right lg:table-cell`}>Last activity</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {agents.map((agent) => (
          <ChatAgentTableRow key={agent.id} agent={agent} />
        ))}
      </TableBody>
    </Table>
  );
}
