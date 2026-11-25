'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

import { truncateClientReferenceId } from './providerUsage';

const COPIED_RESET_MS = 2000;

/** The ID that finds all of a run's requests in the provider's usage logs. */
export function ClientReferenceId({ referenceId }: { referenceId: string }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(referenceId);
            setCopied(true);
            setTimeout(() => setCopied(false), COPIED_RESET_MS);
        } catch {
            toast.error('Could not copy the client reference ID');
        }
    };

    return (
        <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground" title={referenceId}>
            <span className="truncate">{truncateClientReferenceId(referenceId)}</span>
            <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0"
                onClick={handleCopy}
                aria-label="Copy client reference ID"
            >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </Button>
        </div>
    );
}
