"use client";

import { CalendarDays } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RANGE_OPTIONS } from "@/lib/dateRange";

interface OverviewRangeSelectProps {
  days: number;
  onChange: (days: number) => void;
}

/** Date range for the whole overview, as one compact dropdown. */
export function OverviewRangeSelect({ days, onChange }: OverviewRangeSelectProps) {
  return (
    <Select value={String(days)} onValueChange={(value) => onChange(Number(value))}>
      <SelectTrigger aria-label="Date range" className="w-full sm:w-36">
        <CalendarDays aria-hidden className="size-4 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {RANGE_OPTIONS.map((option) => (
          <SelectItem key={option.days} value={String(option.days)}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
