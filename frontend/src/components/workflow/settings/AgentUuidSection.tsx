"use client";


import { Clipboard, Fingerprint } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";


// ---------------------------------------------------------------------------
// Section: Agent UUID
// ---------------------------------------------------------------------------

export function AgentUuidSection({ workflowUuid }: { workflowUuid: string }) {
    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(workflowUuid);
            toast.success("Agent UUID copied");
        } catch {
            toast.error("Failed to copy Agent UUID");
        }
    };

    return (
        <Card id="identity">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                    <Fingerprint className="h-4 w-4" />
                    Agent UUID
                </CardTitle>
                <CardDescription>
                    Stable identifier for this agent. Used in agent-stream URLs and
                    other integrations where a numeric workflow ID isn&apos;t portable.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <button
                    type="button"
                    onClick={handleCopy}
                    title="Click to copy"
                    className="group flex w-full items-center gap-2 rounded-md border bg-muted/20 p-2 text-left font-mono text-xs transition-colors hover:bg-muted/40"
                >
                    <code className="flex-1 truncate">{workflowUuid}</code>
                    <Clipboard className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
                </button>
            </CardContent>
            <CardFooter className="justify-end border-t pt-6">
                <Button variant="outline" size="sm" onClick={handleCopy}>
                    <Clipboard className="h-3.5 w-3.5 mr-2" />
                    Copy UUID
                </Button>
            </CardFooter>
        </Card>
    );
}
