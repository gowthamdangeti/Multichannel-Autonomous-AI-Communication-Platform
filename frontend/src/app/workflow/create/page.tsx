'use client';

import { Loader2, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { getRoleAvatarStyle, getRoleLabel } from '@/app/teams/components/roleStyles';
import {
    createWorkflowFromTemplateApiV1WorkflowCreateTemplatePost,
    getModelConfigurationOptionsApiV1OrganizationsModelConfigurationOptionsGet,
} from '@/client/sdk.gen';
import type { CreateWorkflowTemplateRequest, ModelConfigurationOption } from '@/client/types.gen';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
    AGENT_UTILIZATION_OPTIONS,
    type AgentUtilization,
    agentUtilizationOption,
    DEFAULT_AGENT_UTILIZATION,
} from '@/constants/agentUtilization';
import { type Breadcrumb, PageHeader } from '@/context/HeaderContext';
import { detailFromError } from '@/lib/apiError';
import { useAuth } from '@/lib/auth';
import logger from '@/lib/logger';
import { fetchOrgMembers, type OrgMemberOption } from '@/lib/orgMembers';
import { cn } from '@/lib/utils';

export default function CreateWorkflowPage() {
    const router = useRouter();
    const { user, getAccessToken } = useAuth();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [workflowId, setWorkflowId] = useState<string | null>(null);

    const [callType, setCallType] = useState<'inbound' | 'outbound'>('inbound');
    const [useCase, setUseCase] = useState('');
    const [activityDescription, setActivityDescription] = useState('');
    const [configOptions, setConfigOptions] = useState<ModelConfigurationOption[]>([]);
    const [selectedConfigId, setSelectedConfigId] = useState<string>('');
    const [enableVideoRecording, setEnableVideoRecording] = useState(false);
    const [utilizationType, setUtilizationType] = useState<AgentUtilization>(DEFAULT_AGENT_UTILIZATION);
    const [privateAllowedUserIds, setPrivateAllowedUserIds] = useState<number[]>([]);
    const [grantMembers, setGrantMembers] = useState<OrgMemberOption[]>([]);
    const [grantMembersLoading, setGrantMembersLoading] = useState(false);
    const [grantMembersLoaded, setGrantMembersLoaded] = useState(false);
    const [grantMembersError, setGrantMembersError] = useState<string | null>(null);
    const [grantMemberSearch, setGrantMemberSearch] = useState("");

    useEffect(() => {
        if (!user) return;
        (async () => {
            const accessToken = await getAccessToken();
            const res = await getModelConfigurationOptionsApiV1OrganizationsModelConfigurationOptionsGet({
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (res.data) {
                setConfigOptions(res.data);
                if (res.data.length > 0) setSelectedConfigId(String(res.data[0].id));
            }
        })();
    }, [user, getAccessToken]);

    useEffect(() => {
        if (!user || utilizationType !== "private" || grantMembersLoaded || grantMembersLoading || grantMembersError) return;
        let active = true;
        setGrantMembersLoading(true);
        setGrantMembersError(null);
        void (async () => {
            try {
                const token = await getAccessToken();
                const candidates = await fetchOrgMembers(token);
                if (active) {
                    setGrantMembers(candidates);
                    setGrantMembersLoaded(true);
                }
            } catch (err) {
                if (active) {
                    setGrantMembersError(err instanceof Error ? err.message : "Failed to load grantable members.");
                }
            } finally {
                if (active) setGrantMembersLoading(false);
            }
        })();
        return () => { active = false; };
    }, [user, utilizationType, grantMembersLoaded, grantMembersLoading, grantMembersError, getAccessToken]);

    const currentUserEmail =
        user && "email" in user && typeof user.email === "string" ? user.email.toLowerCase() : null;
    const selectableGrantMembers = useMemo(
        () => grantMembers.filter((member) => !currentUserEmail || member.email?.toLowerCase() !== currentUserEmail),
        [grantMembers, currentUserEmail],
    );
    const visibleGrantMembers = useMemo(() => {
        const term = grantMemberSearch.trim().toLowerCase();
        if (!term) return selectableGrantMembers;
        return selectableGrantMembers.filter(
            (member) => member.name.toLowerCase().includes(term) ||
                Boolean(member.email?.toLowerCase().includes(term)) ||
                Boolean(member.teamName?.toLowerCase().includes(term)),
        );
    }, [selectableGrantMembers, grantMemberSearch]);

    const togglePrivateGrant = (userId: number) => {
        setPrivateAllowedUserIds((previous) =>
            previous.includes(userId) ? previous.filter((id) => id !== userId) : [...previous, userId],
        );
    };

    const handleCreateWorkflow = async () => {
        if (!useCase || !activityDescription) {
            setError('Please fill in all fields');
            return;
        }

        if (!user) {
            setError('You must be logged in to create a workflow');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const accessToken = await getAccessToken();

            // Resolve the platform model configuration to attach to the agent.
            // Re-fetch the active options if the mount-time fetch returned none
            // (e.g. the page loaded before a preset existed), so we never send
            // null when an active preset is available.
            let platformModelConfigurationId: number | null = null;
            if (selectedConfigId) {
                platformModelConfigurationId = Number(selectedConfigId);
            } else {
                const options = await (async () => {
                    if (configOptions.length > 0) return configOptions;
                    const res = await getModelConfigurationOptionsApiV1OrganizationsModelConfigurationOptionsGet({
                        headers: { 'Authorization': `Bearer ${accessToken}` },
                    });
                    return res.data ?? [];
                })();
                if (options.length > 0) {
                    platformModelConfigurationId = options[0].id;
                }
            }

            // `platform_model_configuration_id`, `enable_video_recording` and
            // `utilization_type` are newer than the generated client types, so
            // declare them on the request body explicitly instead of casting.
            const body: CreateWorkflowTemplateRequest & {
                enable_video_recording: boolean;
                utilization_type: AgentUtilization;
                private_allowed_user_ids?: number[];
            } = {
                call_type: callType,
                use_case: useCase,
                activity_description: activityDescription,
                platform_model_configuration_id: platformModelConfigurationId,
                enable_video_recording: enableVideoRecording,
                utilization_type: utilizationType,
                private_allowed_user_ids: utilizationType === "private" ? privateAllowedUserIds : [],
            };

            // Call the API to create workflow from template
            const response = await createWorkflowFromTemplateApiV1WorkflowCreateTemplatePost({
                body,
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
            });

            if (response.error) {
                const msg = detailFromError(response.error, 'Failed to create workflow. Please try again.');
                setError(msg);
                // 402 plan-required: show consistent toast + inline description bottom
                toast.error(msg, {
                    description: msg.includes('purchase a plan') ? 'Visit /billing to subscribe. No free tier.' : undefined,
                    action: msg.includes('purchase a plan') ? { label: 'Go to Billing', onClick: () => router.push('/billing') } : undefined,
                });
                return;
            }

            if (response.data?.id) {
                setWorkflowId(String(response.data.id));
                setShowSuccessModal(true);
            }
        } catch (err) {
            setError('Failed to create workflow. Please try again.');
            logger.error(`Error creating workflow: ${err}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleModalContinue = () => {
        if (!workflowId) return;
        router.push(`/workflow/${workflowId}?onboarding=web_call`);
    };

    const breadcrumbs = useMemo<Breadcrumb[]>(
        () => [
            { label: "Voice agents", href: "/voice/agents" },
            { label: "Create Voice Agent" },
        ],
        [],
    );

    return (
        <div className="flex-1 w-full min-h-0 overflow-y-auto">
            <PageHeader title="Create Voice Agent" breadcrumbs={breadcrumbs} />
            <div className="flex min-h-[calc(100vh-120px)] w-full items-center justify-center p-4 sm:p-6">
                <div className="w-full max-w-2xl my-auto">
                    <Card>
                    <CardHeader className="px-4 py-4 sm:px-6">
                        <CardTitle className="text-lg">Agent Details</CardTitle>
                        <CardDescription className="text-xs">
                            Configure your voice agent settings
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 px-4 pb-5 pt-0 sm:px-6">
                        <div className="space-y-1.5">
                            <Label htmlFor="call-type" className="text-sm">Call Type</Label>
                            <Select value={callType} onValueChange={(value) => setCallType(value as 'inbound' | 'outbound')}>
                                <SelectTrigger id="call-type" className="h-9">
                                    <SelectValue placeholder="Select type" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="inbound">
                                        Inbound (Users call AI)
                                    </SelectItem>
                                    <SelectItem value="outbound">
                                        Outbound (AI calls users)
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground mt-1">
                                Choose whether users will call your AI or your AI will call users
                            </p>
                        </div>

                        {configOptions.length > 0 && (
                            <div className="space-y-1.5">
                                <Label htmlFor="model-config" className="text-sm">Configuration</Label>
                                <Select value={selectedConfigId} onValueChange={setSelectedConfigId}>
                                    <SelectTrigger id="model-config" className="h-9">
                                        <SelectValue placeholder="Select a configuration" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {configOptions.map((opt) => (
                                            <SelectItem key={opt.id} value={String(opt.id)}>
                                                {opt.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Choose the voice &amp; language configuration for this agent
                                </p>
                            </div>
                        )}

                        <div className="space-y-1.5">
                            <Label htmlFor="use-case" className="text-sm">Use Case</Label>
                            <Input
                                id="use-case"
                                placeholder="e.g., Lead Qualification, HR Screening, Customer Support"
                                value={useCase}
                                onChange={(e) => setUseCase(e.target.value)}
                                className="h-9"
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                Describe the primary purpose of your voice agent
                            </p>
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="activity-description" className="text-sm">Agent Instructions &amp; Context</Label>
                            <Textarea
                                id="activity-description"
                                minRows={3}
                                maxRows={6}
                                placeholder={'Describe what the agent should do and include call context such as "Contact name: {{contact_name}}".'}
                                value={activityDescription}
                                onChange={(e) => setActivityDescription(e.target.value)}
                                className="font-mono text-sm"
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                AI uses this description to generate the workflow and Global Node prompt. Plain {`{{variable_name}}`} placeholders are preserved and automatically added to Template Variables.
                            </p>
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="agent-utilisation" className="text-sm">Agent Utilisation</Label>
                            <Select
                                value={utilizationType}
                                onValueChange={(value) => setUtilizationType(value as AgentUtilization)}
                            >
                                <SelectTrigger id="agent-utilisation" className="h-9">
                                    <SelectValue placeholder="Select utilisation" />
                                </SelectTrigger>
                                <SelectContent>
                                    {AGENT_UTILIZATION_OPTIONS.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground mt-1">
                                {agentUtilizationOption(utilizationType).description}
                            </p>
                            {utilizationType === "private" && (
                                <div className="mt-4 space-y-2 rounded-xl border border-border bg-muted/10 p-4">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <Label className="text-sm font-medium">Grant access to members</Label>
                                        <Badge variant="secondary" className="text-[11px]">
                                            {privateAllowedUserIds.length} selected
                                        </Badge>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        You are the creator and always have access. Select additional organization members.
                                    </p>
                                    <div className="relative max-w-sm">
                                        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                                        <Input
                                            value={grantMemberSearch}
                                            onChange={(event) => setGrantMemberSearch(event.target.value)}
                                            placeholder="Search members by name, email or team…"
                                            aria-label="Search private agent grant members"
                                            className="h-9 pl-10 text-xs"
                                        />
                                    </div>
                                    {grantMembersLoading && (
                                        <p className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <Loader2 className="size-3.5 animate-spin" /> Loading organization members…
                                        </p>
                                    )}
                                    {grantMembersError && (
                                        <div className="flex flex-wrap items-center gap-2 text-xs text-destructive">
                                            <span>{grantMembersError} You can still create a creator-only Private agent.</span>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => { setGrantMembersLoaded(false); setGrantMembersError(null); }}
                                            >
                                                Retry
                                            </Button>
                                        </div>
                                    )}
                                    {!grantMembersLoading && !grantMembersError && (
                                        <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border bg-card p-2">
                                            {visibleGrantMembers.map((member) => (
                                                <div key={member.userId} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/30">
                                                    <Checkbox
                                                        checked={privateAllowedUserIds.includes(member.userId)}
                                                        onCheckedChange={() => togglePrivateGrant(member.userId)}
                                                        aria-label={`Grant access to ${member.name}`}
                                                    />
                                                    <span className={cn("grid size-8 shrink-0 place-items-center rounded-full border text-[11px] font-semibold", getRoleAvatarStyle(member.role))}>
                                                        {member.name.slice(0, 2).toUpperCase()}
                                                    </span>
                                                    <span className="min-w-0 flex-1">
                                                        <span className="flex items-center gap-2">
                                                            <span className="truncate text-xs font-semibold text-foreground">{member.name}</span>
                                                            <Badge variant="secondary" className="py-0 text-[10px]">{getRoleLabel(member.role)}</Badge>
                                                            {member.teamName && <Badge variant="outline" className="py-0 text-[10px]">{member.teamName}</Badge>}
                                                        </span>
                                                        <span className="block truncate text-[11px] text-muted-foreground">{member.email ?? "no email"}</span>
                                                    </span>
                                                </div>
                                            ))}
                                            {visibleGrantMembers.length === 0 && (
                                                <p className="px-3 py-2 text-xs text-muted-foreground">No members match.</p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                            <div className="space-y-0.5">
                                <Label htmlFor="enable-video-recording-create" className="text-sm cursor-pointer">
                                    Record video during test calls
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                    When on, the Test Agent captures camera video (with the call audio) for WebRTC test runs.
                                </p>
                            </div>
                            <Switch
                                id="enable-video-recording-create"
                                checked={enableVideoRecording}
                                onCheckedChange={setEnableVideoRecording}
                            />
                        </div>

                        {error && (
                            <p className="text-xs text-red-500">{error}</p>
                        )}

                        <div className="pt-2">
                            <Button
                                onClick={handleCreateWorkflow}
                                disabled={isLoading || !useCase || !activityDescription}
                                className="w-full h-9"
                            >
                                {isLoading ? 'Creating...' : 'Create Agent'}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>

            {/* Loading Overlay */}
            {isLoading && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
                    <div className="w-[500px] rounded-xl border border-border bg-card p-6 shadow-2xl">
                        <div className="flex flex-col items-center space-y-6">
                            {/* Animated spinner */}
                            <div className="relative">
                                <div className="w-16 h-16 border-4 border-muted rounded-full"></div>
                                <div className="absolute top-0 left-0 w-16 h-16 border-4 border-transparent border-t-primary rounded-full animate-spin"></div>
                            </div>

                            <div className="text-center space-y-2">
                                <h3 className="text-lg font-semibold">
                                    Creating Your Workflow
                                </h3>
                                <p className="text-sm text-muted-foreground max-w-xs">
                                    We&apos;re setting up your voice agent with your specifications. This will just take a moment...
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Success Modal */}
            <Dialog open={showSuccessModal} onOpenChange={setShowSuccessModal}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Workflow Created Successfully!
                        </DialogTitle>
                        <DialogDescription asChild>
                            <div className="mt-4 space-y-3">
                                <p>
                                    A voice agent workflow has been generated for your use case, with some artificial data and sample actions.
                                </p>
                                <p>
                                    The voice bot is pre-set to communicate in English with an American accent.
                                </p>
                                <p>
                                    Next steps would be to test the voice bot in the editor, and then modify it to suit your use case.
                                </p>
                            </div>
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="mt-6">
                        <Button
                            onClick={handleModalContinue}
                            className="w-full"
                        >
                            Open and Test Agent
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
