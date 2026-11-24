"use client";

import { useState } from "react";
import { ShieldCheck, Check, X, AlertTriangle, Lock } from "lucide-react";

interface ApprovalRequest {
  id: string;
  agent: string;
  action: string;
  risk_level: "low" | "medium" | "high" | "critical";
  summary: string;
  status: "pending" | "approved" | "rejected";
}

const PENDING_APPROVALS: ApprovalRequest[] = [
  {
    id: "appr-01",
    agent: "lead-software-architect",
    action: "Deploy Autonomous Service to Production Cluster",
    risk_level: "high",
    summary: "Requesting authorization to apply Terraform and deploy container image to production namespace.",
    status: "pending"
  },
  {
    id: "appr-02",
    agent: "communications-director",
    action: "Send Multi-Channel Executive Stakeholder Memo",
    risk_level: "medium",
    summary: "Requesting authorization to broadcast Q4 AI Workforce Strategy to 45 leadership email recipients.",
    status: "pending"
  }
];

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>(PENDING_APPROVALS);

  const handleAction = (id: string, newStatus: "approved" | "rejected") => {
    setApprovals((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: newStatus } : item))
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Controlled Autonomy & Human Approvals</h1>
        <p className="text-xs text-slate-400">
          Supervised gating for sensitive operations, financial commitments, and high-impact actions.
        </p>
      </div>

      <div className="space-y-4">
        {approvals.map((req) => (
          <div key={req.id} className="glass-panel p-6 rounded-xl border border-surface-border space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <span className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <AlertTriangle className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-white">{req.action}</h3>
                  <span className="text-xs font-mono text-slate-400">Initiated by: @{req.agent}</span>
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase border ${
                  req.risk_level === "high" || req.risk_level === "critical"
                    ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                    : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                }`}>
                  {req.risk_level} Risk
                </span>

                <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-surface-light border border-surface-border text-slate-300">
                  {req.status}
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-300 bg-surface-light p-3 rounded-lg border border-surface-border">
              {req.summary}
            </p>

            {req.status === "pending" && (
              <div className="flex items-center justify-end space-x-3 pt-2">
                <button
                  onClick={() => handleAction(req.id, "rejected")}
                  className="px-3.5 py-1.5 rounded-lg bg-surface-light hover:bg-slate-700 text-rose-400 border border-surface-border text-xs font-medium flex items-center space-x-1.5 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Reject</span>
                </button>
                <button
                  onClick={() => handleAction(req.id, "approved")}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium flex items-center space-x-1.5 transition-colors shadow-lg shadow-emerald-600/20"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Authorize Execution</span>
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
