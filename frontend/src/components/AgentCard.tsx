import { Agent } from "@/lib/api";
import { Bot, CheckCircle, Cpu, Shield, Zap } from "lucide-react";

interface AgentCardProps {
  agent: Agent;
}

export default function AgentCard({ agent }: AgentCardProps) {
  return (
    <div className="glass-panel p-5 rounded-xl border border-surface-border hover:border-brand-500/50 transition-all flex flex-col justify-between space-y-4">
      <div>
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-surface-light border border-surface-border flex items-center justify-center text-brand-400">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-white">{agent.name}</h4>
              <span className="text-[11px] font-mono text-slate-400 block">{agent.department}</span>
            </div>
          </div>
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            <span className="w-1 h-1 rounded-full bg-emerald-400" />
            <span>Idle</span>
          </span>
        </div>

        <p className="text-xs text-slate-400 mt-3 line-clamp-2">
          {agent.description}
        </p>

        {/* Capabilities */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {agent.capabilities.slice(0, 4).map((cap, i) => (
            <span
              key={i}
              className="px-2 py-0.5 rounded text-[10px] font-mono bg-surface-light text-slate-300 border border-surface-border"
            >
              {cap}
            </span>
          ))}
        </div>
      </div>

      {/* Metrics footer */}
      <div className="pt-3 border-t border-surface-border/60 flex items-center justify-between text-[11px] font-mono text-slate-400">
        <div className="flex items-center space-x-1">
          <CheckCircle className="w-3 h-3 text-emerald-400" />
          <span>{agent.success_rate}% Success</span>
        </div>
        <div className="flex items-center space-x-1">
          <Cpu className="w-3 h-3 text-accent-cyan" />
          <span>{agent.total_tasks_completed} Tasks</span>
        </div>
      </div>
    </div>
  );
}
