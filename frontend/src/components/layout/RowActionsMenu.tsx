"use client";

import { Check, MoreVertical } from "lucide-react";
import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const stopRowClick = (event: MouseEvent) => event.stopPropagation();

interface RowActionsMenuProps {
  label: string;
  busy?: boolean;
  disabled?: boolean;
  children: ReactNode;
}

// The standard Actions column: view first, then edits, with destructive items
// last behind a RowActionSeparator. Non-modal so an item can open a dialog, and
// clicks stop here because React events bubble through the portal to the row.
export function RowActionsMenu({ label, busy = false, disabled = false, children }: RowActionsMenuProps) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild onClick={stopRowClick}>
        <Button
          variant="ghost"
          size="icon"
          disabled={busy || disabled}
          aria-label={label}
          title="Actions"
          className="ml-auto size-8 data-[state=open]:bg-accent"
        >
          {busy ? (
            <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <MoreVertical />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44" onClick={stopRowClick}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface RowActionProps {
  icon: ReactNode;
  children: ReactNode;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  href?: string;
  destructive?: boolean;
  disabled?: boolean;
  selected?: boolean;
}

export function RowAction({ icon, children, onClick, href, destructive, disabled, selected }: RowActionProps) {
  const variant = destructive ? "destructive" : "default";

  if (href) {
    return (
      <DropdownMenuItem asChild variant={variant} disabled={disabled}>
        <Link href={href}>
          {icon}
          {children}
        </Link>
      </DropdownMenuItem>
    );
  }

  return (
    <DropdownMenuItem variant={variant} disabled={disabled} onClick={onClick}>
      {icon}
      <span className="min-w-0 truncate">{children}</span>
      {selected && <Check className="ml-auto" />}
    </DropdownMenuItem>
  );
}

export function RowActionSub({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <span className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-muted-foreground">
          {icon}
          {label}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className="max-h-72 w-52 overflow-y-auto" onClick={stopRowClick}>
          {children}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

export const RowActionSeparator = DropdownMenuSeparator;
