"use client";

import { AlertCircle, Bot, CreditCard, Loader2, MessageSquareText, Mic, Phone, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { createWorkflowRunApiV1WorkflowWorkflowIdRunsPost } from "@/client/sdk.gen";
import { OnboardingTooltip } from "@/components/onboarding/OnboardingTooltip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PostHogEvent } from "@/constants/posthog-events";
import { WORKFLOW_RUN_MODES } from "@/constants/workflowRunModes";
import { useOnboarding } from "@/context/OnboardingContext";
import { useAuth } from "@/lib/auth";
import { cn, getRandomId } from "@/lib/utils";

import { AiSimulatorPlaceholder } from "./workflow-tester/AiSimulatorPlaceholder";
import { EmbeddedVoiceTester } from "./workflow-tester/EmbeddedVoiceTester";
import { ManualTextChatPanel } from "./workflow-tester/ManualTextChatPanel";
import { ChatModeToggle, DisabledNotice, EmptyState } from "./workflow-tester/shared";
import type { WorkflowRuntimeNodeTransition } from "./workflow-tester/types";
import { extractSdkErrorMessage, getErrorMessage } from "./workflow-tester/utils";

interface WorkflowTesterPanelProps {
    workflowId: number;
    initialContextVariables?: Record<string, string>;
    disabled: boolean;
    disabledReason: string | null;
    showWebCallOnboarding?: boolean;
    isVisible?: boolean;
    className?: string;
    enableVideoRecording?: boolean;
    onClose?: () => void;
    onRuntimeNodeTransition?: (transition: WorkflowRuntimeNodeTransition) => void;
    onCallActiveChange?: (active: boolean) => void;
    onTextChatActiveChange?: (active: boolean) => void;
    onStopCallRef?: React.MutableRefObject<(() => void) | null>;
}

export function WorkflowTesterPanel({
    workflowId,
    initialContextVariables,
    disabled,
    disabledReason,
    showWebCallOnboarding = false,
    isVisible = true,
    className,
    enableVideoRecording = false,
    onRuntimeNodeTransition,
    onCallActiveChange,
    onTextChatActiveChange,
    onStopCallRef,
}: WorkflowTesterPanelProps) {
    const auth = useAuth();
    const router = useRouter();
    const { hasSeenTooltip, markTooltipSeen, markActionCompleted } = useOnboarding();
    const { isAuthenticated, loading: authLoading, getAccessToken } = auth;
    const [accessToken, setAccessToken] = useState<string | null>(null);
    const [activeMode, setActiveMode] = useState<"audio" | "text">("audio");
    const [chatMode, setChatMode] = useState<"manual" | "simulated">("manual");
    const [chatSessionKey, setChatSessionKey] = useState(0);
    const [chatActive, setChatActive] = useState(false);
    const [voiceRunId, setVoiceRunId] = useState<number | null>(null);
    const [creatingVoiceRun, setCreatingVoiceRun] = useState(false);
    const [tokenReady, setTokenReady] = useState(false);
    const [billingDialogOpen, setBillingDialogOpen] = useState(false);
    const [billingErrorMsg, setBillingErrorMsg] = useState<string | null>(null);
    const runTestButtonRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        onTextChatActiveChange?.(chatActive);
    }, [chatActive, onTextChatActiveChange]);

    useEffect(() => {
        let ignore = false;

        const hydrateAccessToken = async () => {
            if (!isAuthenticated || authLoading) return;
            try {
                const token = await getAccessToken();
                if (!ignore) {
                    setAccessToken(token);
                }
            } catch (error) {
                if (!ignore) {
                    toast.error(getErrorMessage(error));
                }
            } finally {
                if (!ignore) {
                    setTokenReady(true);
                }
            }
        };

        if (authLoading) {
            return;
        }

        if (!isAuthenticated) {
            setTokenReady(true);
            return;
        }

        hydrateAccessToken();

        return () => {
            ignore = true;
        };
    }, [authLoading, getAccessToken, isAuthenticated]);

    const createVoiceRun = useCallback(async () => {
        if (!accessToken || disabled) return;
        setCreatingVoiceRun(true);
        try {
            const response = await createWorkflowRunApiV1WorkflowWorkflowIdRunsPost({
                path: { workflow_id: workflowId },
                body: {
                    mode: WORKFLOW_RUN_MODES.SMALL_WEBRTC,
                    name: `WR-${getRandomId()}`,
                },
            });

            if (response.error || !response.data?.id) {
                const msg = extractSdkErrorMessage(response.error, "Failed to create browser test run");
                // Prod will pause — show Insufficient credits dialog until Billing > Add Credits
                const raw = response.error as unknown as { detail?: unknown; message?: unknown; code?: unknown; error_type?: unknown };
                const detail = (raw?.detail ?? {}) as { message?: string; code?: string; error_type?: string };
                const code = detail.code ?? detail.error_type ?? (raw as { code?: string })?.code ?? "";
                const lower = `${msg} ${code} ${detail.message ?? ""}`.toLowerCase();
                if (lower.includes("insufficient_credits") || lower.includes("insufficient credits") || (response as { response?: { status?: number } }).response?.status === 402) {
                    setBillingErrorMsg(msg.includes("insufficient") ? msg : "Insufficient credits: Wallet $0.00. Please add credits in Billing > Add Credits to resume.");
                    setBillingDialogOpen(true);
                    throw new Error(msg);
                }
                throw new Error(msg);
            }

            markActionCompleted("web_call_started");
            markTooltipSeen("web_call");
            posthog.capture(PostHogEvent.WEB_CALL_INITIATED, {
                workflow_id: workflowId,
                workflow_run_id: response.data.id,
                source: "workflow_editor",
            });
            setVoiceRunId(response.data.id);
            setActiveMode("audio");
        } catch (error) {
            const msg = getErrorMessage(error);
            if (!billingDialogOpen && msg.toLowerCase().includes("insufficient")) {
                // already handled via dialog
            } else {
                toast.error(msg);
            }
        } finally {
            setCreatingVoiceRun(false);
        }
    }, [accessToken, billingDialogOpen, disabled, markActionCompleted, markTooltipSeen, workflowId]);

    const authUnavailableReason = tokenReady && !accessToken
        ? "Authentication is required before testing can start."
        : null;
    const effectiveDisabledReason = disabledReason ?? authUnavailableReason;
    const testerBlocked = disabled || authUnavailableReason !== null;
    const showRunTestTooltip =
        showWebCallOnboarding &&
        isVisible &&
        activeMode === "audio" &&
        !voiceRunId &&
        tokenReady &&
        !!accessToken &&
        !testerBlocked &&
        !hasSeenTooltip("web_call");

    return (
        <div className={cn("flex h-full min-h-0 flex-col", className)}>
            <Tabs
                value={activeMode}
                onValueChange={(value) => setActiveMode(value as "audio" | "text")}
                className="min-h-0 flex-1 gap-0"
            >
                <div className="border-b border-border/70 px-4 py-3">
                    {/* Same Bot icon as the editor's "Test Agent" button that opens this drawer. */}
                    <div className="flex items-center gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
                            <Bot className="size-4 text-foreground" aria-hidden />
                        </span>
                        <div className="min-w-0">
                            <h2 className="text-base font-semibold">Test Agent</h2>
                            <p className="text-xs text-muted-foreground mt-0.5">Test your agent with a voice call or text chat</p>
                        </div>
                    </div>
                </div>
                <div className="border-b border-border/70 px-4 py-2.5">
                    <TabsList className="grid h-9 w-full grid-cols-2 rounded-lg bg-muted/60 p-1 border border-border">
                        <TabsTrigger value="audio" className="rounded-md text-sm">
                            <Mic className="h-4 w-4" />
                            Test Audio
                        </TabsTrigger>
                        <TabsTrigger value="text" className="rounded-md text-sm">
                            <MessageSquareText className="h-4 w-4" />
                            Test Chat
                        </TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="audio" className="min-h-0 flex-1 px-4 py-4">
                    <div className="flex h-full min-h-0 flex-col gap-3">
                        {!tokenReady ? (
                            <div className="space-y-4">
                                <Skeleton className="h-14 rounded-xl" />
                                <Skeleton className="h-80 rounded-xl" />
                            </div>
                        ) : !accessToken ? (
                            <DisabledNotice
                                reason={authUnavailableReason ?? "Authentication is required before browser tests can start."}
                            />
                        ) : voiceRunId ? (
                            <EmbeddedVoiceTester
                                workflowId={workflowId}
                                workflowRunId={voiceRunId}
                                initialContextVariables={initialContextVariables}
                                accessToken={accessToken}
                                enableVideo={enableVideoRecording}
                                onReset={() => setVoiceRunId(null)}
                                onNodeTransition={onRuntimeNodeTransition}
                                onCallActiveChange={onCallActiveChange}
                                onStopRef={onStopCallRef}
                            />
                        ) : (
                            <>
                                {effectiveDisabledReason ? <DisabledNotice reason={effectiveDisabledReason} /> : null}
                                <EmptyState
                                    icon={<Phone className="h-7 w-7" />}
                                    title="Call this agent in the browser"
                                    description="Test the agent over a voice call. Some telephony-only tools, like call transfer, are not yet supported here."
                                    action={
                                        <Button
                                            ref={runTestButtonRef}
                                            onClick={createVoiceRun}
                                            disabled={creatingVoiceRun || testerBlocked}
                                        >
                                            {creatingVoiceRun ? (
                                                <>
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                    Starting test...
                                                </>
                                            ) : (
                                                <>
                                                    <Phone className="h-4 w-4" />
                                                    Run Test
                                                </>
                                            )}
                                        </Button>
                                    }
                                />
                            </>
                        )}
                    </div>
                </TabsContent>

                <TabsContent value="text" className="min-h-0 flex-1 px-4 py-3">
                    <div className="flex h-full min-h-0 flex-col gap-3">
                        <div className="flex items-center justify-between gap-2">
                            <ChatModeToggle value={chatMode} onChange={setChatMode} />
                            {chatMode === "manual" && chatActive ? (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setChatSessionKey((value) => value + 1)}
                                    disabled={testerBlocked}
                                    className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                                >
                                    <RefreshCw className="h-3.5 w-3.5" />
                                    Reset
                                </Button>
                            ) : null}
                        </div>

                        {chatMode === "manual" ? (
                            <ManualTextChatPanel
                                key={chatSessionKey}
                                workflowId={workflowId}
                                ready={tokenReady && !!accessToken}
                                initialContextVariables={initialContextVariables}
                                disabled={testerBlocked}
                                disabledReason={effectiveDisabledReason}
                                onActiveChange={setChatActive}
                                onNodeTransition={onRuntimeNodeTransition}
                            />
                        ) : (
                            <AiSimulatorPlaceholder disabledReason={effectiveDisabledReason} />
                        )}
                    </div>
                </TabsContent>
            </Tabs>

            <OnboardingTooltip
                targetRef={runTestButtonRef}
                title="Try Your First Web Call"
                message="Start a browser call here to hear the agent, inspect the transcript, and validate the workflow before you customize it further."
                onDismiss={() => markTooltipSeen("web_call")}
                showNext={false}
                isVisible={showRunTestTooltip}
            />
            <Dialog open={billingDialogOpen} onOpenChange={setBillingDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
                            <CreditCard className="h-5 w-5 text-amber-500" />
                            Insufficient Credits
                        </DialogTitle>
                        <DialogDescription className="text-sm pt-1 text-muted-foreground">
                            Your organization wallet requires additional credits to proceed with voice testing and agent calls.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="py-2">
                        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3.5 flex items-start gap-3">
                            <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                            <div className="space-y-1">
                                <p className="font-semibold text-sm text-foreground">Wallet Balance Depleted</p>
                                <p className="text-xs text-muted-foreground leading-relaxed">
                                    {billingErrorMsg ?? "Wallet $0.00 — Auto-pause active. Please add credits in Billing > Add Credits to resume."}
                                </p>
                            </div>
                        </div>
                    </div>

                    <DialogFooter className="gap-3 sm:gap-3">
                        <Button variant="outline" onClick={() => setBillingDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button className="gap-1.5" onClick={() => router.push("/billing")}>
                            <CreditCard className="h-4 w-4" />
                            Go to Billing
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
