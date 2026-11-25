'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { client } from '@/client/client.gen';
import { getCurrentOrganizationContextApiV1OrganizationsContextGet, getUserConfigurationsApiV1UserConfigurationsUserGet, updateUserConfigurationsApiV1UserConfigurationsUserPut } from '@/client/sdk.gen';
import type { OrganizationContextResponse, UserConfigurationRequestResponseSchema } from '@/client/types.gen';
import { setupAuthInterceptor } from '@/lib/apiClient';
import type { AuthUser } from '@/lib/auth';
import { useAuth } from '@/lib/auth';
import { getModelPricingRules } from '@/lib/modelPricingApi';

interface TeamPermission {
    id: string;
}

interface OrganizationPricing {
    price_per_second_usd: number | null;
    currency: string;
    billing_enabled: boolean;
}

export interface ModelPricingRule {
    service_type: 'llm' | 'tts' | 'stt';
    label: string;
    pattern: string;
    input_rate: number;
    output_rate: number;
    unit_rate: number;
    sort_order: number;
}

interface OrgConfigContextType {
    orgContext: OrganizationContextResponse | null;
    userConfig: UserConfigurationRequestResponseSchema | null;
    saveUserConfig: (userConfig: UserConfigurationRequestResponseSchema) => Promise<void>;
    loading: boolean;
    error: Error | null;
    refreshConfig: () => Promise<void>;
    permissions: TeamPermission[];
    user: AuthUser | null;
    organizationPricing: OrganizationPricing | null;
    modelPricingRules: ModelPricingRule[];
}

const OrgConfigContext = createContext<OrgConfigContextType | null>(null);

const pricingFromUserConfig = (
    userConfig: UserConfigurationRequestResponseSchema,
): OrganizationPricing | null => {
    if (!userConfig.organization_pricing) {
        return null;
    }

    return {
        price_per_second_usd: userConfig.organization_pricing.price_per_second_usd as number | null,
        currency: (userConfig.organization_pricing.currency as string) || 'USD',
        billing_enabled: (userConfig.organization_pricing.billing_enabled as boolean) || false,
    };
};

export function OrgConfigProvider({ children }: { children: ReactNode }) {
    const [orgContext, setOrgContext] = useState<OrganizationContextResponse | null>(null);
    const [userConfig, setUserConfig] = useState<UserConfigurationRequestResponseSchema | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [organizationPricing, setOrganizationPricing] = useState<OrganizationPricing | null>(null);
    const [modelPricingRules, setModelPricingRules] = useState<ModelPricingRule[]>([]);
    const [permissions, setPermissions] = useState<TeamPermission[]>([]);

    const auth = useAuth();

    const authRef = useRef(auth);
    authRef.current = auth;

    const hasFetchedConfig = useRef(false);
    const hasFetchedPermissions = useRef(false);

    if (!auth.loading && auth.isAuthenticated) {
        setupAuthInterceptor(client, auth.getAccessToken);
    }

    useEffect(() => {
        if (auth.loading || hasFetchedPermissions.current) {
            return;
        }
        hasFetchedPermissions.current = true;

        const fetchPermissions = async () => {
            const currentAuth = authRef.current;
            if (currentAuth.provider === 'stack' && currentAuth.getSelectedTeam && currentAuth.listPermissions) {
                const selectedTeam = currentAuth.getSelectedTeam();
                if (selectedTeam) {
                    try {
                        const perms = await currentAuth.listPermissions(selectedTeam);
                        setPermissions(Array.isArray(perms) ? perms : []);
                    } catch {
                        setPermissions([]);
                    }
                } else {
                    setPermissions([]);
                }
            } else {
                setPermissions([{ id: 'admin' }]);
            }
        };

        fetchPermissions();
    }, [auth.loading, auth.provider]);

    const isAuthTokenError = (res: { error?: unknown; response?: Response } | unknown): boolean => {
        const r = res as { error?: unknown; response?: { status?: number } };
        if (r?.response?.status === 401) return true;
        const detail = (r?.error as { detail?: unknown })?.detail;
        if (typeof detail === 'string' && detail.toLowerCase().includes('token')) return true;
        if (typeof detail === 'string' && detail.toLowerCase().includes('expired')) return true;
        return false;
    };

    const handleAuthFailure = useCallback(async () => {
        const currentAuth = authRef.current;
        // Avoid redirect loop on auth pages
        if (typeof window !== 'undefined' && window.location.pathname.startsWith('/auth/')) return;
        try {
            await currentAuth.logout();
        } catch {
            if (typeof window !== 'undefined') window.location.href = '/auth/login';
        }
    }, []);

    const fetchConfig = useCallback(async () => {
        const currentAuth = authRef.current;
        if (!currentAuth.isAuthenticated) {
            return;
        }

        setLoading(true);
        try {
            const [orgContextResponse, userConfigResponse] = await Promise.all([
                getCurrentOrganizationContextApiV1OrganizationsContextGet(),
                getUserConfigurationsApiV1UserConfigurationsUserGet(),
            ]);

            // If either response is 401 due to invalid/expired token, force logout
            if (isAuthTokenError(orgContextResponse) || isAuthTokenError(userConfigResponse)) {
                const detail = (orgContextResponse.error as { detail?: string })?.detail ?? (userConfigResponse.error as { detail?: string })?.detail ?? 'Invalid or expired token';
                setError(new Error(detail));
                await handleAuthFailure();
                return;
            }

            if (orgContextResponse.data) {
                setOrgContext(orgContextResponse.data);
            } else if (orgContextResponse.error) {
                const msg = (orgContextResponse.error as { detail?: string })?.detail ?? 'Failed to fetch organization context';
                setError(new Error(typeof msg === 'string' ? msg : 'Failed to fetch organization context'));
                // Don't logout on non-auth errors
                if (isAuthTokenError(orgContextResponse)) await handleAuthFailure();
                return;
            }

            if (userConfigResponse.data) {
                setUserConfig(userConfigResponse.data);
                setOrganizationPricing(pricingFromUserConfig(userConfigResponse.data));
            }

            // Fetch model pricing rules (non-blocking — fallback to local rules on failure)
            try {
                const rules = await getModelPricingRules();
                if (rules.length > 0) setModelPricingRules(rules);
            } catch {
                // Silently fall back to hardcoded rules in the component
            }

            if (userConfigResponse.error) {
                const msg = (userConfigResponse.error as { detail?: string })?.detail ?? 'Failed to fetch user configuration';
                // Non-fatal: user config can fail independently
                if (isAuthTokenError(userConfigResponse)) {
                    setError(new Error(typeof msg === 'string' ? msg : 'Failed to fetch user configuration'));
                    await handleAuthFailure();
                    return;
                }
            }

            setError(null);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to fetch organization configuration';
            if (msg.toLowerCase().includes('token') || msg.toLowerCase().includes('expired')) {
                await handleAuthFailure();
            }
            setError(err instanceof Error ? err : new Error('Failed to fetch organization configuration'));
        } finally {
            setLoading(false);
        }
    }, [handleAuthFailure]);

    useEffect(() => {
        if (auth.loading || !auth.isAuthenticated || hasFetchedConfig.current) {
            return;
        }
        hasFetchedConfig.current = true;
        fetchConfig();
    }, [auth.loading, auth.isAuthenticated, fetchConfig]);

    const saveUserConfig = useCallback(async (userConfigRequest: UserConfigurationRequestResponseSchema) => {
        if (!authRef.current.isAuthenticated) throw new Error('No authentication available');
        const response = await updateUserConfigurationsApiV1UserConfigurationsUserPut({
            body: {
                ...userConfig,
                ...userConfigRequest,
            } as UserConfigurationRequestResponseSchema,
        });
        if (response.error) {
            let msg = 'Failed to save user configuration';
            const detail = (response.error as unknown as { detail?: string | { errors: { model: string; message: string }[] } }).detail;
            if (typeof detail === 'string') {
                msg = detail;
            } else if (Array.isArray(detail)) {
                msg = detail
                    .map((e: { model: string; message: string }) => `${e.model}: ${e.message}`)
                    .join('\n');
            }
            throw new Error(msg);
        }

        if (response.data) {
            setUserConfig(response.data);
            setOrganizationPricing(pricingFromUserConfig(response.data));
        }
    }, [userConfig]);

    const refreshConfig = useCallback(async () => {
        await fetchConfig();
    }, [fetchConfig]);

    return (
        <OrgConfigContext.Provider
            value={{
                orgContext,
                userConfig,
                saveUserConfig,
                loading,
                error,
                refreshConfig,
                permissions,
                user: auth.user,
                organizationPricing,
                modelPricingRules,
            }}
        >
            {children}
        </OrgConfigContext.Provider>
    );
}

export function useOrgConfig() {
    const context = useContext(OrgConfigContext);
    if (!context) {
        throw new Error('useOrgConfig must be used within an OrgConfigProvider');
    }
    return context;
}
