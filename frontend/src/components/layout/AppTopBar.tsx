"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";

import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { type Breadcrumb, useHeader } from "@/context/HeaderContext";
import { cn } from "@/lib/utils";

import { findNavItem, getDetailLabel } from "./sidebar/navigation";

export function AppTopBar() {
  const pathname = usePathname();
  const { headerData } = useHeader();

  const navItem = findNavItem(pathname);
  const isDetail = navItem !== undefined && pathname !== navItem.url;
  const pageName = isDetail
    ? (headerData?.title ?? getDetailLabel(pathname))
    : (navItem?.title ?? headerData?.title ?? getDetailLabel(pathname));

  // A page that supplies its own trail is deeper than "nav item / title" — it
  // may sit under a tab or a nested record — so it renders verbatim.
  const trail = headerData?.breadcrumbs;
  const crumbs: Breadcrumb[] =
    trail && trail.length > 0
      ? trail
      : [...(isDetail ? [{ label: navItem.title, href: navItem.url }] : []), { label: pageName }];

  const { actions, primaryAction, toolbar, searchBar } = headerData ?? {};
  // List pages: the breadcrumb section also hosts the controls (search,
  // filters, create), so the page body starts directly with content.
  // No in-page title or subtitle — the breadcrumb already names the page.
  const hasListHeader = Boolean(actions || primaryAction || toolbar || searchBar);

  return (
    <header className="shrink-0 border-b border-border">
      {/* Single row: page name (breadcrumb) left, email tabs or compact actions right. */}
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2 lg:px-6">
        <nav aria-label="Breadcrumb" className="flex shrink-0 items-center gap-2">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />

          {crumbs.map((crumb, index) => {
            const isCurrent = index === crumbs.length - 1;
            return (
              <Fragment key={index}>
                {index > 0 && (
                  <span aria-hidden className="text-muted-foreground">/</span>
                )}
                {isCurrent ? (
                  // Some page titles carry a back link, badges and subtext; the breadcrumb keeps only the name.
                  <h1
                    aria-current="page"
                    className={cn(
                      "flex items-center text-base font-medium text-foreground",
                      !trail &&
                        "truncate [&_.flex-col>:not(:first-child)]:hidden [&_a]:hidden [&_h1]:text-base [&_h1]:font-medium [&_h1~*]:hidden [&_button]:hidden [&_p]:hidden"
                    )}
                  >
                    {crumb.label}
                  </h1>
                ) : crumb.href ? (
                  <Link
                    href={crumb.href}
                    className="shrink-0 truncate text-base text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="shrink-0 truncate text-base text-muted-foreground">{crumb.label}</span>
                )}
              </Fragment>
            );
          })}
        </nav>

        {hasListHeader && (
          <div className="ml-auto flex min-w-0 shrink-0 flex-wrap items-center gap-2">
            {actions}
            {toolbar}
            {searchBar}
            {primaryAction}
          </div>
        )}
      </div>
    </header>
  );
}
