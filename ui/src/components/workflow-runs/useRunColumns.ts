"use client";

import { useCallback, useEffect, useState } from "react";

export interface RunColumnOption {
    id: string;
    label: string;
    /** Always shown; not offered in Customize Columns. */
    required?: boolean;
}

function readStored(storageKey: string): string[] | null {
    try {
        const raw = window.localStorage.getItem(storageKey);
        const parsed = raw ? (JSON.parse(raw) as unknown) : null;
        return Array.isArray(parsed) && parsed.every((id) => typeof id === "string") ? parsed : null;
    } catch {
        return null;
    }
}

function writeStored(storageKey: string, ids: string[]) {
    try {
        window.localStorage.setItem(storageKey, JSON.stringify(ids));
    } catch {
        // Private mode / blocked storage: the choice simply isn't remembered.
    }
}

/**
 * Which run-table columns are shown. Starts from `defaultVisible`; with a
 * `storageKey` the viewer's choice is remembered in this browser.
 */
export function useRunColumns(storageKey: string | undefined, defaultVisible: string[]) {
    const [visible, setVisible] = useState<string[]>(defaultVisible);

    // Read after mount so server and first client render agree.
    useEffect(() => {
        if (!storageKey) return;
        const stored = readStored(storageKey);
        if (stored) setVisible(stored);
    }, [storageKey]);

    const toggle = useCallback(
        (id: string) => {
            setVisible((current) => {
                const next = current.includes(id) ? current.filter((c) => c !== id) : [...current, id];
                if (storageKey) writeStored(storageKey, next);
                return next;
            });
        },
        [storageKey],
    );

    const reset = useCallback(() => {
        setVisible(defaultVisible);
        if (storageKey) writeStored(storageKey, defaultVisible);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- defaults are a fixed preset per table
    }, [storageKey]);

    return { visible, isVisible: (id: string) => visible.includes(id), toggle, reset };
}
