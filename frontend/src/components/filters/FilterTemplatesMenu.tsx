"use client";

import { Bookmark, Check, Coins, type LucideIcon, PhoneMissed, Timer } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type FilterTemplate, filterTemplates } from "@/types/filters";

/** Icon per template, by what it finds; unknown templates get the bookmark. */
const TEMPLATE_ICONS: Record<string, LucideIcon> = {
    "failed-calls-today": PhoneMissed,
    "long-duration-calls": Timer,
    "high-cost-calls": Coins,
};

interface FilterTemplatesMenuProps {
    selectedTemplateId: string | null;
    onSelect: (template: FilterTemplate) => void;
}

/**
 * Templates dropdown shared by every run list (Voice conversations, agent
 * conversations, campaign runs). The trigger shows the picked template.
 */
export function FilterTemplatesMenu({ selectedTemplateId, onSelect }: FilterTemplatesMenuProps) {
    const selected = filterTemplates.find((template) => template.id === selectedTemplateId) ?? null;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 max-w-44 gap-1.5 text-xs font-medium sm:max-w-56">
                    <Bookmark className="h-4 w-4 shrink-0" />
                    <span className="truncate">{selected ? selected.name : "Templates"}</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[260px]">
                <DropdownMenuLabel className="flex items-center gap-1.5 text-xs">
                    <Bookmark className="h-3.5 w-3.5" />
                    Filter Templates
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {filterTemplates.map((template) => {
                    const Icon = TEMPLATE_ICONS[template.id] ?? Bookmark;
                    const isActive = template.id === selectedTemplateId;
                    return (
                        <DropdownMenuItem key={template.id} onClick={() => onSelect(template)} className="cursor-pointer items-start gap-2 text-xs">
                            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                            <div className="flex min-w-0 flex-1 flex-col">
                                <span className="font-medium">{template.name}</span>
                                <span className="text-xs text-muted-foreground">{template.description}</span>
                            </div>
                            {isActive && <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
                        </DropdownMenuItem>
                    );
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
