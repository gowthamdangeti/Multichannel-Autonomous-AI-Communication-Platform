'use client';

import {
    Bot,
    Check,
    Copy,
    Download,
    MessageSquare,
    Search,
    User,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import type { RealtimeFeedbackEvent, WorkflowRunResponse } from './types';

interface TranscriptMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    text: string;
    timestamp?: string;
    turn?: number;
}

export interface ConversationTranscriptTabProps {
    workflowRun: WorkflowRunResponse | null | undefined;
    agentName?: string;
}

export function ConversationTranscriptTab({
    workflowRun,
    agentName = 'Assistant',
}: ConversationTranscriptTabProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [copiedAll, setCopiedAll] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    // Extract structured messages from events or fallback to transcript url / gathered context
    const messages = useMemo<TranscriptMessage[]>(() => {
        const events = (workflowRun?.logs?.realtime_feedback_events ?? []) as RealtimeFeedbackEvent[];
        const result: TranscriptMessage[] = [];

        events.forEach((ev, idx) => {
            if (ev.type === 'rtf-user-transcription' && ev.payload?.text) {
                result.push({
                    id: `user-${ev.turn ?? idx}-${idx}`,
                    role: 'user',
                    text: ev.payload.text,
                    timestamp: ev.timestamp,
                    turn: ev.turn,
                });
            } else if (ev.type === 'rtf-bot-text' && ev.payload?.text) {
                // If consecutive bot text in same turn, combine or append
                const last = result[result.length - 1];
                if (last && last.role === 'assistant' && last.turn === ev.turn) {
                    last.text += ' ' + ev.payload.text;
                } else {
                    result.push({
                        id: `bot-${ev.turn ?? idx}-${idx}`,
                        role: 'assistant',
                        text: ev.payload.text,
                        timestamp: ev.timestamp,
                        turn: ev.turn,
                    });
                }
            }
        });

        // Fallback: if no feedback events, check gathered context or notes
        if (result.length === 0 && workflowRun?.gathered_context?.user_notes) {
            result.push({
                id: '1',
                role: 'user',
                text: String(workflowRun.gathered_context.user_notes),
            });
        }

        return result;
    }, [workflowRun]);

    const filteredMessages = useMemo(() => {
        if (!searchQuery.trim()) return messages;
        const q = searchQuery.toLowerCase();
        return messages.filter((m) => m.text.toLowerCase().includes(q));
    }, [messages, searchQuery]);

    const handleCopyAll = () => {
        if (messages.length === 0) return;
        const fullText = messages
            .map((m) => `[${m.role.toUpperCase()}] ${m.text}`)
            .join('\n\n');
        navigator.clipboard.writeText(fullText);
        setCopiedAll(true);
        toast.success('Full transcript copied to clipboard');
        setTimeout(() => setCopiedAll(false), 2000);
    };

    const handleCopySingle = (id: string, text: string) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        toast.success('Message copied');
        setTimeout(() => setCopiedId(null), 2000);
    };

    const handleDownloadAll = () => {
        if (messages.length === 0) return;
        const fullText = messages
            .map((m) => `[${m.role === 'user' ? 'User' : agentName}]: ${m.text}`)
            .join('\n\n');
        const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `transcript-${workflowRun?.id || 'call'}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success('Transcript downloaded');
    };

    return (
        <Card className="border-border/70 bg-card/60 backdrop-blur-sm shadow-sm overflow-hidden">
            <CardHeader className="p-4 border-b border-border/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-primary" />
                    <div>
                        <CardTitle className="text-sm font-bold text-foreground">
                            Call Transcript
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">
                            {messages.length} utterances captured across session
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* Search */}
                    <div className="relative w-48 sm:w-64">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                            placeholder="Filter transcript..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="h-8 pl-8 text-xs bg-muted/40 border-border/60"
                        />
                    </div>

                    {/* Download */}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDownloadAll}
                        disabled={messages.length === 0}
                        className="h-8 gap-1.5 text-xs"
                    >
                        <Download className="h-3.5 w-3.5" />
                        <span>Download</span>
                    </Button>

                    {/* Copy All */}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCopyAll}
                        disabled={messages.length === 0}
                        className="h-8 gap-1.5 text-xs"
                    >
                        {copiedAll ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                        {copiedAll ? 'Copied' : 'Copy All'}
                    </Button>
                </div>
            </CardHeader>

            <CardContent className="p-4 sm:p-6 space-y-4 max-h-[680px] overflow-y-auto">
                {filteredMessages.length === 0 ? (
                    <div className="py-12 text-center text-sm text-muted-foreground">
                        {messages.length === 0
                            ? 'No realtime transcript utterances available for this conversation.'
                            : 'No messages match your search query.'}
                    </div>
                ) : (
                    filteredMessages.map((msg, idx) => {
                        const isUser = msg.role === 'user';
                        return (
                            <div
                                key={msg.id || idx}
                                className={cn(
                                    'flex gap-3 max-w-3xl group',
                                    isUser ? 'ml-auto flex-row-reverse' : 'mr-auto'
                                )}
                            >
                                {/* Avatar */}
                                <div
                                    className={cn(
                                        'h-8 w-8 rounded-full flex items-center justify-center shrink-0 border text-xs font-semibold shadow-xs',
                                        isUser
                                            ? 'bg-sky-500/10 border-sky-500/30 text-sky-400'
                                            : 'bg-primary/10 border-primary/30 text-primary'
                                    )}
                                >
                                    {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                                </div>

                                {/* Bubble */}
                                <div className="space-y-1 min-w-0">
                                    <div className={cn('flex items-center gap-2 text-[10px] text-muted-foreground', isUser && 'justify-end')}>
                                        <span className="font-semibold text-foreground/80">
                                            {isUser ? 'User' : agentName}
                                        </span>
                                        {msg.turn !== undefined && (
                                            <span className="font-mono text-neutral-400">Turn {msg.turn}</span>
                                        )}
                                        {msg.timestamp && (
                                            <span className="text-muted-foreground/60">
                                                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                            </span>
                                        )}
                                    </div>

                                    <div
                                        className={cn(
                                            'rounded-xl px-4 py-2.5 text-xs leading-relaxed relative border shadow-xs',
                                            isUser
                                                ? 'bg-sky-500/10 border-sky-500/20 text-foreground'
                                                : 'bg-muted/40 border-border/60 text-foreground'
                                        )}
                                    >
                                        <p className="whitespace-pre-wrap">{msg.text}</p>

                                        <button
                                            type="button"
                                            onClick={() => handleCopySingle(msg.id, msg.text)}
                                            className="absolute right-2 bottom-1.5 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                                            title="Copy message"
                                        >
                                            {copiedId === msg.id ? (
                                                <Check className="h-3 w-3 text-emerald-400" />
                                            ) : (
                                                <Copy className="h-3 w-3" />
                                            )}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </CardContent>
        </Card>
    );
}
