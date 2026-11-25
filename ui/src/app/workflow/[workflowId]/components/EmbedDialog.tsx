import {
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    Check,
    Code2,
    Copy,
    ExternalLink,
    Globe,
    Layers,
    Loader2,
    Lock,
    Mic,
    Plus,
    Terminal,
    Trash2,
    UserRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
    createOrUpdateEmbedTokenApiV1WorkflowWorkflowIdEmbedTokenPost,
    deactivateEmbedTokenApiV1WorkflowWorkflowIdEmbedTokenDelete,
    getEmbedTokenApiV1WorkflowWorkflowIdEmbedTokenGet,
} from "@/client/sdk.gen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Sheet,
    SheetBody,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { WIDGET_MODE_DOCUMENTATION_URLS } from "@/constants/documentation";
import { detailFromError } from "@/lib/apiError";
import { cn } from "@/lib/utils";

interface EmbedDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    workflowId: number;
    workflowName: string;
    templateContextVariables?: Record<string, unknown>;
}

type PreCallFieldType = "text" | "textarea" | "number" | "select" | "checkbox";

interface PreCallFormFieldPreview {
    name: string;
    label: string;
    type: PreCallFieldType;
    required: boolean;
    editable: boolean;
    has_value: boolean;
    placeholder: string | null;
    value: unknown;
    max_length: number | null;
    options: string[] | null;
}

interface PreCallFormPreview {
    enabled: boolean;
    title: string;
    description: string | null;
    submit_label: string;
    always_show: boolean;
    show_locked_fields: boolean;
    allow_extra_context: boolean;
    fields: PreCallFormFieldPreview[];
}

interface PreCallFieldConfig {
    label: string;
    type: PreCallFieldType;
    required: boolean;
    hasValue: boolean;
    placeholder: string;
    optionsText: string;
    order: number;
}

interface EmbedToken {
    id: number;
    token: string;
    allowed_domains: string[] | null;
    settings: Record<string, unknown> | null;
    is_active: boolean;
    usage_count: number;
    usage_limit: number | null;
    expires_at: string | null;
    created_at: string;
    embed_script: string;
    pre_call_form_preview?: PreCallFormPreview | null;
    has_unpublished_variable_changes?: boolean;
}

function humanizeVariableName(name: string): string {
    return (
        name
            .replace(/_/g, " ")
            .trim()
            .replace(/\b\w/g, (char) => char.toUpperCase()) || name
    );
}

function hasVariableValue(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
    return true;
}

function inferPreCallFieldType(value: unknown): PreCallFieldType {
    if (typeof value === "boolean") return "checkbox";
    if (typeof value === "number") return "number";
    return "text";
}

function parseOptionsText(value: string): string[] {
    return value
        .split(",")
        .map((option) => option.trim())
        .filter(Boolean);
}

/** Surface of every card in the drawer: identical to ToolDetailsDrawer, Org drawer, and ConfigFormDialog. */
const DRAWER_CARD = "rounded-lg border border-border bg-card p-4 shadow-xs";

function DetailSection({
    title,
    description,
    action,
    children,
}: {
    title: string;
    description?: string;
    action?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <section className={`${DRAWER_CARD} space-y-4`}>
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h4 className="text-sm font-semibold text-foreground">{title}</h4>
                    {description && <p className="text-xs text-muted-foreground">{description}</p>}
                </div>
                {action}
            </div>
            {children}
        </section>
    );
}

export type EmbedDrawerTab = "style" | "domains" | "precall" | "code";

const EMBED_DRAWER_TABS: { value: EmbedDrawerTab; label: string }[] = [
    { value: "style", label: "Widget & Style" },
    { value: "domains", label: "Allowed Domains" },
    { value: "precall", label: "Pre-Call Form" },
    { value: "code", label: "Embed & Code" },
];

const SECTIONS: EmbedDrawerTab[] = ["style", "domains", "precall", "code"];

export function EmbedDialog({
    open,
    onOpenChange,
    workflowId,
    workflowName,
    templateContextVariables = {},
}: EmbedDialogProps) {
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [embedToken, setEmbedToken] = useState<EmbedToken | null>(null);
    const [copied, setCopied] = useState(false);
    const [activeSection, setActiveSection] = useState<EmbedDrawerTab>("style");

    const handleNext = () => {
        const idx = SECTIONS.indexOf(activeSection);
        if (idx < SECTIONS.length - 1) {
            setActiveSection(SECTIONS[idx + 1]);
        }
    };

    const handlePrev = () => {
        const idx = SECTIONS.indexOf(activeSection);
        if (idx > 0) {
            setActiveSection(SECTIONS[idx - 1]);
        }
    };

    // Form state
    const [isEnabled, setIsEnabled] = useState(false);
    const [domains, setDomains] = useState<string[]>([]);
    const [newDomain, setNewDomain] = useState("");
    const [embedMode, setEmbedMode] = useState<"floating" | "inline" | "headless">("floating");
    const [position, setPosition] = useState("bottom-right");
    const [buttonText, setButtonText] = useState("Talk to Agent");
    const [buttonColor, setButtonColor] = useState("#10b981");
    const [callToActionText, setCallToActionText] = useState("Click to start voice conversation");

    // Pre-call form state
    const [preCallEnabled, setPreCallEnabled] = useState(false);
    const [preCallTitle, setPreCallTitle] = useState("Before we start");
    const [preCallDescription, setPreCallDescription] = useState("");
    const [preCallSubmitLabel, setPreCallSubmitLabel] = useState("Start call");
    const [preCallAlwaysShow, setPreCallAlwaysShow] = useState(false);
    const [preCallShowLocked, setPreCallShowLocked] = useState(true);
    const [preCallAllowExtra, setPreCallAllowExtra] = useState(false);
    const [preCallFields, setPreCallFields] = useState<Record<string, PreCallFieldConfig>>({});

    // Dirty state tracking: button is initially inactive until user makes any change
    const [isInitialized, setIsInitialized] = useState(false);
    const savedSnapshotRef = useRef<string | null>(null);

    const currentSnapshot = useMemo(() => {
        return JSON.stringify({
            isEnabled,
            embedMode,
            position,
            buttonText,
            buttonColor,
            callToActionText,
            domains: [...domains].sort(),
            preCallEnabled,
            preCallTitle,
            preCallDescription,
            preCallSubmitLabel,
            preCallAlwaysShow,
            preCallShowLocked,
            preCallAllowExtra,
            preCallFields,
        });
    }, [
        isEnabled,
        embedMode,
        position,
        buttonText,
        buttonColor,
        callToActionText,
        domains,
        preCallEnabled,
        preCallTitle,
        preCallDescription,
        preCallSubmitLabel,
        preCallAlwaysShow,
        preCallShowLocked,
        preCallAllowExtra,
        preCallFields,
    ]);

    useEffect(() => {
        if (!loading && open && !isInitialized) {
            savedSnapshotRef.current = currentSnapshot;
            setIsInitialized(true);
        }
    }, [loading, open, isInitialized, currentSnapshot]);

    useEffect(() => {
        if (!open) {
            setIsInitialized(false);
            savedSnapshotRef.current = null;
        }
    }, [open]);

    const isDirty = Boolean(
        isInitialized &&
        savedSnapshotRef.current !== null &&
        savedSnapshotRef.current !== currentSnapshot
    );

    const applyPreCallSettings = useCallback(
        (
            token: Pick<
                EmbedToken,
                "settings" | "pre_call_form_preview" | "has_unpublished_variable_changes"
            >,
        ) => {
            const preview = token.pre_call_form_preview;
            const settingsForm = (token.settings as { preCallForm?: Record<string, unknown> } | null)
                ?.preCallForm;
            const savedFields =
                (settingsForm?.fields as Record<string, Record<string, unknown>> | undefined) || {};
            const previewFields = preview?.fields || [];
            const previewByName = new Map(previewFields.map((field) => [field.name, field]));

            const names = Array.from(
                new Set([
                    ...Object.keys(templateContextVariables || {}),
                    ...previewFields.map((field) => field.name),
                ]),
            ).sort();

            const nextFields: Record<string, PreCallFieldConfig> = {};
            names.forEach((name) => {
                const saved = savedFields[name] || {};
                const previewField = previewByName.get(name);
                const previewOrder = previewFields.findIndex((field) => field.name === name);
                const draftValue = templateContextVariables?.[name];
                const hasValue = previewField
                    ? previewField.has_value
                    : hasVariableValue(draftValue);
                const savedType = saved.type as PreCallFieldType | undefined;
                const inferredType = inferPreCallFieldType(draftValue);
                const savedOptions = Array.isArray(saved.options)
                    ? (saved.options as string[])
                    : previewField?.options || [];

                nextFields[name] = {
                    label:
                        (saved.label as string | undefined) ||
                        previewField?.label ||
                        humanizeVariableName(name),
                    type: savedType || previewField?.type || inferredType,
                    required:
                        hasValue
                            ? false
                            : saved.required !== undefined
                              ? Boolean(saved.required)
                              : previewField?.required ?? true,
                    hasValue,
                    placeholder:
                        (saved.placeholder as string | undefined) || previewField?.placeholder || "",
                    optionsText: savedOptions.join(", "),
                    order:
                        typeof saved.order === "number"
                            ? saved.order
                            : previewOrder >= 0
                              ? previewOrder
                              : names.indexOf(name),
                };
            });
            setPreCallFields(nextFields);

            if (settingsForm) {
                setPreCallEnabled(Boolean(settingsForm.enabled));
                setPreCallTitle((settingsForm.title as string | undefined) || "Before we start");
                setPreCallDescription((settingsForm.description as string | undefined) || "");
                setPreCallSubmitLabel((settingsForm.submitLabel as string | undefined) || "Start call");
                setPreCallAlwaysShow(Boolean(settingsForm.alwaysShow));
                setPreCallShowLocked(settingsForm.showLockedFields !== false);
                setPreCallAllowExtra(Boolean(settingsForm.allowExtraContext));
            } else {
                setPreCallEnabled(names.length > 0);
                setPreCallTitle(preview?.title || "Before we start");
                setPreCallDescription(preview?.description || "");
                setPreCallSubmitLabel(preview?.submit_label || "Start call");
                setPreCallAlwaysShow(Boolean(preview?.always_show));
                setPreCallShowLocked(preview?.show_locked_fields !== false);
                setPreCallAllowExtra(Boolean(preview?.allow_extra_context));
            }
        },
        [templateContextVariables],
    );

    const loadEmbedToken = useCallback(async () => {
        setLoading(true);
        try {
            const response = await getEmbedTokenApiV1WorkflowWorkflowIdEmbedTokenGet({
                path: { workflow_id: workflowId },
            });

            if (response.data) {
                const token = response.data as EmbedToken;
                setEmbedToken(token);
                setIsEnabled(response.data.is_active);

                // Load settings
                if (response.data.settings) {
                    const settings = response.data.settings as Record<string, string>;
                    setEmbedMode((settings.embedMode as "floating" | "inline" | "headless") || "floating");
                    setPosition(settings.position || "bottom-right");
                    setButtonText(settings.buttonText || "Talk to Agent");
                    setButtonColor(settings.buttonColor || "#10b981");
                    setCallToActionText(settings.callToActionText || "Click to start voice conversation");
                }

                // Load domains
                setDomains(response.data.allowed_domains ?? []);

                applyPreCallSettings(token);
            } else {
                applyPreCallSettings({
                    settings: null,
                    pre_call_form_preview: null,
                    has_unpublished_variable_changes: false,
                });
            }
        } catch (error) {
            console.error("Failed to load embed token:", error);
        } finally {
            setLoading(false);
        }
    }, [workflowId, applyPreCallSettings]);

    useEffect(() => {
        if (open) {
            loadEmbedToken();
        }
    }, [open, loadEmbedToken]);

    const handleSave = async () => {
        setSaving(true);
        const pendingDomain = newDomain.trim();
        const effectiveDomains =
            pendingDomain && !domains.includes(pendingDomain)
                ? [...domains, pendingDomain]
                : domains;
        try {
            if (!isEnabled && embedToken) {
                // Deactivate token
                const response = await deactivateEmbedTokenApiV1WorkflowWorkflowIdEmbedTokenDelete({
                    path: { workflow_id: workflowId },
                });
                if (response.error) {
                    toast.error(detailFromError(response.error, "Failed to disable embedding"));
                    return;
                }
                setEmbedToken(null);
                savedSnapshotRef.current = currentSnapshot;
                toast.success("Widget embedding disabled");
            } else if (isEnabled) {
                const fieldsPayload: Record<string, unknown> = {};
                Object.entries(preCallFields)
                    .sort(
                        ([leftName, left], [rightName, right]) =>
                            left.order - right.order || leftName.localeCompare(rightName),
                    )
                    .forEach(([name, field], index) => {
                        fieldsPayload[name] = {
                            label: field.label || humanizeVariableName(name),
                            type: field.type,
                            required: field.hasValue ? false : field.required,
                            editable: !field.hasValue,
                            placeholder: field.placeholder || undefined,
                            options:
                                field.type === "select"
                                    ? parseOptionsText(field.optionsText)
                                    : undefined,
                            order: index,
                        };
                    });

                // Create or update token
                const response = await createOrUpdateEmbedTokenApiV1WorkflowWorkflowIdEmbedTokenPost({
                    path: { workflow_id: workflowId },
                    body: {
                        allowed_domains: effectiveDomains.length > 0 ? effectiveDomains : null,
                        settings: {
                            embedMode,
                            position,
                            buttonText,
                            buttonColor,
                            callToActionText,
                            size: "medium",
                            autoStart: false,
                            containerId: embedMode === "inline" ? "convozent-inline-container" : undefined,
                            preCallForm: {
                                enabled: preCallEnabled,
                                title: preCallTitle || undefined,
                                description: preCallDescription || undefined,
                                submitLabel: preCallSubmitLabel || undefined,
                                alwaysShow: preCallAlwaysShow,
                                showLockedFields: preCallShowLocked,
                                allowExtraContext: preCallAllowExtra,
                                fields: fieldsPayload,
                            },
                        },
                        usage_limit: null,
                        expires_in_days: null,
                    },
                });

                if (response.error) {
                    console.error("Failed to save embed token:", response.error);
                    toast.error(detailFromError(response.error, "Failed to save embed configuration"));
                    return;
                }

                if (response.data) {
                    setEmbedToken(response.data as EmbedToken);
                    setDomains(response.data.allowed_domains ?? []);
                    if (pendingDomain) {
                        setNewDomain("");
                    }
                    savedSnapshotRef.current = currentSnapshot;
                    toast.success("Widget configuration saved successfully");
                }
            }
        } catch (error) {
            console.error("Failed to save embed token:", error);
            toast.error("Failed to save embed configuration. Please try again.");
        } finally {
            setSaving(false);
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        toast.success("Embed script copied to clipboard!");
        setTimeout(() => setCopied(false), 2000);
    };

    const addDomain = () => {
        const trimmed = newDomain.trim();
        if (trimmed && !domains.includes(trimmed)) {
            setDomains([...domains, trimmed]);
            setNewDomain("");
        }
    };

    const removeDomain = (domain: string) => {
        setDomains(domains.filter((d) => d !== domain));
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            addDomain();
        }
    };

    const updatePreCallField = (name: string, patch: Partial<PreCallFieldConfig>) => {
        setPreCallFields((previous) => ({
            ...previous,
            [name]: { ...previous[name], ...patch },
        }));
    };

    const movePreCallField = (name: string, delta: number) => {
        setPreCallFields((previous) => {
            const entries = Object.entries(previous).sort(
                ([leftName, left], [rightName, right]) =>
                    left.order - right.order || leftName.localeCompare(rightName),
            );
            const index = entries.findIndex(([entryName]) => entryName === name);
            const target = index + delta;
            if (index < 0 || target < 0 || target >= entries.length) {
                return previous;
            }
            const [moved] = entries.splice(index, 1);
            entries.splice(target, 0, moved);
            const next: Record<string, PreCallFieldConfig> = {};
            entries.forEach(([entryName, field], order) => {
                next[entryName] = { ...field, order };
            });
            return next;
        });
    };

    const preCallFieldEntries = Object.entries(preCallFields).sort(
        ([leftName, left], [rightName, right]) =>
            left.order - right.order || leftName.localeCompare(rightName),
    );

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right">
                <SheetHeader>
                    <SheetTitle className="text-base truncate">
                        Configure Website Widget
                    </SheetTitle>
                    <SheetDescription className="sr-only">
                        Add &ldquo;{workflowName}&rdquo; to your website with real-time WebRTC voice
                    </SheetDescription>
                </SheetHeader>

                <Tabs
                    value={activeSection}
                    onValueChange={(value) => setActiveSection(value as EmbedDrawerTab)}
                    className="flex min-h-0 flex-1 flex-col gap-0"
                >
                    {/* Fixed horizontal tab bar directly beneath title */}
                    <div className="shrink-0 border-b border-border px-4 pb-3">
                        <UnderlineTabs
                            value={activeSection}
                            onValueChange={(v) => setActiveSection(v as EmbedDrawerTab)}
                            items={EMBED_DRAWER_TABS}
                        />
                    </div>

                    <SheetBody className="px-4 py-4 space-y-4">
                        {loading ? (
                            <div className="flex-1 flex flex-col items-center justify-center py-16 gap-3">
                                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                <span className="text-sm text-muted-foreground">Loading widget settings...</span>
                            </div>
                        ) : (
                            <>
                                {/* Disabled Banner notice */}
                                {!isEnabled && (
                                    <div className="rounded-lg border border-status-warning/40 bg-status-warning/10 p-3 flex items-center justify-between gap-3">
                                        <div className="space-y-0.5">
                                            <p className="text-xs font-semibold text-status-warning">
                                                Widget embedding is currently paused
                                            </p>
                                            <p className="text-[11px] text-status-warning/80">
                                                Enable embedding to activate the widget, customize styling, and generate your embed script.
                                            </p>
                                        </div>
                                        <Button
                                            size="sm"
                                            variant="default"
                                            onClick={() => setIsEnabled(true)}
                                            className="h-7 text-xs px-2.5 shrink-0 cursor-pointer"
                                        >
                                            Enable Embedding
                                        </Button>
                                    </div>
                                )}

                                {/* ── TAB 1: WIDGET & STYLE ── */}
                                <TabsContent value="style" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                                    <DetailSection
                                        title="Web Embedding Status"
                                        description="Allow this voice agent workflow to be loaded on external web pages."
                                        action={
                                            <Switch
                                                id="embed-enabled"
                                                checked={isEnabled}
                                                onCheckedChange={setIsEnabled}
                                            />
                                        }
                                    >
                                        <p className="text-xs text-muted-foreground">
                                            {isEnabled
                                                ? "Web embedding is currently active for this voice agent."
                                                : "Web embedding is paused. External sites cannot connect to this agent."}
                                        </p>
                                    </DetailSection>

                                    {isEnabled && (
                                        <>
                                            <DetailSection
                                                title="Display Mode"
                                                description="Select how the widget integrates into the host page."
                                            >
                                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                                                    {/* Floating */}
                                                    <button
                                                        type="button"
                                                        onClick={() => setEmbedMode("floating")}
                                                        className={cn(
                                                            "p-2.5 rounded-lg border text-left transition-all relative flex flex-col justify-between gap-2 cursor-pointer",
                                                            embedMode === "floating"
                                                                ? "border-primary bg-primary/5 ring-1 ring-primary/40 shadow-2xs"
                                                                : "border-border hover:border-muted-foreground/30 bg-card hover:bg-muted/10",
                                                        )}
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-cta/10 text-cta">
                                                                <Mic className="h-3.5 w-3.5" />
                                                            </div>
                                                            {embedMode === "floating" && (
                                                                <span className="flex h-1.5 w-1.5 rounded-full bg-primary" />
                                                            )}
                                                        </div>
                                                        <div>
                                                            <div className="font-medium text-xs">Floating Widget</div>
                                                            <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">
                                                                Pinned button in corner with expandable voice modal
                                                            </div>
                                                        </div>
                                                    </button>

                                                    {/* Inline */}
                                                    <button
                                                        type="button"
                                                        onClick={() => setEmbedMode("inline")}
                                                        className={cn(
                                                            "p-2.5 rounded-lg border text-left transition-all relative flex flex-col justify-between gap-2 cursor-pointer",
                                                            embedMode === "inline"
                                                                ? "border-primary bg-primary/5 ring-1 ring-primary/40 shadow-2xs"
                                                                : "border-border hover:border-muted-foreground/30 bg-card hover:bg-muted/10",
                                                        )}
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-cta/10 text-cta">
                                                                <Layers className="h-3.5 w-3.5" />
                                                            </div>
                                                            {embedMode === "inline" && (
                                                                <span className="flex h-1.5 w-1.5 rounded-full bg-primary" />
                                                            )}
                                                        </div>
                                                        <div>
                                                            <div className="font-medium text-xs">Inline Component</div>
                                                            <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">
                                                                Embeds directly within an HTML container on the page
                                                            </div>
                                                        </div>
                                                    </button>

                                                    {/* Headless */}
                                                    <button
                                                        type="button"
                                                        onClick={() => setEmbedMode("headless")}
                                                        className={cn(
                                                            "p-2.5 rounded-lg border text-left transition-all relative flex flex-col justify-between gap-2 cursor-pointer",
                                                            embedMode === "headless"
                                                                ? "border-primary bg-primary/5 ring-1 ring-primary/40 shadow-2xs"
                                                                : "border-border hover:border-muted-foreground/30 bg-card hover:bg-muted/10",
                                                        )}
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-cta/10 text-cta">
                                                                <Terminal className="h-3.5 w-3.5" />
                                                            </div>
                                                            {embedMode === "headless" && (
                                                                <span className="flex h-1.5 w-1.5 rounded-full bg-primary" />
                                                            )}
                                                        </div>
                                                        <div>
                                                            <div className="font-medium text-xs">Headless API</div>
                                                            <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">
                                                                Control microphone &amp; audio with custom JavaScript UI
                                                            </div>
                                                        </div>
                                                    </button>
                                                </div>
                                            </DetailSection>

                                            <DetailSection
                                                title="Appearance & Preview"
                                                description="Customize button label, theme color, placement, and preview."
                                            >
                                                {embedMode === "headless" ? (
                                                    <div className="rounded-md bg-muted/40 border border-border p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                                                        <div className="space-y-0.5">
                                                            <h4 className="font-semibold text-xs">Headless mode renders no UI</h4>
                                                            <p className="text-[11px] text-muted-foreground max-w-xl leading-relaxed">
                                                                Convozent supplies the voice engine in the background. You design 100% of your own buttons and interfaces using the JS API.
                                                            </p>
                                                        </div>
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => setActiveSection("code")}
                                                            className="h-7 text-xs px-2.5 shrink-0 gap-1 cursor-pointer"
                                                        >
                                                            <Code2 className="h-3.5 w-3.5" />
                                                            View Code Samples
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                                                        {/* Controls Left Column */}
                                                        <div className="space-y-3">
                                                            <div className="space-y-1">
                                                                <Label htmlFor="button-text" className="text-xs font-medium">
                                                                    Button Label
                                                                </Label>
                                                                <Input
                                                                    id="button-text"
                                                                    value={buttonText}
                                                                    onChange={(e) => setButtonText(e.target.value)}
                                                                    placeholder="Talk to Agent"
                                                                    maxLength={40}
                                                                    className="h-8 text-xs"
                                                                />
                                                            </div>

                                                            <div className="space-y-1">
                                                                <Label htmlFor="button-color" className="text-xs font-medium">
                                                                    Theme Color
                                                                </Label>
                                                                <div className="flex gap-2">
                                                                    <Input
                                                                        id="button-color-picker"
                                                                        type="color"
                                                                        value={buttonColor}
                                                                        onChange={(e) => setButtonColor(e.target.value)}
                                                                        className="w-10 h-8 p-1 cursor-pointer shrink-0 rounded-md"
                                                                    />
                                                                    <Input
                                                                        id="button-color"
                                                                        value={buttonColor}
                                                                        onChange={(e) => setButtonColor(e.target.value)}
                                                                        placeholder="#10b981"
                                                                        className="h-8 font-mono text-xs flex-1 uppercase"
                                                                    />
                                                                </div>
                                                            </div>

                                                            {embedMode === "floating" && (
                                                                <div className="space-y-1">
                                                                    <Label htmlFor="position" className="text-xs font-medium">
                                                                        Screen Position
                                                                    </Label>
                                                                    <Select value={position} onValueChange={setPosition}>
                                                                        <SelectTrigger id="position" className="h-8 text-xs">
                                                                            <SelectValue />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem value="bottom-right">Bottom Right (Default)</SelectItem>
                                                                            <SelectItem value="bottom-left">Bottom Left</SelectItem>
                                                                            <SelectItem value="top-right">Top Right</SelectItem>
                                                                            <SelectItem value="top-left">Top Left</SelectItem>
                                                                        </SelectContent>
                                                                    </Select>
                                                                </div>
                                                            )}

                                                            {embedMode === "inline" && (
                                                                <div className="space-y-1">
                                                                    <Label htmlFor="cta-text" className="text-xs font-medium">
                                                                        Call to Action Text
                                                                    </Label>
                                                                    <Input
                                                                        id="cta-text"
                                                                        value={callToActionText}
                                                                        onChange={(e) => setCallToActionText(e.target.value)}
                                                                        placeholder="Click to start voice conversation"
                                                                        className="h-8 text-xs"
                                                                    />
                                                                </div>
                                                            )}
                                                        </div>

                                                        {/* Live Preview Right Column */}
                                                        <div className="flex flex-col gap-1.5">
                                                            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                                                                Live Interactive Preview
                                                            </span>
                                                            <div className="rounded-lg border border-border bg-muted/30 p-4 min-h-[170px] flex items-center justify-center relative overflow-hidden shadow-inner">
                                                                <div className="absolute inset-0 bg-radial from-transparent to-muted/50 pointer-events-none" />

                                                                {embedMode === "floating" ? (
                                                                    <div className="w-full flex justify-center py-4">
                                                                        <button
                                                                            type="button"
                                                                            className="inline-flex items-center gap-2 rounded-full px-4 py-2 font-medium text-white shadow-md transition-transform hover:scale-105 active:scale-95 cursor-pointer"
                                                                            style={{ backgroundColor: buttonColor }}
                                                                        >
                                                                            <div className="relative flex items-center justify-center">
                                                                                <Mic className="h-3.5 w-3.5" />
                                                                                <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-white animate-ping opacity-75" />
                                                                            </div>
                                                                            <span className="text-xs font-medium tracking-wide">
                                                                                {buttonText || "Talk to Agent"}
                                                                            </span>
                                                                        </button>
                                                                    </div>
                                                                ) : (
                                                                    <div className="w-full max-w-[260px] rounded-lg border border-border bg-card p-3.5 text-center shadow-2xs">
                                                                        <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                                                                            <Mic className="h-4 w-4" />
                                                                        </div>
                                                                        <p className="text-xs font-semibold text-foreground">
                                                                            Ready to Connect
                                                                        </p>
                                                                        <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
                                                                            {callToActionText || "Click to start voice conversation"}
                                                                        </p>
                                                                        <button
                                                                            type="button"
                                                                            className="w-full py-2 px-3 rounded-md text-xs font-semibold text-white shadow-2xs transition-opacity hover:opacity-95 cursor-pointer"
                                                                            style={{ backgroundColor: buttonColor }}
                                                                        >
                                                                            {buttonText || "Talk to Agent"}
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </DetailSection>
                                        </>
                                    )}
                                </TabsContent>

                                {/* ── TAB 2: ALLOWED DOMAINS ── */}
                                <TabsContent value="domains" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                                    <DetailSection
                                        title="Security & Origin Restrictions"
                                        description="Restrict widget loading to authorized websites. If left empty, any website can embed this voice agent."
                                    >
                                        {/* Add Domain Input Bar */}
                                        <div className="flex gap-2">
                                            <Input
                                                placeholder="example.com or *.example.com"
                                                value={newDomain}
                                                onChange={(e) => setNewDomain(e.target.value)}
                                                onKeyDown={handleKeyPress}
                                                className="h-8 text-xs font-mono"
                                            />
                                            <Button
                                                type="button"
                                                size="sm"
                                                onClick={addDomain}
                                                disabled={!newDomain.trim()}
                                                className="h-8 text-xs px-2.5 gap-1 shrink-0 cursor-pointer"
                                            >
                                                <Plus className="h-3.5 w-3.5" />
                                                Add Domain
                                            </Button>
                                        </div>

                                        {/* Domain Tag List */}
                                        <div className="pt-1">
                                            {domains.length === 0 ? (
                                                <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-center">
                                                    <Globe className="h-6 w-6 mx-auto text-muted-foreground/50 mb-1.5" />
                                                    <p className="text-xs font-medium text-foreground">
                                                        All domains allowed
                                                    </p>
                                                    <p className="text-[11px] text-muted-foreground mt-0.5 max-w-sm mx-auto">
                                                        The widget will accept requests from any origin. Add specific domains above to restrict embedding.
                                                    </p>
                                                </div>
                                            ) : (
                                                <div className="space-y-1.5">
                                                    <span className="text-[11px] font-medium text-muted-foreground">
                                                        Configured Allowed Domains ({domains.length})
                                                    </span>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                                        {domains.map((domain, index) => (
                                                            <div
                                                                key={index}
                                                                className="flex items-center justify-between bg-muted/40 border border-border rounded-md px-2.5 py-1.5 text-xs font-mono"
                                                            >
                                                                <div className="flex items-center gap-1.5 truncate">
                                                                    <Globe className="h-3 w-3 text-primary shrink-0" />
                                                                    <span className="truncate">{domain}</span>
                                                                </div>
                                                                <Button
                                                                    type="button"
                                                                    size="icon"
                                                                    variant="ghost"
                                                                    className="h-5 w-5 text-muted-foreground hover:text-destructive cursor-pointer"
                                                                    onClick={() => removeDomain(domain)}
                                                                >
                                                                    <Trash2 className="h-3 w-3" />
                                                                </Button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </DetailSection>
                                </TabsContent>

                                {/* ── TAB 3: PRE-CALL FORM ── */}
                                <TabsContent value="precall" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                                    <DetailSection
                                        title="Pre-Call Form Settings"
                                        description="Prompt visitors to enter required variables (e.g. Name, Phone, Account ID) before connecting."
                                        action={
                                            <Switch
                                                id="pre-call-enabled"
                                                checked={preCallEnabled}
                                                onCheckedChange={setPreCallEnabled}
                                            />
                                        }
                                    >
                                        <p className="text-xs text-muted-foreground">
                                            {preCallEnabled
                                                ? "Visitors are prompted to fill out context fields before starting the voice call."
                                                : "Pre-call form is disabled. Visitors connect directly to the voice agent."}
                                        </p>
                                    </DetailSection>

                                    {embedToken?.has_unpublished_variable_changes && (
                                        <div className="rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-status-warning flex items-center gap-1.5">
                                            <span className="font-semibold">Note:</span> Template variables have unpublished changes. Publish your workflow to update live visitor forms.
                                        </div>
                                    )}

                                    {preCallEnabled && (
                                        <>
                                            <DetailSection
                                                title="Form Copy & Details"
                                                description="Customize form title, submit button label, and guidance text."
                                            >
                                                <div className="grid gap-3 sm:grid-cols-2">
                                                    <div className="space-y-1">
                                                        <Label htmlFor="pre-call-title" className="text-xs font-medium">
                                                            Form Title
                                                        </Label>
                                                        <Input
                                                            id="pre-call-title"
                                                            value={preCallTitle}
                                                            onChange={(event) => setPreCallTitle(event.target.value)}
                                                            placeholder="Before we start"
                                                            maxLength={120}
                                                            className="h-8 text-xs"
                                                        />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <Label htmlFor="pre-call-submit-label" className="text-xs font-medium">
                                                            Submit Button Text
                                                        </Label>
                                                        <Input
                                                            id="pre-call-submit-label"
                                                            value={preCallSubmitLabel}
                                                            onChange={(event) => setPreCallSubmitLabel(event.target.value)}
                                                            placeholder="Start call"
                                                            maxLength={40}
                                                            className="h-8 text-xs"
                                                        />
                                                    </div>
                                                </div>

                                                <div className="space-y-1">
                                                    <Label htmlFor="pre-call-description" className="text-xs font-medium">
                                                        Description / Guidance
                                                    </Label>
                                                    <Textarea
                                                        id="pre-call-description"
                                                        value={preCallDescription}
                                                        onChange={(event) => setPreCallDescription(event.target.value)}
                                                        placeholder="Tell us a little about yourself before the call."
                                                        maxLength={500}
                                                        rows={2}
                                                        className="text-xs"
                                                    />
                                                </div>

                                                <div className="grid gap-2 sm:grid-cols-3 pt-1">
                                                    <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/20 px-2.5 py-1.5">
                                                        <Label htmlFor="pre-call-always-show" className="text-xs cursor-pointer">
                                                            Always show form
                                                        </Label>
                                                        <Switch
                                                            id="pre-call-always-show"
                                                            checked={preCallAlwaysShow}
                                                            onCheckedChange={setPreCallAlwaysShow}
                                                        />
                                                    </div>
                                                    <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/20 px-2.5 py-1.5">
                                                        <Label htmlFor="pre-call-show-locked" className="text-xs cursor-pointer">
                                                            Show locked fields
                                                        </Label>
                                                        <Switch
                                                            id="pre-call-show-locked"
                                                            checked={preCallShowLocked}
                                                            onCheckedChange={setPreCallShowLocked}
                                                        />
                                                    </div>
                                                    <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/20 px-2.5 py-1.5">
                                                        <Label htmlFor="pre-call-extra-context" className="text-xs cursor-pointer">
                                                            Allow extra context
                                                        </Label>
                                                        <Switch
                                                            id="pre-call-extra-context"
                                                            checked={preCallAllowExtra}
                                                            onCheckedChange={setPreCallAllowExtra}
                                                        />
                                                    </div>
                                                </div>
                                            </DetailSection>

                                            <DetailSection
                                                title="Variables & Form Preview"
                                                description="Configure field types, required state, ordering, and live preview."
                                            >
                                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                                                    {/* Left: Fields List */}
                                                    <div className="space-y-2.5">
                                                        <div className="flex items-center justify-between">
                                                            <Label className="text-xs font-semibold">
                                                                Form Fields ({preCallFieldEntries.length})
                                                            </Label>
                                                            <span className="text-[10px] text-muted-foreground">
                                                                Ordered top to bottom
                                                            </span>
                                                        </div>

                                                        {preCallFieldEntries.length === 0 ? (
                                                            <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                                                                No template variables found in this workflow.
                                                            </div>
                                                        ) : (
                                                            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                                                                {preCallFieldEntries.map(([name, field], index) => (
                                                                    <div
                                                                        key={name}
                                                                        className="rounded-md border border-border bg-card p-2.5 space-y-2 shadow-2xs"
                                                                    >
                                                                        <div className="flex items-center justify-between gap-2">
                                                                            <div className="flex items-center gap-1.5 truncate">
                                                                                <code className="text-xs font-mono font-semibold text-primary truncate">
                                                                                    {name}
                                                                                </code>
                                                                                <Badge
                                                                                    variant={field.hasValue ? "secondary" : "outline"}
                                                                                    className="text-[10px] h-4 px-1"
                                                                                >
                                                                                    {field.hasValue ? (
                                                                                        <>
                                                                                            <Lock className="mr-0.5 h-2.5 w-2.5" />
                                                                                            Locked
                                                                                        </>
                                                                                    ) : (
                                                                                        <>
                                                                                            <UserRound className="mr-0.5 h-2.5 w-2.5" />
                                                                                            Input
                                                                                        </>
                                                                                    )}
                                                                                </Badge>
                                                                            </div>
                                                                            <div className="flex items-center gap-1 shrink-0">
                                                                                <Button
                                                                                    type="button"
                                                                                    size="icon"
                                                                                    variant="ghost"
                                                                                    className="h-5 w-5 cursor-pointer"
                                                                                    disabled={index === 0}
                                                                                    onClick={() => movePreCallField(name, -1)}
                                                                                >
                                                                                    <ArrowUp className="h-3 w-3" />
                                                                                </Button>
                                                                                <Button
                                                                                    type="button"
                                                                                    size="icon"
                                                                                    variant="ghost"
                                                                                    className="h-5 w-5 cursor-pointer"
                                                                                    disabled={index === preCallFieldEntries.length - 1}
                                                                                    onClick={() => movePreCallField(name, 1)}
                                                                                >
                                                                                    <ArrowDown className="h-3 w-3" />
                                                                                </Button>
                                                                            </div>
                                                                        </div>

                                                                        <div className="grid gap-1.5 sm:grid-cols-2">
                                                                            <Input
                                                                                value={field.label}
                                                                                onChange={(event) =>
                                                                                    updatePreCallField(name, { label: event.target.value })
                                                                                }
                                                                                placeholder="Field label"
                                                                                className="h-7 text-xs"
                                                                            />

                                                                            {!field.hasValue && (
                                                                                <Select
                                                                                    value={field.type}
                                                                                    onValueChange={(value) =>
                                                                                        updatePreCallField(name, {
                                                                                            type: value as PreCallFieldType,
                                                                                        })
                                                                                    }
                                                                                >
                                                                                    <SelectTrigger className="h-7 text-xs">
                                                                                        <SelectValue />
                                                                                    </SelectTrigger>
                                                                                    <SelectContent>
                                                                                        <SelectItem value="text">Text Input</SelectItem>
                                                                                        <SelectItem value="textarea">Long Text</SelectItem>
                                                                                        <SelectItem value="number">Number</SelectItem>
                                                                                        <SelectItem value="select">Dropdown</SelectItem>
                                                                                        <SelectItem value="checkbox">Checkbox</SelectItem>
                                                                                    </SelectContent>
                                                                                </Select>
                                                                            )}

                                                                            {!field.hasValue && (
                                                                                <Input
                                                                                    value={field.placeholder}
                                                                                    onChange={(event) =>
                                                                                        updatePreCallField(name, {
                                                                                            placeholder: event.target.value,
                                                                                        })
                                                                                    }
                                                                                    placeholder="Placeholder text"
                                                                                    className="h-7 text-xs"
                                                                                />
                                                                            )}

                                                                            {!field.hasValue && (
                                                                                <div className="flex items-center justify-between rounded-md border border-border px-2 h-7">
                                                                                    <Label className="text-[10px]">Required field</Label>
                                                                                    <Switch
                                                                                        checked={field.required}
                                                                                        onCheckedChange={(checked) =>
                                                                                            updatePreCallField(name, { required: checked })
                                                                                        }
                                                                                    />
                                                                                </div>
                                                                            )}

                                                                            {!field.hasValue && field.type === "select" && (
                                                                                <div className="sm:col-span-2">
                                                                                    <Input
                                                                                        value={field.optionsText}
                                                                                        onChange={(event) =>
                                                                                            updatePreCallField(name, {
                                                                                                optionsText: event.target.value,
                                                                                            })
                                                                                        }
                                                                                        placeholder="Option 1, Option 2, Option 3"
                                                                                        className="h-7 text-xs"
                                                                                    />
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Right: Form Preview */}
                                                    <div className="space-y-2">
                                                        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                                                            Visitor Form Preview
                                                        </span>
                                                        <div className="rounded-lg border border-border bg-card p-4 shadow-2xs max-w-[270px] mx-auto w-full">
                                                            <p className="text-xs font-semibold">{preCallTitle || "Before we start"}</p>
                                                            {preCallDescription && (
                                                                <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">
                                                                    {preCallDescription}
                                                                </p>
                                                            )}
                                                            <div className="mt-3 space-y-2">
                                                                {preCallFieldEntries.map(([name, field]) => (
                                                                    <div key={name} className="space-y-0.5">
                                                                        <p className="text-[10px] font-medium text-foreground">
                                                                            {field.label || humanizeVariableName(name)}
                                                                            {!field.hasValue && field.required ? " *" : ""}
                                                                        </p>
                                                                        {field.hasValue ? (
                                                                            <div className="flex items-center justify-between rounded-md border border-dashed border-border bg-muted/20 px-2 py-1 text-[10px] text-muted-foreground">
                                                                                <span>
                                                                                    {preCallShowLocked ? "From website context" : "Hidden (server-side)"}
                                                                                </span>
                                                                                {preCallShowLocked && <Lock className="h-2.5 w-2.5" />}
                                                                            </div>
                                                                        ) : (
                                                                            <div className="h-7 rounded-md border border-border bg-muted/30 px-2 py-1 text-xs text-muted-foreground/60 flex items-center">
                                                                                {field.placeholder || "Enter value..."}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>

                                                            <button
                                                                type="button"
                                                                className="mt-4 w-full flex h-7 items-center justify-center rounded-md text-xs font-semibold text-white shadow-2xs cursor-pointer"
                                                                style={{ backgroundColor: buttonColor }}
                                                            >
                                                                {preCallSubmitLabel || "Start call"}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </DetailSection>
                                        </>
                                    )}
                                </TabsContent>

                                {/* ── TAB 4: EMBED CODE & SETUP ── */}
                                <TabsContent value="code" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                                    <DetailSection
                                        title="Live Embed Script"
                                        description="Paste this script tag before the closing </body> tag of your website."
                                        action={
                                            embedToken && embedToken.is_active ? (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => copyToClipboard(embedToken.embed_script)}
                                                    className="h-8 text-xs px-2.5 gap-1 shrink-0 cursor-pointer"
                                                >
                                                    {copied ? (
                                                        <>
                                                            <Check className="h-3.5 w-3.5 text-status-success" />
                                                            Copied!
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Copy className="h-3.5 w-3.5" />
                                                            Copy Script
                                                        </>
                                                    )}
                                                </Button>
                                            ) : null
                                        }
                                    >
                                        {embedToken && embedToken.is_active ? (
                                            <div className="relative rounded-md bg-zinc-950 p-3 border border-zinc-800 text-zinc-100 overflow-x-auto shadow-inner">
                                                <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-all select-all">
                                                    <code>{embedToken.embed_script}</code>
                                                </pre>
                                            </div>
                                        ) : (
                                            <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center space-y-1.5">
                                                <Code2 className="h-6 w-6 mx-auto text-muted-foreground/60" />
                                                <p className="text-xs font-medium">Script not generated yet</p>
                                                <p className="text-[11px] text-muted-foreground max-w-sm mx-auto">
                                                    Click <span className="font-semibold text-foreground">Save Configurations</span> in the bottom right to activate this widget and generate your embed code.
                                                </p>
                                            </div>
                                        )}
                                    </DetailSection>

                                    <DetailSection
                                        title="Integration Guide & Examples"
                                        description={`Implementation instructions and usage examples for ${embedMode} mode.`}
                                    >
                                        {embedMode === "headless" ? (
                                            <div className="space-y-3">
                                                <div className="space-y-0.5">
                                                    <p className="text-xs font-medium text-foreground">Headless Integration Examples</p>
                                                    <p className="text-[11px] text-muted-foreground">
                                                        Invoke <code className="font-mono bg-muted px-1 rounded">window.ConvozentWidget.start()</code> and <code className="font-mono bg-muted px-1 rounded">end()</code> from your own custom UI.
                                                    </p>
                                                </div>

                                                <div className="space-y-3">
                                                    <div>
                                                        <span className="text-[11px] font-medium text-foreground mb-1 block">
                                                            Vanilla JavaScript Example
                                                        </span>
                                                        <div className="rounded-md bg-zinc-950 p-3 border border-zinc-800 text-zinc-100 overflow-x-auto">
                                                            <pre className="text-xs font-mono leading-relaxed">{`<!-- Your custom UI button -->
<button id="talk-btn">Talk to AI</button>

<script>
  let callStatus = 'idle';
  const btn = document.getElementById('talk-btn');

  function render() {
    btn.textContent =
      callStatus === 'connected'  ? 'End Call' :
      callStatus === 'connecting' ? 'Connecting…' :
      callStatus === 'failed'     ? 'Retry' : 'Talk to AI';
  }

  // Subscribe to voice status events
  window.addEventListener('load', () => {
    window.ConvozentWidget?.onStatusChange((status) => {
      callStatus = status;
      render();
    });
    window.ConvozentWidget?.onError((err) => console.error(err.message));
  });

  // User click trigger (required for browser mic permissions)
  btn.addEventListener('click', () => {
    if (callStatus === 'connected' || callStatus === 'connecting') {
      window.ConvozentWidget.end();
    } else {
      window.ConvozentWidget.start();
    }
  });
</script>`}</pre>
                                                        </div>
                                                    </div>

                                                    <div>
                                                        <span className="text-[11px] font-medium text-foreground mb-1 block">
                                                            React / Next.js Component
                                                        </span>
                                                        <div className="rounded-md bg-zinc-950 p-3 border border-zinc-800 text-zinc-100 overflow-x-auto">
                                                            <pre className="text-xs font-mono leading-relaxed">{`import { useEffect, useState } from 'react';

export function VoiceAgentButton() {
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    window.ConvozentWidget?.onStatusChange(setStatus);
    window.ConvozentWidget?.onError((err) => console.error(err.message));
  }, []);

  const isLive = status === 'connected' || status === 'connecting';
  const label = { idle: 'Talk to AI', connecting: 'Connecting…', connected: 'End Call', failed: 'Retry' }[status];

  return (
    <button onClick={() => isLive ? window.ConvozentWidget.end() : window.ConvozentWidget.start()}>
      {label}
    </button>
  );
}`}</pre>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : embedMode === "inline" ? (
                                            <div className="space-y-2.5">
                                                <div className="space-y-0.5">
                                                    <p className="text-xs font-medium text-foreground">Inline Container Placement</p>
                                                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                                                        Place this HTML container on your web page where the inline widget should render.
                                                    </p>
                                                </div>
                                                <div className="rounded-md bg-zinc-950 p-3 border border-zinc-800 text-zinc-100 overflow-x-auto">
                                                    <pre className="text-xs font-mono leading-relaxed">{`<!-- Place where you want the agent widget to appear -->
<div id="convozent-inline-container" style="min-height: 400px; width: 100%;"></div>`}</pre>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="space-y-2">
                                                <div className="space-y-0.5">
                                                    <p className="text-xs font-medium text-foreground">Quick Verification</p>
                                                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                                                        Once you have placed the script tag on your website, open your browser and refresh. The floating button will appear at the {position.replace("-", " ")} corner of your page.
                                                    </p>
                                                </div>
                                            </div>
                                        )}
                                    </DetailSection>
                                </TabsContent>
                            </>
                        )}
                    </SheetBody>

                    {/* Shared Stepper Footer */}
                    <SheetFooter className="justify-between border-t border-border px-4 py-3 bg-card/95">
                        <div className="flex items-center gap-2">
                            {activeSection !== "style" && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={handlePrev}
                                    disabled={saving}
                                    className="h-8 text-xs font-medium cursor-pointer"
                                >
                                    <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                                    Previous
                                </Button>
                            )}
                            <a
                                href={WIDGET_MODE_DOCUMENTATION_URLS[embedMode]}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-muted"
                            >
                                <ExternalLink className="h-3.5 w-3.5" />
                                <span>Docs</span>
                            </a>
                        </div>

                        <div className="flex items-center gap-2">
                            {embedToken?.embed_script && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => copyToClipboard(embedToken.embed_script)}
                                    className="h-8 gap-1.5 text-xs cursor-pointer px-2.5"
                                >
                                    {copied ? <Check className="h-3.5 w-3.5 text-status-success" /> : <Copy className="h-3.5 w-3.5" />}
                                    Copy Code
                                </Button>
                            )}

                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => onOpenChange(false)}
                                disabled={saving}
                                className="h-8 text-xs font-medium cursor-pointer"
                            >
                                Cancel
                            </Button>

                            {activeSection === "code" ? (
                                <Button
                                    type="button"
                                    size="sm"
                                    onClick={handleSave}
                                    disabled={saving || !isDirty}
                                    className="h-8 text-xs font-medium gap-1.5 cursor-pointer"
                                >
                                    {saving ? (
                                        <>
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            Saving…
                                        </>
                                    ) : (
                                        "Save Configurations"
                                    )}
                                </Button>
                            ) : (
                                <>
                                    {isDirty && (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={handleSave}
                                            disabled={saving}
                                            className="h-8 text-xs font-medium gap-1.5 cursor-pointer"
                                        >
                                            {saving ? (
                                                <>
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                    Saving…
                                                </>
                                            ) : (
                                                "Save changes"
                                            )}
                                        </Button>
                                    )}
                                    <Button
                                        type="button"
                                        size="sm"
                                        onClick={handleNext}
                                        disabled={saving}
                                        className="h-8 text-xs font-medium gap-1 cursor-pointer"
                                    >
                                        Next Step
                                        <ArrowRight className="h-3.5 w-3.5 ml-1" />
                                    </Button>
                                </>
                            )}
                        </div>
                    </SheetFooter>
                </Tabs>
            </SheetContent>
        </Sheet>
    );
}
