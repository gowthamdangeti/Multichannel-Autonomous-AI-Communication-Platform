"use client";

import { Users, Bot, GitPullRequest, ArrowUpRight } from "lucide-react";

const TEAMS = [
  {
    name: "Strategic Intelligence Swarm",
    department: "Research and Intelligence",
    lead: "senior-researcher",
    agentsCount: 4,
    description: "Monitors market signals, synthesizes regulatory shifts, and produces executive intelligence reports.",
    status: "Active"
  },
  {
    name: "Full-Stack Core Engineering",
    department: "Software Engineering",
    lead: "lead-software-architect",
    agentsCount: 6,
    description: "Designs, generates, refactors, and validates clean modular microservices and frontend clients.",
    status: "Active"
  },
  {
    name: "Operational Telemetry & Performance",
    department: "Data and Analytics",
    lead: "principal-data-analyst",
    agentsCount: 3,
    description: "Evaluates platform telemetry, error classification, and agent execution duration.",
    status: "Active"
  }
];

export default function TeamsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Autonomous Agent Teams</h1>
        <p className="text-xs text-slate-400">
          Collaborative agent clusters grouped by departmental objectives with assigned team leads.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {TEAMS.map((team, idx) => (
          <div key={idx} className="glass-panel p-6 rounded-xl border border-surface-border space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider text-brand-500">
                {team.department}
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                {team.status}
              </span>
            </div>

            <h3 className="text-sm font-semibold text-white">{team.name}</h3>
            <p className="text-xs text-slate-400">{team.description}</p>

            <div className="pt-4 border-t border-surface-border/60 flex items-center justify-between text-xs text-slate-400 font-mono">
              <span>Lead: @{team.lead}</span>
              <span>{team.agentsCount} Agents</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
