"use client";

import { Code, Eye, Plus, Save, Search, Trash2, X } from "lucide-react";
import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { updateWorkflowApiV1WorkflowWorkflowIdPut } from "@/client/sdk.gen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { detailFromError } from "@/lib/apiError";
import logger from "@/lib/logger";
import type { ReportVariable, ReportVariableType } from "@/types/workflow-configurations";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
    ssr: false,
    loading: () => (
        <div className="flex h-full items-center justify-center bg-[#1e1e1e]">
            <span className="text-sm text-muted-foreground">Loading editor...</span>
        </div>
    ),
});

import { DEFAULT_REPORT_VARIABLE_ITEMS } from "@/app/campaigns/campaignReportUtils";

const SAMPLE_DATA: Record<string, unknown> = {
    run_id: "demo-001",
    campaign_id: "demo-campaign",
    agent_id: "demo-agent",
    created_at: new Date().toISOString(),
    phone_number: "+1 (555) 123-4567",
    call_disposition: "completed",
    call_duration: 342,
    call_tags: "follow-up, qualified",
    transcript_url: "https://example.com/transcript/demo-001",
    recording_url: "https://example.com/recording/demo-001.mp3",
    extracted_variables: {
        "Customer Name": "John Smith",
        "Intent": "Product Inquiry",
        "Sentiment": "Positive",
        "Priority": "Medium",
    },
    initial_context: { source: "inbound", channel: "phone" },
    gathered_context: { resolved: true, notes: "Interested in premium plan" },
};

const BUILTIN_VARS = new Set([
    "run_id", "campaign_id", "agent_id", "created_at", "phone_number",
    "call_disposition", "call_duration", "cost", "call_tags",
    "transcript_url", "recording_url", "extracted_variables",
]);

function inferVariableTypeFromContext(varName: string, template: string): ReportVariableType {
    const reFor = /\{%\s*for\s+.+?\s+in\s+/;
    const reIf = /\{%\s*if\s+/;

    const varRefRe = new RegExp(
        `\\{\\{\\s*${varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s*\\||\\s*\\.|\\s*\\}\\}|\\s)`,
    );

    const lines = template.split("\n");
    const usageContexts: string[] = [];
    for (const line of lines) {
        if (varRefRe.test(line)) usageContexts.push(line);
    }

    for (const line of usageContexts) {
        if (reFor.test(line) && line.includes(varName)) return "list";
    }

    for (const line of usageContexts) {
        if (reIf.test(line) && line.includes(varName)) return "yes_no";
    }

    for (const line of usageContexts) {
        if (/\/\s*10\b/.test(line) && line.includes(varName)) return "score";
        if (/\/\s*100\b/.test(line) && line.includes(varName)) return "number";
        if (/\|\s*int\b/.test(line) && line.includes(varName)) return "number";
        if (/\|\s*float\b/.test(line) && line.includes(varName)) return "number";
        if (/[\+\-\*\/]/.test(line) && line.includes(varName)) return "number";
    }

    for (const line of usageContexts) {
        if (/\|\s*join/.test(line) && line.includes(varName)) return "list";
    }

    return "text";
}

interface ExtractedVar {
    name: string;
    type: ReportVariableType;
    description: string;
}

function extractVariablesFromTemplate(template: string): ExtractedVar[] {
    const vars = new Map<string, ExtractedVar>();
    const loopVars = new Set<string>();
    let match: RegExpExecArray | null;

    // 1. Find for-loop iterables (collection vars) and track loop targets
    const forRegex = /\{%\s*for\s+(.+?)\s+in\s+([a-zA-Z_]\w*)/g;
    while ((match = forRegex.exec(template)) !== null) {
        const targets = match[1].split(",").map((t) => t.trim()).filter(Boolean);
        targets.forEach((t) => loopVars.add(t));
        const collectionVar = match[2];
        if (!BUILTIN_VARS.has(collectionVar) && !vars.has(collectionVar)) {
            vars.set(collectionVar, {
                name: collectionVar,
                type: "list",
                description: "",
            });
        }
    }

    // 2. Find all {{ variable }} references (handles filters like {{ var | default(...) }})
    const varRegex = /\{\{\s*([a-zA-Z_]\w*)/g;
    while ((match = varRegex.exec(template)) !== null) {
        const name = match[1];
        if (BUILTIN_VARS.has(name)) continue;
        if (loopVars.has(name)) continue;
        if (vars.has(name)) continue;
        const type = inferVariableTypeFromContext(name, template);
        vars.set(name, { name, type, description: "" });
    }

    // 3. Variables from {% if %} blocks (catches vars that only appear in conditionals)
    const ifRegex = /\{%\s*if\s+([a-zA-Z_]\w*)/g;
    while ((match = ifRegex.exec(template)) !== null) {
        const name = match[1];
        if (!BUILTIN_VARS.has(name) && !loopVars.has(name) && !vars.has(name)) {
            const type = inferVariableTypeFromContext(name, template);
            vars.set(name, { name, type, description: "" });
        }
    }

    return [...vars.values()];
}

interface VariableItem extends ReportVariable {
    id: string;
}

let idCounter = 0;
function createVariableId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `var_${Date.now()}_${++idCounter}_${Math.random().toString(36).slice(2, 9)}`;
}

function ensureVariableIds(vars: (ReportVariable | VariableItem)[]): VariableItem[] {
    return (vars || []).map((v) => ({
        name: v.name,
        type: v.type,
        description: v.description || "",
        id: ("id" in v && typeof (v as VariableItem).id === "string" && (v as VariableItem).id)
            ? (v as VariableItem).id
            : createVariableId(),
    }));
}

function toCleanReportVariable(v: VariableItem): ReportVariable {
    return {
        name: v.name,
        type: v.type,
        description: v.description,
    };
}

function mergeTemplateAndVariables(
    template: string,
    existing: VariableItem[]
): VariableItem[] {
    const extracted = extractVariablesFromTemplate(template);
    const result: VariableItem[] = [];
    const usedKeys = new Set<string>();

    // 1. Keep existing variables in their current order (maintains user customizations and custom-added variables)
    for (const v of existing) {
        const key = v.name.trim().toLowerCase();
        if (!key) {
            result.push(v);
            continue;
        }
        if (usedKeys.has(key)) continue;
        usedKeys.add(key);

        const match = DEFAULT_REPORT_VARIABLE_ITEMS.find(
            (d) => d.name.toLowerCase() === key
        );

        result.push({
            ...v,
            description: v.description || (match ? match.description : ""),
        });
    }

    // 2. Append newly extracted variables from template
    for (const ev of extracted) {
        const key = ev.name.trim().toLowerCase();
        if (usedKeys.has(key)) continue;
        usedKeys.add(key);

        const match = DEFAULT_REPORT_VARIABLE_ITEMS.find(
            (d) => d.name.toLowerCase() === key
        );

        result.push({
            id: createVariableId(),
            name: ev.name,
            type: match ? (match.type as ReportVariableType) : ev.type,
            description: match ? match.description : "",
        });
    }

    return result;
}

interface VariableCardProps {
    variable: VariableItem;
    onChange: (id: string, field: keyof ReportVariable, value: string) => void;
    onRemove: (id: string) => void;
}

const VariableCard = memo(function VariableCard({
    variable,
    onChange,
    onRemove,
}: VariableCardProps) {
    return (
        <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
            <div className="flex items-center gap-2">
                <Input
                    value={variable.name}
                    onChange={(e) => onChange(variable.id, "name", e.target.value)}
                    placeholder="Variable name"
                    className="h-8 text-xs font-mono font-medium flex-1 min-w-0"
                />
                <Select
                    value={variable.type}
                    onValueChange={(val) => onChange(variable.id, "type", val)}
                >
                    <SelectTrigger className="h-8 text-xs w-[110px] shrink-0 cursor-pointer">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="text" className="text-xs cursor-pointer">text</SelectItem>
                        <SelectItem value="number" className="text-xs cursor-pointer">number</SelectItem>
                        <SelectItem value="yes_no" className="text-xs cursor-pointer">yes/no</SelectItem>
                        <SelectItem value="list" className="text-xs cursor-pointer">list</SelectItem>
                        <SelectItem value="range" className="text-xs cursor-pointer">range</SelectItem>
                        <SelectItem value="score" className="text-xs cursor-pointer">score</SelectItem>
                    </SelectContent>
                </Select>
                <button
                    type="button"
                    onClick={() => onRemove(variable.id)}
                    className="shrink-0 flex items-center justify-center h-8 w-8 rounded-md border text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors cursor-pointer"
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </button>
            </div>
            <Textarea
                value={variable.description}
                onChange={(e) => onChange(variable.id, "description", e.target.value)}
                placeholder="Description"
                minRows={2}
                maxRows={4}
            />
        </div>
    );
});

function renderPreviewHtml(template: string): string {
    let rendered = template;
    for (const [key, value] of Object.entries(SAMPLE_DATA)) {
        const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g");
        rendered = rendered.replace(regex, String(value));
    }
    return rendered;
}

interface ReportTemplateSheetProps {
    workflowId: number;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initialTemplate: string;
    initialReportVariables: ReportVariable[];
    currentConfigurations: Record<string, unknown>;
    onSave: (template: string, reportVariables: ReportVariable[]) => void;
}

export function extractVariablesCount(template: string): number {
    return extractVariablesFromTemplate(template || "").length;
}

export function ReportTemplateSheet({
    workflowId,
    open,
    onOpenChange,
    initialTemplate,
    initialReportVariables,
    currentConfigurations,
    onSave,
}: ReportTemplateSheetProps) {
    const [template, setTemplate] = useState(initialTemplate || "");
    const [isSaving, setIsSaving] = useState(false);
    const [viewMode, setViewMode] = useState<"code" | "preview">("code");

    useEffect(() => {
        if (open) {
            setTemplate(initialTemplate || "");
            setViewMode("code");
        }
    }, [open, initialTemplate]);

    const isDirty = useMemo(() => {
        return (template || "").trim() !== (initialTemplate || "").trim();
    }, [template, initialTemplate]);

    const previewHtml = useMemo(() => renderPreviewHtml(template), [template]);

    const handleSave = useCallback(async () => {
        if (!template.trim()) {
            toast.error("Template cannot be empty");
            return;
        }
        setIsSaving(true);
        try {
            const merged = mergeTemplateAndVariables(
                template,
                ensureVariableIds(initialReportVariables || [])
            );
            const cleanVariables = merged
                .filter((v) => Boolean(v.name.trim()))
                .map(toCleanReportVariable);

            const response = await updateWorkflowApiV1WorkflowWorkflowIdPut({
                path: { workflow_id: workflowId },
                body: {
                    name: null,
                    workflow_definition: null,
                    workflow_configurations: {
                        ...currentConfigurations,
                        report_template: template,
                        report_variables: cleanVariables,
                    },
                },
            });
            if (response.error) {
                throw new Error(detailFromError(response.error, "Failed to save template"));
            }
            onSave(template, cleanVariables);
            toast.success("Report template saved");
            onOpenChange(false);
        } catch (err) {
            logger.error(`Failed to save report template: ${err}`);
            toast.error(err instanceof Error ? err.message : "Failed to save template");
        } finally {
            setIsSaving(false);
        }
    }, [template, initialReportVariables, workflowId, currentConfigurations, onSave, onOpenChange]);


    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side="right"
                className="w-full sm:w-[45%] sm:max-w-[45%] flex flex-col p-0 !gap-0 [&>button:last-child]:hidden"
            >
                <div className="flex items-center justify-between border-b px-5 py-3">
                    <div className="flex-1 min-w-0">
                        <SheetTitle className="text-base font-semibold leading-tight m-0">
                            Report Template
                        </SheetTitle>
                        <SheetDescription className="text-xs text-muted-foreground mt-0.5 m-0">
                            HTML + Jinja template with {"{{ variable }}"} syntax
                        </SheetDescription>
                    </div>
                    <button
                        onClick={() => onOpenChange(false)}
                        className="ml-3 flex items-center justify-center h-8 w-8 rounded-lg border bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0 cursor-pointer"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="flex-1 flex flex-col min-h-0">
                    <div className="flex items-center justify-end gap-2 border-b bg-muted/20 px-5 py-1.5">
                        <div className="flex items-center rounded-md border bg-background p-0.5">
                            <button
                                onClick={() => setViewMode("code")}
                                className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors cursor-pointer ${
                                    viewMode === "code"
                                        ? "bg-primary text-primary-foreground shadow-sm"
                                        : "text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                <Code className="h-3.5 w-3.5" />
                                Code
                            </button>
                            <button
                                onClick={() => setViewMode("preview")}
                                className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors cursor-pointer ${
                                    viewMode === "preview"
                                        ? "bg-primary text-primary-foreground shadow-sm"
                                        : "text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                <Eye className="h-3.5 w-3.5" />
                                Preview
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 min-h-0 px-3 py-2">
                        {viewMode === "code" ? (
                            <MonacoEditor
                                defaultLanguage="html"
                                theme="vs-dark"
                                value={template}
                                onChange={(value) => setTemplate(value || "")}
                                options={{
                                    minimap: { enabled: false },
                                    fontSize: 13,
                                    lineNumbers: "on",
                                    wordWrap: "on",
                                    scrollBeyondLastLine: false,
                                    automaticLayout: true,
                                    tabSize: 2,
                                    padding: { top: 8, bottom: 8 },
                                    overviewRulerLanes: 0,
                                    hideCursorInOverviewRuler: true,
                                    scrollbar: {
                                        vertical: "auto",
                                        horizontal: "auto",
                                        verticalScrollbarSize: 8,
                                        horizontalScrollbarSize: 8,
                                    },
                                }}
                            />
                        ) : (
                            <div className="h-full overflow-auto bg-white rounded-md border">
                                <iframe
                                    srcDoc={previewHtml}
                                    title="Report Preview"
                                    className="w-full h-full border-0"
                                    sandbox="allow-same-origin"
                                />
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex items-center justify-end gap-2.5 border-t border-border/60 px-4 py-2.5 shrink-0">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onOpenChange(false)}
                        disabled={isSaving}
                        className="h-8 text-xs px-4 font-medium shrink-0 cursor-pointer"
                    >
                        Cancel
                    </Button>
                    <Button
                        size="sm"
                        onClick={handleSave}
                        disabled={isSaving || !isDirty}
                        className="h-8 text-xs px-4 font-medium shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Save className="h-3.5 w-3.5 mr-1 shrink-0" />
                        {isSaving ? "Saving..." : "Save"}
                    </Button>
                </div>
            </SheetContent>
        </Sheet>
    );
}

export interface ExtractedVariablesSheetProps {
    workflowId: number;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    template: string;
    initialReportVariables: ReportVariable[];
    currentConfigurations: Record<string, unknown>;
    onSave: (variables: ReportVariable[]) => void;
}

export function ExtractedVariablesSheet({
    workflowId,
    open,
    onOpenChange,
    template,
    initialReportVariables,
    currentConfigurations,
    onSave,
}: ExtractedVariablesSheetProps) {
    const [reportVariables, setReportVariables] = useState<VariableItem[]>(() =>
        mergeTemplateAndVariables(template || "", ensureVariableIds(initialReportVariables || []))
    );
    const [searchTerm, setSearchTerm] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (open) {
            setReportVariables(
                mergeTemplateAndVariables(template || "", ensureVariableIds(initialReportVariables || []))
            );
            setSearchTerm("");
        }
    }, [open, template, initialReportVariables]);

    const handleVariableChange = useCallback((id: string, field: keyof ReportVariable, value: string) => {
        setReportVariables((prev) =>
            prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
        );
    }, []);

    const handleRemoveVariable = useCallback((id: string) => {
        setReportVariables((prev) => prev.filter((item) => item.id !== id));
    }, []);

    const filteredVariables = useMemo(() => {
        if (!searchTerm.trim()) return reportVariables;
        const term = searchTerm.toLowerCase();
        return reportVariables.filter(
            (v) =>
                v.name.toLowerCase().includes(term) ||
                v.type.toLowerCase().includes(term) ||
                v.description.toLowerCase().includes(term)
        );
    }, [reportVariables, searchTerm]);

    const handleAddVariable = useCallback(() => {
        setSearchTerm("");
        const newVar: VariableItem = {
            id: createVariableId(),
            name: "new_variable",
            type: "text",
            description: "",
        };
        setReportVariables((prev) => [newVar, ...prev]);
    }, []);

    const isDirty = useMemo(() => {
        const cleanInitial = (initialReportVariables || []).map((v) => ({
            name: v.name.trim(),
            type: v.type,
            description: (v.description || "").trim(),
        }));
        const cleanCurrent = reportVariables.map((v) => ({
            name: v.name.trim(),
            type: v.type,
            description: (v.description || "").trim(),
        }));
        if (cleanInitial.length !== cleanCurrent.length) return true;
        for (let i = 0; i < cleanCurrent.length; i++) {
            if (
                cleanCurrent[i].name !== cleanInitial[i].name ||
                cleanCurrent[i].type !== cleanInitial[i].type ||
                cleanCurrent[i].description !== cleanInitial[i].description
            ) {
                return true;
            }
        }
        return false;
    }, [reportVariables, initialReportVariables]);

    const handleSaveVariables = useCallback(async () => {
        setIsSaving(true);
        try {
            const cleanVariables = reportVariables
                .filter((v) => Boolean(v.name.trim()))
                .map(toCleanReportVariable);

            const response = await updateWorkflowApiV1WorkflowWorkflowIdPut({
                path: { workflow_id: workflowId },
                body: {
                    name: null,
                    workflow_definition: null,
                    workflow_configurations: {
                        ...currentConfigurations,
                        report_variables: cleanVariables,
                    },
                },
            });
            if (response.error) {
                throw new Error(detailFromError(response.error, "Failed to save variables"));
            }
            onSave(cleanVariables);
            toast.success(`${cleanVariables.length} variable(s) saved`);
            onOpenChange(false);
        } catch (err) {
            logger.error(`Failed to save report variables: ${err}`);
            toast.error(err instanceof Error ? err.message : "Failed to save variables");
        } finally {
            setIsSaving(false);
        }
    }, [reportVariables, workflowId, currentConfigurations, onSave, onOpenChange]);

    return (
        <Sheet open={open} onOpenChange={(val) => { onOpenChange(val); if (!val) setSearchTerm(""); }}>
            <SheetContent
                side="right"
                className="w-full sm:w-[45%] sm:max-w-[45%] flex flex-col p-0 !gap-0 [&>button:last-child]:hidden"
            >
                <div className="flex items-center justify-between border-b px-5 py-3">
                    <div className="flex-1 min-w-0">
                        <SheetTitle className="text-base font-semibold leading-tight m-0">
                            Extracted Variables
                        </SheetTitle>
                        <SheetDescription className="text-xs text-muted-foreground mt-0.5 m-0">
                            {reportVariables.length} variable(s) found in template
                        </SheetDescription>
                    </div>
                    <button
                        onClick={() => { onOpenChange(false); setSearchTerm(""); }}
                        className="ml-3 flex items-center justify-center h-8 w-8 rounded-lg border bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0 cursor-pointer"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="px-5 pt-4 pb-3 border-b">
                    <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                                placeholder="Search variables..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="h-8 text-xs pl-8"
                            />
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleAddVariable}
                            className="h-8 text-xs gap-1 shrink-0 cursor-pointer"
                        >
                            <Plus className="h-3.5 w-3.5" />
                            Add Variable
                        </Button>
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-3">
                    {filteredVariables.length === 0 && reportVariables.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-8">
                            No variables found in template. Add {"{{ variable_name }}"} placeholders or click &quot;Add Variable&quot;.
                        </p>
                    )}
                    {filteredVariables.length === 0 && reportVariables.length > 0 && (
                        <p className="text-sm text-muted-foreground text-center py-8">
                            No variables match &quot;{searchTerm}&quot;.
                        </p>
                    )}
                    {filteredVariables.map((v) => (
                        <VariableCard
                            key={v.id}
                            variable={v}
                            onChange={handleVariableChange}
                            onRemove={handleRemoveVariable}
                        />
                    ))}
                </div>

                <div className="flex items-center justify-end gap-2.5 border-t border-border/60 px-4 py-2.5 shrink-0">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { onOpenChange(false); setSearchTerm(""); }}
                        className="h-8 text-xs px-4 font-medium shrink-0 cursor-pointer"
                    >
                        Cancel
                    </Button>
                    <Button
                        size="sm"
                        onClick={handleSaveVariables}
                        disabled={isSaving || !isDirty}
                        className="h-8 text-xs px-4 font-medium shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Save className="h-3.5 w-3.5 mr-1 shrink-0" />
                        {isSaving ? "Saving..." : "Save Variables"}
                    </Button>
                </div>
            </SheetContent>
        </Sheet>
    );
}
