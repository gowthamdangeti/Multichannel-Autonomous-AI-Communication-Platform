"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
    createToolApiV1ToolsPost,
    listRecordingsApiV1WorkflowRecordingsGet,
    updateToolApiV1ToolsToolUuidPut,
} from "@/client/sdk.gen";
import type {
    CreateToolRequest,
    RecordingResponseSchema,
    ToolResponse,
    UpdateToolRequest,
} from "@/client/types.gen";
import {
    CredentialSelector,
    type HttpMethod,
    HttpMethodSelector,
    KeyValueEditor,
    type KeyValueItem,
    ParameterEditor,
    PresetParameterEditor,
    type PresetToolParameter,
    type ToolParameter,
    UrlInput,
    validateUrl,
} from "@/components/http";
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
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { detailFromError } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

import {
    createMcpDefinition,
    DEFAULT_END_CALL_REASON_DESCRIPTION,
    getCategoryConfig,
    MCP_URL_PATTERN,
    TOOL_CATEGORIES,
    type ToolCategory,
} from "./config";

export type DrawerTab = "general" | "config" | "post_execution";

export interface ToolDetailsDrawerProps {
    tool: ToolResponse | null;
    isOpen: boolean;
    isCreate?: boolean;
    initialTab?: DrawerTab;
    onOpenChange: (open: boolean) => void;
    /** Fired after a successful creation. */
    onToolCreated?: (tool: ToolResponse) => void;
    /** Fired after a successful save. */
    onToolSaved?: (tool: ToolResponse) => void;
}

/** Surface of every card in the drawer: white on drawer background (identical to Org drawer). */
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

export function ToolDetailsDrawer({
    tool,
    isOpen,
    isCreate = false,
    initialTab = "general",
    onOpenChange,
    onToolCreated,
    onToolSaved,
}: ToolDetailsDrawerProps) {
    const { getAccessToken } = useAuth();
    const [activeTab, setActiveTab] = useState<DrawerTab>(initialTab);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [nameError, setNameError] = useState<string | null>(null);

    // General state
    const [category, setCategory] = useState<ToolCategory>("http_api");
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");

    // HTTP API config state
    const [httpMethod, setHttpMethod] = useState<HttpMethod>("POST");
    const [url, setUrl] = useState("");
    const [timeoutMs, setTimeoutMs] = useState(5000);
    const [credentialUuid, setCredentialUuid] = useState("");
    const [headers, setHeaders] = useState<KeyValueItem[]>([]);
    const [parameters, setParameters] = useState<ToolParameter[]>([]);
    const [presetParameters, setPresetParameters] = useState<PresetToolParameter[]>([]);

    // Scraper config state
    const [scraperUrl, setScraperUrl] = useState("");
    const [extractionType, setExtractionType] = useState<"full_text" | "main_content" | "meta_only">("main_content");
    const [includeLinks, setIncludeLinks] = useState(false);
    const [maxLength, setMaxLength] = useState(8000);
    const [scraperTimeoutMs, setScraperTimeoutMs] = useState(10000);
    const [scraperCredentialUuid, setScraperCredentialUuid] = useState("");

    // MCP config state
    const [mcpUrl, setMcpUrl] = useState("");
    const [mcpCredentialUuid, setMcpCredentialUuid] = useState("");
    const [mcpToolsFilter, setMcpToolsFilter] = useState("");

    // End call config state
    const [endCallReason, setEndCallReason] = useState(false);
    const [endCallReasonDescription, setEndCallReasonDescription] = useState("");

    // Transfer call config state
    const [transferDestination, setTransferDestination] = useState("");
    const [transferTimeout, setTransferTimeout] = useState(30);

    // Post-execution message state
    const [messageType, setMessageType] = useState<"none" | "text" | "audio">("none");
    const [customMessage, setCustomMessage] = useState("");
    const [recordingId, setRecordingId] = useState("");

    // Organization recordings for audio dropdowns
    const [recordings, setRecordings] = useState<RecordingResponseSchema[]>([]);

    // Reset tab when opening or initialTab changes
    useEffect(() => {
        if (isOpen) {
            setActiveTab(initialTab);
            setNameError(null);
        }
    }, [isOpen, initialTab, tool?.tool_uuid]);

    // Populate state based on tool (edit mode) or defaults (create mode)
    useEffect(() => {
        if (!isOpen) return;

        if (tool) {
            setCategory((tool.category as ToolCategory) || "http_api");
            setName(tool.name || "");
            setDescription(tool.description || "");

            const def = (tool.definition as Record<string, unknown> | undefined) || {};
            const cfg = (def.config as Record<string, unknown> | undefined) || {};

            // HTTP API
            setHttpMethod(((cfg.method as string) || "POST").toUpperCase() as HttpMethod);
            setUrl((cfg.url as string) || "");
            setTimeoutMs(typeof cfg.timeout_ms === "number" ? cfg.timeout_ms : 5000);
            setCredentialUuid((cfg.credential_uuid as string) || "");
            const rawHeaders = cfg.headers as Record<string, string> | KeyValueItem[] | undefined;
            if (Array.isArray(rawHeaders)) {
                setHeaders(rawHeaders);
            } else if (rawHeaders && typeof rawHeaders === "object") {
                setHeaders(Object.entries(rawHeaders).map(([k, v]) => ({ key: k, value: String(v) })));
            } else {
                setHeaders([]);
            }
            setParameters(Array.isArray(cfg.parameters) ? (cfg.parameters as ToolParameter[]) : []);
            setPresetParameters(Array.isArray(cfg.preset_parameters) ? (cfg.preset_parameters as PresetToolParameter[]) : []);

            // Scraper
            setScraperUrl((cfg.url as string) || "");
            setExtractionType(((cfg.extraction_type as string) || "main_content") as "full_text" | "main_content" | "meta_only");
            setIncludeLinks(Boolean(cfg.include_links));
            setMaxLength(typeof cfg.max_length === "number" ? cfg.max_length : 8000);
            setScraperTimeoutMs(typeof cfg.timeout_ms === "number" ? cfg.timeout_ms : 10000);
            setScraperCredentialUuid((cfg.credential_uuid as string) || "");

            // MCP
            setMcpUrl((cfg.url as string) || "");
            setMcpCredentialUuid((cfg.credential_uuid as string) || "");
            setMcpToolsFilter(Array.isArray(cfg.tools_filter) ? cfg.tools_filter.join(", ") : "");

            // End Call
            setEndCallReason(Boolean(cfg.endCallReason));
            setEndCallReasonDescription((cfg.endCallReasonDescription as string) || "");

            // Transfer Call
            setTransferDestination((cfg.destination as string) || "");
            setTransferTimeout(typeof cfg.timeout === "number" ? cfg.timeout : 30);

            // Post-execution message
            if (tool.category === "end_call" || tool.category === "transfer_call") {
                const mt = (cfg.messageType as string) || "none";
                if (mt === "audio") {
                    setMessageType("audio");
                    setRecordingId((cfg.audioRecordingId as string) || "");
                    setCustomMessage("");
                } else if (mt === "custom" || cfg.customMessage) {
                    setMessageType("text");
                    setCustomMessage((cfg.customMessage as string) || "");
                    setRecordingId("");
                } else {
                    setMessageType("none");
                    setCustomMessage("");
                    setRecordingId("");
                }
            } else {
                const cmt = (cfg.customMessageType as string) || "";
                if (cmt === "audio" || cfg.customMessageRecordingId) {
                    setMessageType("audio");
                    setRecordingId((cfg.customMessageRecordingId as string) || "");
                    setCustomMessage("");
                } else if (cmt === "text" || cfg.customMessage) {
                    setMessageType("text");
                    setCustomMessage((cfg.customMessage as string) || "");
                    setRecordingId("");
                } else {
                    setMessageType("none");
                    setCustomMessage("");
                    setRecordingId("");
                }
            }
        } else if (isCreate) {
            setCategory("http_api");
            const catConfig = getCategoryConfig("http_api");
            setName(catConfig?.autoFill?.name || "");
            setDescription(catConfig?.autoFill?.description || "");
            setHttpMethod("POST");
            setUrl("");
            setTimeoutMs(5000);
            setCredentialUuid("");
            setHeaders([]);
            setParameters([]);
            setPresetParameters([]);
            setScraperUrl("");
            setExtractionType("main_content");
            setIncludeLinks(false);
            setMaxLength(8000);
            setScraperTimeoutMs(10000);
            setScraperCredentialUuid("");
            setMcpUrl("");
            setMcpCredentialUuid("");
            setMcpToolsFilter("");
            setEndCallReason(false);
            setEndCallReasonDescription("");
            setTransferDestination("");
            setTransferTimeout(30);
            setMessageType("none");
            setCustomMessage("");
            setRecordingId("");
        }
    }, [isOpen, tool, isCreate]);

    // Fetch org recordings for audio dropdowns
    useEffect(() => {
        if (!isOpen) return;
        const fetchRecordings = async () => {
            try {
                const response = await listRecordingsApiV1WorkflowRecordingsGet({ query: {} });
                if (response.data) {
                    setRecordings(response.data.recordings);
                }
            } catch {
                // Ignore failure
            }
        };
        void fetchRecordings();
    }, [isOpen]);

    const handleCategoryChange = (newCat: ToolCategory) => {
        setCategory(newCat);
        setNameError(null);
        if (isCreate) {
            const catConfig = getCategoryConfig(newCat);
            if (catConfig?.autoFill) {
                setName(catConfig.autoFill.name);
                setDescription(catConfig.autoFill.description);
            }
        }
    };

    const handleEndCallReasonChange = (enabled: boolean) => {
        setEndCallReason(enabled);
        if (enabled && !endCallReasonDescription) {
            setEndCallReasonDescription(DEFAULT_END_CALL_REASON_DESCRIPTION);
        }
    };

    const buildDefinition = (): CreateToolRequest["definition"] => {
        const postMessage = messageType === "text" ? (customMessage.trim() || undefined) : undefined;
        const postAudioId = messageType === "audio" ? (recordingId || undefined) : undefined;
        const postMessageType = messageType === "none" ? undefined : messageType;

        switch (category) {
            case "calculator":
                return { schema_version: 1, type: "calculator" };

            case "end_call":
                return {
                    schema_version: 1,
                    type: "end_call",
                    config: {
                        messageType: messageType === "audio" ? "audio" : messageType === "text" ? "custom" : "none",
                        customMessage: postMessage,
                        audioRecordingId: postAudioId,
                        endCallReason,
                        endCallReasonDescription: endCallReason ? (endCallReasonDescription || undefined) : undefined,
                    },
                };

            case "transfer_call":
                return {
                    schema_version: 1,
                    type: "transfer_call",
                    config: {
                        destination: transferDestination,
                        timeout: transferTimeout,
                        messageType: messageType === "audio" ? "audio" : messageType === "text" ? "custom" : "none",
                        customMessage: postMessage,
                        audioRecordingId: postAudioId,
                    },
                };

            case "mcp":
                return createMcpDefinition(mcpUrl, mcpCredentialUuid, mcpToolsFilter);

            case "website_scraper":
                return {
                    schema_version: 1,
                    type: "website_scraper",
                    config: {
                        url: scraperUrl || "https://example.com",
                        extraction_type: extractionType,
                        include_links: includeLinks,
                        max_length: maxLength,
                        timeout_ms: scraperTimeoutMs,
                        credential_uuid: scraperCredentialUuid || undefined,
                        customMessage: postMessage,
                        customMessageType: postMessageType,
                        customMessageRecordingId: postAudioId,
                    },
                };

            case "http_api":
            default: {
                const headersObj: Record<string, string> = {};
                headers.filter((h) => h.key && h.value).forEach((h) => {
                    headersObj[h.key] = h.value;
                });
                const validParams = parameters.filter((p) => p.name.trim());
                const validPreset = presetParameters.filter((p) => p.name.trim() && p.valueTemplate.trim());

                return {
                    schema_version: 1,
                    type: "http_api",
                    config: {
                        method: httpMethod,
                        url,
                        timeout_ms: timeoutMs,
                        credential_uuid: credentialUuid || undefined,
                        headers: Object.keys(headersObj).length > 0 ? headersObj : undefined,
                        parameters: validParams.length > 0 ? validParams : undefined,
                        preset_parameters: validPreset.length > 0
                            ? validPreset.map((p) => ({
                                name: p.name,
                                type: p.type,
                                value_template: p.valueTemplate,
                                required: p.required,
                            }))
                            : undefined,
                        customMessage: postMessage,
                        customMessageType: postMessageType,
                        customMessageRecordingId: postAudioId,
                    },
                };
            }
        }
    };

    const handlePrev = () => {
        setNameError(null);
        if (activeTab === "post_execution") {
            setActiveTab("config");
        } else if (activeTab === "config") {
            setActiveTab("general");
        }
    };

    const handleNext = () => {
        setNameError(null);
        if (activeTab === "general") {
            if (!name.trim()) {
                setNameError("Tool Name is required");
                toast.error("Please enter a tool name");
                return;
            }
            setActiveTab("config");
        } else if (activeTab === "config") {
            if (category === "transfer_call") {
                const e164Pattern = /^\+[1-9]\d{1,14}$/;
                const sipPattern = /^(PJSIP|SIP)\/[\w\-\.@]+$/i;
                const isValid = e164Pattern.test(transferDestination) || sipPattern.test(transferDestination);
                if (!transferDestination || !isValid) {
                    toast.error("Please enter a valid phone number (E.164 format) or SIP endpoint");
                    return;
                }
            } else if (category === "mcp") {
                if (!mcpUrl.trim()) {
                    toast.error("Please enter the MCP server URL");
                    return;
                }
                if (!MCP_URL_PATTERN.test(mcpUrl.trim())) {
                    toast.error("MCP server URL must start with http:// or https://");
                    return;
                }
            } else if (category === "http_api" && url) {
                const validation = validateUrl(url);
                if (!validation.valid) {
                    toast.error(validation.error || "Invalid URL");
                    return;
                }
            } else if (category === "website_scraper" && scraperUrl) {
                const validation = validateUrl(scraperUrl);
                if (!validation.valid) {
                    toast.error(validation.error || "Invalid URL");
                    return;
                }
            }
            setActiveTab("post_execution");
        }
    };

    const handleSubmit = async () => {
        setNameError(null);
        if (!name.trim()) {
            setNameError("Tool Name is required");
            toast.error("Please enter a tool name");
            setActiveTab("general");
            return;
        }

        if (category === "transfer_call") {
            const e164Pattern = /^\+[1-9]\d{1,14}$/;
            const sipPattern = /^(PJSIP|SIP)\/[\w\-\.@]+$/i;
            const isValid = e164Pattern.test(transferDestination) || sipPattern.test(transferDestination);
            if (!transferDestination || !isValid) {
                toast.error("Please enter a valid phone number (E.164 format) or SIP endpoint");
                setActiveTab("config");
                return;
            }
        } else if (category === "mcp") {
            if (!mcpUrl.trim()) {
                toast.error("Please enter the MCP server URL");
                setActiveTab("config");
                return;
            }
            if (!MCP_URL_PATTERN.test(mcpUrl.trim())) {
                toast.error("MCP server URL must start with http:// or https://");
                setActiveTab("config");
                return;
            }
        } else if (category === "http_api" && url) {
            const validation = validateUrl(url);
            if (!validation.valid) {
                toast.error(validation.error || "Invalid URL");
                setActiveTab("config");
                return;
            }
        } else if (category === "website_scraper" && scraperUrl) {
            const validation = validateUrl(scraperUrl);
            if (!validation.valid) {
                toast.error(validation.error || "Invalid URL");
                setActiveTab("config");
                return;
            }
        }

        try {
            setIsSubmitting(true);
            const accessToken = await getAccessToken();
            const definition = buildDefinition();

            if (isCreate) {
                const categoryConfig = getCategoryConfig(category);
                const requestBody: CreateToolRequest = {
                    name: name.trim(),
                    description: description.trim() || undefined,
                    category,
                    icon: categoryConfig?.iconName || "globe",
                    icon_color: categoryConfig?.iconColor || "#3B82F6",
                    definition,
                };

                const response = await createToolApiV1ToolsPost({
                    body: requestBody,
                    headers: { Authorization: `Bearer ${accessToken}` },
                });

                if (response.error) {
                    toast.error(detailFromError(response.error, "Failed to create tool"));
                    return;
                }

                if (response.data) {
                    toast.success("Tool created successfully");
                    onToolCreated?.(response.data);
                }
            } else if (tool) {
                const requestBody: UpdateToolRequest = {
                    name: name.trim(),
                    description: description.trim() || undefined,
                    definition: definition as unknown as UpdateToolRequest["definition"],
                };

                const response = await updateToolApiV1ToolsToolUuidPut({
                    path: { tool_uuid: tool.tool_uuid },
                    body: requestBody,
                    headers: { Authorization: `Bearer ${accessToken}` },
                });

                if (response.error) {
                    toast.error(detailFromError(response.error, "Failed to save tool"));
                    return;
                }

                if (response.data) {
                    toast.success("Tool saved successfully");
                    onToolSaved?.(response.data);
                }
            }
        } catch (err) {
            toast.error("An unexpected error occurred");
            console.error(err);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Sheet open={isOpen} onOpenChange={onOpenChange}>
            <SheetContent side="right">
                <SheetHeader>
                    <SheetTitle className="text-base truncate">
                        {isCreate ? "Create New Tool" : `Tool #${tool?.id} — ${tool?.name || "Tool"}`}
                    </SheetTitle>
                    <SheetDescription className="sr-only">
                        {isCreate ? "Create a new tool" : `Tool details and configuration for ${tool?.name}`}
                    </SheetDescription>
                </SheetHeader>

                <Tabs
                    value={activeTab}
                    onValueChange={(value) => setActiveTab(value as DrawerTab)}
                    className="flex min-h-0 flex-1 flex-col gap-0"
                >
                    {/* Fixed tab bar directly beneath title (Org drawer pattern) */}
                    <div className="shrink-0 border-b border-border px-4 pb-3">
                        <UnderlineTabs
                            value={activeTab}
                            onValueChange={(v) => setActiveTab(v as DrawerTab)}
                            items={[
                                { value: "general", label: "General" },
                                { value: "config", label: "Configuration" },
                                { value: "post_execution", label: "Post-execution Message" },
                            ]}
                        />
                    </div>

                    <SheetBody className="px-4 py-4 space-y-4">
                        {/* Tab 1: General */}
                        <TabsContent value="general" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                            <DetailSection
                                title="General Information"
                                description="Select the tool type, name, and description."
                            >
                                <div className="space-y-4">
                                    <div className="space-y-1.5">
                                        <Label>Tool Type</Label>
                                        <Select
                                            value={category}
                                            disabled={!isCreate}
                                            onValueChange={(v) => handleCategoryChange(v as ToolCategory)}
                                        >
                                            <SelectTrigger className="w-full text-xs">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {TOOL_CATEGORIES.map((cat) => (
                                                    <SelectItem
                                                        key={cat.value}
                                                        value={cat.value}
                                                        disabled={cat.disabled}
                                                    >
                                                        {cat.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <p className="text-[11px] text-muted-foreground">
                                            {getCategoryConfig(category)?.description}
                                        </p>
                                    </div>

                                    <div className="space-y-1.5">
                                        <Label htmlFor="tool-name">Tool Name</Label>
                                        <Input
                                            id="tool-name"
                                            value={name}
                                            onChange={(e) => {
                                                setName(e.target.value);
                                                if (nameError) setNameError(null);
                                            }}
                                            placeholder="e.g., Book Appointment, Check Inventory"
                                            className={cn("text-xs", nameError && "border-destructive focus-visible:ring-destructive")}
                                        />
                                        {nameError && (
                                            <p className="text-xs text-destructive">{nameError}</p>
                                        )}
                                        <p className="text-[11px] text-muted-foreground">
                                            A descriptive name for the tool used in workflows.
                                        </p>
                                    </div>

                                    <div className="space-y-1.5">
                                        <Label htmlFor="tool-description">Description (Optional)</Label>
                                        <Textarea
                                            id="tool-description"
                                            value={description}
                                            onChange={(e) => setDescription(e.target.value)}
                                            placeholder="What does this tool do? The LLM uses this description to understand when to invoke it."
                                            rows={3}
                                            className="text-xs"
                                        />
                                    </div>
                                </div>
                            </DetailSection>
                        </TabsContent>

                        {/* Tab 2: Configuration based on tool type */}
                        <TabsContent value="config" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                            {category === "http_api" && (
                                <>
                                    <DetailSection
                                        title="Endpoint Configuration"
                                        description="HTTP request method, destination URL, and credentials."
                                    >
                                        <div className="space-y-4">
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-1.5">
                                                    <Label>HTTP Method</Label>
                                                    <HttpMethodSelector
                                                        value={httpMethod}
                                                        onChange={setHttpMethod}
                                                    />
                                                </div>
                                                <div className="space-y-1.5">
                                                    <Label>Timeout (ms)</Label>
                                                    <Input
                                                        type="number"
                                                        value={timeoutMs}
                                                        onChange={(e) => setTimeoutMs(parseInt(e.target.value) || 5000)}
                                                        min={1000}
                                                        max={30000}
                                                        className="text-xs"
                                                    />
                                                </div>
                                            </div>

                                            <div className="space-y-1.5">
                                                <Label>Endpoint URL</Label>
                                                <UrlInput
                                                    value={url}
                                                    onChange={setUrl}
                                                    placeholder="https://api.example.com/endpoint"
                                                    showValidation
                                                />
                                            </div>

                                            <CredentialSelector
                                                value={credentialUuid}
                                                onChange={setCredentialUuid}
                                                label="Credential (Optional)"
                                                description="Select an authentication credential, or leave empty if public."
                                            />
                                        </div>
                                    </DetailSection>

                                    <DetailSection
                                        title="Headers"
                                        description="Custom HTTP headers to include with the request."
                                    >
                                        <KeyValueEditor
                                            items={headers}
                                            onChange={setHeaders}
                                            keyPlaceholder="Header name (e.g. X-Api-Key)"
                                            valuePlaceholder="Header value"
                                        />
                                    </DetailSection>

                                    <DetailSection
                                        title="Parameters"
                                        description="Dynamic arguments extracted from caller speech and passed to the API."
                                    >
                                        <ParameterEditor
                                            parameters={parameters}
                                            onChange={setParameters}
                                        />
                                    </DetailSection>

                                    <DetailSection
                                        title="Preset Parameters"
                                        description="Static or template parameters automatically appended to the payload."
                                    >
                                        <PresetParameterEditor
                                            parameters={presetParameters}
                                            onChange={setPresetParameters}
                                        />
                                    </DetailSection>
                                </>
                            )}

                            {category === "website_scraper" && (
                                <DetailSection
                                    title="Scraper Settings"
                                    description="Web page target, content extraction type, and character limits."
                                >
                                    <div className="space-y-4">
                                        <div className="space-y-1.5">
                                            <Label>Target URL</Label>
                                            <UrlInput
                                                value={scraperUrl}
                                                onChange={setScraperUrl}
                                                placeholder="https://example.com/docs"
                                                showValidation
                                            />
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-1.5">
                                                <Label>Extraction Type</Label>
                                                <Select
                                                    value={extractionType}
                                                    onValueChange={(v) => setExtractionType(v as "full_text" | "main_content" | "meta_only")}
                                                >
                                                    <SelectTrigger className="w-full text-xs">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="main_content">Main Content</SelectItem>
                                                        <SelectItem value="full_text">Full Text</SelectItem>
                                                        <SelectItem value="meta_only">Metadata Only</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label>Max Characters</Label>
                                                <Input
                                                    type="number"
                                                    value={maxLength}
                                                    onChange={(e) => setMaxLength(parseInt(e.target.value) || 8000)}
                                                    className="text-xs"
                                                />
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between rounded-lg border border-border p-3">
                                            <div className="space-y-0.5">
                                                <Label className="text-xs">Include Links</Label>
                                                <p className="text-[11px] text-muted-foreground">
                                                    Extract and append hyperlinks found on the page.
                                                </p>
                                            </div>
                                            <Switch
                                                checked={includeLinks}
                                                onCheckedChange={setIncludeLinks}
                                            />
                                        </div>

                                        <CredentialSelector
                                            value={scraperCredentialUuid}
                                            onChange={setScraperCredentialUuid}
                                            label="Credential (Optional)"
                                            description="Select a credential if this page requires authentication."
                                        />
                                    </div>
                                </DetailSection>
                            )}

                            {category === "mcp" && (
                                <DetailSection
                                    title="MCP Server Settings"
                                    description="Connect to an external Model Context Protocol server over HTTP."
                                >
                                    <div className="space-y-4">
                                        <div className="space-y-1.5">
                                            <Label>Server URL</Label>
                                            <Input
                                                value={mcpUrl}
                                                onChange={(e) => setMcpUrl(e.target.value)}
                                                placeholder="https://your-mcp-server.example.com/mcp"
                                                className="text-xs"
                                            />
                                            <p className="text-[11px] text-muted-foreground">
                                                Must begin with http:// or https://.
                                            </p>
                                        </div>

                                        <div className="space-y-1.5">
                                            <Label>Transport</Label>
                                            <Input value="Streamable HTTP" disabled readOnly className="text-xs" />
                                        </div>

                                        <CredentialSelector
                                            value={mcpCredentialUuid}
                                            onChange={setMcpCredentialUuid}
                                            label="Credential (Optional)"
                                            description="Select a credential for authenticating with the MCP server."
                                        />

                                        <div className="space-y-1.5">
                                            <Label>Tools Filter (Optional)</Label>
                                            <Input
                                                value={mcpToolsFilter}
                                                onChange={(e) => setMcpToolsFilter(e.target.value)}
                                                placeholder="e.g., tool_one, tool_two"
                                                className="text-xs"
                                            />
                                            <p className="text-[11px] text-muted-foreground">
                                                Comma-separated list of tool names to expose. Leave empty to allow all.
                                            </p>
                                        </div>
                                    </div>
                                </DetailSection>
                            )}

                            {category === "end_call" && (
                                <DetailSection
                                    title="End Call Settings"
                                    description="Configure call termination behavior and AI prompt controls."
                                >
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between rounded-lg border border-border p-3">
                                            <div className="space-y-0.5">
                                                <Label className="text-xs">End Call Reason Detection</Label>
                                                <p className="text-[11px] text-muted-foreground">
                                                    Prompt the LLM to record the reason for ending the call.
                                                </p>
                                            </div>
                                            <Switch
                                                checked={endCallReason}
                                                onCheckedChange={handleEndCallReasonChange}
                                            />
                                        </div>

                                        {endCallReason && (
                                            <div className="space-y-1.5">
                                                <Label>Reason Description</Label>
                                                <Textarea
                                                    value={endCallReasonDescription}
                                                    onChange={(e) => setEndCallReasonDescription(e.target.value)}
                                                    rows={3}
                                                    className="text-xs"
                                                />
                                            </div>
                                        )}
                                    </div>
                                </DetailSection>
                            )}

                            {category === "transfer_call" && (
                                <DetailSection
                                    title="Transfer Call Settings"
                                    description="Forward the call to a telephone number or SIP endpoint."
                                >
                                    <div className="space-y-4">
                                        <div className="space-y-1.5">
                                            <Label>Destination</Label>
                                            <Input
                                                value={transferDestination}
                                                onChange={(e) => setTransferDestination(e.target.value)}
                                                placeholder="e.g. +14155552671 or PJSIP/1001"
                                                className="text-xs font-mono"
                                            />
                                            <p className="text-[11px] text-muted-foreground">
                                                Supports phone numbers in E.164 format or Asterisk SIP endpoints (e.g., PJSIP/1234).
                                            </p>
                                        </div>

                                        <div className="space-y-1.5">
                                            <Label>Timeout (seconds)</Label>
                                            <Input
                                                type="number"
                                                value={transferTimeout}
                                                onChange={(e) => setTransferTimeout(parseInt(e.target.value) || 30)}
                                                min={5}
                                                max={120}
                                                className="text-xs"
                                            />
                                        </div>
                                    </div>
                                </DetailSection>
                            )}

                            {category === "calculator" && (
                                <DetailSection
                                    title="Calculator Settings"
                                    description="Built-in arithmetic capabilities."
                                >
                                    <p className="text-xs text-muted-foreground">
                                        Built-in calculator tool for arithmetic operations. No additional configuration is required.
                                    </p>
                                </DetailSection>
                            )}
                        </TabsContent>

                        {/* Tab 3: Post-execution Message */}
                        <TabsContent value="post_execution" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                            <DetailSection
                                title="Post-execution Message"
                                description="Configure an optional message the AI speaks or plays after executing this tool."
                            >
                                <div className="space-y-4">
                                    <div className="space-y-1.5">
                                        <Label>Message Type</Label>
                                        <Select
                                            value={messageType}
                                            onValueChange={(val) => setMessageType(val as "none" | "text" | "audio")}
                                        >
                                            <SelectTrigger className="w-full text-xs">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="none">None (Silent execution)</SelectItem>
                                                <SelectItem value="text">Text (Spoken by AI via TTS)</SelectItem>
                                                <SelectItem value="audio">Pre-recorded Audio</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    {messageType === "text" && (
                                        <div className="space-y-1.5">
                                            <Label>Custom Spoken Message</Label>
                                            <Textarea
                                                value={customMessage}
                                                onChange={(e) => setCustomMessage(e.target.value)}
                                                placeholder="e.g., Let me check that for you, one moment please."
                                                rows={3}
                                                className="text-xs"
                                            />
                                            <p className="text-[11px] text-muted-foreground">
                                                The AI assistant will speak this message to the caller after the tool completes.
                                            </p>
                                        </div>
                                    )}

                                    {messageType === "audio" && (
                                        <div className="space-y-1.5">
                                            <Label>Audio Recording</Label>
                                            <Select value={recordingId} onValueChange={setRecordingId}>
                                                <SelectTrigger className="w-full text-xs">
                                                    <SelectValue
                                                        placeholder={
                                                            recordings.length === 0
                                                                ? "No recordings available"
                                                                : "Select a recording..."
                                                        }
                                                    />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {recordings.map((rec) => (
                                                        <SelectItem key={rec.id} value={String(rec.id)}>
                                                            {rec.transcript ||
                                                                (rec.metadata?.original_filename as string) ||
                                                                rec.recording_id ||
                                                                `Recording ${rec.id}`}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <p className="text-[11px] text-muted-foreground">
                                                Pre-recorded audio file to broadcast to the caller after the tool finishes.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </DetailSection>
                        </TabsContent>
                    </SheetBody>

                    {/* Shared footer: Back (left corner) + Cancel & Next/Save (right) */}
                    <SheetFooter className="justify-between">
                        <div>
                            {activeTab !== "general" && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={handlePrev}
                                    disabled={isSubmitting}
                                >
                                    <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
                                    Previous
                                </Button>
                            )}
                        </div>

                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => onOpenChange(false)}
                                disabled={isSubmitting}
                            >
                                Cancel
                            </Button>

                            {activeTab !== "post_execution" ? (
                                <Button
                                    type="button"
                                    size="sm"
                                    onClick={handleNext}
                                    disabled={isSubmitting}
                                >
                                    Next
                                    <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                                </Button>
                            ) : (
                                <Button
                                    type="button"
                                    size="sm"
                                    onClick={handleSubmit}
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting
                                        ? isCreate
                                            ? "Creating…"
                                            : "Saving…"
                                        : isCreate
                                        ? "Create Tool"
                                        : "Save Changes"}
                                </Button>
                            )}
                        </div>
                    </SheetFooter>
                </Tabs>
            </SheetContent>
        </Sheet>
    );
}
