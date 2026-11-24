"use client";

import { useEffect, useState } from "react";
import { fetchAgents, Agent } from "@/lib/api";
import AgentCard from "@/components/AgentCard";
import { Bot, Filter, Plus, Search, Sparkles } from "lucide-react";

const DEPARTMENTS = [
  "All",
  "Research and Intelligence",
  "Communication",
  "Software Engineering",
  "Data and Analytics",
  "Security and Governance",
  "Finance and Procurement"
];

export default function WorkforcePage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedDept, setSelectedDept] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAgents()
      .then(setAgents)
      .catch(() => [])
      .finally(() => setLoading(false));
  }, []);

  const filteredAgents = agents.filter((agent) => {
    const matchesDept = selectedDept === "All" || agent.department === selectedDept;
    const matchesSearch =
      agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.role.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.capabilities.some((c) => c.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesDept && matchesSearch;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Autonomous AI Workforce</h1>
          <p className="text-xs text-slate-400">
            Registered agents with defined schemas, model providers, and autonomous tool access.
          </p>
        </div>
        <button className="px-3.5 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium flex items-center space-x-2 transition-colors">
          <Plus className="w-3.5 h-3.5" />
          <span>Register New Agent</span>
        </button>
      </div>

      {/* Filter and search bar */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 glass-panel p-4 rounded-xl border border-surface-border">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search agents by capability or role..."
            className="w-full pl-9 pr-4 py-1.5 bg-surface-light border border-surface-border rounded-lg text-xs text-slate-200 focus:outline-none focus:border-brand-500"
          />
        </div>

        <div className="flex items-center space-x-2 overflow-x-auto w-full md:w-auto pb-1 md:pb-0">
          {DEPARTMENTS.map((dept) => (
            <button
              key={dept}
              onClick={() => setSelectedDept(dept)}
              className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors ${
                selectedDept === dept
                  ? "bg-brand-600/20 text-brand-400 border border-brand-500/30"
                  : "bg-surface-light text-slate-400 hover:text-slate-200 border border-surface-border"
              }`}
            >
              {dept}
            </button>
          ))}
        </div>
      </div>

      {/* Agent Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredAgents.map((agent) => (
          <AgentCard key={agent.slug} agent={agent} />
        ))}
      </div>
    </div>
  );
}
