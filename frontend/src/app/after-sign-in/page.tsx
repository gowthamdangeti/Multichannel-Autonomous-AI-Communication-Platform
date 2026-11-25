import { isNextRouterError } from "next/dist/client/components/is-next-router-error";
import { redirect } from "next/navigation";

import { getCurrentUserApiV1AuthMeGet, getWorkflowCountApiV1WorkflowCountGet } from "@/client/sdk.gen";
import { getServerAccessToken,getServerAuthProvider, getServerUser } from "@/lib/auth/server";
import logger from '@/lib/logger';
import { getRedirectUrl } from "@/lib/utils";

export const dynamic = 'force-dynamic';

export default async function AfterSignInPage() {
    logger.debug('[AfterSignInPage] Starting after-sign-in page');
    const authProvider = await getServerAuthProvider();
    logger.debug('[AfterSignInPage] Auth provider:', authProvider);
    logger.debug('[AfterSignInPage] Getting server user...');
    const user = await getServerUser();
    const accessToken = await getServerAccessToken();
    logger.debug('[AfterSignInPage] Got token:', { hasToken: !!accessToken });

    // Resolve the post-sign-in destination (same as before, hoisted so the
    // profile-setup gate can send the user back to it afterwards).
    let targetUrl: string | null = null;
    if (authProvider === 'stack' && user && 'getAuthJson' in user) {
        logger.debug('[AfterSignInPage] Stack user detected, getting auth token...');
        const token = await user.getAuthJson();
        const permissions = 'listPermissions' in user && 'selectedTeam' in user
            ? await user.listPermissions(user.selectedTeam!) ?? []
            : [];
        logger.debug('[AfterSignInPage] Got permissions:', { count: permissions.length });
        targetUrl = await getRedirectUrl(token?.accessToken ?? "", permissions);
    } else if (accessToken) {
        // For local provider, check for existing workflows
        logger.debug('[AfterSignInPage] Checking for existing workflows before fallback');
        try {
            const countResponse = await getWorkflowCountApiV1WorkflowCountGet({
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });

            logger.debug('[AfterSignInPage] Found workflows:', {
                total: countResponse.data?.total,
                active: countResponse.data?.active
            });

            targetUrl = countResponse.data && countResponse.data.active > 0
                ? '/workflow'
                : '/workflow/create';
        } catch (error) {
            if (isNextRouterError(error)) {
                throw error;
            }
            logger.error('[AfterSignInPage] Error checking workflows:', error);
            targetUrl = '/workflow/create';
        }
    } else {
        // Default fallback
        targetUrl = '/workflow/create';
    }

    // Profile setup gate: new users without a name must complete their profile
    // at /settings/profile before entering the workspace.
    if (accessToken) {
        try {
            const meResponse = await getCurrentUserApiV1AuthMeGet({
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });
            if (meResponse.data && (!meResponse.data.first_name || !meResponse.data.last_name)) {
                logger.debug('[AfterSignInPage] Profile incomplete, redirecting to profile setup');
                redirect(`/settings/profile?next=${encodeURIComponent(targetUrl)}`);
            }
        } catch (error) {
            if (isNextRouterError(error)) {
                throw error;
            }
            logger.error('[AfterSignInPage] Error checking profile:', error);
        }
    }

    logger.debug(`[AfterSignInPage] Redirecting to: ${targetUrl}`);
    redirect(targetUrl);
}
