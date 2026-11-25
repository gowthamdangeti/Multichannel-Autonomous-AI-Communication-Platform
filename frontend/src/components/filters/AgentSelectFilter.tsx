import { ChevronDown, Loader2, Search } from "lucide-react";
import React, { useEffect, useState } from "react";

import { getWorkflowsApiV1WorkflowFetchGet } from "@/client/sdk.gen";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { MultiSelectValue } from "@/types/filters";

interface AgentItem {
  id: number;
  name: string;
}

interface AgentSelectFilterProps {
  value: MultiSelectValue;
  onChange: (value: MultiSelectValue) => void;
  error?: string;
}

export const AgentSelectFilter: React.FC<AgentSelectFilterProps> = ({
  value,
  onChange,
  error,
}) => {
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;
    async function loadAgents() {
      setIsLoading(true);
      try {
        const res = await getWorkflowsApiV1WorkflowFetchGet();
        if (isMounted && res.data) {
          const list: AgentItem[] = res.data.map((w: { id: number; name?: string | null }) => ({
            id: w.id,
            name: w.name || `Agent #${w.id}`,
          }));
          setAgents(list);
        }
      } catch (err) {
        console.error("Failed to load agents for filter", err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    loadAgents();
    return () => {
      isMounted = false;
    };
  }, []);

  const selectedCodes = value.codes || [];

  const filteredAgents = agents.filter((agent) =>
    agent.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    agent.id.toString().includes(searchTerm)
  );

  const handleToggleAgent = (agentId: number) => {
    const idStr = agentId.toString();
    const newCodes = selectedCodes.includes(idStr)
      ? selectedCodes.filter((c) => c !== idStr)
      : [...selectedCodes, idStr];
    onChange({ codes: newCodes });
  };

  const handleSelectAll = () => {
    const allIds = agents.map((a) => a.id.toString());
    onChange({ codes: allIds });
  };

  const handleSelectNone = () => {
    onChange({ codes: [] });
  };

  const getDisplayText = () => {
    if (selectedCodes.length === 0) return "Select Agent(s)...";
    const selectedNames = selectedCodes.map((code) => {
      const found = agents.find((a) => a.id.toString() === code);
      return found ? found.name : `Agent #${code}`;
    });
    if (selectedNames.length <= 2) return selectedNames.join(", ");
    return `${selectedNames.slice(0, 2).join(", ")} +${selectedNames.length - 2} more`;
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium">Filter by Agent</Label>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={isOpen}
            className={cn(
              "w-full justify-between h-9 text-xs font-normal",
              selectedCodes.length === 0 && "text-muted-foreground"
            )}
          >
            <span className="truncate">{getDisplayText()}</span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[280px] p-2" align="start">
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search agent by name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 h-8 text-xs"
              />
            </div>

            <div className="flex gap-1.5 border-b pb-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSelectAll}
                className="flex-1 h-7 text-[11px]"
                disabled={agents.length === 0}
              >
                Select All
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSelectNone}
                className="flex-1 h-7 text-[11px]"
                disabled={selectedCodes.length === 0}
              >
                Clear
              </Button>
            </div>

            <div className="max-h-[220px] overflow-auto space-y-0.5">
              {isLoading ? (
                <div className="flex items-center justify-center py-4 text-xs text-muted-foreground gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading agents...
                </div>
              ) : filteredAgents.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  {searchTerm ? "No matching agents found" : "No agents available"}
                </p>
              ) : (
                filteredAgents.map((agent) => {
                  const isChecked = selectedCodes.includes(agent.id.toString());
                  return (
                    <div
                      key={agent.id}
                      className={cn(
                        "flex items-center space-x-2.5 px-2 py-1.5 hover:bg-muted/60 rounded-md cursor-pointer text-xs transition-colors",
                        isChecked && "bg-muted/40 font-medium"
                      )}
                      onClick={() => handleToggleAgent(agent.id)}
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => handleToggleAgent(agent.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-3.5 w-3.5"
                      />
                      <span className="flex-1 truncate">{agent.name}</span>
                      <span className="text-[10px] text-muted-foreground font-mono bg-muted/80 px-1 py-0.5 rounded">
                        #{agent.id}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            {selectedCodes.length > 0 && (
              <div className="pt-1.5 border-t text-[11px] text-muted-foreground font-medium flex justify-between items-center">
                <span>{selectedCodes.length} agent(s) selected</span>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
};
