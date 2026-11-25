"use client";

import { ExternalLink, Mic, Rocket } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { SETTINGS_DOCUMENTATION_URLS } from "@/constants/documentation";

function LearnMore({ href }: { href: string }) {
    return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline">
            Learn more <ExternalLink className="h-3 w-3" />
        </a>
    );
}

/** Recordings live at the organization level; this card links there. */
export function RecordingsCard() {
    return (
        <Card id="recordings">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                    <Mic className="h-4 w-4" />
                    Recordings
                </CardTitle>
                <CardDescription>
                    Recordings are now managed at the organization level and shared across all agents.
                    Use <code className="rounded bg-muted px-1 text-xs">@</code> in prompt fields to insert them.{" "}
                    <LearnMore href={SETTINGS_DOCUMENTATION_URLS.recordings} />
                </CardDescription>
            </CardHeader>
            <CardFooter className="justify-end border-t pt-6">
                <Button variant="outline" asChild>
                    <Link href="/recordings">
                        Go to Recordings
                        <ExternalLink className="ml-2 h-4 w-4" />
                    </Link>
                </Button>
            </CardFooter>
        </Card>
    );
}

/** Opens the website widget (embed) configuration dialog. */
export function DeploymentCard({ onConfigure }: { onConfigure: () => void }) {
    return (
        <Card id="deployment">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                    <Rocket className="h-4 w-4" />
                    Add to Website
                </CardTitle>
                <CardDescription>
                    Configure a widget to add this voice agent to your website.{" "}
                    <LearnMore href={SETTINGS_DOCUMENTATION_URLS.deployment} />
                </CardDescription>
            </CardHeader>
            <CardFooter className="justify-end border-t pt-6">
                <Button variant="outline" onClick={onConfigure}>
                    Configure Widget
                </Button>
            </CardFooter>
        </Card>
    );
}
