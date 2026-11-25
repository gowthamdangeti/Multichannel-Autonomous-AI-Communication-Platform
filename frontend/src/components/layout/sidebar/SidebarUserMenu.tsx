"use client";

import { LogOut, MoreVertical, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { getCurrentUserApiV1AuthMeGet } from "@/client/sdk.gen";
import ThemeToggle from "@/components/ThemeSwitcher";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import type { LocalUser } from "@/lib/auth";
import { useAuth } from "@/lib/auth";

type SidebarUser = {
  displayName?: string | null;
  name?: string | null;
  primaryEmail?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  avatarUrl?: string | null;
  image?: string | null;
  profileImageUrl?: string | null;
};

function getUserIdentity(user: SidebarUser | null | undefined) {
  const email = user?.email || user?.primaryEmail || "";
  const name = user?.displayName || user?.name || email.split("@")[0] || "";
  const initials =
    (name || email)
      .split(/[\s@]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "U";
  const avatarUrl = user?.avatar_url || user?.avatarUrl || user?.image || user?.profileImageUrl || null;
  return { name, email, initials, avatarUrl };
}

export function SidebarUserMenu() {
  const router = useRouter();
  const { logout, user, getAccessToken } = useAuth();
  const baseIdentity = getUserIdentity(user as LocalUser | undefined);

  const [liveProfile, setLiveProfile] = useState<{
    name?: string;
    email?: string;
    avatarUrl?: string | null;
  } | null>(null);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadLatestProfile() {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const res = await getCurrentUserApiV1AuthMeGet({
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.data && isMounted) {
          const first = res.data.first_name?.trim() || "";
          const last = res.data.last_name?.trim() || "";
          const fullName = [first, last].filter(Boolean).join(" ");
          setLiveProfile({
            name: fullName || res.data.email?.split("@")[0] || undefined,
            email: res.data.email || undefined,
            avatarUrl: res.data.avatar_url || null,
          });
          setImageError(false);
        }
      } catch {
        // Silently use auth user identity
      }
    }

    void loadLatestProfile();

    const handleProfileUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<{
        first_name?: string | null;
        last_name?: string | null;
        email?: string | null;
        avatar_url?: string | null;
      }>;
      const detail = customEvent.detail;
      if (detail && isMounted) {
        const first = detail.first_name?.trim() || "";
        const last = detail.last_name?.trim() || "";
        const fullName = [first, last].filter(Boolean).join(" ");
        setLiveProfile((prev) => ({
          name: fullName || prev?.name || undefined,
          email: detail.email || prev?.email || undefined,
          avatarUrl: detail.avatar_url !== undefined ? detail.avatar_url : prev?.avatarUrl ?? null,
        }));
        setImageError(false);
      }
    };

    window.addEventListener("autonomous_ai_os:user-updated", handleProfileUpdate);
    return () => {
      isMounted = false;
      window.removeEventListener("autonomous_ai_os:user-updated", handleProfileUpdate);
    };
  }, [getAccessToken]);

  const name = liveProfile?.name || baseIdentity.name;
  const email = liveProfile?.email || baseIdentity.email;
  const avatarUrl = liveProfile?.avatarUrl !== undefined ? liveProfile.avatarUrl : baseIdentity.avatarUrl;
  const initials = baseIdentity.initials;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent cursor-pointer">
              <span className="user-avatar-trigger flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-medium text-foreground overflow-hidden">
                {avatarUrl && !imageError ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl}
                    alt={name || "User avatar"}
                    className="h-full w-full object-cover"
                    onError={() => setImageError(true)}
                  />
                ) : (
                  initials
                )}
              </span>
              <span className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="notranslate truncate text-sm font-medium" translate="no">
                  {name}
                </span>
                {email && (
                  <span className="notranslate truncate text-xs text-muted-foreground" translate="no">
                    {email}
                  </span>
                )}
              </span>
              <MoreVertical className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" sideOffset={8} className="z-50 w-(--radix-dropdown-menu-trigger-width) min-w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-medium text-foreground overflow-hidden border border-border">
                  {avatarUrl && !imageError ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatarUrl}
                      alt={name || "User avatar"}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    initials
                  )}
                </span>
                <div className="flex flex-col space-y-0.5 min-w-0 flex-1">
                  {name && <p className="truncate text-sm font-medium">{name}</p>}
                  {email && <p className="truncate text-xs text-muted-foreground">{email}</p>}
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/settings")} className="cursor-pointer">
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <ThemeToggle showLabel={true} className="h-8 w-full cursor-pointer justify-start px-2 text-sm font-normal" />
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => logout()} className="cursor-pointer text-destructive focus:text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
