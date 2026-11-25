"use client";

import { Lock, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getAllowedVoicesApiV1OrganizationsAllowedVoicesGet } from "@/client/sdk.gen";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";

interface AllowedVoice {
    id: number;
    name: string;
    provider: string;
    voice_id: string;
    language: string;
    gender?: string | null;
    accent?: string | null;
}

/**
 * Read-only model-configuration view for organizations whose AI model and keys
 * are managed by the super-admin platform layer. Providers and keys are never
 * shown — users only see which voices they may use (selected per agent).
 */
export default function ManagedModelConfiguration({
    effectiveConfiguration,
}: {
    effectiveConfiguration?: Record<string, unknown> | null;
}) {
    const { user, loading: authLoading } = useAuth();
    const hasFetched = useRef(false);
    const [voices, setVoices] = useState<AllowedVoice[]>([]);

    const activeVoice =
        ((effectiveConfiguration?.tts as Record<string, unknown> | undefined)?.voice as string | undefined) ??
        null;

    useEffect(() => {
        if (authLoading || !user || hasFetched.current) return;
        hasFetched.current = true;
        (async () => {
            const res = await getAllowedVoicesApiV1OrganizationsAllowedVoicesGet();
            if (res.data) setVoices(res.data as AllowedVoice[]);
        })();
    }, [authLoading, user]);

    return (
        <div className="w-full max-w-4xl mx-auto space-y-6">
            <div>
                <div className="flex items-center gap-2">
                    <h1 className="text-3xl font-bold">AI Models Configuration</h1>
                    <Badge variant="outline" className="gap-1">
                        <Lock className="h-3 w-3" /> Managed
                    </Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                    Your AI model, transcription, and keys are managed by your platform
                    administrator. You don&apos;t need to configure providers or enter any keys.
                </p>
            </div>

            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base">Voice</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {activeVoice && (
                        <p className="text-sm">
                            Current default voice:{" "}
                            <span className="font-medium">{activeVoice}</span>
                        </p>
                    )}
                    {voices.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            No voices have been enabled for your organization yet. Contact your
                            administrator.
                        </p>
                    ) : (
                        <div className="space-y-2">
                            <p className="text-sm text-muted-foreground">
                                Voices available to your organization — pick one per agent in the
                                agent&apos;s voice settings:
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {voices.map((v) => (
                                    <Badge key={v.id} variant="secondary" className="gap-1">
                                        <Volume2 className="h-3 w-3" />
                                        {v.name}
                                        {v.language && (
                                            <span className="uppercase text-[10px] opacity-70">
                                                {v.language}
                                            </span>
                                        )}
                                    </Badge>
                                ))}
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
