"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";

import { SidebarMenuButton } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { SidebarNavItem } from "./navigation";

const TELEPHONY_WARNING_COPY = "Action required";

interface SidebarNavLinkProps {
  item: SidebarNavItem;
  isActive: boolean;
  /** The item owns the current page but is not itself the selected row (e.g. a
   *  collapsible parent whose child is selected). Renders a softer highlight. */
  isSectionActive?: boolean;
  showWarning: boolean;
  onNavigate: () => void;
}

export function SidebarNavLink({ item, isActive, isSectionActive = false, showWarning, onNavigate }: SidebarNavLinkProps) {
  const Icon = item.icon;

  if (item.comingSoon) {
    return (
      <SidebarMenuButton disabled className="cursor-default opacity-60 hover:bg-transparent">
        <Icon />
        <span className="notranslate min-w-0 flex-1 truncate" translate="no">
          {item.title}
        </span>
        <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          Soon
        </span>
      </SidebarMenuButton>
    );
  }

  return (
    <SidebarMenuButton
      asChild
      isActive={isActive}
      className={cn(
        "transition-colors",
        isActive && "nb-sidebar-active",
        !isActive && isSectionActive && "nb-sidebar-section-active"
      )}
    >
      <Link href={item.url} onClick={onNavigate} translate="no">
        <Icon className="active-sidebar-icon" />
        <span className="notranslate min-w-0 flex-1 truncate" translate="no">
          {item.title}
        </span>
        {showWarning && (
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertTriangle
                aria-label="Action required on a telephony configuration"
                className="ml-auto text-status-warning"
              />
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>{TELEPHONY_WARNING_COPY}</p>
            </TooltipContent>
          </Tooltip>
        )}
      </Link>
    </SidebarMenuButton>
  );
}
