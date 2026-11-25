"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { OVERVIEW_CHANNELS, type OverviewChannel } from "./channels";

interface OverviewChannelTabsProps {
  channel: OverviewChannel;
  onChange: (channel: OverviewChannel) => void;
}

export function OverviewChannelTabs({ channel, onChange }: OverviewChannelTabsProps) {
  return (
    <Tabs value={channel} onValueChange={(value) => onChange(value as OverviewChannel)} className="max-w-full">
      <TabsList aria-label="Agent channel" className="max-w-full justify-start overflow-x-auto">
        {OVERVIEW_CHANNELS.map((option) => (
          <TabsTrigger
            key={option.id}
            value={option.id}
            disabled={Boolean(option.unavailable)}
            className="flex-none shrink-0 px-3"
          >
            {option.label}
            {option.unavailable && <span className="text-xs text-muted-foreground">{option.unavailable}</span>}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
