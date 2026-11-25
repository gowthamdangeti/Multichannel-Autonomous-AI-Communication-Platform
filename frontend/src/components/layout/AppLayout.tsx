"use client";

import { usePathname } from "next/navigation";
import React, { CSSProperties, ReactNode } from "react";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useHeader } from "@/context/HeaderContext";
import { LeadFormsProvider } from "@/context/LeadFormsContext";
import { TeamsAccessProvider } from "@/context/TeamsAccessContext";
import { cn } from "@/lib/utils";

import { AppSidebar } from "./AppSidebar";
import { AppTopBar } from "./AppTopBar";

const SIDEBAR_STYLE = { "--sidebar-width": "18rem" } as CSSProperties;

interface AppLayoutProps {
  children: ReactNode;
  headerActions?: ReactNode;
  stickyTabs?: ReactNode;
}

const AppLayout: React.FC<AppLayoutProps> = ({
  children,
  stickyTabs,
}) => {
  const pathname = usePathname();
  const { headerData } = useHeader();
  // Full-bleed screens such as the workflow canvas bring their own header.
  const hasPageGutter = !headerData?.customHeader;

  // Check if current route should have sidebar
  // Hide sidebar for root (/), /handler routes (Stack Auth routes), and /auth routes
  const shouldShowSidebar = pathname !== "/" && !pathname.startsWith("/handler") && !pathname.startsWith("/auth");

  // Always render SidebarProvider to keep the component tree shape consistent
  // across route changes (avoids React hooks ordering violations during navigation).
  return (
    <SidebarProvider defaultOpen style={SIDEBAR_STYLE}>
      {shouldShowSidebar ? (
        <LeadFormsProvider>
          <TeamsAccessProvider>
            <div className="flex h-svh w-full overflow-hidden">
              <AppSidebar />
              <SidebarInset className="flex h-svh min-w-0 flex-1 flex-col overflow-hidden lg:h-[calc(100svh-1rem)]">
                <div className="app-surface flex min-h-0 flex-1 flex-col overflow-hidden">
                  <AppTopBar />

                  {/* Optional sticky tabs */}
                  {stickyTabs && (
                    <div className="sticky top-0 z-40 bg-background border-b border-border">
                      <div className="w-full px-4 lg:px-6">
                        <div className="flex items-center justify-center py-2">
                          {stickyTabs}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="relative flex min-h-0 flex-1 flex-col">
                    {/* Full-bleed pages (workflow canvas): the page's own header floats
                        over the top of the content, so the canvas runs right up to the
                        top bar as one surface. Only its controls take clicks; the
                        empty bar passes them through to the canvas (pan, select). */}
                    {headerData?.customHeader && (
                      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 [&_header>*]:pointer-events-auto">
                        {headerData.customHeader}
                      </div>
                    )}
                    <div data-page-content className={cn("flex h-full flex-1 flex-col overflow-y-auto", hasPageGutter && "pt-4")}>
                      {children}
                    </div>
                  </div>
                </div>
              </SidebarInset>
            </div>
          </TeamsAccessProvider>
        </LeadFormsProvider>
      ) : (
        <div className="app-surface w-full flex-1">
          {children}
        </div>
      )}
    </SidebarProvider>
  );
};

export default AppLayout;
