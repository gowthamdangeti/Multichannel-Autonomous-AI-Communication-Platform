"use client";

import { useState } from "react";
import { GitFork, Play, Pause, Square, RefreshCw, CheckCircle2, AlertTriangle, Layers, ArrowRight } from "lucide-react";

interface GraphNode {
  id: string;
  type: "agent" | "llm" | "tool" | "approval" | "verification" | "completion";
  title: string;
  agent: string;
  status: "idle" | "running" | "completed" | "waiting";
}

const INITIAL_NODES: GraphNode[] = [
  { id: "node-1", type: "agent", title: "Intelligence Gathering", agent: "senior-researcher", status: "completed" },
  { id: "node-2", type: "agent", title: "System Architecture Design", agent: "lead-software-architect", status: "completed" },
  { id: "node-3", type: "verification", title: "Automated Code Verification", agent: "verifier-bot", status: "completed" },
  { id: "node-4", type: "approval", title: "Enterprise Security Signoff", agent: "human-governor", status: "waiting" },
  { id: "node-5", type: "completion", title: "Deliverable Publishing", agent: "communications-director", status: "idle" },
];

export default function WorkflowStudioPage() {
  const [nodes, setNodes] = useState<GraphNode[]>(INITIAL_NODES);
  const [workflowState, setWorkflowState] = useState<"idle" | "running" | "paused">("idle");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(INITIAL_NODES[0]);

  const handleStart = () => setWorkflowState("running");
  const handlePause = () => setWorkflowState("paused");
  const handleStop = () => setWorkflowState("idle");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Dynamic Workflow Studio</h1>
          <p className="text-xs text-slate-400">
            Stateful graph orchestration engine supporting parallel nodes, human gates, and checkpoint recovery.
          </p>
        </div>

        {/* Engine controls */}
        <div className="flex items-center space-x-2">
          <button
            onClick={handleStart}
            disabled={workflowState === "running"}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-medium flex items-center space-x-1.5 transition-colors"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Run</span>
          </button>
          <button
            onClick={handlePause}
            disabled={workflowState !== "running"}
            className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-medium flex items-center space-x-1.5 transition-colors"
          >
            <Pause className="w-3.5 h-3.5 fill-current" />
            <span>Pause</span>
          </button>
          <button
            onClick={handleStop}
            className="px-3 py-1.5 rounded-lg bg-surface-light hover:bg-slate-700 text-slate-300 border border-surface-border text-xs font-medium flex items-center space-x-1.5 transition-colors"
          >
            <Square className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Visual Graph Area */}
        <div className="lg:col-span-2 glass-panel p-6 rounded-xl border border-surface-border min-h-[480px] flex flex-col justify-between">
          <div className="flex items-center justify-between border-b border-surface-border pb-3">
            <span className="text-xs font-mono text-slate-400">
              Workflow Graph ID: wf-active-graph-orchestrator-01
            </span>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-surface-light border border-surface-border text-slate-300">
              State: {workflowState.toUpperCase()}
            </span>
          </div>

          {/* Interactive node path */}
          <div className="py-8 flex flex-col space-y-4">
            {nodes.map((node, i) => (
              <div key={node.id} className="flex items-center space-x-3">
                <div
                  onClick={() => setSelectedNode(node)}
                  className={`flex-1 p-4 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                    selectedNode?.id === node.id
                      ? "bg-brand-600/20 border-brand-500"
                      : "bg-surface-light/60 border-surface-border hover:border-slate-500"
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded-lg bg-surface border border-surface-border flex items-center justify-center font-mono text-xs font-bold text-brand-400">
                      {i + 1}
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-white">{node.title}</h4>
                      <span className="text-[11px] font-mono text-slate-400">@{node.agent}</span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded uppercase bg-surface text-slate-300 border border-surface-border">
                      {node.type}
                    </span>
                    {node.status === "completed" && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    )}
                    {node.status === "waiting" && (
                      <AlertTriangle className="w-4 h-4 text-amber-400 animate-pulse" />
                    )}
                  </div>
                </div>

                {i < nodes.length - 1 && (
                  <ArrowRight className="w-4 h-4 text-slate-600 flex-shrink-0" />
                )}
              </div>
            ))}
          </div>

          <div className="pt-3 border-t border-surface-border text-[11px] font-mono text-slate-500 flex items-center justify-between">
            <span>Checkpoints Saved: 4</span>
            <span>Graph Version: 1.2.0</span>
          </div>
        </div>

        {/* Selected Node Inspector */}
        <div className="glass-panel p-6 rounded-xl border border-surface-border space-y-4">
          <div className="border-b border-surface-border pb-3">
            <span className="text-[10px] font-mono uppercase tracking-widest text-brand-500">
              Node Configuration
            </span>
            <h3 className="text-sm font-semibold text-white mt-1">
              {selectedNode ? selectedNode.title : "Select a node"}
            </h3>
          </div>

          {selectedNode && (
            <div className="space-y-3 text-xs">
              <div>
                <label className="text-[11px] text-slate-400 font-mono block mb-1">Assigned Agent</label>
                <div className="p-2 rounded bg-surface-light border border-surface-border text-slate-200 font-mono">
                  @{selectedNode.agent}
                </div>
              </div>

              <div>
                <label className="text-[11px] text-slate-400 font-mono block mb-1">Node Type</label>
                <div className="p-2 rounded bg-surface-light border border-surface-border text-slate-200 capitalize">
                  {selectedNode.type} Node
                </div>
              </div>

              <div>
                <label className="text-[11px] text-slate-400 font-mono block mb-1">Status</label>
                <div className="p-2 rounded bg-surface-light border border-surface-border text-emerald-400 font-mono capitalize">
                  {selectedNode.status}
                </div>
              </div>

              <div>
                <label className="text-[11px] text-slate-400 font-mono block mb-1">Retry Policy</label>
                <div className="p-2 rounded bg-surface-light border border-surface-border text-slate-400 font-mono text-[11px]">
                  Max Retries: 3 | Exponential Backoff (base: 0.5s)
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
