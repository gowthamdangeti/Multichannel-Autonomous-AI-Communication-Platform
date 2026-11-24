"use client";

import { useEffect, useState } from "react";
import { fetchHealth, HealthCheckData } from "@/lib/api";
import { Activity, Shield, Terminal, Zap } from "lucide-react";

export default function Header() {
  const [health, setHealth] = useState<HealthCheckData | null>(null);
  const [connected, setConnected] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    const check = async () => {
      try {
        const data = await fetchHealth();
        if (isMounted) {
          setHealth(data);
          setConnected(true);
        }
      } catch (err) {
        if (isMounted) setConnected(false);
      }
    };
    check();
    const interval = setInterval(check, 10000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <header className="h-14 border-b border-surface-border bg-surface/80 backdrop-blur sticky top-0 z-30 flex items-center justify-between px-6 select-none">
      <div className="flex items-center space-x-4">
        <span className="text-xs font-mono px-2 py-0.5 rounded bg-surface-light text-slate-300 border border-surface-border">
          ENV: {health?.environment || "development"}
        </span>
        <span className="text-xs text-slate-400 flex items-center space-x-1.5">
          <Terminal className="w-3.5 h-3.5 text-accent-cyan" />
          <span>LangGraph & ARQ Hybrid Mesh</span>
        </span>
      </div>

      <div className="flex items-center space-x-4">
        {/* Backend health pill */}
        <div className="flex items-center space-x-2 text-xs">
          <span className="text-slate-400">Backend API:</span>
          {connected ? (
            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Connected (8000)</span>
            </span>
          ) : (
            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-mono bg-rose-500/10 text-rose-400 border border-rose-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
              <span>Offline / Connecting</span>
            </span>
          )}
        </div>

        {/* Autonomous workforce count */}
        <div className="flex items-center space-x-1.5 text-xs text-slate-300 bg-surface-light px-2.5 py-1 rounded border border-surface-border font-mono">
          <Zap className="w-3.5 h-3.5 text-amber-400" />
          <span>{health?.details?.registered_agents_count ?? 4} Agents Online</span>
        </div>
      </div>
    </header>
  );
}
