import { Activity, Bell, Gauge, Palette, ScrollText, ShieldCheck, User, Webhook } from "lucide-react";
import type { ComponentType } from "react";

export interface SettingsNavItem {
  title: string;
  description: string;
  url: string;
  icon: ComponentType<{ className?: string }>;
  // Planned but not built: listed with a "Soon" tag and not clickable.
  comingSoon?: boolean;
}

export const SETTINGS_SECTIONS: Array<{ label: string; items: SettingsNavItem[] }> = [
  {
    label: "Account",
    items: [
      { title: "Profile Settings", description: "Your profile picture, name and contact details.", url: "/settings/profile", icon: User },
      { title: "Two-Factor Authentication", description: "Protect your account with a code each time you sign in.", url: "/settings/security", icon: ShieldCheck },
      { title: "Theme", description: "Light or dark mode and the overall design style.", url: "/settings/theme", icon: Palette },
      { title: "Notification Settings", description: "Choose which alerts you receive.", url: "/settings/notifications", icon: Bell, comingSoon: true },
    ],
  },
  {
    label: "Workspace",
    items: [
      { title: "Usage", description: "Token, minute, and cost usage across your workspace.", url: "/settings/usage", icon: Gauge, comingSoon: true },
      { title: "Activity", description: "Your recent actions in this workspace.", url: "/settings/activity", icon: Activity, comingSoon: true },
      { title: "Webhooks", description: "Send events like call ended to your own systems.", url: "/settings/webhooks", icon: Webhook, comingSoon: true },
      { title: "Audit Logs", description: "Every action taken across your workspace.", url: "/settings/audit-logs", icon: ScrollText, comingSoon: true },
    ],
  },
];

export const SETTINGS_ITEMS = SETTINGS_SECTIONS.flatMap((section) => section.items);

export const DEFAULT_SETTINGS_URL = "/settings/profile";

export function findSettingsItem(pathname: string): SettingsNavItem | undefined {
  return SETTINGS_ITEMS.find((item) => pathname.startsWith(item.url));
}
