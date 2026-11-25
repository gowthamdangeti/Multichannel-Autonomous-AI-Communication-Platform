"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

import { ALL_TIME_DAYS } from "@/lib/dateRange";

import { ChatOverview } from "./chat/ChatOverview";
import { DEFAULT_CHANNEL, type OverviewChannel, toChannel } from "./shared/channels";
import { OverviewChannelTabs } from "./shared/OverviewChannelTabs";
import { OverviewRangeSelect } from "./shared/OverviewRangeSelect";
import { VoiceOverview } from "./voice/VoiceOverview";
import { WhatsAppOverview } from "./whatsapp/WhatsAppOverview";

/** Owns the channel (kept in the URL, so links and Back work) and the date range. */
export function OverviewView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const channel = toChannel(searchParams.get("channel"));
  const [days, setDays] = useState(ALL_TIME_DAYS);

  const setChannel = useCallback(
    (next: OverviewChannel) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === DEFAULT_CHANNEL) params.delete("channel");
      else params.set("channel", next);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // Channel switcher and date range both live in the top bar's breadcrumb section.
  const headerControls = (
    <>
      <OverviewChannelTabs channel={channel} onChange={setChannel} />
      <OverviewRangeSelect days={days} onChange={setDays} />
    </>
  );

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 pt-2 pb-6 lg:px-6">
      {/* Only the open channel mounts, so only its data loads and refreshes. */}
      {channel === "chat" && <ChatOverview days={days} headerControls={headerControls} />}
      {channel === "whatsapp" && <WhatsAppOverview days={days} headerControls={headerControls} />}
      {(channel === "voice" || channel === "email") && <VoiceOverview days={days} headerControls={headerControls} />}
    </div>
  );
}
