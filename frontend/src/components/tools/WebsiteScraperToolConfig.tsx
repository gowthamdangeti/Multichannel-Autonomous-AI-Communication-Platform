"use client";

import type { RecordingResponseSchema } from "@/client/types.gen";
import { CredentialSelector } from "@/components/http";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export interface WebsiteScraperToolConfigProps {
    name: string;
    onNameChange: (name: string) => void;
    description: string;
    onDescriptionChange: (description: string) => void;

    // Scraper-specific fields
    url: string;
    onUrlChange: (url: string) => void;
    extractionType: "full_text" | "main_content" | "meta_only";
    onExtractionTypeChange: (type: "full_text" | "main_content" | "meta_only") => void;
    includeLinks: boolean;
    onIncludeLinksChange: (include: boolean) => void;
    maxLength: number;
    onMaxLengthChange: (maxLength: number) => void;
    timeoutMs: number;
    onTimeoutMsChange: (timeoutMs: number) => void;
    credentialUuid: string;
    onCredentialUuidChange: (uuid: string) => void;

    // Custom message fields
    customMessage: string;
    onCustomMessageChange: (message: string) => void;
    customMessageType: "text" | "audio";
    onCustomMessageTypeChange: (type: "text" | "audio") => void;
    customMessageRecordingId: string;
    onCustomMessageRecordingIdChange: (recordingId: string) => void;
    recordings: RecordingResponseSchema[];
}

export function WebsiteScraperToolConfig({
    name,
    onNameChange,
    description,
    onDescriptionChange,
    url,
    onUrlChange,
    extractionType,
    onExtractionTypeChange,
    includeLinks,
    onIncludeLinksChange,
    maxLength,
    onMaxLengthChange,
    timeoutMs,
    onTimeoutMsChange,
    credentialUuid,
    onCredentialUuidChange,
    customMessage,
    onCustomMessageChange,
    customMessageType,
    onCustomMessageTypeChange,
    customMessageRecordingId,
    onCustomMessageRecordingIdChange,
    recordings,
}: WebsiteScraperToolConfigProps) {
    return (
        <div className="space-y-6">
            {/* Name & Description */}
            <Card>
                <CardHeader>
                    <CardTitle>Website Scraper Configuration</CardTitle>
                    <CardDescription>
                        Configure the website scraper to fetch and extract content from web pages during a conversation.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* Tool Name */}
                    <div className="space-y-2">
                        <Label htmlFor="tool-name">Tool Name</Label>
                        <Input
                            id="tool-name"
                            value={name}
                            onChange={(e) => onNameChange(e.target.value)}
                            placeholder="e.g., Product Documentation Lookup"
                        />
                    </div>

                    {/* Tool Description */}
                    <div className="space-y-2">
                        <Label htmlFor="tool-description">Description</Label>
                        <p className="text-xs text-muted-foreground">
                            Provide a description which makes it easy for LLM to understand what this tool does
                        </p>
                        <Textarea
                            id="tool-description"
                            value={description}
                            onChange={(e) => onDescriptionChange(e.target.value)}
                            placeholder="Describe when this tool is useful..."
                            rows={3}
                        />
                    </div>

                    {/* Target URL */}
                    <div className="space-y-2">
                        <Label htmlFor="scraper-url">Target URL</Label>
                        <Input
                            id="scraper-url"
                            value={url}
                            onChange={(e) => onUrlChange(e.target.value)}
                            placeholder="https://example.com/page-to-scrape"
                        />
                        <p className="text-xs text-muted-foreground">
                            The URL that the agent will scrape. Can also be overridden by the agent at runtime.
                        </p>
                    </div>

                    {/* Extraction Type */}
                    <div className="space-y-2">
                        <Label htmlFor="extraction-type">Extraction Type</Label>
                        <Select
                            value={extractionType}
                            onValueChange={(v) => onExtractionTypeChange(v as "full_text" | "main_content" | "meta_only")}
                        >
                            <SelectTrigger id="extraction-type" className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="main_content">Main Content (Recommended)</SelectItem>
                                <SelectItem value="full_text">Full Text (All visible text)</SelectItem>
                                <SelectItem value="meta_only">Meta Only (Title &amp; description)</SelectItem>
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                            What to extract: &quot;Main Content&quot; tries to find the primary content area, &quot;Full Text&quot; returns all visible text, &quot;Meta Only&quot; returns only title and meta tags.
                        </p>
                    </div>

                    {/* Include Links Toggle */}
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <Label htmlFor="include-links">Include Links</Label>
                            <p className="text-xs text-muted-foreground">
                                When enabled, hyperlinks found on the page are returned alongside the content.
                            </p>
                        </div>
                        <Switch
                            id="include-links"
                            checked={includeLinks}
                            onCheckedChange={onIncludeLinksChange}
                        />
                    </div>

                    {/* Max Length */}
                    <div className="space-y-2">
                        <Label htmlFor="max-length">Max Characters</Label>
                        <Input
                            id="max-length"
                            type="number"
                            min={100}
                            max={50000}
                            value={maxLength}
                            onChange={(e) => onMaxLengthChange(parseInt(e.target.value) || 8000)}
                        />
                        <p className="text-xs text-muted-foreground">
                            Maximum characters of extracted text to return to the agent. Default: 8000.
                        </p>
                    </div>

                    {/* Timeout */}
                    <div className="space-y-2">
                        <Label htmlFor="scraper-timeout">Timeout (ms)</Label>
                        <Input
                            id="scraper-timeout"
                            type="number"
                            min={1000}
                            max={60000}
                            value={timeoutMs}
                            onChange={(e) => onTimeoutMsChange(parseInt(e.target.value) || 10000)}
                        />
                        <p className="text-xs text-muted-foreground">
                            Request timeout in milliseconds. Default: 10000 (10s).
                        </p>
                    </div>

                    {/* Credential */}
                    <CredentialSelector
                        value={credentialUuid}
                        onChange={onCredentialUuidChange}
                        label="Credential (Optional)"
                        description="Select a credential for authenticating with protected pages, or leave empty for public pages."
                    />
                </CardContent>
            </Card>

            {/* Custom Message */}
            <Card>
                <CardHeader>
                    <CardTitle>Post-execution Message</CardTitle>
                    <CardDescription>
                        Configure an optional message to play after the tool executes.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="space-y-2">
                        <Label htmlFor="cm-type">Message Type</Label>
                        <Select
                            value={customMessageType}
                            onValueChange={(v) => onCustomMessageTypeChange(v as "text" | "audio")}
                        >
                            <SelectTrigger id="cm-type" className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="text">Text (TTS)</SelectItem>
                                <SelectItem value="audio">Pre-recorded Audio</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {customMessageType === "text" && (
                        <div className="space-y-2">
                            <Label htmlFor="cm-text">Custom Message</Label>
                            <Input
                                id="cm-text"
                                value={customMessage}
                                onChange={(e) => onCustomMessageChange(e.target.value)}
                                placeholder="e.g., I've looked up that information for you."
                            />
                        </div>
                    )}

                    {customMessageType === "audio" && (
                        <div className="space-y-2">
                            <Label htmlFor="cm-audio">Audio Recording</Label>
                            <Select
                                value={customMessageRecordingId}
                                onValueChange={(v) => onCustomMessageRecordingIdChange(v)}
                            >
                                <SelectTrigger id="cm-audio" className="w-full">
                                    <SelectValue placeholder={recordings.length === 0 ? "No recordings available" : "Select a recording..."} />
                                </SelectTrigger>
                                <SelectContent>
                                    {recordings.map((recording) => (
                                        <SelectItem key={recording.id} value={String(recording.id)}>
                                            {recording.transcript || (recording.metadata?.original_filename as string) || recording.recording_id || `Recording ${recording.id}`}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
