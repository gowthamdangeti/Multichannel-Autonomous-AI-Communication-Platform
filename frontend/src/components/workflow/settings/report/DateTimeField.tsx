"use client";

import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface DateTimeFieldProps {
    label: string;
    placeholder: string;
    date: Date | undefined;
    onDateChange: (date: Date | undefined) => void;
    time: string;
    onTimeChange: (time: string) => void;
    /** Dates that may not be picked (e.g. after the range end). */
    isDateDisabled: (date: Date) => boolean;
}

/** Calendar date plus time-of-day, one end of a report date range. */
export function DateTimeField({ label, placeholder, date, onDateChange, time, onTimeChange, isDateDisabled }: DateTimeFieldProps) {
    return (
        <div className="space-y-1.5">
            <Label className="text-xs">{label}</Label>
            <div className="flex gap-2">
                <Popover>
                    <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="w-[140px] justify-start text-left font-normal">
                            <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                            {date ? format(date, "MMM dd, yyyy") : placeholder}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={date} onSelect={onDateChange} disabled={isDateDisabled} />
                    </PopoverContent>
                </Popover>
                <Input
                    type="time"
                    value={time}
                    onChange={(e) => onTimeChange(e.target.value)}
                    className="w-[100px] h-8 text-xs"
                />
            </div>
        </div>
    );
}
