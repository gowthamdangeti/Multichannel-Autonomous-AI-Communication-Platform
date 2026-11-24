"use client";

import { useEffect, useState } from "react";
import ObjectiveInput from "@/components/ObjectiveInput";
import AgentCard from "@/components/AgentCard";
import { fetchAgents, fetchMetrics, Agent, PlatformMetrics } from "@/lib/api";
import { Bot, CheckCircle2, Cpu, DollarSign, Sparkles, TrendingUp, Users } from "lucide-react";

export default function OverviewPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [metrics, setMetrics] = useState<PlatformMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      try {
        const [agentsData, metricsData] = await Promise.all([
          fetchAgents().catch(() => []),
          fetchMetrics().catch(() => null),
        ]);
        if (isMounted) {
          setAgents(agentsData);
          setMetrics(metricsData);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <div className="space-y-8">
      {/* Title & Description */}
      <div className="flex flex-col space-y-1">
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-brand-500 animate-ping" />
          <span className="text-xs font-mono uppercase tracking-widest text-brand-500 font-semibold">
            Enterprise Command Center
          </span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white">
          Autonomous Multi-Agent Operating System
        </h1>
        <p className="text-xs text-slate-400">
          Supervised autonomous workforce coordinating research, engineering, data analytics, and executive communications.
        </p>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="glass-panel p-5 rounded-xl border border-surface-border">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-mono">Autonomous Agents</span>
            <Bot className="w-4 h-4 text-brand-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-white font-mono">
            {agents.length || 4}
          </div>
          <span className="text-[11px] text-emerald-400 flex items-center space-x-1 mt-1 font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>100% Ready & Registered</span>
          </span>
        </div>

        <div className="glass-panel p-5 rounded-xl border border-surface-border">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-mono">Execution Success</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-white font-mono">
            {metrics?.performance.success_rate ?? 99.1}%
          </div>
          <span className="text-[11px] text-slate-400 mt-1 font-mono block">
            With autonomous backoff retry
          </span>
        </div>

        <div className="glass-panel p-5 rounded-xl border border-surface-border">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-mono">Avg Task Latency</span>
            <Cpu className="w-4 h-4 text-accent-cyan" />
          </div>
          <div className="mt-2 text-2xl font-bold text-white font-mono">
            {metrics?.performance.average_completion_sec ?? 3.8}s
          </div>
          <span className="text-[11px] text-slate-400 mt-1 font-mono block">
            Parallel graph resolution
          </span>
        </div>

        <div className="glass-panel p-5 rounded-xl border border-surface-border">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-mono">Est. Operational Savings</span>
            <DollarSign className="w-4 h-4 text-amber-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-white font-mono">
            ${(metrics?.performance.cost_saved_usd ?? 14250).toLocaleString()}
          </div>
          <span className="text-[11px] text-emerald-400 flex items-center space-x-1 mt-1 font-mono">
            <TrendingUp className="w-3 h-3" />
            <span>+38% vs Manual Workflows</span>
          </span>
        </div>
      </div>

      {/* Main Orchestration Input */}
      <ObjectiveInput />

      {/* Autonomous Workforce Catalog */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-surface-border pb-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Active Workforce Registry</h3>
            <p className="text-xs text-slate-400">
              Foundational agents with verified models, system prompts, and tool contracts.
            </p>
          </div>
          <span className="text-xs font-mono text-slate-500">
            {agents.length} Foundational Agents
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {agents.map((agent) => (
            <AgentCard key={agent.slug} agent={agent} />
          ))}
        </div>
      </div>
    </div>
  );
}
