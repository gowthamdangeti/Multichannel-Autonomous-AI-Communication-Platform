"use client";

import { useState } from "react";
import { Sparkles, Play, Loader2, ArrowRight, CheckCircle2, FileText, Code2, AlertCircle } from "lucide-react";
import { planObjective, executeObjective, ExecutionPlan, WorkflowResult } from "@/lib/api";
import { useAppStore } from "@/lib/store";

export default function ObjectiveInput() {
  const [objective, setObjective] = useState("");
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [loadingExecution, setLoadingExecution] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { currentPlan, currentResult, setCurrentPlan, setCurrentResult } = useAppStore();

  const handlePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!objective.trim()) return;
    setError(null);
    setLoadingPlan(true);
    try {
      const plan = await planObjective(objective);
      setCurrentPlan(plan);
      setCurrentResult(null);
    } catch (err: any) {
      setError(err.message || "Failed to generate execution plan.");
    } finally {
      setLoadingPlan(false);
    }
  };

  const handleExecute = async () => {
    if (!objective.trim()) return;
    setError(null);
    setLoadingExecution(true);
    try {
      const result = await executeObjective(objective);
      setCurrentResult(result);
    } catch (err: any) {
      setError(err.message || "Execution failed.");
    } finally {
      setLoadingExecution(false);
    }
  };

  return (
    <div className="w-full space-y-6">
      {/* Objective command bar */}
      <div className="glass-panel p-6 rounded-xl border border-surface-border">
        <div className="flex items-center space-x-2 text-xs font-mono text-brand-500 uppercase tracking-wider mb-2">
          <Sparkles className="w-3.5 h-3.5 text-brand-500" />
          <span>Autonomous AI OS Command Center</span>
        </div>
        <h2 className="text-lg font-semibold text-white mb-2">
          State Your High-Level Objective
        </h2>
        <p className="text-xs text-slate-400 mb-4">
          Natural-language objectives are analyzed, decomposed into dependency graphs, and delegated across specialized agents.
        </p>

        <form onSubmit={handlePlan} className="space-y-3">
          <div className="relative">
            <textarea
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="e.g. Conduct comprehensive competitive intelligence on enterprise autonomous agent platforms, verify code compliance, and draft executive memo"
              className="w-full h-24 bg-surface-light border border-surface-border rounded-lg p-3 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 resize-none font-sans"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="text-[11px] text-slate-500 font-mono">
                Autonomy: Controlled Enterprise Supervised
              </span>
            </div>

            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={handlePlan}
                disabled={loadingPlan || loadingExecution || !objective.trim()}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-surface-light hover:bg-slate-700 text-slate-200 border border-surface-border flex items-center space-x-2 disabled:opacity-50 transition-colors"
              >
                {loadingPlan ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-brand-500" />}
                <span>1. Generate Plan</span>
              </button>

              <button
                type="button"
                onClick={handleExecute}
                disabled={loadingExecution || !objective.trim()}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-brand-600 hover:bg-brand-500 text-white flex items-center space-x-2 disabled:opacity-50 transition-colors shadow-lg shadow-brand-600/20"
              >
                {loadingExecution ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                <span>2. Execute Autonomously</span>
              </button>
            </div>
          </div>
        </form>

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Plan Preview Section */}
      {currentPlan && (
        <div className="glass-panel p-6 rounded-xl border border-surface-border space-y-4">
          <div className="flex items-center justify-between border-b border-surface-border pb-3">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-widest text-brand-500">
                Plan Generated by Master Orchestrator
              </span>
              <h3 className="text-sm font-semibold text-white">
                Category: {currentPlan.category} (Confidence: {Math.round(currentPlan.confidence * 100)}%)
              </h3>
            </div>
            <span className="text-xs font-mono text-slate-400">
              Est. Duration: ~{currentPlan.estimated_duration_sec}s
            </span>
          </div>

          <div className="space-y-3">
            {currentPlan.steps.map((step, idx) => (
              <div
                key={step.step_id}
                className="flex items-start space-x-3 p-3 rounded-lg bg-surface-light/60 border border-surface-border text-xs"
              >
                <div className="w-6 h-6 rounded-full bg-brand-600/30 text-brand-400 flex items-center justify-center font-mono font-bold text-xs flex-shrink-0 mt-0.5">
                  {idx + 1}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200">{step.title}</span>
                    <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-brand-500/10 text-brand-400 border border-brand-500/20">
                      @{step.assigned_agent_slug}
                    </span>
                  </div>
                  <p className="text-slate-400 mt-1">{step.description}</p>
                  <div className="mt-2 flex items-center space-x-3 text-[11px] text-slate-500 font-mono">
                    <span>Department: {step.department}</span>
                    <span>Action: {step.action_type}</span>
                    {step.dependencies.length > 0 && (
                      <span>Depends on: {step.dependencies.join(", ")}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Execution Results & Generated Artifacts */}
      {currentResult && (
        <div className="glass-panel p-6 rounded-xl border border-surface-border space-y-5">
          <div className="flex items-center justify-between border-b border-surface-border pb-3">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-semibold text-white">
                Workflow Completed: {currentResult.workflow_id}
              </h3>
            </div>
            <div className="flex items-center space-x-3 text-xs font-mono text-slate-400">
              <span>Steps: {currentResult.completed_steps}/{currentResult.steps_count}</span>
              <span>Duration: {currentResult.duration_sec}s</span>
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                Verified
              </span>
            </div>
          </div>

          <p className="text-xs text-slate-300 bg-surface-light p-3 rounded-lg border border-surface-border">
            {currentResult.summary}
          </p>

          {/* Artifacts preview */}
          <div className="space-y-3">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
              Generated Deliverables & Artifacts ({currentResult.artifacts.length})
            </span>
            <div className="grid grid-cols-1 gap-3">
              {currentResult.artifacts.map((art, idx) => (
                <div
                  key={idx}
                  className="p-4 rounded-lg bg-surface border border-surface-border text-xs space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-brand-400 flex items-center space-x-2">
                      {art.type === "code" ? <Code2 className="w-3.5 h-3.5 text-accent-cyan" /> : <FileText className="w-3.5 h-3.5 text-brand-500" />}
                      <span>{art.title}</span>
                    </span>
                    <span className="font-mono text-[10px] text-slate-500 uppercase">{art.type}</span>
                  </div>
                  <pre className="p-3 rounded bg-black/40 text-slate-300 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap max-h-48">
                    {art.content}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
