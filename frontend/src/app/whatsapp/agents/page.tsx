"use client";

import {
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    ArrowUpDown,
    BookOpen,
    Bot,
    Brain,
    CheckCircle2,
    Eye,
    Loader2,
    Pencil,
    Phone,
    Plus,
    Trash2,
    Wrench,
    XIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
    getModelConfigurationOptionsApiV1OrganizationsModelConfigurationOptionsGet,
    listDocumentsApiV1KnowledgeBaseDocumentsGet,
    listToolsApiV1ToolsGet,
} from "@/client/sdk.gen";
import type {
    DocumentResponseSchema,
    ModelConfigurationOption,
    ToolResponse,
} from "@/client/types.gen";
import {
    AgentMediaConfig,
    AgentMediaTab,
    DEFAULT_MEDIA_CONFIG,
} from "@/components/agent/AgentMediaTab";
import { PageFilterSelect } from "@/components/layout/PageFilterSelect";
import { PageSearchInput } from "@/components/layout/PageSearchInput";
import { RowAction, RowActionSeparator, RowActionsMenu } from "@/components/layout/RowActionsMenu";
import { TableNameLink } from "@/components/layout/TableNameLink";
import { TablePagination } from "@/components/layout/TablePagination";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
} from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
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
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { PageHeader } from "@/context/HeaderContext";
import { usePagination } from "@/hooks/usePagination";
import { detailFromError } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";
import { ACTIVE_FILTER_OPTIONS, ALL_FILTER, filterBySearch,matchesFilter, toActiveValue } from "@/lib/searchFilter";
import { cn } from "@/lib/utils";

interface WhatsAppMediaSettingsPayload {
    enabled: boolean;
    max_files: number;
    max_file_size_mb: number;
    allowed_extensions: string[];
    reply_with_voice?: boolean;
}

interface WhatsAppAgent {
    id: number;
    name: string;
    description: string | null;
    character: string | null;
    system_prompt: string;
    greeting: string | null;
    guardrails?: string | null;
    tool_ids?: number[];
    document_uuids?: string[];
    model_config_ref?: Record<string, unknown>;
    image_settings?: WhatsAppMediaSettingsPayload;
    document_settings?: WhatsAppMediaSettingsPayload;
    audio_settings?: WhatsAppMediaSettingsPayload;
    active_contacts: string[];
    deactive_contacts: string[];
    is_active: boolean;
    created_at?: string | null;
    total_runs?: number | null;
}

interface WhatsAppCharacter {
    key: string;
    name: string;
    gender: string;
    description: string;
    persona: string;
    greeting: string;
}


interface AgentDraft {
    id?: number;
    name: string;
    character: string;
    description: string;
    system_prompt: string;
    greeting: string;
    guardrails?: string;
    platform_model_configuration_id?: number | null;
    tool_ids: number[];
    document_uuids: string[];
    allowed_media: string[];
    media_config: AgentMediaConfig;
    active_numbers: string[];
    deactive_numbers: string[];
}

const EMPTY: AgentDraft = {
    name: "",
    character: "",
    description: "",
    system_prompt: "",
    greeting: "",
    guardrails: "",
    platform_model_configuration_id: null,
    tool_ids: [],
    document_uuids: [],
    allowed_media: [],
    media_config: DEFAULT_MEDIA_CONFIG,
    active_numbers: [],
    deactive_numbers: [],
};


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

export type WhatsAppDrawerTab =
    | "characters"
    | "general"
    | "model"
    | "tools"
    | "knowledge"
    | "media"
    | "active_numbers"
    | "deactive_numbers";

const DRAWER_TABS: { value: WhatsAppDrawerTab; label: string }[] = [
    { value: "characters", label: "Characters" },
    { value: "general", label: "General" },
    { value: "model", label: "Model" },
    { value: "tools", label: "Tools" },
    { value: "knowledge", label: "Knowledge Base" },
    { value: "media", label: "Media" },
    { value: "active_numbers", label: "Active Numbers" },
    { value: "deactive_numbers", label: "Deactive Numbers" },
];

// ---------------------------------------------------------------------------
// Tab content components
// ---------------------------------------------------------------------------

function CharactersTab({
    characters,
    draft,
    pickCharacter,
    setDraft,
}: {
    characters: WhatsAppCharacter[];
    draft: AgentDraft;
    pickCharacter: (c: WhatsAppCharacter) => void;
    setDraft: (updater: (d: AgentDraft) => AgentDraft) => void;
}) {
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [customName, setCustomName] = useState("");
    const [customPersona, setCustomPersona] = useState("");

    const isPresetSelected = characters.some((c) => c.key === draft.character);
    const isCustomSelected = Boolean(draft.character && (!isPresetSelected || draft.character === "custom"));

    const handleCreateCustom = () => {
        if (!customName.trim()) return;
        setDraft((d) => ({
            ...d,
            character: customName.trim(),
            system_prompt: customPersona,
        }));
        setCreateDialogOpen(false);
    };

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {characters.map((c) => (
                    <button
                        type="button"
                        key={c.key}
                        onClick={() => pickCharacter(c)}
                        className={cn(
                            "flex flex-col gap-0.5 rounded-lg border p-2.5 text-left transition-colors cursor-pointer",
                            draft.character === c.key ? "border-2 border-cta bg-accent/30" : "border-border hover:bg-accent"
                        )}
                    >
                        <div className="flex items-center justify-between w-full mb-0.5">
                            <span className="text-sm font-medium leading-tight">{c.name}</span>
                            {draft.character === c.key && <CheckCircle2 className="h-4 w-4 shrink-0 text-cta" />}
                        </div>
                        <span className="text-[11px] leading-tight text-muted-foreground">{c.description}</span>
                    </button>
                ))}

                {/* Create Character Card Button */}
                <button
                    type="button"
                    onClick={() => {
                        setCustomName(isCustomSelected ? (draft.character === "custom" ? "" : draft.character) : "");
                        setCustomPersona(draft.system_prompt || "");
                        setCreateDialogOpen(true);
                    }}
                    className={cn(
                        "flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-3 text-center transition-all cursor-pointer hover:border-cta hover:bg-accent/40",
                        isCustomSelected ? "border-2 border-cta bg-accent/20" : "border-border"
                    )}
                >
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary mb-0.5">
                        <Plus className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-xs font-semibold leading-tight">
                        {isCustomSelected && draft.character !== "custom" ? draft.character : "Create Character"}
                    </span>
                    <span className="text-[10px] leading-tight text-muted-foreground">
                        {isCustomSelected ? "Click to edit persona" : "Add custom name & prompt"}
                    </span>
                </button>
            </div>

            {/* Create Character Modal Popup */}
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                <DialogContent className="sm:max-w-md bg-card" hideCloseButton>
                    <DialogHeader className="text-left !gap-0.5 !space-y-0">
                        <div className="flex items-center justify-between gap-2 w-full">
                            <DialogTitle className="text-base font-semibold leading-none">Create Custom Character</DialogTitle>
                            <button
                                type="button"
                                onClick={() => setCreateDialogOpen(false)}
                                className="rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none text-muted-foreground hover:text-foreground cursor-pointer p-0.5"
                            >
                                <XIcon className="h-4 w-4" />
                                <span className="sr-only">Close</span>
                            </button>
                        </div>
                        <DialogDescription className="text-xs text-muted-foreground leading-normal mt-1">
                            Specify a character name and instructions for your agent persona.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3.5 py-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="char-name" className="text-xs font-semibold">
                                Character Name
                            </Label>
                            <Input
                                id="char-name"
                                placeholder="e.g. Senior Support Lead"
                                value={customName}
                                onChange={(e) => setCustomName(e.target.value)}
                                className="h-8 text-xs"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="char-persona" className="text-xs font-semibold">
                                Character Persona / Instructions
                            </Label>
                            <Textarea
                                id="char-persona"
                                rows={2}
                                className="text-xs min-h-[52px] max-h-32 resize-y"
                                placeholder="Write the persona instructions and guidance for this character..."
                                value={customPersona}
                                onChange={(e) => setCustomPersona(e.target.value)}
                            />
                        </div>
                    </div>

                    <DialogFooter className="flex items-center justify-end gap-3 sm:space-x-0">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setCreateDialogOpen(false)}
                            className="h-8 text-xs"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            onClick={handleCreateCustom}
                            disabled={!customName.trim()}
                            className="h-8 text-xs"
                        >
                            Save Character
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function ConfigTab({
    draft,
    setDraft,
}: {
    draft: AgentDraft;
    setDraft: (updater: (d: AgentDraft) => AgentDraft) => void;
}) {
    return (
        <div className="space-y-4">
            <div className="space-y-1.5">
                <Label htmlFor="a-name">Agent Name</Label>
                <Input
                    id="a-name"
                    placeholder="e.g. Recruiting Screener"
                    value={draft.name}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    className="text-xs"
                />
            </div>
            <div className="space-y-1.5">
                <Label htmlFor="a-desc">Description</Label>
                <Textarea
                    id="a-desc"
                    rows={2}
                    className="max-h-32 resize-none text-xs"
                    placeholder="Short summary (optional)"
                    value={draft.description}
                    onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                />
            </div>
            <div className="space-y-1.5">
                <Label htmlFor="a-greeting">First Message (Greeting)</Label>
                <Textarea
                    id="a-greeting"
                    rows={2}
                    className="max-h-32 resize-none text-xs"
                    placeholder="Hi! Thanks for reaching out — how can I help?"
                    value={draft.greeting}
                    onChange={(e) => setDraft((d) => ({ ...d, greeting: e.target.value }))}
                />
            </div>
            <div className="space-y-1.5">
                <Label htmlFor="a-prompt">Instructions (system prompt)</Label>
                <Textarea
                    id="a-prompt"
                    rows={4}
                    className="max-h-48 resize-y text-xs font-mono"
                    placeholder="You are a friendly recruiting assistant for Acme. Ask the candidate about…"
                    value={draft.system_prompt}
                    onChange={(e) => setDraft((d) => ({ ...d, system_prompt: e.target.value }))}
                />
            </div>
            <div className="space-y-1.5">
                <Label htmlFor="a-guardrails">Guardrails</Label>
                <Textarea
                    id="a-guardrails"
                    rows={2}
                    className="max-h-32 resize-none text-xs"
                    placeholder="e.g. Never share personal information. Always redirect sensitive questions to a human agent."
                    value={draft.guardrails || ""}
                    onChange={(e) => setDraft((d) => ({ ...d, guardrails: e.target.value }))}
                />
                <p className="text-[11px] text-muted-foreground">
                    Define safety rules and boundaries the agent must follow.
                </p>
            </div>
        </div>
    );
}

function ModelConfigTab({
    draft,
    setDraft,
    presetOptions,
    presetOptionsLoading,
}: {
    draft: AgentDraft;
    setDraft: (updater: (d: AgentDraft) => AgentDraft) => void;
    presetOptions: ModelConfigurationOption[];
    presetOptionsLoading: boolean;
}) {
    const selectedPresetId = draft.platform_model_configuration_id ?? (presetOptions.length > 0 ? presetOptions[0].id : null);

    if (presetOptionsLoading) {
        return (
            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                Loading configurations...
            </div>
        );
    }

    return (
        <div className="space-y-1.5">
            <Label htmlFor="model-cfg" className="text-xs font-semibold">
                Platform Model Configuration
            </Label>
            <Select
                value={selectedPresetId ? String(selectedPresetId) : ""}
                onValueChange={(val) => {
                    setDraft((d) => ({
                        ...d,
                        platform_model_configuration_id: val ? Number(val) : null,
                    }));
                }}
            >
                <SelectTrigger id="model-cfg" className="w-full text-xs cursor-pointer">
                    <SelectValue placeholder="Select a configuration" />
                </SelectTrigger>
                <SelectContent>
                    {presetOptions.map((opt) => (
                        <SelectItem key={opt.id} value={String(opt.id)} className="cursor-pointer text-xs">
                            {opt.name}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
                Select the voice engine, STT pipeline, and language model configuration for this WhatsApp agent.
            </p>
        </div>
    );
}

function ToolsTab({ tools, toolsLoading, draft, setDraft }: { tools: ToolResponse[]; toolsLoading: boolean; draft: AgentDraft; setDraft: (updater: (d: AgentDraft) => AgentDraft) => void; }) {
    if (toolsLoading) {
        return (
            <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (tools.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                <Wrench className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">No tools created yet</p>
                <p className="text-xs text-muted-foreground">
                    Create tools from the Tools page to make them available here.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {tools.map((tool) => (
                <div
                    key={tool.id}
                    className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-accent/30 transition-colors"
                >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <Wrench className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{tool.name}</p>
                        {tool.description && (
                            <p className="text-xs text-muted-foreground truncate">{tool.description}</p>
                        )}
                    </div>
                    <span className="shrink-0 rounded-md bg-muted/60 px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground">
                        {tool.category.replace(/_/g, " ")}
                    </span>
                    <Switch
                        checked={draft.tool_ids.includes(tool.id)}
                        onCheckedChange={(c) => {
                            setDraft(d => ({
                                ...d,
                                tool_ids: c ? [...d.tool_ids, tool.id] : d.tool_ids.filter(id => id !== tool.id)
                            }));
                        }}
                    />
                </div>
            ))}
        </div>
    );
}

function KnowledgeTab({ documents, documentsLoading, draft, setDraft }: { documents: DocumentResponseSchema[]; documentsLoading: boolean; draft: AgentDraft; setDraft: (updater: (d: AgentDraft) => AgentDraft) => void; }) {
    const getStatusBadge = (status: string) => {
        switch (status) {
            case "completed":
                return <span className="text-xs text-status-success font-medium">Completed</span>;
            case "processing":
                return <span className="text-xs text-primary font-medium animate-pulse">Processing</span>;
            case "pending":
                return <span className="text-xs text-status-warning font-medium">Pending</span>;
            case "failed":
                return <span className="text-xs text-destructive font-medium">Failed</span>;
            default:
                return <span className="text-xs text-muted-foreground">{status}</span>;
        }
    };

    if (documentsLoading) {
        return (
            <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (documents.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                <BookOpen className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">No documents uploaded yet</p>
                <p className="text-xs text-muted-foreground">
                    Upload documents from the Knowledge Base page to make them available here.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {documents.map((doc) => (
                <div
                    key={doc.document_uuid}
                    className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-accent/30 transition-colors"
                >
                    <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{doc.filename}</p>
                        <p className="text-xs text-muted-foreground">
                            {(doc.file_size_bytes / 1024).toFixed(1)} KB &middot; {doc.total_chunks} chunks
                        </p>
                    </div>
                    {getStatusBadge(doc.processing_status)}
                    <Switch
                        checked={draft.document_uuids.includes(doc.document_uuid)}
                        onCheckedChange={(c) => {
                            setDraft(d => ({
                                ...d,
                                document_uuids: c ? [...d.document_uuids, doc.document_uuid] : d.document_uuids.filter(id => id !== doc.document_uuid)
                            }));
                        }}
                    />
                </div>
            ))}
        </div>
    );
}

function NumberListTab({
    title,
    description,
    numbers,
    onAdd,
    onRemove,
}: {
    title: string;
    description: string;
    numbers: string[];
    onAdd: (num: string) => void;
    onRemove: (idx: number) => void;
}) {
    const [countryCode, setCountryCode] = useState("+91");
    const [phone, setPhone] = useState("");
    const [phoneError, setPhoneError] = useState<string | null>(null);

    const handleCountryCodeChange = (value: string) => {
        const digits = value.replace(/\D/g, "").slice(0, 4);
        setCountryCode(digits ? `+${digits}` : "");
        setPhoneError(null);
    };

    const handlePhoneChange = (value: string) => {
        setPhone(value.replace(/\D/g, "").slice(0, 15));
        setPhoneError(null);
    };

    const handleAdd = () => {
        const countryDigits = countryCode.replace(/\D/g, "");
        const normalizedCountryCode = countryDigits ? `+${countryDigits}` : "";
        const normalizedPhone = phone.replace(/\D/g, "");
        const normalizedNumber = `${normalizedCountryCode}${normalizedPhone}`;

        if (countryDigits.length < 1 || countryDigits.length > 4) {
            setPhoneError("Country code must be 1 to 4 digits.");
            return;
        }
        if (normalizedPhone.length < 7 || normalizedPhone.length > 15) {
            setPhoneError("Phone number must be 7 to 15 digits.");
            return;
        }
        if (numbers.includes(normalizedNumber)) {
            setPhoneError("This number is already added.");
            return;
        }

        onAdd(normalizedNumber);
        setPhone("");
        setPhoneError(null);
    };

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label className="text-xs font-semibold">{title}</Label>
                <div className="flex items-center gap-2">
                    <Input
                        value={countryCode}
                        onChange={e => handleCountryCodeChange(e.target.value)}
                        className="w-20 shrink-0 text-xs"
                        placeholder="+91"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={5}
                    />
                    <Input
                        value={phone}
                        onChange={e => handlePhoneChange(e.target.value)}
                        className="flex-1 text-xs"
                        placeholder="Phone Number"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={15}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleAdd();
                        }}
                    />
                    <Button type="button" size="sm" onClick={handleAdd} className="shrink-0 gap-1 h-8 text-xs cursor-pointer">
                        <Plus className="h-3.5 w-3.5" /> Add
                    </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">{description}</p>
                {phoneError && <p className="text-xs text-destructive">{phoneError}</p>}
            </div>

            {numbers.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-3">
                    {numbers.map((num, idx) => (
                        <div key={idx} className="flex items-center justify-between rounded-lg border border-border bg-card p-2.5 shadow-xs transition-colors hover:border-border/80">
                            <div className="flex items-center gap-2.5">
                                <div className="h-7 w-7 rounded-full bg-accent flex items-center justify-center shrink-0">
                                    <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                                </div>
                                <div className="flex flex-col">
                                    <p className="text-xs font-semibold leading-none">{num}</p>
                                </div>
                            </div>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive cursor-pointer" onClick={() => onRemove(idx)}>
                                <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function WhatsAppAgentsPage() {
    const router = useRouter();
    const { user, loading: authLoading, getAccessToken } = useAuth();
    const hasFetched = useRef(false);

    const [agents, setAgents] = useState<WhatsAppAgent[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState(ALL_FILTER);
    const [characters, setCharacters] = useState<WhatsAppCharacter[]>([]);
    const [loading, setLoading] = useState(true);

    const [editorOpen, setEditorOpen] = useState(false);
    const [draft, setDraft] = useState<AgentDraft>(EMPTY);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<WhatsAppDrawerTab>("characters");

    // Tools & Knowledge Base data
    const [tools, setTools] = useState<ToolResponse[]>([]);
    const [toolsLoading, setToolsLoading] = useState(false);
    const [documents, setDocuments] = useState<DocumentResponseSchema[]>([]);
    const [documentsLoading, setDocumentsLoading] = useState(false);

    // Model configuration data
    const [presetOptions, setPresetOptions] = useState<ModelConfigurationOption[]>([]);
    const [presetOptionsLoading, setPresetOptionsLoading] = useState(false);

    const authFetch = useCallback(
        async (path: string, opts: RequestInit = {}) => {
            const token = await getAccessToken();
            return fetch(`/api/v1${path}`, {
                ...opts,
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                    ...(opts.headers ?? {}),
                },
            });
        },
        [getAccessToken]
    );

    const loadAgents = useCallback(async () => {
        try {
            const res = await authFetch("/whatsapp/agents");
            if (res.ok) setAgents(await res.json());
        } catch {
            /* non-critical */
        } finally {
            setLoading(false);
        }
    }, [authFetch]);

    const loadCharacters = useCallback(async () => {
        try {
            const res = await authFetch("/whatsapp/characters");
            if (res.ok) setCharacters(await res.json());
        } catch {
            /* non-critical */
        }
    }, [authFetch]);

    const loadModelConfigurations = useCallback(async () => {
        setPresetOptionsLoading(true);
        try {
            const presetsRes = await getModelConfigurationOptionsApiV1OrganizationsModelConfigurationOptionsGet();
            if (presetsRes.data && presetsRes.data.length > 0) {
                setPresetOptions(presetsRes.data);
                setDraft((d) => {
                    if (d.platform_model_configuration_id == null) {
                        return { ...d, platform_model_configuration_id: presetsRes.data![0].id };
                    }
                    return d;
                });
            }
        } catch {
            /* non-critical */
        } finally {
            setPresetOptionsLoading(false);
        }
    }, []);

    const fetchTools = useCallback(async () => {
        setToolsLoading(true);
        try {
            const res = await listToolsApiV1ToolsGet();
            if (res.data) setTools(res.data);
        } catch {
            /* non-critical */
        } finally {
            setToolsLoading(false);
        }
    }, []);

    const fetchDocuments = useCallback(async () => {
        setDocumentsLoading(true);
        try {
            const res = await listDocumentsApiV1KnowledgeBaseDocumentsGet({ query: { limit: 100, offset: 0 } });
            if (res.data) setDocuments(res.data.documents);
        } catch {
            /* non-critical */
        } finally {
            setDocumentsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (authLoading || !user || hasFetched.current) return;
        hasFetched.current = true;
        loadAgents();
        loadCharacters();
        loadModelConfigurations();
    }, [authLoading, user, loadAgents, loadCharacters, loadModelConfigurations]);

    useEffect(() => {
        if (editorOpen) {
            fetchTools();
            fetchDocuments();
            loadModelConfigurations();
            setActiveTab("characters");
        }
    }, [editorOpen, fetchTools, fetchDocuments, loadModelConfigurations]);

    const pickCharacter = (c: WhatsAppCharacter) =>
        setDraft((d) => ({
            ...d,
            character: c.key,
            // Seed persona/greeting from the preset; user can still edit.
            system_prompt: c.persona,
            greeting: c.greeting,
        }));

    const openNew = () => {
        const defaultPresetId = presetOptions.length > 0 ? presetOptions[0].id : null;
        setDraft({
            ...EMPTY,
            platform_model_configuration_id: defaultPresetId,
        });
        setError(null);
        setEditorOpen(true);
    };
    const openEdit = (a: WhatsAppAgent) => {
        const existingRef = (a.model_config_ref || {}) as Record<string, unknown>;
        const refMediaConfig = existingRef.media_config as AgentMediaConfig | undefined;
        const defaultPresetId = presetOptions.length > 0 ? presetOptions[0].id : null;
        const platformModelId = existingRef.platform_model_configuration_id != null
            ? Number(existingRef.platform_model_configuration_id)
            : defaultPresetId;

        // Populate media_config from model_config_ref or top-level settings
        const media_config: AgentMediaConfig = {
            images: {
                enabled: a.image_settings?.enabled ?? refMediaConfig?.images?.enabled ?? DEFAULT_MEDIA_CONFIG.images.enabled,
                maxFiles: a.image_settings?.max_files ?? refMediaConfig?.images?.maxFiles ?? DEFAULT_MEDIA_CONFIG.images.maxFiles,
                maxSizeMB: a.image_settings?.max_file_size_mb ?? refMediaConfig?.images?.maxSizeMB ?? DEFAULT_MEDIA_CONFIG.images.maxSizeMB,
                allowedTypes: a.image_settings?.allowed_extensions
                    ? a.image_settings.allowed_extensions.map((e) => e.replace(/^\./, ""))
                    : (refMediaConfig?.images?.allowedTypes ?? DEFAULT_MEDIA_CONFIG.images.allowedTypes),
            },
            documents: {
                enabled: a.document_settings?.enabled ?? refMediaConfig?.documents?.enabled ?? DEFAULT_MEDIA_CONFIG.documents.enabled,
                maxFiles: a.document_settings?.max_files ?? refMediaConfig?.documents?.maxFiles ?? DEFAULT_MEDIA_CONFIG.documents.maxFiles,
                maxSizeMB: a.document_settings?.max_file_size_mb ?? refMediaConfig?.documents?.maxSizeMB ?? DEFAULT_MEDIA_CONFIG.documents.maxSizeMB,
                allowedTypes: a.document_settings?.allowed_extensions
                    ? a.document_settings.allowed_extensions.map((e) => e.replace(/^\./, ""))
                    : (refMediaConfig?.documents?.allowedTypes ?? DEFAULT_MEDIA_CONFIG.documents.allowedTypes),
            },
            audio: {
                enabled: a.audio_settings?.enabled ?? refMediaConfig?.audio?.enabled ?? DEFAULT_MEDIA_CONFIG.audio.enabled,
                maxFiles: a.audio_settings?.max_files ?? refMediaConfig?.audio?.maxFiles ?? DEFAULT_MEDIA_CONFIG.audio.maxFiles,
                maxSizeMB: a.audio_settings?.max_file_size_mb ?? refMediaConfig?.audio?.maxSizeMB ?? DEFAULT_MEDIA_CONFIG.audio.maxSizeMB,
                allowedTypes: a.audio_settings?.allowed_extensions
                    ? a.audio_settings.allowed_extensions.map((e) => e.replace(/^\./, ""))
                    : (refMediaConfig?.audio?.allowedTypes ?? DEFAULT_MEDIA_CONFIG.audio.allowedTypes),
                replyWithVoice: a.audio_settings?.reply_with_voice ?? refMediaConfig?.audio?.replyWithVoice ?? false,
            },
        };

        setDraft({
            id: a.id,
            name: a.name,
            character: a.character ?? "",
            description: a.description ?? "",
            system_prompt: a.system_prompt ?? "",
            greeting: a.greeting ?? "",
            guardrails: a.guardrails ?? "",
            platform_model_configuration_id: platformModelId,
            tool_ids: a.tool_ids ?? [],
            document_uuids: a.document_uuids ?? [],
            allowed_media: [],
            media_config,
            active_numbers: a.active_contacts ?? [],
            deactive_numbers: a.deactive_contacts ?? [],
        });
        setError(null);
        setEditorOpen(true);
    };

    const handlePrev = () => {
        setError(null);
        const idx = DRAWER_TABS.findIndex((t) => t.value === activeTab);
        if (idx > 0) {
            setActiveTab(DRAWER_TABS[idx - 1].value);
        }
    };

    const handleNext = () => {
        setError(null);
        if (activeTab === "general" && !draft.name.trim()) {
            setError("Agent name is required");
            toast.error("Please enter an agent name");
            return;
        }
        const idx = DRAWER_TABS.findIndex((t) => t.value === activeTab);
        if (idx !== -1 && idx < DRAWER_TABS.length - 1) {
            setActiveTab(DRAWER_TABS[idx + 1].value);
        }
    };

    const handleSave = async () => {
        if (!draft.name.trim()) {
            setError("Agent name is required");
            toast.error("Please enter an agent name");
            setActiveTab("general");
            return;
        }
        setSaving(true);
        setError(null);

        const currentAgent = agents.find((a) => a.id === draft.id);
        const existingRef = (currentAgent?.model_config_ref || {}) as Record<string, unknown>;

        const resolvedPresetId = draft.platform_model_configuration_id ?? (presetOptions.length > 0 ? presetOptions[0].id : null);

        const nextModelConfigRef: Record<string, unknown> = {
            ...existingRef,
            media_config: draft.media_config,
            platform_model_configuration_id: resolvedPresetId,
        };
        delete nextModelConfigRef.model_configuration_v2_override;

        const image_settings: WhatsAppMediaSettingsPayload = {
            enabled: Boolean(draft.media_config.images?.enabled),
            max_files: Number(draft.media_config.images?.maxFiles ?? 20),
            max_file_size_mb: Number(draft.media_config.images?.maxSizeMB ?? 100),
            allowed_extensions: (draft.media_config.images?.allowedTypes ?? []).map(
                (t) => (t.startsWith(".") ? t.toLowerCase() : `.${t.toLowerCase()}`)
            ),
        };
        const document_settings: WhatsAppMediaSettingsPayload = {
            enabled: Boolean(draft.media_config.documents?.enabled),
            max_files: Number(draft.media_config.documents?.maxFiles ?? 20),
            max_file_size_mb: Number(draft.media_config.documents?.maxSizeMB ?? 100),
            allowed_extensions: (draft.media_config.documents?.allowedTypes ?? []).map(
                (t) => (t.startsWith(".") ? t.toLowerCase() : `.${t.toLowerCase()}`)
            ),
        };
        const audio_settings: WhatsAppMediaSettingsPayload = {
            enabled: Boolean(draft.media_config.audio?.enabled),
            max_files: Number(draft.media_config.audio?.maxFiles ?? 20),
            max_file_size_mb: Number(draft.media_config.audio?.maxSizeMB ?? 100),
            allowed_extensions: (draft.media_config.audio?.allowedTypes ?? []).map(
                (t) => (t.startsWith(".") ? t.toLowerCase() : `.${t.toLowerCase()}`)
            ),
            reply_with_voice: Boolean(draft.media_config.audio?.replyWithVoice),
        };

        const payload = {
            name: draft.name.trim(),
            character: draft.character || "custom",
            description: draft.description.trim() || null,
            system_prompt: draft.system_prompt,
            greeting: draft.greeting.trim() || null,
            guardrails: draft.guardrails?.trim() || null,
            active_contacts: draft.active_numbers,
            deactive_contacts: draft.deactive_numbers,
            tool_ids: draft.tool_ids,
            document_uuids: draft.document_uuids,
            image_settings,
            document_settings,
            audio_settings,
            model_config_ref: nextModelConfigRef,
        };
        try {
            const res = draft.id
                ? await authFetch(`/whatsapp/agents/${draft.id}`, { method: "PATCH", body: JSON.stringify(payload) })
                : await authFetch("/whatsapp/agents", { method: "POST", body: JSON.stringify(payload) });
            if (!res.ok) {
                const b = await res.json().catch(() => ({}));
                const message = detailFromError(b, "Failed to save agent");
                setError(message);
                toast.error(message);
                return;
            }
            const saved: WhatsAppAgent = await res.json();
            setAgents((list) =>
                draft.id ? list.map((a) => (a.id === saved.id ? saved : a)) : [saved, ...list]
            );
            setEditorOpen(false);
            toast.success(draft.id ? "Agent updated" : "Agent created");
        } catch {
            const message = "Failed to save agent";
            setError(message);
            toast.error(message);
        } finally {
            setSaving(false);
        }
    };

    const remove = async (a: WhatsAppAgent) => {
        setAgents((list) => list.filter((x) => x.id !== a.id));
        await authFetch(`/whatsapp/agents/${a.id}`, { method: "DELETE" });
    };

    // Header sorting (client-side, current list only; null = server order).
    type WaAgentSortKey = 'id' | 'name' | 'model_config' | 'created_at' | 'total_runs';
    const [sortKey, setSortKey] = useState<WaAgentSortKey | null>(null);
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
    const toggleSort = (key: WaAgentSortKey) => {
        if (sortKey !== key) {
            setSortKey(key);
            setSortDir('asc');
        } else if (sortDir === 'asc') {
            setSortDir('desc');
        } else {
            setSortKey(null);
            setSortDir('asc');
        }
    };
    const SortIcon = ({ column }: { column: WaAgentSortKey }) => {
        if (sortKey !== column) return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />;
        return sortDir === 'asc'
            ? <ArrowUp className="h-3.5 w-3.5 text-foreground" />
            : <ArrowDown className="h-3.5 w-3.5 text-foreground" />;
    };
    const sortedAgents = useMemo(() => {
        if (!sortKey) return agents;
        const getAgentModelName = (agent: WhatsAppAgent): string => {
            const ref = (agent.model_config_ref || {}) as Record<string, unknown>;
            const presetId = ref.platform_model_configuration_id ?? (presetOptions.length > 0 ? presetOptions[0].id : null);
            if (presetId) {
                const preset = presetOptions.find((p) => p.id === Number(presetId));
                if (preset) return preset.name;
            }
            return '';
        };

        const dir = sortDir === 'asc' ? 1 : -1;
        return [...agents].sort((a, b) => {
            switch (sortKey) {
                case 'id':
                    return (a.id - b.id) * dir;
                case 'name':
                    return (a.name ?? '').localeCompare(b.name ?? '') * dir;
                case 'model_config':
                    return getAgentModelName(a).localeCompare(getAgentModelName(b)) * dir;
                case 'created_at':
                    return ((a.created_at ? new Date(a.created_at).getTime() : -1) - (b.created_at ? new Date(b.created_at).getTime() : -1)) * dir;
                case 'total_runs':
                    return ((a.total_runs ?? 0) - (b.total_runs ?? 0)) * dir;
            }
        });
    }, [agents, sortKey, sortDir, presetOptions]);
    const visibleAgents = filterBySearch(sortedAgents, searchQuery, (a) => a.name).filter((a) => matchesFilter(toActiveValue(a.is_active), statusFilter));
    const agentPagination = usePagination(visibleAgents);

    return (
        <div className="space-y-4 px-4 lg:px-6 pt-2 pb-6">
            <PageHeader
                title="WhatsApp Agents"
                subtitle="Create agents and attach them to your numbers"
                onRefresh={() => void loadAgents()}
                isRefreshing={loading}
                primaryAction={<Button onClick={openNew}>
                        <Plus className="mr-2 h-4 w-4" /> New agent
                    </Button>}
                toolbar={
                    <>
                        <PageSearchInput placeholder="Search agents..." value={searchQuery} onChange={setSearchQuery} />
                        <PageFilterSelect allLabel="All statuses" value={statusFilter} options={ACTIVE_FILTER_OPTIONS} onChange={setStatusFilter} />
                    </>
                }
            />

            {loading ? (
                <Card className="border border-border">
                    <CardContent className="p-12 text-center text-muted-foreground text-sm">
                        Loading WhatsApp agents...
                    </CardContent>
                </Card>
            ) : agents.length === 0 ? (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "color-mix(in oklch, var(--cta) 14%, transparent)", color: "var(--cta)" }}>
                            <Bot className="h-6 w-6" />
                        </div>
                        <div>
                            <p className="font-medium">No agents yet</p>
                            <p className="text-sm text-muted-foreground">Create an agent, then attach it to a WhatsApp number.</p>
                        </div>
                        <Button onClick={openNew}><Plus className="mr-2 h-4 w-4" /> New agent</Button>
                    </CardContent>
                </Card>
            ) : (
                <Card className="nb-card overflow-hidden border border-border">
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader className="nb-table-header">
                                <TableRow>
                                    <TableHead className="font-semibold">
                                        <button onClick={() => toggleSort('id')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by ID">
                                            ID <SortIcon column="id" />
                                        </button>
                                    </TableHead>
                                    <TableHead className="font-semibold">
                                        <button onClick={() => toggleSort('name')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by agent name">
                                            Agent Name <SortIcon column="name" />
                                        </button>
                                    </TableHead>
                                    <TableHead className="font-semibold">
                                        <button onClick={() => toggleSort('model_config')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by model config">
                                            Model Config <SortIcon column="model_config" />
                                        </button>
                                    </TableHead>
                                    <TableHead className="font-semibold">
                                        <button onClick={() => toggleSort('created_at')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by created date">
                                            Created At <SortIcon column="created_at" />
                                        </button>
                                    </TableHead>
                                    <TableHead className="font-semibold text-center">
                                        <button onClick={() => toggleSort('total_runs')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by total runs">
                                            Total Runs <SortIcon column="total_runs" />
                                        </button>
                                    </TableHead>
                                    <TableHead className="font-semibold text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {agentPagination.pageItems.map((a) => {
                                    return (
                                        <TableRow
                                            key={a.id}
                                            onClick={() => router.push(`/whatsapp/agents/${a.id}/view`)}
                                            className="hover:bg-accent/50 transition-colors cursor-pointer"
                                        >
                                            <TableCell className="text-muted-foreground font-mono">
                                                #{a.id}
                                            </TableCell>
                                            <TableCell className="font-medium">
                                                <TableNameLink href={`/whatsapp/agents/${a.id}/view`}>{a.name}</TableNameLink>
                                            </TableCell>
                                            <TableCell>
                                                {(() => {
                                                    const ref = (a.model_config_ref || {}) as Record<string, unknown>;
                                                    const presetId = ref.platform_model_configuration_id ?? (presetOptions.length > 0 ? presetOptions[0].id : null);
                                                    if (presetId) {
                                                        const preset = presetOptions.find((p) => p.id === Number(presetId));
                                                        if (preset) {
                                                            return (
                                                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-md">
                                                                    <Brain className="h-3.5 w-3.5" /> {preset.name}
                                                                </span>
                                                            );
                                                        }
                                                    }
                                                    return <span className="text-muted-foreground text-xs">—</span>;
                                                })()}
                                            </TableCell>
                                            <TableCell>
                                                {a.created_at
                                                    ? new Date(a.created_at).toLocaleDateString("en-US", {
                                                          year: "numeric",
                                                          month: "short",
                                                          day: "numeric",
                                                      })
                                                    : "—"}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-1 text-sm font-semibold bg-muted rounded-full">
                                                    {a.total_runs || 0}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                                <RowActionsMenu label={`Actions for ${a.name}`}>
                                                    <RowAction icon={<Eye />} href={`/whatsapp/agents/${a.id}/view`}>View</RowAction>
                                                    <RowAction icon={<Pencil />} onClick={(e) => {
                                                            e.stopPropagation();
                                                            openEdit(a);
                                                        }}>Edit</RowAction>
                                                    <RowActionSeparator />
                                                    <RowAction icon={<Trash2 />} onClick={(e) => {
                                                            e.stopPropagation();
                                                            remove(a);
                                                        }} destructive>Delete</RowAction>
                                                </RowActionsMenu>
</TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                        <TablePagination {...agentPagination} />
                    </CardContent>
                </Card>
            )}

            {/* Editor off-canvas drawer */}
            <Sheet open={editorOpen} onOpenChange={setEditorOpen}>
                <SheetContent side="right">
                    <SheetHeader>
                        <SheetTitle className="text-base truncate">
                            {draft.id ? "Edit WhatsApp Agent" : "Create WhatsApp Agent"}
                        </SheetTitle>
                        <SheetDescription className="sr-only">
                            Configure your WhatsApp agent
                        </SheetDescription>
                    </SheetHeader>

                    <Tabs
                        value={activeTab}
                        onValueChange={(value) => {
                            setError(null);
                            setActiveTab(value as WhatsAppDrawerTab);
                        }}
                        className="flex min-h-0 flex-1 flex-col gap-0"
                    >
                        {/* Fixed tab bar directly beneath title (identical to Org, Tools, and Telephony drawers) */}
                        <div className="shrink-0 border-b border-border px-4 pb-3">
                            <UnderlineTabs
                                value={activeTab}
                                onValueChange={(v) => {
                                    setError(null);
                                    setActiveTab(v as WhatsAppDrawerTab);
                                }}
                                items={DRAWER_TABS}
                            />
                        </div>

                        <SheetBody className="px-4 py-4 space-y-4">
                            {error && (
                                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                                    {error}
                                </div>
                            )}

                            {/* Characters Tab */}
                            <TabsContent value="characters" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                                <DetailSection
                                    title="Agent Character"
                                    description="Select a predefined character persona or create a custom character."
                                >
                                    <CharactersTab
                                        characters={characters}
                                        draft={draft}
                                        pickCharacter={pickCharacter}
                                        setDraft={setDraft}
                                    />
                                </DetailSection>
                            </TabsContent>

                            {/* General Tab */}
                            <TabsContent value="general" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                                <DetailSection
                                    title="General Information"
                                    description="Specify agent name, description, greeting message, instructions, and guardrails."
                                >
                                    <ConfigTab
                                        draft={draft}
                                        setDraft={setDraft}
                                    />
                                </DetailSection>
                            </TabsContent>

                            {/* Model Configuration Tab */}
                            <TabsContent value="model" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                                <DetailSection
                                    title="Platform Model Configuration"
                                    description="Choose the voice and language model configuration for this WhatsApp agent."
                                >
                                    <ModelConfigTab
                                        draft={draft}
                                        setDraft={setDraft}
                                        presetOptions={presetOptions}
                                        presetOptionsLoading={presetOptionsLoading}
                                    />
                                </DetailSection>
                            </TabsContent>

                            {/* Tools Tab */}
                            <TabsContent value="tools" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                                <DetailSection
                                    title="Agent Tools"
                                    description="Enable external tools that this agent can execute during conversations."
                                >
                                    <ToolsTab
                                        tools={tools}
                                        toolsLoading={toolsLoading}
                                        draft={draft}
                                        setDraft={setDraft}
                                    />
                                </DetailSection>
                            </TabsContent>

                            {/* Knowledge Base Tab */}
                            <TabsContent value="knowledge" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                                <DetailSection
                                    title="Knowledge Base"
                                    description="Attach documents to enhance the agent's contextual knowledge."
                                >
                                    <KnowledgeTab
                                        documents={documents}
                                        documentsLoading={documentsLoading}
                                        draft={draft}
                                        setDraft={setDraft}
                                    />
                                </DetailSection>
                            </TabsContent>

                            {/* Media Tab */}
                            <TabsContent value="media" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                                <DetailSection
                                    title="Media Configuration"
                                    description="Manage allowed media attachments (Images, Documents, Audio) for this agent."
                                >
                                    <AgentMediaTab
                                        config={draft.media_config}
                                        showOverviewCards={true}
                                        onChange={(updater) => setDraft((d) => ({ ...d, media_config: updater(d.media_config) }))}
                                    />
                                </DetailSection>
                            </TabsContent>

                            {/* Active Numbers Tab */}
                            <TabsContent value="active_numbers" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                                <DetailSection
                                    title="Active Numbers"
                                    description="If any are added, this agent replies only to these numbers. Leave empty to allow everyone."
                                >
                                    <NumberListTab
                                        title="Active Numbers"
                                        description="Enter numbers in E.164 format (with country code)."
                                        numbers={draft.active_numbers}
                                        onAdd={(num) => setDraft(d => ({ ...d, active_numbers: [...d.active_numbers, num] }))}
                                        onRemove={(idx) => setDraft(d => ({ ...d, active_numbers: d.active_numbers.filter((_, i) => i !== idx) }))}
                                    />
                                </DetailSection>
                            </TabsContent>

                            {/* Deactive Numbers Tab */}
                            <TabsContent value="deactive_numbers" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                                <DetailSection
                                    title="Deactive Numbers"
                                    description="These numbers are blocked even when the active list is empty or includes them."
                                >
                                    <NumberListTab
                                        title="Deactive Numbers"
                                        description="Enter numbers in E.164 format (with country code)."
                                        numbers={draft.deactive_numbers}
                                        onAdd={(num) => setDraft(d => ({ ...d, deactive_numbers: [...d.deactive_numbers, num] }))}
                                        onRemove={(idx) => setDraft(d => ({ ...d, deactive_numbers: d.deactive_numbers.filter((_, i) => i !== idx) }))}
                                    />
                                </DetailSection>
                            </TabsContent>
                        </SheetBody>

                        {/* Stepper Footer: matches Tools, Campaigns, & Telephony drawers */}
                        <SheetFooter className="justify-between border-t border-border px-4 py-3 bg-card/95">
                            <div>
                                {activeTab !== "characters" && (
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
                            </div>

                            <div className="flex items-center gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setEditorOpen(false)}
                                    disabled={saving}
                                    className="h-8 text-xs font-medium cursor-pointer"
                                >
                                    Cancel
                                </Button>

                                {activeTab === "deactive_numbers" ? (
                                    <Button
                                        type="button"
                                        size="sm"
                                        onClick={handleSave}
                                        disabled={saving || !draft.name.trim()}
                                        className="h-8 text-xs font-medium gap-1.5 cursor-pointer"
                                    >
                                        {saving ? (
                                            <>
                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                {draft.id ? "Saving…" : "Creating…"}
                                            </>
                                        ) : (
                                            draft.id ? "Save changes" : "Create agent"
                                        )}
                                    </Button>
                                ) : (
                                    <>
                                        {draft.id && (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={handleSave}
                                                disabled={saving || !draft.name.trim()}
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
        </div>
    );
}
