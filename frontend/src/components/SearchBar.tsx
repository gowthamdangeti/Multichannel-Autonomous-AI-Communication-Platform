"use client";

import { RefreshCw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SearchBarProps {
    title: string;
    subtitle?: string;
    searchQuery: string;
    onSearchChange: (query: string) => void;
    onRefresh?: () => void;
    refreshing?: boolean;
    searchPlaceholder?: string;
}

export function SearchBar({
    title,
    subtitle,
    searchQuery,
    onSearchChange,
    onRefresh,
    refreshing = false,
    searchPlaceholder = "Search...",
}: SearchBarProps) {
    return (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-3 mt-1">
            <div className="flex flex-col gap-1">
                <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
                {subtitle && (
                    <p className="text-sm text-muted-foreground">{subtitle}</p>
                )}
            </div>
            <div className="flex items-center gap-3">
                <div className="relative w-64">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder={searchPlaceholder}
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        className="pl-10 h-9"
                    />
                </div>
                {onRefresh && (
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={onRefresh}
                        disabled={refreshing}
                        className="h-9 w-9"
                    >
                        <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                    </Button>
                )}
            </div>
        </div>
    );
}
