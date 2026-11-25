import type { WhatsAppAgentRow } from "@/client/types.gen";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { WhatsAppAgentTableRow } from "./WhatsAppAgentTableRow";

const HEAD = "h-10 px-4";

export function WhatsAppAgentTable({ agents }: { agents: WhatsAppAgentRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={HEAD}>Agent</TableHead>
          <TableHead className={HEAD}>Status</TableHead>
          <TableHead className={`${HEAD} text-right`}>New contacts</TableHead>
          <TableHead className={`${HEAD} text-right`}>Active</TableHead>
          <TableHead className={`${HEAD} hidden lg:table-cell`}>Share</TableHead>
          <TableHead className={`${HEAD} hidden text-right lg:table-cell`}>Awaiting reply</TableHead>
          <TableHead className={`${HEAD} hidden text-right lg:table-cell`}>Last activity</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {agents.map((agent) => (
          <WhatsAppAgentTableRow key={agent.id} agent={agent} />
        ))}
      </TableBody>
    </Table>
  );
}
