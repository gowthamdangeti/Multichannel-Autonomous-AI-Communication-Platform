"use client";

import { usePathname } from "next/navigation";
import { type ReactNode,useMemo } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type Breadcrumb, PageHeader } from "@/context/HeaderContext";

import { findSettingsItem } from "./hooks/settingsSections";
import { SettingsNav } from "./SettingsNav";

// Mirrors the agent settings page: a full-height menu card and one card per section.
export function SettingsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const current = findSettingsItem(pathname);
  const Icon = current?.icon;

  const breadcrumbs = useMemo<Breadcrumb[] | undefined>(() => {
    if (pathname !== "/settings" && current) {
      return [
        { label: "Settings", href: "/settings" },
        { label: current.title },
      ];
    }
    return undefined;
  }, [pathname, current]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4 px-4 pt-3 pb-4 lg:flex-row lg:items-stretch lg:gap-5 lg:px-6">
      <PageHeader title={current?.title ?? "Settings"} breadcrumbs={breadcrumbs} />
      <div className="min-w-0 shrink-0 rounded-xl border border-border bg-card p-2 nb-secondary-sidebar lg:w-64 lg:p-4">
        <SettingsNav />
      </div>
      <div className="min-w-0 flex-1 space-y-8 px-1 lg:overflow-y-auto">
        <Card>
          {current && Icon && (
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Icon className="h-4 w-4" />
                {current.title}
              </CardTitle>
              <CardDescription>{current.description}</CardDescription>
            </CardHeader>
          )}
          <CardContent className="space-y-6">{children}</CardContent>
        </Card>
      </div>
    </div>
  );
}
