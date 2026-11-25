"use client";

import { Download } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";

import { DateTimeField } from "./DateTimeField";
import { useReportDownload } from "./hooks/useReportDownload";

interface ReportDownloadPopoverProps {
    workflowId: number;
    hasTemplate: boolean;
}

/** "Download report" button with an optional date-range filter. */
export function ReportDownloadPopover({ workflowId, hasTemplate }: ReportDownloadPopoverProps) {
    const [isOpen, setIsOpen] = useState(false);
    const report = useReportDownload(workflowId, hasTemplate);

    const handleDownload = () => {
        setIsOpen(false);
        void report.download();
    };

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" disabled={report.isDownloading}>
                    <Download className="h-4 w-4 mr-2" />
                    {hasTemplate ? "Download PDF Report" : "Download CSV Report"}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-4" align="start">
                <div className="space-y-4">
                    <div className="text-sm font-medium">Filter by date range</div>
                    <div className="grid gap-3">
                        <DateTimeField
                            label="From"
                            placeholder="Start date"
                            date={report.startDate}
                            onDateChange={report.setStartDate}
                            time={report.startTime}
                            onTimeChange={report.setStartTime}
                            isDateDisabled={(date) => (report.endDate ? date > report.endDate : false)}
                        />
                        <DateTimeField
                            label="To"
                            placeholder="End date"
                            date={report.endDate}
                            onDateChange={report.setEndDate}
                            time={report.endTime}
                            onTimeChange={report.setEndTime}
                            isDateDisabled={(date) => (report.startDate ? date < report.startDate : false)}
                        />
                    </div>
                    <Separator />
                    <div className="flex justify-between">
                        <Button variant="ghost" size="sm" onClick={report.clear}>
                            Clear
                        </Button>
                        <Button size="sm" onClick={handleDownload} disabled={report.isDownloading}>
                            <Download className="h-3.5 w-3.5 mr-1.5" />
                            {report.isFiltered ? "Download Filtered" : "Download All"}
                        </Button>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
