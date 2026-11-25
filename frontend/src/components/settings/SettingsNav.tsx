"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import { SETTINGS_ITEMS, type SettingsNavItem } from "./hooks/settingsSections";

// Same classes as the agent settings menu, so every design theme styles both alike.
const ITEM = "flex h-8 shrink-0 items-center gap-2.5 rounded-lg px-3 py-1 text-sm whitespace-nowrap nb-secondary-nav-item lg:w-full";

function NavEntry({ item, isActive }: { item: SettingsNavItem; isActive: boolean }) {
  const Icon = item.icon;
  if (item.comingSoon) {
    return (
      <span aria-disabled="true" className={cn(ITEM, "pointer-events-none opacity-60")}>
        <Icon className="h-4 w-4 shrink-0" />
        <span className="flex-1">{item.title}</span>
        <span className="text-[10px]">Soon</span>
      </span>
    );
  }
  return (
    <Link
      href={item.url}
      aria-current={isActive ? "page" : undefined}
      className={cn(ITEM, "transition-all duration-200", isActive && "nb-secondary-nav-active font-semibold")}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1">{item.title}</span>
    </Link>
  );
}

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Settings" className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-0 lg:space-y-3 lg:overflow-visible">
      {SETTINGS_ITEMS.map((item) => (
        <NavEntry key={item.url} item={item} isActive={pathname.startsWith(item.url)} />
      ))}
    </nav>
  );
}
