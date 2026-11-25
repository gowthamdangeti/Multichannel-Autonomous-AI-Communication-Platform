"use client";

import {
    AlertCircle,
    BookOpen,
    Database,
    ExternalLink,
    Globe,
    MessageSquareText,
    Settings,
    SlidersHorizontal,
    Wrench,
} from "lucide-react";
import {
    type ComponentType,
    useCallback,
    useEffect,
    useMemo,
    useState,
} from "react";

import type { NodeSpec, PropertySpec } from "@/client/types.gen";
import { Button } from "@/components/ui/button";
import { SheetBody, SheetFooter } from "@/components/ui/sheet";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { UnderlineTabs } from "@/components/ui/underline-tabs";

import { useNodeEditDrawerContext } from "../nodes/common/NodeEditDialog";
import { evaluateDisplayOptions } from "./displayOptions";
import { PropertyInput, type RendererContext } from "./PropertyInput";

/** Surface of every card in the drawer: white on drawer background (identical to Org & Tools drawer). */
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
                    {description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                    )}
                </div>
                {action}
            </div>
            {children}
        </section>
    );
}

export interface NodeEditFormProps {
    spec: NodeSpec;
    /** Current form values keyed by property name. */
    values: Record<string, unknown>;
    onChange: (next: Record<string, unknown>) => void;
    context: RendererContext;
    extraContent?: React.ReactNode;
    extraContentBySection?: Partial<Record<NodeFormSectionId, React.ReactNode>>;
    initialSectionId?: NodeFormSectionId;
    onSave?: () => void;
    onCancel?: () => void;
    documentationUrl?: string;
    readOnly?: boolean;
    error?: string | null;
}

type NodeFormSectionId =
    | "basics"
    | "prompt"
    | "behavior"
    | "extraction"
    | "tools"
    | "knowledge"
    | "webhook"
    | "advanced";

interface NodeFormSection {
    id: NodeFormSectionId;
    label: string;
    description: string;
    icon: ComponentType<{ className?: string }>;
    properties: PropertySpec[];
}

const SECTION_META: Record<
    NodeFormSectionId,
    Omit<NodeFormSection, "properties">
> = {
    basics: {
        id: "basics",
        label: "Basics",
        description: "Identity and primary node details.",
        icon: Settings,
    },
    prompt: {
        id: "prompt",
        label: "Prompt",
        description: "Conversation instructions and spoken content.",
        icon: MessageSquareText,
    },
    behavior: {
        id: "behavior",
        label: "Behavior",
        description: "Runtime switches, checkboxes, and simple options.",
        icon: SlidersHorizontal,
    },
    extraction: {
        id: "extraction",
        label: "Extraction",
        description: "Variables and extraction instructions.",
        icon: Database,
    },
    tools: {
        id: "tools",
        label: "Tools",
        description: "Callable tools available to this node.",
        icon: Wrench,
    },
    knowledge: {
        id: "knowledge",
        label: "Knowledge Base",
        description: "Knowledge base documents this node can reference.",
        icon: BookOpen,
    },
    webhook: {
        id: "webhook",
        label: "Webhook",
        description: "Webhook URLs and API endpoints.",
        icon: Globe,
    },
    advanced: {
        id: "advanced",
        label: "Advanced",
        description: "Integrations, authentication, URLs, and remaining settings.",
        icon: SlidersHorizontal,
    },
};

const SECTION_ORDER: NodeFormSectionId[] = [
    "basics",
    "prompt",
    "behavior",
    "extraction",
    "tools",
    "knowledge",
    "advanced",
    "webhook",
];

function classifyProperty(prop: PropertySpec): NodeFormSectionId {
    const name = prop.name.toLowerCase();

    if (name === "name") return "basics";
    if (prop.type === "tool_refs" || name.includes("tool")) return "tools";
    if (prop.type === "document_refs" || name.includes("document") || name.includes("knowledge")) {
        return "knowledge";
    }
    if (name.startsWith("extraction") || name.includes("extract")) return "extraction";
    if (name.includes("webhook") || name.includes("endpoint")) {
        return "webhook";
    }
    if (name.startsWith("pre_call") || name.startsWith("callback")) {
        return "advanced";
    }
    if (
        prop.type === "mention_textarea" ||
        name.includes("prompt") ||
        name.includes("greeting") ||
        name.includes("message")
    ) {
        return "prompt";
    }
    if (
        prop.type === "boolean" ||
        prop.type === "options" ||
        prop.type === "multi_options" ||
        name.includes("enabled") ||
        name.includes("allow") ||
        name.includes("delayed") ||
        name.includes("schedule") ||
        name.includes("retry") ||
        name.includes("max_")
    ) {
        return "behavior";
    }

    return "advanced";
}

function buildNodeFormSections(
    properties: PropertySpec[],
    extraContentBySection?: Partial<Record<NodeFormSectionId, React.ReactNode>>,
): NodeFormSection[] {
    const grouped = new Map<NodeFormSectionId, PropertySpec[]>();

    for (const property of properties) {
        const sectionId = classifyProperty(property);
        grouped.set(sectionId, [...(grouped.get(sectionId) ?? []), property]);
    }

    return SECTION_ORDER.flatMap((sectionId) => {
        const sectionProperties = grouped.get(sectionId) ?? [];
        const hasExtraContent = Boolean(extraContentBySection?.[sectionId]);
        if (sectionProperties.length === 0 && !hasExtraContent) return [];
        return [{ ...SECTION_META[sectionId], properties: sectionProperties }];
    });
}

/**
 * Generic node-edit form rendered inside an off-canvas drawer.
 * Walks `spec.properties` once, evaluates each property's `display_options`
 * against current values, and renders each section inside a structured `<TabsContent>`
 * with cards wrapped in `<DetailSection>`, matching the Org and Tools drawer design.
 */
export function NodeEditForm({
    spec,
    values,
    onChange,
    context,
    extraContent,
    extraContentBySection,
    initialSectionId,
    onSave: propsOnSave,
    onCancel: propsOnCancel,
    documentationUrl: propsDocUrl,
    readOnly: propsReadOnly,
    error: propsError,
}: NodeEditFormProps) {
    const drawer = useNodeEditDrawerContext();
    const onSave = propsOnSave ?? drawer?.onSave;
    const onCancel = propsOnCancel ?? drawer?.onCancel;
    const documentationUrl = propsDocUrl ?? drawer?.documentationUrl;
    const readOnly = propsReadOnly ?? drawer?.readOnly ?? false;
    const error = propsError ?? drawer?.error;

    const [activeSectionId, setActiveSectionId] = useState<NodeFormSectionId | null>(
        initialSectionId ?? null,
    );
    const setProp = useCallback(
        (propName: string, propValue: unknown) => {
            onChange({ ...values, [propName]: propValue });
        },
        [values, onChange],
    );

    const sections = useMemo(
        () =>
            buildNodeFormSections(
                spec.properties.filter((p) =>
                    evaluateDisplayOptions(p.display_options, values),
                ),
                extraContentBySection,
            ),
        [spec.properties, values, extraContentBySection],
    );

    useEffect(() => {
        if (sections.length === 0) {
            setActiveSectionId(null);
            return;
        }

        if (!activeSectionId || !sections.some((section) => section.id === activeSectionId)) {
            setActiveSectionId(sections[0].id);
        }
    }, [activeSectionId, sections]);

    if (sections.length === 0) {
        return (
            <div className="flex min-h-0 flex-1 flex-col gap-0">
                <SheetBody className="px-4 py-4 space-y-4">
                    <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                        No editable settings are available for this node.
                    </p>
                </SheetBody>
                <SheetFooter className="justify-between">
                    <div>
                        {documentationUrl ? (
                            <a
                                href={documentationUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                                Docs
                                <ExternalLink className="h-3 w-3" />
                            </a>
                        ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                        {onCancel && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={onCancel}
                            >
                                Cancel
                            </Button>
                        )}
                    </div>
                </SheetFooter>
            </div>
        );
    }

    const currentTab = activeSectionId ?? sections[0].id;

    return (
        <Tabs
            value={currentTab}
            onValueChange={(v) => setActiveSectionId(v as NodeFormSectionId)}
            className="flex min-h-0 flex-1 flex-col gap-0"
        >
            {/* Fixed tab bar directly beneath title (identical to Tools, Org, & Agent drawers) */}
            {sections.length > 1 && (
                <div className="shrink-0 border-b border-border px-4 pb-3">
                    <UnderlineTabs
                        value={currentTab}
                        onValueChange={(v) => setActiveSectionId(v as NodeFormSectionId)}
                        items={sections.map((section) => ({
                            value: section.id,
                            label: section.label,
                        }))}
                    />
                </div>
            )}

            <SheetBody className="px-4 py-4 space-y-4">
                {error && (
                    <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive border border-destructive/30 shrink-0">
                        <AlertCircle className="h-4 w-4 flex-shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {sections.map((section) => (
                    <TabsContent
                        key={section.id}
                        value={section.id}
                        forceMount
                        className="mt-0 space-y-4 data-[state=inactive]:hidden"
                    >
                        <DetailSection
                            title={section.label}
                            description={section.description}
                        >
                            <div className="space-y-4">
                                {extraContentBySection?.[section.id]}
                                {section.properties.length > 0 && (
                                    <div className="grid gap-4">
                                        {section.properties.map((p) => (
                                            <PropertyInput
                                                key={p.name}
                                                spec={p}
                                                value={values[p.name]}
                                                onChange={(v) => setProp(p.name, v)}
                                                context={context}
                                            />
                                        ))}
                                    </div>
                                )}
                                {section.id === "basics" && extraContent}
                            </div>
                        </DetailSection>
                    </TabsContent>
                ))}
            </SheetBody>

            <SheetFooter className="justify-between">
                <div>
                    {documentationUrl ? (
                        <a
                            href={documentationUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                            Docs
                            <ExternalLink className="h-3 w-3" />
                        </a>
                    ) : null}
                </div>
                <div className="flex items-center gap-2">
                    {onCancel && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onCancel}
                        >
                            Cancel
                        </Button>
                    )}
                    {onSave && (
                        <Button
                            type="button"
                            size="sm"
                            onClick={onSave}
                            disabled={readOnly}
                        >
                            {readOnly ? "Read Only" : "Save Changes"}
                        </Button>
                    )}
                </div>
            </SheetFooter>
        </Tabs>
    );
}
