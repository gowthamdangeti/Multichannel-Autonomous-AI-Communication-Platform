"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RANGE_OPTIONS } from "@/lib/dateRange";

interface RangeTabsProps {
  days: number;
  onChange: (days: number) => void;
}

export function RangeTabs({ days, onChange }: RangeTabsProps) {
  return (
    <Tabs value={String(days)} onValueChange={(value) => onChange(Number(value))} className="max-w-full">
      <TabsList aria-label="Date range" className="max-w-full justify-start overflow-x-auto">
        {RANGE_OPTIONS.map((option) => (
          <TabsTrigger key={option.days} value={String(option.days)} className="flex-none px-2 sm:px-3">
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
