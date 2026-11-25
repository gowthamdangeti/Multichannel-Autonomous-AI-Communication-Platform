"use client";

import { ChevronDown, Columns2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { RunColumnOption } from "./useRunColumns";

interface RunColumnsMenuProps {
    options: RunColumnOption[];
    isVisible: (id: string) => boolean;
    onToggle: (id: string) => void;
    onReset: () => void;
}

/** shadcn "Customize Columns" menu: a checkbox per optional column. */
export function RunColumnsMenu({ options, isVisible, onToggle, onReset }: RunColumnsMenuProps) {
    const optional = options.filter((option) => !option.required);
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs font-medium">
                    <Columns2 className="h-4 w-4" />
                    Customize Columns
                    <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-[60vh] w-56 overflow-y-auto">
                <DropdownMenuLabel className="text-xs">Columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {optional.map((option) => (
                    <DropdownMenuCheckboxItem
                        key={option.id}
                        checked={isVisible(option.id)}
                        onCheckedChange={() => onToggle(option.id)}
                        // Keep the menu open so several columns can be toggled.
                        onSelect={(event) => event.preventDefault()}
                        className="text-xs"
                    >
                        <span className="truncate">{option.label}</span>
                    </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onReset} className="text-xs">
                    Reset to default
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
