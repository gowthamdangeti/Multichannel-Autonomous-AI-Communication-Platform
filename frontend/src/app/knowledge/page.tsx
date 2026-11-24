"use client";

import { Database, Search, Upload, FileText, HardDrive, CheckCircle } from "lucide-react";

export default function KnowledgePage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Knowledge Hub & Shared Memory</h1>
          <p className="text-xs text-slate-400">
            PostgreSQL pgvector embeddings, MinIO object storage, and episodic memory persistence.
          </p>
        </div>

        <button className="px-3.5 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium flex items-center space-x-2 transition-colors">
          <Upload className="w-3.5 h-3.5" />
          <span>Ingest Document</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-panel p-5 rounded-xl border border-surface-border">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-mono">pgvector Embeddings</span>
            <Database className="w-4 h-4 text-brand-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-white font-mono">1,240</div>
          <span className="text-[11px] text-emerald-400 font-mono mt-1 block">Cosine Similarity Indexed</span>
        </div>

        <div className="glass-panel p-5 rounded-xl border border-surface-border">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-mono">MinIO Artifacts</span>
            <HardDrive className="w-4 h-4 text-accent-cyan" />
          </div>
          <div className="mt-2 text-2xl font-bold text-white font-mono">342 Objects</div>
          <span className="text-[11px] text-slate-400 font-mono mt-1 block">S3-Compatible Object Store</span>
        </div>

        <div className="glass-panel p-5 rounded-xl border border-surface-border">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-mono">Episodic Cache Hits</span>
            <CheckCircle className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-white font-mono">94.6%</div>
          <span className="text-[11px] text-slate-400 font-mono mt-1 block">Redis Working Memory Tier</span>
        </div>
      </div>
    </div>
  );
}
