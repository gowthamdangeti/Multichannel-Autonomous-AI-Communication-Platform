"use client";

import { Code, Loader2, Save } from "lucide-react";
import { useEffect, useState } from "react";

import {
    listRecordingsApiV1WorkflowRecordingsGet,
    updateToolApiV1ToolsToolUuidPut,
} from "@/client/sdk.gen";
import type {
    EndCallConfig,
    HttpApiToolDefinition,
    RecordingResponseSchema,
    ToolResponse,
    TransferCallConfig as APITransferCallConfig,
    UpdateToolRequest,
} from "@/client/types.gen";
import {
    CredentialSelector,
    type HttpMethod,
    type KeyValueItem,
    type ParameterType,
    type PresetToolParameter,
    type ToolParameter,
    validateUrl,
} from "@/components/http";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { detailFromError } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

import { BuiltinToolConfig } from "./BuiltinToolConfig";
import { createMcpDefinition, DEFAULT_END_CALL_REASON_DESCRIPTION, type EndCallMessageType, MCP_URL_PATTERN } from "./config";
import { EndCallToolConfig } from "./EndCallToolConfig";
import { HttpApiToolConfig } from "./HttpApiToolConfig";
import { TransferCallToolConfig } from "./TransferCallToolConfig";
import { WebsiteScraperToolConfig } from "./WebsiteScraperToolConfig";

function normalizeParameterType(value: string | null | undefined): ParameterType {
    switch (value) {
        case "number":
        case "boolean":
        case "object":
        case "array":
            return value;
        default:
            return "string";
    }
}

export interface ToolConfigEditorProps {
    toolUuid: string;
    tool: ToolResponse;
    onToolSaved?: (tool: ToolResponse) => void;
    /** Sticks the action bar to the bottom of its scroll container (drawers). */
    actionsSticky?: boolean;
}

/** The full tool editor (identity + category configuration + save). Shared by the
 *  tool detail page and the off-canvas tool drawer so both edit identically. */
export function ToolConfigEditor({ toolUuid, tool, onToolSaved, actionsSticky = false }: ToolConfigEditorProps) {
    const { getAccessToken } = useAuth();

    // Common form state
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");

    // Shared form state
    const [customMessage, setCustomMessage] = useState("");

    // HTTP API form state
    const [httpMethod, setHttpMethod] = useState<HttpMethod>("POST");
    const [url, setUrl] = useState("");
    const [credentialUuid, setCredentialUuid] = useState("");
    const [headers, setHeaders] = useState<KeyValueItem[]>([]);
    const [parameters, setParameters] = useState<ToolParameter[]>([]);
    const [presetParameters, setPresetParameters] = useState<PresetToolParameter[]>([]);
    const [timeoutMs, setTimeoutMs] = useState(5000);

    // End Call form state
    const [endCallMessageType, setEndCallMessageType] = useState<EndCallMessageType>("none");
    const [endCallReason, setEndCallReason] = useState(false);
    const [endCallReasonDescription, setEndCallReasonDescription] = useState("");
    const [audioRecordingId, setAudioRecordingId] = useState("");

    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [showCodeDialog, setShowCodeDialog] = useState(false);

    // Transfer Call form state
    const [transferDestination, setTransferDestination] = useState("");
    const [transferMessageType, setTransferMessageType] = useState<EndCallMessageType>("none");
    const [transferTimeout, setTransferTimeout] = useState(30);
    const [transferAudioRecordingId, setTransferAudioRecordingId] = useState("");

    // HTTP API form state - custom message type
    const [customMessageType, setCustomMessageType] = useState<'text' | 'audio'>('text');
    const [customMessageRecordingId, setCustomMessageRecordingId] = useState("");

    // Website Scraper form state
    const [extractionType, setExtractionType] = useState<"full_text" | "main_content" | "meta_only">("main_content");
    const [includeLinks, setIncludeLinks] = useState(false);
    const [maxLength, setMaxLength] = useState(8000);
    const [scraperTimeoutMs, setScraperTimeoutMs] = useState(10000);

    // MCP form state
    const [mcpUrl, setMcpUrl] = useState("");
    const [mcpCredentialUuid, setMcpCredentialUuid] = useState("");
    const [mcpToolsFilter, setMcpToolsFilter] = useState("");

    // Org-level recordings for audio dropdowns
    const [recordings, setRecordings] = useState<RecordingResponseSchema[]>([]);

    const handleEndCallReasonChange = (enabled: boolean) => {
        setEndCallReason(enabled);
        if (enabled && !endCallReasonDescription) {
            setEndCallReasonDescription(DEFAULT_END_CALL_REASON_DESCRIPTION);
        }
    };

    // Populate the form whenever a (possibly refreshed) tool arrives.
    useEffect(() => {
        const cfg = tool.definition?.config as
            | EndCallConfig
            | APITransferCallConfig
            | HttpApiToolDefinition["config"]
            | { url?: string; credential_uuid?: string | null; tools_filter?: string[] }
            | { url?: string; extraction_type?: string; include_links?: boolean; max_length?: number; timeout_ms?: number; credential_uuid?: string | null; customMessage?: string; customMessageType?: string; customMessageRecordingId?: string }
            | undefined;

        setName(tool.name);
        setDescription(tool.description || "");

        if (tool.category === "end_call") {
            const config = cfg as EndCallConfig | undefined;
            setEndCallMessageType(config?.messageType || "none");
            setCustomMessage(config?.customMessage || "");
            setAudioRecordingId(config?.audioRecordingId || "");
            setEndCallReason(config?.endCallReason ?? false);
            setEndCallReasonDescription(config?.endCallReasonDescription || "");
        } else if (tool.category === "transfer_call") {
            const config = cfg as APITransferCallConfig | undefined;
            setTransferDestination(config?.destination || "");
            setTransferMessageType(config?.messageType || "none");
            setCustomMessage(config?.customMessage || "");
            setTransferAudioRecordingId(config?.audioRecordingId || "");
            setTransferTimeout(config?.timeout ?? 30);
        } else if (tool.category === "website_scraper") {
            const config = cfg as
                | {
                    url?: string;
                    extraction_type?: string;
                    include_links?: boolean;
                    max_length?: number;
                    timeout_ms?: number;
                    credential_uuid?: string | null;
                    customMessage?: string;
                    customMessageType?: string;
                    customMessageRecordingId?: string;
                }
                | undefined;
            setUrl(config?.url || "");
            setExtractionType((config?.extraction_type as "full_text" | "main_content" | "meta_only") || "main_content");
            setIncludeLinks(config?.include_links ?? false);
            setMaxLength(config?.max_length ?? 8000);
            setScraperTimeoutMs(config?.timeout_ms ?? 10000);
            setCredentialUuid(config?.credential_uuid || "");
            setCustomMessage(config?.customMessage || "");
            setCustomMessageType((config?.customMessageType as "text" | "audio") || "text");
            setCustomMessageRecordingId(config?.customMessageRecordingId || "");
        } else if (tool.category === "mcp") {
            const config = cfg as { url?: string; credential_uuid?: string | null; tools_filter?: string[] } | undefined;
            setMcpUrl(config?.url || "");
            setMcpCredentialUuid(config?.credential_uuid || "");
            setMcpToolsFilter(
                Array.isArray(config?.tools_filter)
                    ? config.tools_filter.join(", ")
                    : ""
            );
        } else {
            const config = cfg as HttpApiToolDefinition["config"] | undefined;
            setHttpMethod((config?.method as HttpMethod) || "POST");
            setUrl(config?.url || "");
            setCredentialUuid(config?.credential_uuid || "");
            setTimeoutMs(config?.timeout_ms || 5000);
            setCustomMessage(config?.customMessage || "");
            setCustomMessageType(config?.customMessageType || "text");
            setCustomMessageRecordingId(config?.customMessageRecordingId || "");
            setHeaders(
                config?.headers
                    ? Object.entries(config.headers).map(([key, value]) => ({ key, value: value as string }))
                    : []
            );
            setParameters(
                Array.isArray(config?.parameters)
                    ? config.parameters.map((p) => ({
                        name: p.name || "",
                        type: normalizeParameterType(p.type),
                        description: p.description || "",
                        required: p.required ?? true,
                    }))
                    : []
            );
            setPresetParameters(
                Array.isArray(config?.preset_parameters)
                    ? config.preset_parameters.map((p) => ({
                        name: p.name || "",
                        type: normalizeParameterType(p.type),
                        valueTemplate: p.value_template || "",
                        required: p.required ?? true,
                    }))
                    : []
            );
        }
    }, [tool]);

    useEffect(() => {
        const fetchRecordings = async () => {
            try {
                const response = await listRecordingsApiV1WorkflowRecordingsGet({
                    query: {},
                });
                if (response.data) {
                    setRecordings(response.data.recordings);
                }
            } catch {
                // Non-critical — dropdowns will show "No recordings available"
            }
        };
        fetchRecordings();
    }, []);

    const handleSave = async () => {
        // Validation based on tool type
        if (tool.category === "calculator") {
            // No validation needed for built-in tools
        } else if (tool.category === "transfer_call") {
            // Validate destination for Transfer Call tools (supports both E.164 and SIP endpoints)
            const e164Pattern = /^\+[1-9]\d{1,14}$/;
            const sipPattern = /^(PJSIP|SIP)\/[\w\-\.@]+$/i;
            const isValidE164 = e164Pattern.test(transferDestination);
            const isValidSip = sipPattern.test(transferDestination);

            if (!transferDestination || (!isValidE164 && !isValidSip)) {
                setError("Please enter a valid phone number (E.164 format) or SIP endpoint (e.g., PJSIP/1234)");
                return;
            }
        } else if (tool.category === "mcp") {
            // Validate MCP server URL (must be http(s))
            if (!mcpUrl.trim()) {
                setError("Please enter the MCP server URL");
                return;
            }
            if (!MCP_URL_PATTERN.test(mcpUrl.trim())) {
                setError("MCP server URL must start with http:// or https://");
                return;
            }
        } else if (tool.category !== "end_call") {
            // Validate URL for HTTP API tools
            const urlValidation = validateUrl(url);
            if (!urlValidation.valid) {
                setError(urlValidation.error || "Invalid URL");
                return;
            }

            // Validate parameters have names
            const invalidParams = parameters.filter((p) => !p.name.trim());
            if (invalidParams.length > 0) {
                setError("All parameters must have a name");
                return;
            }

            const invalidPresetParams = presetParameters.filter(
                (p) => !p.name.trim() || !p.valueTemplate.trim()
            );
            if (invalidPresetParams.length > 0) {
                setError("All preset parameters must have a name and a value");
                return;
            }
        }

        try {
            setIsSaving(true);
            setError(null);
            setSaveSuccess(false);
            const accessToken = await getAccessToken();

            let requestBody: UpdateToolRequest;

            if (tool.category === "calculator") {
                // Built-in tool - only name/description, no config
                requestBody = {
                    name,
                    description: description || undefined,
                    definition: {
                        schema_version: 1,
                        type: "calculator",
                    },
                };
            } else if (tool.category === "end_call") {
                // Build end call request body
                requestBody = {
                    name,
                    description: description || undefined,
                    definition: {
                        schema_version: 1,
                        type: "end_call",
                        config: {
                            messageType: endCallMessageType,
                            customMessage: endCallMessageType === "custom" ? customMessage : undefined,
                            audioRecordingId: endCallMessageType === "audio" ? audioRecordingId || undefined : undefined,
                            endCallReason,
                            endCallReasonDescription: endCallReason ? endCallReasonDescription || undefined : undefined,
                        },
                    },
                };
            } else if (tool.category === "transfer_call") {
                // Build transfer call request body
                requestBody = {
                    name,
                    description: description || undefined,
                    definition: {
                        schema_version: 1,
                        type: "transfer_call",
                        config: {
                            destination: transferDestination,
                            messageType: transferMessageType,
                            customMessage: transferMessageType === "custom" ? customMessage : undefined,
                            audioRecordingId: transferMessageType === "audio" ? transferAudioRecordingId || undefined : undefined,
                            timeout: transferTimeout,
                        },
                    },
                };
            } else if (tool.category === "mcp") {
                requestBody = {
                    name,
                    description: description || undefined,
                    definition: createMcpDefinition(mcpUrl, mcpCredentialUuid, mcpToolsFilter),
                };
            } else {
                // Build HTTP API request body
                const headersObject: Record<string, string> = {};
                headers.filter((h) => h.key && h.value).forEach((h) => {
                    headersObject[h.key] = h.value;
                });

                const validParameters = parameters.filter((p) => p.name.trim());
                const validPresetParameters = presetParameters.filter(
                    (p) => p.name.trim() && p.valueTemplate.trim()
                );

                requestBody = {
                    name,
                    description: description || undefined,
                    definition: {
                        schema_version: 1,
                        type: "http_api",
                        config: {
                            method: httpMethod,
                            url,
                            credential_uuid: credentialUuid || undefined,
                            headers:
                                Object.keys(headersObject).length > 0
                                    ? headersObject
                                    : undefined,
                            parameters:
                                validParameters.length > 0 ? validParameters : undefined,
                            preset_parameters:
                                validPresetParameters.length > 0
                                    ? validPresetParameters.map((p) => ({
                                        name: p.name,
                                        type: p.type,
                                        value_template: p.valueTemplate,
                                        required: p.required,
                                    }))
                                    : undefined,
                            timeout_ms: timeoutMs,
                            customMessage: customMessageType === 'text' ? (customMessage || undefined) : undefined,
                            customMessageType,
                            customMessageRecordingId: customMessageType === 'audio' ? (customMessageRecordingId || undefined) : undefined,
                        },
                    },
                };
            }

            const response = await updateToolApiV1ToolsToolUuidPut({
                path: { tool_uuid: toolUuid },
                body: requestBody,
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });

            if (response.error) {
                setError(detailFromError(response.error, "Failed to save tool"));
                return;
            }

            if (response.data) {
                setSaveSuccess(true);
                setTimeout(() => setSaveSuccess(false), 3000);
                onToolSaved?.(response.data);
            }
        } catch (err) {
            setError("Failed to save tool");
            console.error("Error saving tool:", err);
        } finally {
            setIsSaving(false);
        }
    };

    const getCodeSnippet = () => {
        const headersObj: Record<string, string> = {
            "Content-Type": "application/json",
        };
        headers.filter((h) => h.key && h.value).forEach((h) => {
            headersObj[h.key] = h.value;
        });

        // Build example body from parameters
        const exampleBody: Record<string, unknown> = {};
        parameters.forEach((p) => {
            if (p.type === "number") {
                exampleBody[p.name] = 0;
            } else if (p.type === "boolean") {
                exampleBody[p.name] = true;
            } else {
                exampleBody[p.name] = `<${p.name}>`;
            }
        });
        presetParameters.forEach((p) => {
            if (p.type === "number") {
                exampleBody[p.name] = p.valueTemplate || 0;
            } else if (p.type === "boolean") {
                exampleBody[p.name] = p.valueTemplate || true;
            } else {
                exampleBody[p.name] = p.valueTemplate || `<${p.name}>`;
            }
        });

        const hasBody =
            httpMethod !== "GET" &&
            httpMethod !== "DELETE" &&
            (parameters.length > 0 || presetParameters.length > 0);

        return `// ${tool.name}
// ${tool.description || "HTTP API Tool"}

const response = await fetch("${url}", {
    method: "${httpMethod}",
    headers: ${JSON.stringify(headersObj, null, 4)},${hasBody ? `
    body: JSON.stringify(${JSON.stringify(exampleBody, null, 4)}),` : ""}
});

const data = await response.json();`;
    };

    const isEndCallTool = tool.category === "end_call";
    const isTransferCallTool = tool.category === "transfer_call";
    const isBuiltinTool = tool.category === "calculator";
    const isMcpTool = tool.category === "mcp";
    const isWebsiteScraperTool = tool.category === "website_scraper";
    const showCode = !isEndCallTool && !isTransferCallTool && !isBuiltinTool && !isMcpTool && !isWebsiteScraperTool;

    return (
        <div className="space-y-4">
            {isBuiltinTool ? (
                <BuiltinToolConfig
                    name={name}
                    onNameChange={setName}
                    description={description}
                    onDescriptionChange={setDescription}
                    title="Calculator Configuration"
                    subtitle="Built-in calculator for arithmetic operations. No additional configuration needed."
                />
            ) : isEndCallTool ? (
                <EndCallToolConfig
                    name={name}
                    onNameChange={setName}
                    description={description}
                    onDescriptionChange={setDescription}
                    messageType={endCallMessageType}
                    onMessageTypeChange={setEndCallMessageType}
                    customMessage={customMessage}
                    onCustomMessageChange={setCustomMessage}
                    audioRecordingId={audioRecordingId}
                    onAudioRecordingIdChange={setAudioRecordingId}
                    recordings={recordings}
                    endCallReason={endCallReason}
                    onEndCallReasonChange={handleEndCallReasonChange}
                    endCallReasonDescription={endCallReasonDescription}
                    onEndCallReasonDescriptionChange={setEndCallReasonDescription}
                />
            ) : isTransferCallTool ? (
                <TransferCallToolConfig
                    name={name}
                    onNameChange={setName}
                    description={description}
                    onDescriptionChange={setDescription}
                    destination={transferDestination}
                    onDestinationChange={setTransferDestination}
                    messageType={transferMessageType}
                    onMessageTypeChange={setTransferMessageType}
                    customMessage={customMessage}
                    onCustomMessageChange={setCustomMessage}
                    audioRecordingId={transferAudioRecordingId}
                    onAudioRecordingIdChange={setTransferAudioRecordingId}
                    recordings={recordings}
                    timeout={transferTimeout}
                    onTimeoutChange={setTransferTimeout}
                />
            ) : isWebsiteScraperTool ? (
                <WebsiteScraperToolConfig
                    name={name}
                    onNameChange={setName}
                    description={description}
                    onDescriptionChange={setDescription}
                    url={url}
                    onUrlChange={setUrl}
                    extractionType={extractionType}
                    onExtractionTypeChange={setExtractionType}
                    includeLinks={includeLinks}
                    onIncludeLinksChange={setIncludeLinks}
                    maxLength={maxLength}
                    onMaxLengthChange={setMaxLength}
                    timeoutMs={scraperTimeoutMs}
                    onTimeoutMsChange={setScraperTimeoutMs}
                    credentialUuid={credentialUuid}
                    onCredentialUuidChange={setCredentialUuid}
                    customMessage={customMessage}
                    onCustomMessageChange={setCustomMessage}
                    customMessageType={customMessageType}
                    onCustomMessageTypeChange={setCustomMessageType}
                    customMessageRecordingId={customMessageRecordingId}
                    onCustomMessageRecordingIdChange={setCustomMessageRecordingId}
                    recordings={recordings}
                />
            ) : isMcpTool ? (
                <Card>
                    <CardHeader>
                        <CardTitle>MCP Server Configuration</CardTitle>
                        <CardDescription>
                            Configure the MCP server endpoint. Its tools become available to the agent.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="space-y-2">
                            <Label htmlFor="mcp-name">Tool Name</Label>
                            <Input
                                id="mcp-name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g., Customer MCP Server"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="mcp-description">Description</Label>
                            <p className="text-xs text-muted-foreground">
                                Provide a description which makes it easy for LLM to understand what this tool does
                            </p>
                            <Textarea
                                id="mcp-description"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="What does this MCP server provide?"
                                rows={3}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="mcp-url">MCP Server URL</Label>
                            <Input
                                id="mcp-url"
                                value={mcpUrl}
                                onChange={(e) => setMcpUrl(e.target.value)}
                                placeholder="https://your-mcp-server.example.com/mcp"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Transport</Label>
                            <Input
                                value="Streamable HTTP"
                                disabled
                                readOnly
                            />
                        </div>

                        <CredentialSelector
                            value={mcpCredentialUuid}
                            onChange={setMcpCredentialUuid}
                            label="Credential (Optional)"
                            description="Select a credential for authenticating with the MCP server, or leave empty for no auth."
                        />

                        <div className="space-y-2">
                            <Label htmlFor="mcp-tools-filter">Tools Filter (Optional)</Label>
                            <Input
                                id="mcp-tools-filter"
                                value={mcpToolsFilter}
                                onChange={(e) => setMcpToolsFilter(e.target.value)}
                                placeholder="e.g., tool_one, tool_two"
                            />
                            <p className="text-xs text-muted-foreground">
                                Comma-separated list of tool names to allow. Leave empty to expose all tools from the server.
                            </p>
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <HttpApiToolConfig
                    name={name}
                    onNameChange={setName}
                    description={description}
                    onDescriptionChange={setDescription}
                    httpMethod={httpMethod}
                    onHttpMethodChange={setHttpMethod}
                    url={url}
                    onUrlChange={setUrl}
                    credentialUuid={credentialUuid}
                    onCredentialUuidChange={setCredentialUuid}
                    headers={headers}
                    onHeadersChange={setHeaders}
                    parameters={parameters}
                    onParametersChange={setParameters}
                    presetParameters={presetParameters}
                    onPresetParametersChange={setPresetParameters}
                    timeoutMs={timeoutMs}
                    onTimeoutMsChange={setTimeoutMs}
                    customMessage={customMessage}
                    onCustomMessageChange={setCustomMessage}
                    customMessageType={customMessageType}
                    onCustomMessageTypeChange={setCustomMessageType}
                    customMessageRecordingId={customMessageRecordingId}
                    onCustomMessageRecordingIdChange={setCustomMessageRecordingId}
                    recordings={recordings}
                />
            )}

            {error && (
                <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
                    {error}
                </div>
            )}

            {saveSuccess && (
                <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg text-green-600">
                    Tool saved successfully!
                </div>
            )}

            <div className={cn(
                "mt-6 flex items-center justify-end gap-3",
                actionsSticky &&
                    "sticky bottom-0 -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-sm"
            )}>
                {showCode && (
                    <Button variant="outline" size="sm" onClick={() => setShowCodeDialog(true)} className="h-9">
                        <Code className="w-4 h-4 mr-2" />
                        View Code
                    </Button>
                )}
                <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? (
                        <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Saving...
                        </>
                    ) : (
                        <>
                            <Save className="w-4 h-4 mr-2" />
                            Save
                        </>
                    )}
                </Button>
            </div>

            {/* Code View Dialog (only for HTTP API tools) */}
            <Dialog open={showCodeDialog} onOpenChange={setShowCodeDialog}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Code Preview</DialogTitle>
                        <DialogDescription>
                            JavaScript code to make this API call
                        </DialogDescription>
                    </DialogHeader>
                    <div className="bg-muted rounded-lg p-4 font-mono text-sm overflow-auto max-h-96">
                        <pre>{getCodeSnippet()}</pre>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
