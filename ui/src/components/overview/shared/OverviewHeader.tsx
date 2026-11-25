"use client";

import type { ReactNode } from "react";

import { PageHeader } from "@/context/HeaderContext";

interface OverviewHeaderProps {
  subtitle: string;
  onRefresh: () => void;
  isRefreshing: boolean;
  /** Channel switcher and date-range select, rendered in the top bar's breadcrumb section. */
  headerControls?: ReactNode;
}

/** The page header for whichever channel is open. */
export function OverviewHeader({ subtitle, onRefresh, isRefreshing, headerControls }: OverviewHeaderProps) {
  return (
    <PageHeader
      title="Agents Overview"
      subtitle={subtitle}
      onRefresh={onRefresh}
      isRefreshing={isRefreshing}
      toolbar={headerControls}
    />
  );
}
