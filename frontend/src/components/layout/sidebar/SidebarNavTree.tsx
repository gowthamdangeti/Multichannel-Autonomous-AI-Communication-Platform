"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SidebarMenuItem } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

import { isNavItemActive, NAV_TREE } from "./navigation";
import { SidebarNavLink } from "./SidebarNavLink";

interface SidebarNavTreeProps {
  pathname: string;
  onNavigate: () => void;
}

export function SidebarNavTree({ pathname, onNavigate }: SidebarNavTreeProps) {
  // Which parent owns the current route, so it can open automatically.
  const activeKey =
    NAV_TREE.find((section) => section.items.some((item) => isNavItemActive(item, pathname)))?.key ?? null;

  // Single-open accordion: expanding one parent collapses the other.
  const [openKey, setOpenKey] = useState<string | null>(activeKey ?? "agents");

  useEffect(() => {
    if (activeKey) setOpenKey(activeKey);
  }, [activeKey]);

  return (
    <>
      {NAV_TREE.map((section) => {
        const SectionIcon = section.icon;
        const isOpen = openKey === section.key;
        return (
          <SidebarMenuItem key={section.key}>
            <Collapsible open={isOpen} onOpenChange={(open) => setOpenKey(open ? section.key : null)}>
              <CollapsibleTrigger asChild>
                <button className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                  <SectionIcon className="size-4 shrink-0" />
                  <span className="notranslate min-w-0 flex-1 truncate text-left" translate="no">
                    {section.label}
                  </span>
                  <ChevronDown
                    className={cn("size-4 shrink-0 transition-transform duration-200", isOpen && "rotate-180")}
                  />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="overflow-hidden">
                <div className="mt-0.5 ml-[17px] flex flex-col gap-1 border-l border-sidebar-border pl-2">
                  {section.items.map((item) => (
                    <SidebarNavLink
                      key={item.title}
                      item={item}
                      isActive={isNavItemActive(item, pathname)}
                      showWarning={false}
                      onNavigate={onNavigate}
                    />
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </SidebarMenuItem>
        );
      })}
    </>
  );
}
