import type { VoiceAgentRow } from "@/client/types.gen";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { VoiceAgentTableRow } from "./VoiceAgentTableRow";

const HEAD = "h-10 px-4";

export function VoiceAgentTable({ agents }: { agents: VoiceAgentRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={HEAD}>Agent</TableHead>
          <TableHead className={HEAD}>Status</TableHead>
          <TableHead className={`${HEAD} text-right`}>Calls</TableHead>
          <TableHead className={`${HEAD} hidden lg:table-cell`}>Share</TableHead>
          <TableHead className={`${HEAD} hidden text-right lg:table-cell`}>Talk time</TableHead>
          <TableHead className={`${HEAD} hidden text-right xl:table-cell`}>Avg length</TableHead>
          <TableHead className={`${HEAD} text-right`}>Completed</TableHead>
          <TableHead className={`${HEAD} hidden text-right xl:table-cell`}>In / Out</TableHead>
          <TableHead className={`${HEAD} hidden text-right lg:table-cell`}>Last call</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {agents.map((agent) => (
          <VoiceAgentTableRow key={agent.id} agent={agent} />
        ))}
      </TableBody>
    </Table>
  );
}
