"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Redirects legacy /campaigns/new navigations to /campaigns?create=true
 * so the campaign creation off-canvas drawer is automatically displayed.
 */
export default function NewCampaignRedirectPage() {
    const router = useRouter();

    useEffect(() => {
        router.replace("/campaigns?create=true");
    }, [router]);

    return (
        <div className="flex h-[50vh] items-center justify-center">
            <p className="text-xs text-muted-foreground animate-pulse">
                Opening campaign creation…
            </p>
        </div>
    );
}
