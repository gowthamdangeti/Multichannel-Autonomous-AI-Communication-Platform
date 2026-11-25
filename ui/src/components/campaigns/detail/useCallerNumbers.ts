"use client";

import { useEffect, useState } from "react";

import { listPhoneNumbersApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersGet } from "@/client/sdk.gen";
import type { PhoneNumberResponse } from "@/client/types.gen";
import { useAuth } from "@/lib/auth";

export interface CallerNumbers {
    /** Active numbers a campaign on this line dials from, default caller ID first. */
    numbers: PhoneNumberResponse[];
    /** The number shown as the line's caller ID (default, else the first active one). */
    primary: PhoneNumberResponse | null;
    isLoading: boolean;
}

/**
 * Active numbers of a telephony configuration. The dialer picks the caller ID
 * from exactly these (active numbers of the campaign's configuration).
 */
export function useCallerNumbers(configurationId: number | null | undefined): CallerNumbers {
    const { user, loading: authLoading, getAccessToken } = useAuth();
    const [numbers, setNumbers] = useState<PhoneNumberResponse[]>([]);
    const [isLoading, setIsLoading] = useState(Boolean(configurationId));

    useEffect(() => {
        if (!configurationId) {
            setNumbers([]);
            setIsLoading(false);
            return;
        }
        if (authLoading || !user) return;

        let active = true;
        (async () => {
            setIsLoading(true);
            try {
                const token = await getAccessToken();
                const response = await listPhoneNumbersApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersGet({
                    path: { config_id: configurationId },
                    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                });
                if (!active) return;
                const all = response.error ? [] : (response.data?.phone_numbers ?? []);
                const activeNumbers = all
                    .filter((number) => number.is_active)
                    .sort((a, b) => Number(Boolean(b.is_default_caller_id)) - Number(Boolean(a.is_default_caller_id)));
                setNumbers(activeNumbers);
            } catch {
                if (active) setNumbers([]);
            } finally {
                if (active) setIsLoading(false);
            }
        })();
        return () => {
            active = false;
        };
    }, [authLoading, configurationId, getAccessToken, user]);

    return { numbers, primary: numbers[0] ?? null, isLoading };
}
