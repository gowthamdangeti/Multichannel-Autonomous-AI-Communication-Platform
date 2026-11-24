"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Bot,
  Wrench,
  Store,
  GitFork,
  ListTodo,
  Users2,
  Database,
  Blocks,
  ShieldCheck,
  BrainCircuit,
  Activity,
  Lock,
  Settings,
  Sparkles,
} from "lucide-react";

const navigationItems = [
  { name: "Overview", href: "/", icon: LayoutDashboard },
  { name: "AI Workforce", href: "/workforce", icon: Bot },
  { name: "Workflow Studio", href: "/workflow-studio", icon: GitFork },
  { name: "Autonomous Tasks", href: "/tasks", icon: ListTodo },
  { name: "Agent Teams", href: "/teams", icon: Users2 },
  { name: "Knowledge Hub", href: "/knowledge", icon: Database },
  { name: "Integrations & Models", href: "/integrations", icon: Blocks },
  { name: "Approvals", href: "/approvals", icon: ShieldCheck },
  { name: "Monitoring & Telemetry", href: "/monitoring", icon: Activity },
  { name: "Governance & Audit", href: "/governance", icon: Lock },
  { name: "Settings", href: "/settings", icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-surface border-r border-surface-border flex flex-col h-screen fixed left-0 top-0 z-40 select-none">
      {/* Brand header */}
      <div className="p-5 border-b border-surface-border flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-brand-600 to-accent-cyan flex items-center justify-center shadow-lg shadow-brand-500/20">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <span className="font-bold tracking-tight text-white text-sm block">AUTONOMOUS</span>
            <span className="text-[10px] tracking-widest text-brand-500 font-mono font-semibold uppercase">AI OS v1.0</span>
          </div>
        </div>
      </div>

      {/* Nav links */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        <div className="px-3 pb-2 text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold">
          Platform Modules
        </div>
        {navigationItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                isActive
                  ? "bg-brand-600/20 text-brand-100 border border-brand-500/40"
                  : "text-slate-400 hover:text-slate-200 hover:bg-surface-light/50"
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? "text-brand-500" : "text-slate-400"}`} />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer status */}
      <div className="p-4 border-t border-surface-border bg-surface/50 text-xs">
        <div className="flex items-center justify-between text-slate-400 mb-1">
          <span className="font-mono text-[11px]">Runtime Engine</span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            Online
          </span>
        </div>
        <div className="text-[11px] text-slate-500 truncate">
          Active Cluster: us-east-prod-1
        </div>
      </div>
    </aside>
  );
}
