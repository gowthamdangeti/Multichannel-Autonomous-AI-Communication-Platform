"use client";

import { useUnsavedChangesContext } from "@/context/UnsavedChangesContext";
import { cn } from "@/lib/utils";

import { NAV_ITEMS } from "./constants";

interface SettingsNavProps {
    activeSection: string;
    onSelect: (sectionId: string) => void;
}

/** Left sub-sidebar of the agent settings page; dots mark unsaved sections. */
export function SettingsNav({ activeSection, onSelect }: SettingsNavProps) {
    const { dirtySections } = useUnsavedChangesContext();
    return (
        <div className="w-64 bg-card border border-border rounded-xl p-4 space-y-3 shrink-0 flex flex-col nb-secondary-sidebar">
            {NAV_ITEMS.map((item) => (
                <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelect(item.id)}
                    className={cn(
                        "w-full flex items-center gap-2.5 h-8 px-3 py-1 text-sm transition-all duration-200 text-left cursor-pointer nb-secondary-nav-item",
                        activeSection === item.id && "nb-secondary-nav-active",
                    )}
                >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {dirtySections.has(item.id) && <span className="h-1.5 w-1.5 rounded-full bg-orange-500 shrink-0" />}
                </button>
            ))}
        </div>
    );
}
