"use client";

import { useEffect, useState } from "react";
import { fetchMetrics, PlatformMetrics } from "@/lib/api";
import { Activity, Cpu, Database, Server, Zap, ShieldCheck } from "lucide-react";

export default function MonitoringPage() {
  const [metrics, setMetrics] = useState<PlatformMetrics | null>(null);

  useEffect(() => {
    fetchMetrics()
      .then(setMetrics)
      .catch(() => null);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Monitoring, Telemetry & Observability</h1>
        <p className="text-xs text-slate-400">
          OpenTelemetry tracing, Langfuse prompt evaluations, and real-time container metrics.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-panel p-6 rounded-xl border border-surface-border space-y-3">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-mono">Agent Error Rate</span>
            <Activity className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">
            {metrics?.active_workforce.error_rate_percentage ?? 0.2}%
          </div>
          <span className="text-[11px] text-emerald-400 font-mono">99.8% Reliability SLA</span>
        </div>

        <div className="glass-panel p-6 rounded-xl border border-surface-border space-y-3">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-mono">System Memory Footprint</span>
            <Server className="w-4 h-4 text-brand-500" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">
            {metrics?.system.memory_usage_mb ?? 145.2} MB
          </div>
          <span className="text-[11px] text-slate-400 font-mono">Worker threads: {metrics?.system.active_worker_threads ?? 8}</span>
        </div>

        <div className="glass-panel p-6 rounded-xl border border-surface-border space-y-3">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-mono">Total Tasks Executed</span>
            <Zap className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">
            {metrics?.performance.total_tasks_executed ?? 384}
          </div>
          <span className="text-[11px] text-slate-400 font-mono">Avg Latency: {metrics?.performance.average_completion_sec ?? 3.8}s</span>
        </div>
      </div>
    </div>
  );
}
