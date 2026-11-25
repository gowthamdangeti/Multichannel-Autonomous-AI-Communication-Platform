"use client";

import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { getLanguagesApiV1UserConfigurationsLanguagesProviderGet } from "@/client/sdk.gen";
import type { LanguageGroupInfo, LanguageInfo, LanguagesResponse } from "@/client/types.gen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContentInline, PopoverTrigger } from "@/components/ui/popover";
import { getLanguageNameAndCountry } from "@/constants/languages";
import { closestSupported, languagesDiffer } from "@/lib/languageFallback";
import { cn } from "@/lib/utils";

export type LanguageCapability = "stt" | "tts" | "realtime";

interface LanguagePickerProps {
    provider: string;
    capability: LanguageCapability;
    model?: string;
    value: string;
    onChange: (code: string) => void;
    /** Codes from the provider schema, used only if the languages API is unreachable. */
    fallbackCodes?: string[];
    /** Called whenever a catalog for the current provider/model is loaded. */
    onCatalogLoaded?: (catalog: LanguagesResponse) => void;
    disabled?: boolean;
}

// Catalogs are static per provider/model, so keep them for the page's lifetime.
const catalogCache = new Map<string, Promise<LanguagesResponse>>();

function fetchCatalog(provider: string, capability: LanguageCapability, model?: string): Promise<LanguagesResponse> {
    const key = `${provider}|${capability}|${model ?? ""}`;
    let pending = catalogCache.get(key);
    if (!pending) {
        pending = getLanguagesApiV1UserConfigurationsLanguagesProviderGet({
            path: { provider: provider.toLowerCase() },
            query: { capability, ...(model ? { model } : {}) },
        }).then((response) => {
            if (!response.data) throw new Error("Failed to load languages");
            return response.data;
        });
        // Don't cache failures, so the next open can retry.
        pending.catch(() => catalogCache.delete(key));
        catalogCache.set(key, pending);
    }
    return pending;
}

/** Minimal catalog built from schema codes, for when the API can't be reached. */
function fallbackCatalog(provider: string, capability: LanguageCapability, codes: string[]): LanguagesResponse {
    const languages: LanguageInfo[] = Array.from(new Set(codes)).map((code) => {
        const { name, countryCode } = getLanguageNameAndCountry(code);
        const isAuto = ["auto", "multi", "unknown"].includes(code.toLowerCase());
        return {
            code,
            display_code: code,
            name: countryCode && !isAuto ? `${name} (${countryCode})` : name,
            language_name: name,
            region: countryCode || null,
            group: isAuto ? "auto" : "all",
            base_language: code.split(/[-_]/)[0].toLowerCase(),
            is_auto_detect: isAuto,
        };
    });
    const selectable = languages.filter((l) => !l.is_auto_detect);
    return {
        provider,
        capability,
        total_languages: new Set(selectable.map((l) => l.base_language)).size,
        total_options: selectable.length,
        groups: [{ id: "all", label: "Languages", count: languages.length, languages }],
        languages,
        source: "fallback",
    };
}

/**
 * Shown under the TTS language when callers and replies would use different
 * languages (e.g. STT listens for Hindi while TTS speaks English).
 */
export function LanguageMismatchWarning({ sttLanguage, ttsLanguage }: { sttLanguage: string; ttsLanguage: string }) {
    if (!languagesDiffer(sttLanguage, ttsLanguage)) return null;
    const heard = getLanguageNameAndCountry(sttLanguage).name || sttLanguage;
    const spoken = getLanguageNameAndCountry(ttsLanguage).name || ttsLanguage;
    return (
        <p className="rounded-sm border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-300">
            Callers are transcribed as {heard}, but replies are spoken in {spoken}. Use the same language for both
            unless this is intended.
        </p>
    );
}

function matches(lang: LanguageInfo, query: string): boolean {
    if (!query) return true;
    const q = query.toLowerCase();
    return [lang.name, lang.language_name, lang.native_name, lang.region_name, lang.display_code, lang.code]
        .some((field) => field?.toLowerCase().includes(q));
}

/** Split a group into rows: one row per language, with regional variants nested. */
function languageRows(group: LanguageGroupInfo): Array<{ heading: string | null; native?: string | null; items: LanguageInfo[] }> {
    const rows: Array<{ heading: string | null; native?: string | null; items: LanguageInfo[] }> = [];
    const byLanguage = new Map<string, LanguageInfo[]>();
    for (const lang of group.languages) {
        const key = group.id === "auto" || group.id === "mixed" ? lang.code : lang.language_name;
        const list = byLanguage.get(key);
        if (list) list.push(lang);
        else byLanguage.set(key, [lang]);
    }
    for (const items of byLanguage.values()) {
        rows.push(
            items.length > 1
                ? { heading: items[0].language_name, native: items[0].native_name, items }
                : { heading: null, items },
        );
    }
    return rows;
}

function LanguageLabel({ lang, nested }: { lang: LanguageInfo; nested?: boolean }) {
    const title = nested ? lang.region_name || lang.name : lang.name;
    return (
        <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="w-5 shrink-0 text-center" aria-hidden>
                {lang.flag ?? ""}
            </span>
            <span className="truncate font-medium">{title}</span>
            {!nested && lang.native_name && lang.native_name !== lang.language_name && (
                <span className="truncate text-xs text-muted-foreground" dir={lang.direction ?? "ltr"}>
                    {lang.native_name}
                </span>
            )}
        </span>
    );
}

export function LanguagePicker({
    provider,
    capability,
    model,
    value,
    onChange,
    fallbackCodes,
    onCatalogLoaded,
    disabled,
}: LanguagePickerProps) {
    const [catalog, setCatalog] = useState<LanguagesResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    // Keep the latest callback/fallback without refetching when their identity changes.
    const onLoadedRef = useRef(onCatalogLoaded);
    onLoadedRef.current = onCatalogLoaded;
    const fallbackRef = useRef(fallbackCodes);
    fallbackRef.current = fallbackCodes;

    const valueRef = useRef(value);
    valueRef.current = value;
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    // The first catalog is for the saved settings: never change the value then,
    // only warn. Later catalogs follow a provider/model change by the user.
    const initialLoadRef = useRef(true);

    useEffect(() => {
        if (!provider) return;
        let cancelled = false;
        setLoading(true);
        fetchCatalog(provider, capability, model)
            .catch(() => fallbackCatalog(provider, capability, fallbackRef.current ?? []))
            .then((result) => {
                if (cancelled) return;
                setCatalog(result);
                onLoadedRef.current?.(result);
                const isInitial = initialLoadRef.current;
                initialLoadRef.current = false;
                if (isInitial || result.source === "fallback") return;
                const current = valueRef.current;
                if (!current || result.languages.some((l) => l.code === current)) return;
                const replacement = closestSupported(result, current);
                if (!replacement) return;
                onChangeRef.current(replacement.code);
                const from = getLanguageNameAndCountry(current).name || current;
                toast.info(`Language changed to ${replacement.name}`, {
                    description: `${result.model ?? provider} doesn't support ${from} (${current}).`,
                });
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [provider, capability, model]);

    const selected = useMemo(
        () => catalog?.languages.find((l) => l.code === value) ?? null,
        [catalog, value],
    );

    const filteredGroups = useMemo(() => {
        if (!catalog) return [];
        return catalog.groups
            .map((group) => ({ ...group, languages: group.languages.filter((l) => matches(l, query.trim())) }))
            .filter((group) => group.languages.length > 0);
    }, [catalog, query]);

    // Flat order of visible items, for keyboard navigation.
    const flatItems = useMemo(
        () => filteredGroups.flatMap((group) => languageRows(group).flatMap((row) => row.items)),
        [filteredGroups],
    );

    useEffect(() => {
        setActiveIndex(0);
    }, [query, open]);

    useEffect(() => {
        if (!open) setQuery("");
    }, [open]);

    useEffect(() => {
        const active = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
        active?.scrollIntoView({ block: "nearest" });
    }, [activeIndex]);

    const choose = (code: string) => {
        onChange(code);
        setOpen(false);
    };

    const onKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((i) => Math.min(i + 1, flatItems.length - 1));
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
        } else if (event.key === "Enter") {
            event.preventDefault();
            const item = flatItems[activeIndex];
            if (item) choose(item.code);
        }
    };

    const summary = catalog
        ? catalog.total_options > catalog.total_languages
            ? `${catalog.total_languages} languages · ${catalog.total_options} regional options`
            : `${catalog.total_languages} ${catalog.total_languages === 1 ? "language" : "languages"}`
        : null;

    const fallbackInfo = value ? getLanguageNameAndCountry(value) : null;
    let itemIndex = -1;

    return (
        <div className="space-y-1">
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        disabled={disabled}
                        className="w-full justify-between font-normal"
                    >
                        {value ? (
                            <span className="flex min-w-0 items-center gap-2">
                                {selected?.flag && <span aria-hidden>{selected.flag}</span>}
                                <span className="truncate font-medium">
                                    {selected?.name ?? fallbackInfo?.name ?? value}
                                </span>
                                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                                    {selected?.display_code ?? value}
                                </span>
                            </span>
                        ) : (
                            <span className="text-muted-foreground">Select language</span>
                        )}
                        {loading ? (
                            <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin opacity-60" />
                        ) : (
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        )}
                    </Button>
                </PopoverTrigger>
                <PopoverContentInline
                    align="start"
                    className="w-(--radix-popover-trigger-width) min-w-80 p-0"
                    onKeyDown={onKeyDown}
                >
                    <div className="border-b p-2">
                        <div className="relative">
                            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                autoFocus
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder={
                                    catalog ? `Search ${catalog.total_languages} languages…` : "Search languages…"
                                }
                                className="h-8 pl-8"
                                aria-label="Search languages"
                            />
                        </div>
                        {summary && (
                            <p className="mt-1.5 px-1 text-xs text-muted-foreground">
                                {summary}
                                {catalog?.model ? ` · ${catalog.model}` : ""}
                            </p>
                        )}
                    </div>

                    <div ref={listRef} role="listbox" className="max-h-80 overflow-y-auto py-1">
                        {value && catalog && !selected && !query && (
                            <div className="px-2 pb-1">
                                <div className="px-2 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                                    Current value isn&apos;t offered for this model
                                </div>
                                <div className="flex items-center gap-2 rounded-sm bg-accent/50 px-2 py-1.5 text-sm">
                                    <Check className="h-4 w-4" />
                                    <span className="truncate">{fallbackInfo?.name ?? value}</span>
                                    <span className="ml-auto font-mono text-xs text-muted-foreground">{value}</span>
                                </div>
                            </div>
                        )}

                        {loading && !catalog && (
                            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" /> Loading languages…
                            </div>
                        )}

                        {catalog && filteredGroups.length === 0 && (
                            <div className="py-6 text-center text-sm text-muted-foreground">
                                No language matches &ldquo;{query}&rdquo;
                            </div>
                        )}

                        {filteredGroups.map((group) => (
                            <div key={group.id} role="group" aria-label={group.label}>
                                {group.id !== "auto" && (
                                    <div className="sticky top-0 z-10 flex items-center justify-between bg-popover px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                                        <span>{group.label}</span>
                                        <span className="font-normal">{group.languages.length}</span>
                                    </div>
                                )}
                                {languageRows(group).map((row) => (
                                    <div key={row.heading ?? row.items[0].code}>
                                        {row.heading && (
                                            <div className="flex items-baseline gap-2 px-3 pb-0.5 pt-1.5 text-sm font-medium">
                                                <span>{row.heading}</span>
                                                {row.native && row.native !== row.heading && (
                                                    <span className="text-xs font-normal text-muted-foreground">
                                                        {row.native}
                                                    </span>
                                                )}
                                                <span className="text-xs font-normal text-muted-foreground">
                                                    · {row.items.length} variants
                                                </span>
                                            </div>
                                        )}
                                        {row.items.map((lang) => {
                                            itemIndex += 1;
                                            const index = itemIndex;
                                            const isSelected = lang.code === value;
                                            return (
                                                <div
                                                    key={lang.code}
                                                    role="option"
                                                    aria-selected={isSelected}
                                                    data-index={index}
                                                    onMouseEnter={() => setActiveIndex(index)}
                                                    onClick={() => choose(lang.code)}
                                                    className={cn(
                                                        "mx-1 flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                                                        row.heading && "pl-6",
                                                        index === activeIndex && "bg-accent text-accent-foreground",
                                                    )}
                                                >
                                                    <LanguageLabel lang={lang} nested={!!row.heading} />
                                                    {lang.voice_count ? (
                                                        <span className="shrink-0 text-xs text-muted-foreground">
                                                            {lang.voice_count} {lang.voice_count === 1 ? "voice" : "voices"}
                                                        </span>
                                                    ) : null}
                                                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                                                        {lang.is_auto_detect ? "" : lang.display_code}
                                                    </span>
                                                    <Check
                                                        className={cn("h-4 w-4 shrink-0", isSelected ? "opacity-100" : "opacity-0")}
                                                    />
                                                </div>
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                </PopoverContentInline>
            </Popover>
            {summary && (
                <p className="text-xs text-muted-foreground">
                    {summary} supported{catalog?.model ? ` by ${catalog.model}` : ""}
                    {catalog?.source === "live" && (
                        <span title={catalog.fetched_at ? `Fetched ${new Date(catalog.fetched_at).toLocaleString()}` : undefined}>
                            {" "}· live from provider
                        </span>
                    )}
                </p>
            )}
            {catalog?.note && (
                <p className="rounded-sm border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-300">
                    {catalog.note}
                </p>
            )}
        </div>
    );
}
