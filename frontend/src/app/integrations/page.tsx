"use client";

import { useEffect, useState } from "react";
import { fetchModelProviders } from "@/lib/api";
import { Blocks, CheckCircle, Cpu, Key, Shield, Zap } from "lucide-react";

export default function IntegrationsPage() {
  const [providers, setProviders] = useState<any[]>([]);

  useEffect(() => {
    fetchModelProviders()
      .then(setProviders)
      .catch(() => [
        { provider: "openai", name: "OpenAI", models: ["gpt-4o", "o1-preview"], configured: true },
        { provider: "gemini", name: "Google Gemini", models: ["gemini-1.5-pro", "gemini-2.0-flash"], configured: true },
        { provider: "anthropic", name: "Anthropic Claude", models: ["claude-3-5-sonnet-20241022"], configured: true },
        { provider: "groq", name: "Groq LPU", models: ["llama-3.3-70b-versatile"], configured: false },
        { provider: "deepseek", name: "DeepSeek", models: ["deepseek-chat", "deepseek-coder"], configured: false },
      ]);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Frontier Model Providers & Integrations</h1>
        <p className="text-xs text-slate-400">
          Manage model routing, API credentials, rate limits, and external tool adapters.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {providers.map((p) => (
          <div key={p.provider} className="glass-panel p-6 rounded-xl border border-surface-border space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white">{p.name}</span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                  p.configured
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                    : "bg-slate-800 text-slate-400 border-slate-700"
                }`}
              >
                {p.configured ? "Configured" : "Needs API Key"}
              </span>
            </div>

            <div className="space-y-1">
              <span className="text-[11px] font-mono text-slate-400 block">Available Models:</span>
              <div className="flex flex-wrap gap-1">
                {p.models.map((m: string) => (
                  <span key={m} className="px-2 py-0.5 rounded bg-surface-light text-[10px] font-mono text-slate-300 border border-surface-border">
                    {m}
                  </span>
                ))}
              </div>
            </div>

            <div className="pt-3 border-t border-surface-border/60 flex items-center justify-between text-xs">
              <span className="text-[11px] text-slate-500 font-mono">Dynamic fallback active</span>
              <button className="px-2.5 py-1 rounded bg-surface-light hover:bg-slate-700 border border-surface-border text-slate-300 text-[11px] font-medium transition-colors">
                Configure
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
