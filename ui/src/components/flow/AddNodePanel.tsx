"use client";

import * as LucideIcons from "lucide-react";
import { Circle, ExternalLink, type LucideIcon, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";

import type { NodeSpec } from "@/client/types.gen";
import { useNodeSpecs } from "@/components/flow/renderer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Sheet,
    SheetBody,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";

import { NodeType } from "./types";

interface AddNodePanelProps {
    isOpen: boolean;
    onClose: () => void;
    onNodeSelect: (nodeType: NodeType) => void;
}

const SECTION_ORDER: Array<{ category: NodeSpec["category"]; title: string; description: string }> = [
    { category: "call_node", title: "Agent Nodes", description: "Interactive voice agents and call handling steps." },
    { category: "trigger", title: "Triggers", description: "Entry points for initiating or scheduling workflow execution." },
    { category: "global_node", title: "Global Nodes", description: "Universal logic, fallback handlers, and QA evaluations." },
    { category: "integration", title: "Integrations", description: "Outbound webhooks, third-party APIs, and CRM synchronizations." },
];

/** Surface of every card in the drawer: white on drawer background. */
const DRAWER_CARD = "rounded-lg border border-border bg-card p-4 shadow-xs";

function DetailSection({
    title,
    description,
    children,
}: {
    title: string;
    description?: string;
    children: React.ReactNode;
}) {
    return (
        <section className={`${DRAWER_CARD} space-y-3`}>
            <div>
                <h4 className="text-sm font-semibold text-foreground">{title}</h4>
                {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
            </div>
            {children}
        </section>
    );
}

function resolveIcon(name: string): LucideIcon {
    const icons = LucideIcons as unknown as Record<string, LucideIcon>;
    return icons[name] ?? Circle;
}

export default function AddNodePanel({ isOpen, onNodeSelect, onClose }: AddNodePanelProps) {
    const { specs } = useNodeSpecs();
    const [searchQuery, setSearchQuery] = useState("");

    const filteredSections = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();

        return SECTION_ORDER.flatMap(({ category, title, description }) => {
            const categorySpecs = specs.filter((s) => {
                if (s.category !== category) return false;
                if (!query) return true;
                return (
                    s.display_name.toLowerCase().includes(query) ||
                    s.description.toLowerCase().includes(query)
                );
            });

            if (categorySpecs.length === 0) return [];

            return [{ title, description, specs: categorySpecs }];
        });
    }, [specs, searchQuery]);

    const handleSelect = (nodeType: NodeType) => {
        onNodeSelect(nodeType);
        onClose();
    };

    return (
        <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <SheetContent side="right" className="w-full sm:w-[400px] sm:max-w-[400px]">
                <SheetHeader>
                    <SheetTitle className="text-base font-semibold truncate pr-10">
                        Add Node
                    </SheetTitle>
                    <SheetDescription className="sr-only">
                        Select a node type to add to the workflow canvas.
                    </SheetDescription>
                </SheetHeader>

                <SheetBody className="px-4 py-4 space-y-4">
                    {/* Search filter input */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                            placeholder="Search node types..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="h-8 pl-8 text-xs bg-background"
                        />
                    </div>

                    {filteredSections.length === 0 ? (
                        <p className="rounded-md border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">
                            No node types match your filter.
                        </p>
                    ) : (
                        filteredSections.map(({ title, description, specs }) => (
                            <DetailSection key={title} title={title} description={description}>
                                <div className="space-y-2">
                                    {specs.map((spec) => {
                                        const Icon = resolveIcon(spec.icon);
                                        return (
                                            <button
                                                key={spec.name}
                                                type="button"
                                                className="w-full group text-left p-3 rounded-lg border border-border bg-card hover:bg-accent/40 hover:border-primary/40 transition-all flex items-start gap-3 cursor-pointer"
                                                onClick={() => handleSelect(spec.name as NodeType)}
                                            >
                                                <div className="p-2 rounded-md bg-muted group-hover:bg-primary/10 border border-border group-hover:border-primary/20 shrink-0 mt-0.5 transition-colors">
                                                    <Icon className="h-4 w-4 text-foreground group-hover:text-primary transition-colors" />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="font-medium text-xs text-foreground group-hover:text-primary transition-colors">
                                                            {spec.display_name}
                                                        </span>
                                                        <Plus className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                                    </div>
                                                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5 leading-relaxed">
                                                        {spec.description}
                                                    </p>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </DetailSection>
                        ))
                    )}
                </SheetBody>

                <SheetFooter className="justify-between">
                    <div>
                        <a
                            href="https://docs.convozent.ai/voice-agent/introduction"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                            Docs
                            <ExternalLink className="h-3 w-3" />
                        </a>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onClose}
                        >
                            Close
                        </Button>
                    </div>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
}
