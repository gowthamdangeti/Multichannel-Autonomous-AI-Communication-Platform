import {
  Activity,
  AudioLines,
  Bot,
  Brain,
  CircleDollarSign,
  Database,
  FileText,
  Handshake,
  Home,
  Key,
  type LucideIcon,
  Mail,
  Megaphone,
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  Mic,
  Network,
  Phone,
  Settings,
  Smartphone,
  TrendingUp,
  Users,
  Wrench,
} from "lucide-react";

export type SidebarNavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  showsTelephonyWarning?: boolean;
  // Planned but has no page yet: shown muted with a "Soon" tag, not clickable.
  comingSoon?: boolean;
  // Match the route exactly, for an item whose url prefixes another's
  // (/whatsapp vs /whatsapp/agents).
  exact?: boolean;
};

// A collapsible parent: a labelled, icon'd row whose children are nav items.
export type SidebarTreeSection = {
  key: string;
  label: string;
  icon: LucideIcon;
  items: SidebarNavItem[];
};

// Overview is a standalone dashboard link that sits above the tree.
export const OVERVIEW_ITEM: SidebarNavItem = { title: "Overview", url: "/overview", icon: Home };

// Standalone Teams module at the main navigation level with sub-items
export const TEAMS_ITEM: SidebarNavItem = { title: "Teams", url: "/teams?tab=hierarchy", icon: Users };

// Teams sub-navigation items.
export const TEAMS_SUB_ITEMS: SidebarNavItem[] = [
  { title: "Hierarchy", url: "/teams?tab=hierarchy", icon: Network },
  { title: "Teams & Members", url: "/teams?tab=teams-members", icon: Users },
  { title: "Agent Access", url: "/teams?tab=agent-access", icon: Bot },
];

// Only Agents and Conversations are collapsible parents.
export const NAV_TREE: SidebarTreeSection[] = [
  {
    key: "agents",
    label: "Agents",
    icon: Bot,
    items: [
      { title: "Voice agents", url: "/voice/agents", icon: Mic },
      { title: "WhatsApp agents", url: "/whatsapp/agents", icon: MessageCircle },
      { title: "Chat agents", url: "/chat/agents", icon: MessageSquare },
      { title: "Email agents", url: "/email/agents", icon: Mail },
    ],
  },
  {
    key: "conversations",
    label: "Conversations",
    icon: MessagesSquare,
    items: [
      { title: "Voice conversations", url: "/voice/conversations", icon: TrendingUp },
      { title: "WhatsApp conversations", url: "/whatsapp/conversations", icon: MessageCircle },
      { title: "Chat conversations", url: "/chat/conversations", icon: MessageSquare },
      { title: "Email conversations", url: "/email/inbox", icon: Mail },
    ],
  },
];

export const CHANNELS_ITEMS: SidebarNavItem[] = [
  { title: "Telephony", url: "/telephony-configurations", icon: Phone, showsTelephonyWarning: true },
  { title: "WhatsApp Numbers", url: "/whatsapp", icon: Smartphone, exact: true },
  { title: "Connect Email", url: "/connect-email", icon: Mail },
  { title: "Campaigns", url: "/campaigns", icon: Megaphone },
];

export const RESOURCE_ITEMS: SidebarNavItem[] = [
  { title: "Tools", url: "/tools", icon: Wrench },
  { title: "Knowledge Base", url: "/knowledge-base", icon: Database },
  { title: "Recordings", url: "/recordings", icon: AudioLines },
];

// Account/manage items, separated from the resources above by a divider.
export const ACCOUNT_ITEMS: SidebarNavItem[] = [
  { title: "API Keys", url: "/api-keys", icon: Key },
  { title: "Billing", url: "/billing", icon: CircleDollarSign },
  { title: "Reports", url: "/reports", icon: FileText },
  { title: "Settings", url: "/settings", icon: Settings },
];

export const ADMIN_ITEMS: SidebarNavItem[] = [
  { title: "Leads", url: "/admin/leads", icon: Handshake },
  { title: "Organizations", url: "/admin/orgs", icon: Brain },
  { title: "Billing Plans", url: "/admin/billing", icon: CircleDollarSign },
  { title: "Models & Keys", url: "/admin/models", icon: Key },
  { title: "Monitor", url: "/admin/monitor", icon: Activity },
];

export function isNavItemActive(
  item: SidebarNavItem,
  pathname: string,
  search?: string | null
): boolean {
  if (!item.url) return false;
  if (item.url === TEAMS_ITEM.url) {
    return pathname.startsWith("/teams");
  }
  if (item.url.includes("?tab=")) {
    const tabParam = item.url.split("?tab=")[1];
    if (pathname !== "/teams") return false;
    if (!search || search === "" || search === "?") {
      return tabParam === "hierarchy";
    }
    return search.includes(`tab=${tabParam}`);
  }
  if (item.url === "/teams" || item.url.startsWith("/teams?")) {
    return pathname.startsWith("/teams");
  }
  if (item.url === "/voice/conversations") {
    return (
      pathname.startsWith("/voice/conversations") ||
      pathname.startsWith("/voiceconversation") ||
      pathname.startsWith("/usage") ||
      pathname.includes("/run/")
    );
  }
  if (item.url === "/voice/agents") {
    return (
      (pathname.startsWith("/voice/agents") ||
        pathname.startsWith("/voiceagents") ||
        pathname.startsWith("/workflow")) &&
      !pathname.includes("/run/")
    );
  }
  if (item.url === "/connect-email") {
    return pathname.startsWith("/connect-email");
  }
  if (item.url === "/email/inbox") {
    return pathname.startsWith("/email") && !pathname.startsWith("/email/agents");
  }
  return item.exact ? pathname === item.url : pathname.startsWith(item.url);
}

export function findNavItem(pathname: string, search?: string | null): SidebarNavItem | undefined {
  const items = [
    OVERVIEW_ITEM,
    TEAMS_ITEM,
    ...NAV_TREE.flatMap((section) => section.items),
    ...CHANNELS_ITEMS,
    ...RESOURCE_ITEMS,
    ...ACCOUNT_ITEMS,
    ...ADMIN_ITEMS,
    ...TEAMS_SUB_ITEMS,
  ];
  return items.find((item) => isNavItemActive(item, pathname, search));
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

// Breadcrumb name for a detail page that doesn't set its own title.
export function getDetailLabel(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  const last = segments.at(-1) ?? "";
  const parent = segments.at(-2);
  if (/^\d+$/.test(last) && parent) return `${capitalize(parent)} #${last}`;
  if (last.length > 24) return "Details";
  return capitalize(last.replaceAll("-", " "));
}
