"use client";

import { Lock, Shield, FileText, CheckCircle } from "lucide-react";

const AUDIT_LOGS = [
  { id: "aud-001", time: "14:52:10 UTC", agent: "senior-researcher", action: "Execute Tool: web_search", risk: "Low", status: "Authorized" },
  { id: "aud-002", time: "14:52:14 UTC", agent: "lead-software-architect", action: "Generate Architecture Spec", risk: "Low", status: "Authorized" },
  { id: "aud-003", time: "14:52:18 UTC", agent: "communications-director", action: "Draft Executive Brief", risk: "Low", status: "Authorized" },
  { id: "aud-004", time: "14:50:02 UTC", agent: "human-governor", action: "Approve Deployment Task", risk: "High", status: "Signed & Committed" },
];

export default function GovernancePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Security, Governance & Immutable Audit Logs</h1>
        <p className="text-xs text-slate-400">
          Deterministic RBAC, agent permission boundaries, and cryptographic execution records.
        </p>
      </div>

      <div className="glass-panel rounded-xl border border-surface-border overflow-hidden">
        <div className="p-4 bg-surface-light border-b border-surface-border flex items-center justify-between">
          <span className="text-xs font-semibold text-white">Cryptographic Audit Trail</span>
          <span className="text-[11px] font-mono text-emerald-400">Tamper-Evident Ledger Active</span>
        </div>

        <table className="w-full text-left text-xs">
          <thead className="bg-surface border-b border-surface-border text-slate-400 font-mono text-[11px]">
            <tr>
              <th className="p-4">Timestamp</th>
              <th className="p-4">Entity</th>
              <th className="p-4">Action</th>
              <th className="p-4">Risk Tier</th>
              <th className="p-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border text-slate-300">
            {AUDIT_LOGS.map((log) => (
              <tr key={log.id} className="hover:bg-surface-light/30">
                <td className="p-4 font-mono text-[11px] text-slate-400">{log.time}</td>
                <td className="p-4 font-mono text-[11px] text-brand-400">@{log.agent}</td>
                <td className="p-4">{log.action}</td>
                <td className="p-4 font-mono text-[11px] text-slate-300">{log.risk}</td>
                <td className="p-4 font-mono text-emerald-400">{log.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
