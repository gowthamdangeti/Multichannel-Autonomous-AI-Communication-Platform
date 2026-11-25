"use client";

import { cn } from "@/lib/utils";

export interface UnderlineTabItem {
    value: string;
    label: string;
    /** Shows an amber dot marking unsaved changes on the tab. */
    dirty?: boolean;
}

interface UnderlineTabsProps {
    items: UnderlineTabItem[];
    value: string;
    onValueChange: (value: string) => void;
    className?: string;
}

/**
 * Horizontal underline tab bar used by the conversation detail page and every
 * off-canvas drawer, so navigation stays visually identical across surfaces.
 * Base layout is mobile-first: the row scrolls horizontally and tabs never wrap.
 */
export function UnderlineTabs({ items, value, onValueChange, className }: UnderlineTabsProps) {
    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
        if (!keys.includes(event.key)) return;
        const currentIndex = items.findIndex((item) => item.value === value);
        if (currentIndex === -1) return;
        let nextIndex = currentIndex;
        if (event.key === "Home") nextIndex = 0;
        else if (event.key === "End") nextIndex = items.length - 1;
        else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + items.length) % items.length;
        else if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % items.length;
        const next = items[nextIndex];
        if (!next) return;
        event.preventDefault();
        onValueChange(next.value);
    };

    return (
        <div
            role="tablist"
            aria-label="Sections"
            onKeyDown={handleKeyDown}
            className={cn("flex items-center gap-6 overflow-x-auto", className)}
        >
            {items.map((item) => {
                const active = item.value === value;
                return (
                    <button
                        key={item.value}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => onValueChange(item.value)}
                        className={cn(
                            "shrink-0 cursor-pointer border-b-2 pb-2.5 text-xs font-semibold transition-colors",
                            active
                                ? "border-primary text-foreground"
                                : "border-transparent text-muted-foreground hover:text-foreground focus-visible:text-foreground",
                        )}
                    >
                        <span className="inline-flex items-center gap-1.5">
                            {item.label}
                            {item.dirty && (
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-label="Unsaved changes" />
                            )}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
