"use client";

import { Settings, Save, Server, Shield, Database } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Platform Configuration & Settings</h1>
        <p className="text-xs text-slate-400">
          Environment flags, orchestrator thresholds, and cluster persistence endpoints.
        </p>
      </div>

      <div className="glass-panel p-6 rounded-xl border border-surface-border space-y-6 max-w-3xl">
        <div className="space-y-4 text-xs">
          <div>
            <label className="font-semibold text-slate-200 block mb-1">Platform Name</label>
            <input
              type="text"
              readOnly
              value="Autonomous AI OS Enterprise"
              className="w-full p-2.5 rounded-lg bg-surface-light border border-surface-border text-slate-300 font-mono"
            />
          </div>

          <div>
            <label className="font-semibold text-slate-200 block mb-1">Execution Mode</label>
            <select
              disabled
              className="w-full p-2.5 rounded-lg bg-surface-light border border-surface-border text-slate-300 font-mono"
            >
              <option>Supervised Autonomous (Human in the Loop)</option>
              <option>Full Autonomous (Direct Action)</option>
            </select>
          </div>

          <div>
            <label className="font-semibold text-slate-200 block mb-1">Max Retry Backoff Attempts</label>
            <input
              type="number"
              readOnly
              value={3}
              className="w-full p-2.5 rounded-lg bg-surface-light border border-surface-border text-slate-300 font-mono"
            />
          </div>

          <div>
            <label className="font-semibold text-slate-200 block mb-1">PostgreSQL + pgvector Endpoint</label>
            <input
              type="text"
              readOnly
              value="postgresql+asyncpg://postgres:postgres@localhost:5432/autonomous_ai_os"
              className="w-full p-2.5 rounded-lg bg-surface-light border border-surface-border text-slate-300 font-mono"
            />
          </div>

          <div>
            <label className="font-semibold text-slate-200 block mb-1">MinIO S3 Artifact Bucket</label>
            <input
              type="text"
              readOnly
              value="ai-os-artifacts"
              className="w-full p-2.5 rounded-lg bg-surface-light border border-surface-border text-slate-300 font-mono"
            />
          </div>
        </div>

        <div className="pt-4 border-t border-surface-border flex justify-end">
          <button className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium flex items-center space-x-2 transition-colors">
            <Save className="w-3.5 h-3.5" />
            <span>Save Configuration</span>
          </button>
        </div>
      </div>
    </div>
  );
}
