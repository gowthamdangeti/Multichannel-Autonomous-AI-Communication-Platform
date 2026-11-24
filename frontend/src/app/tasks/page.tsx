"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, ListTodo, ShieldAlert, Cpu } from "lucide-react";

interface TaskItem {
  id: string;
  title: string;
  objective: string;
  status: string;
  priority: string;
  assigned_agent: string;
  confidence: number;
  created_at: string;
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);

  useEffect(() => {
    fetch("http://localhost:8000/api/v1/tasks")
      .then((res) => res.json())
      .then(setTasks)
      .catch(() => [
        {
          id: "task-001",
          title: "Analyze Enterprise LLM Evaluation Frameworks",
          objective: "Survey current benchmarks for autonomous agents in production",
          status: "completed",
          priority: "high",
          assigned_agent: "senior-researcher",
          confidence: 0.96,
          created_at: "2026-11-24T14:30:00Z",
        },
        {
          id: "task-002",
          title: "Autonomous Backend Architecture Verification",
          objective: "Verify type safety and hexagonal port contracts",
          status: "completed",
          priority: "medium",
          assigned_agent: "lead-software-architect",
          confidence: 0.98,
          created_at: "2026-11-24T14:35:00Z",
        },
      ]);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Autonomous Tasks Management</h1>
        <p className="text-xs text-slate-400">
          Real-time ledger of dispatched, in-progress, and verified agent task contracts.
        </p>
      </div>

      <div className="glass-panel rounded-xl border border-surface-border overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-surface-light border-b border-surface-border text-slate-400 font-mono text-[11px]">
            <tr>
              <th className="p-4">Task ID</th>
              <th className="p-4">Title & Objective</th>
              <th className="p-4">Assigned Agent</th>
              <th className="p-4">Priority</th>
              <th className="p-4">Confidence</th>
              <th className="p-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border text-slate-300">
            {tasks.map((t) => (
              <tr key={t.id} className="hover:bg-surface-light/40 transition-colors">
                <td className="p-4 font-mono text-[11px] text-brand-400">{t.id}</td>
                <td className="p-4">
                  <div className="font-semibold text-white">{t.title}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{t.objective}</div>
                </td>
                <td className="p-4 font-mono text-[11px] text-slate-300">@{t.assigned_agent}</td>
                <td className="p-4 capitalize font-mono">{t.priority}</td>
                <td className="p-4 font-mono text-emerald-400">
                  {Math.round(t.confidence * 100)}%
                </td>
                <td className="p-4">
                  <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>{t.status}</span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
