"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { BrandLogo } from "@/components/BrandLogo";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { useTeamsAccess } from "@/context/TeamsAccessContext";
import { useTelephonyConfigWarnings } from "@/context/TelephonyConfigWarningsContext";
import type { LocalUser } from "@/lib/auth";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

import {
  ACCOUNT_ITEMS,
  ADMIN_ITEMS,
  CHANNELS_ITEMS,
  isNavItemActive,
  OVERVIEW_ITEM,
  RESOURCE_ITEMS,
  type SidebarNavItem,
  TEAMS_ITEM,
  TEAMS_SUB_ITEMS,
} from "./sidebar/navigation";
import { SidebarNavLink } from "./sidebar/SidebarNavLink";
import { SidebarNavTree } from "./sidebar/SidebarNavTree";
import { SidebarTeamSwitcher } from "./sidebar/SidebarTeamSwitcher";
import { SidebarUserMenu } from "./sidebar/SidebarUserMenu";

function SidebarDivider() {
  return <div aria-hidden className="mx-auto my-2.5 h-px w-3/5 bg-sidebar-border" />;
}

function SidebarTeamsItem({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate: () => void;
}) {
  const isTeamsRoute = pathname.startsWith("/teams");
  const [isOpen, setIsOpen] = useState(isTeamsRoute);

  useEffect(() => {
    if (isTeamsRoute) {
      setIsOpen(true);
    }
  }, [isTeamsRoute]);

  // Derive the active tab from the URL rather than reading window.location in an
  // effect keyed on pathname: tab switches are router.push on the SAME pathname,
  // so a pathname-keyed effect never re-runs and the highlight goes stale.
  // useSearchParams re-renders the sidebar whenever ?tab= changes.
  const searchParams = useSearchParams();
  const currentTab = searchParams.get("tab") || "hierarchy";

  return (
    <SidebarMenuItem key="teams-menu">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="flex items-center w-full">
          <div className="flex-1 min-w-0">
            <SidebarNavLink
              item={TEAMS_ITEM}
              isActive={isTeamsRoute && !isOpen}
              isSectionActive={isTeamsRoute && isOpen}
              showWarning={false}
              onNavigate={onNavigate}
            />
          </div>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="p-1.5 hover:bg-sidebar-accent rounded-md text-sidebar-foreground transition-colors cursor-pointer shrink-0"
              title={isOpen ? "Collapse Teams" : "Expand Teams"}
            >
              <ChevronDown
                className={cn("size-3.5 transition-transform duration-200", isOpen && "rotate-180")}
              />
            </button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="overflow-hidden">
          <div className="mt-0.5 ml-[17px] flex flex-col gap-1 border-l border-sidebar-border pl-2">
            {TEAMS_SUB_ITEMS.map((subItem) => {
              const tabKey = subItem.url.split("?tab=")[1];
              const isSubActive = isTeamsRoute && currentTab === tabKey;
              return (
                <SidebarNavLink
                  key={subItem.title}
                  item={subItem}
                  isActive={isSubActive}
                  showWarning={false}
                  onNavigate={onNavigate}
                />
              );
            })}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}

interface NavItemsProps {
  items: SidebarNavItem[];
  pathname: string;
  hasTelephonyWarning: boolean;
  onNavigate: () => void;
}

function NavItems({ items, pathname, hasTelephonyWarning, onNavigate }: NavItemsProps) {
  return items.map((item) => {
    if (item.title === "Teams") {
      return (
        <SidebarTeamsItem
          key={item.title}
          pathname={pathname}
          onNavigate={onNavigate}
        />
      );
    }
    return (
      <SidebarMenuItem key={item.title}>
        <SidebarNavLink
          item={item}
          isActive={isNavItemActive(item, pathname)}
          showWarning={Boolean(item.showsTelephonyWarning && hasTelephonyWarning)}
          onNavigate={onNavigate}
        />
      </SidebarMenuItem>
    );
  });
}

export function AppSidebar() {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const { user } = useAuth();
  const { telnyxMissingWebhookPublicKeyCount } = useTelephonyConfigWarnings();
  const { access: teamsAccess, status: teamsAccessStatus } = useTeamsAccess();

  const isSuperuser = !!(user as LocalUser | undefined)?.is_superuser;
  const onNavigate = () => {
    if (isMobile) setOpenMobile(false);
  };
  const itemProps = {
    pathname,
    hasTelephonyWarning: telnyxMissingWebhookPublicKeyCount > 0,
    onNavigate,
  };

  return (
    <Sidebar collapsible="offcanvas" variant="inset" className="app-sidebar-dock">
      <SidebarHeader className="gap-3">
        <Link href="/" className="notranslate flex h-8 items-center px-1.5" translate="no">
          <BrandLogo className="h-6" />
        </Link>
        <SidebarTeamSwitcher />
      </SidebarHeader>

      <SidebarContent className="notranslate" translate="no">
        <SidebarGroup className="py-1">
          <SidebarMenu className="gap-1">
            <NavItems items={[OVERVIEW_ITEM]} {...itemProps} />
            <SidebarNavTree pathname={pathname} onNavigate={onNavigate} />
            <NavItems items={[...CHANNELS_ITEMS, ...RESOURCE_ITEMS]} {...itemProps} />
            <SidebarDivider />
            <NavItems items={ACCOUNT_ITEMS} {...itemProps} />
            {isSuperuser && (
              <>
                <SidebarDivider />
                <NavItems items={ADMIN_ITEMS} {...itemProps} />
              </>
            )}
            {teamsAccessStatus === "allowed" && teamsAccess?.canView && (
              <>
                <SidebarDivider />
                <NavItems items={[TEAMS_ITEM]} {...itemProps} />
              </>
            )}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="notranslate" translate="no">
        <SidebarUserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
