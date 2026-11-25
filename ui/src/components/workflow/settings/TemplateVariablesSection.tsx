"use client";


import { ExternalLink, Loader2, Pencil, Plus, Trash2Icon, Variable } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { TemplateVariableFormDialog } from "@/app/workflow/[workflowId]/components/TemplateVariableFormDialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SETTINGS_DOCUMENTATION_URLS } from "@/constants/documentation";


// ---------------------------------------------------------------------------
// Section: Template Variables
// ---------------------------------------------------------------------------

export function TemplateVariablesSection({
    templateContextVariables,
    onSave,
}: {
    templateContextVariables: Record<string, string>;
    onSave: (variables: Record<string, string>) => Promise<void>;
}) {
    const [contextVars, setContextVars] = useState<Record<string, string>>(templateContextVariables);
    const [dialogMode, setDialogMode] = useState<"add" | "edit">("add");
    const [dialogOpen, setDialogOpen] = useState(false);
    const [selectedName, setSelectedName] = useState<string | null>(null);
    const [deleteName, setDeleteName] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        setContextVars(templateContextVariables);
    }, [templateContextVariables]);

    const persistVariables = async (nextVariables: Record<string, string>, message: string) => {
        setIsSaving(true);
        try {
            await onSave(nextVariables);
            setContextVars(nextVariables);
            toast.success(message);
        } catch (error) {
            console.error("Failed to save template variables:", error);
            toast.error("Failed to save template variables. Please try again.");
            throw error;
        } finally {
            setIsSaving(false);
        }
    };

    const openAddDialog = () => {
        setDialogMode("add");
        setSelectedName(null);
        setDialogOpen(true);
    };

    const openEditDialog = (name: string) => {
        setDialogMode("edit");
        setSelectedName(name);
        setDialogOpen(true);
    };

    const handleVariableSubmit = async (name: string, value: string) => {
        const nextVariables = { ...contextVars, [name]: value };
        await persistVariables(
            nextVariables,
            dialogMode === "add" ? "Template variable added." : "Template variable updated.",
        );
    };

    const handleDelete = async () => {
        if (!deleteName) return;
        const nextVariables = { ...contextVars };
        delete nextVariables[deleteName];
        try {
            await persistVariables(nextVariables, "Template variable deleted.");
            setDeleteName(null);
        } catch {
            // Keep the confirmation open so the user can retry or cancel.
        }
    };

    const entries = Object.entries(contextVars).sort(([left], [right]) => left.localeCompare(right));

    return (
        <Card id="variables">
            <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1.5">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Variable className="h-4 w-4" />
                        Template Variables
                    </CardTitle>
                    <CardDescription>
                        Variables available in workflow prompts via {`{{variable_name}}`} syntax for testing the workflow.{" "}
                        <a href={SETTINGS_DOCUMENTATION_URLS.templateVariables} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline">Learn more <ExternalLink className="h-3 w-3" /></a>
                    </CardDescription>
                </div>
                <Button size="sm" onClick={openAddDialog} disabled={isSaving} className="shrink-0">
                    <Plus className="h-4 w-4" />
                    Add Variable
                </Button>
            </CardHeader>
            <CardContent>
                {entries.length === 0 ? (
                    <div className="rounded-md border border-dashed px-4 py-8 text-center">
                        <p className="text-sm font-medium">No template variables</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                            Add one here or include a placeholder when creating an agent.
                        </p>
                    </div>
                ) : (
                    <div className="divide-y rounded-md border">
                        {entries.map(([name, value]) => (
                            <div key={name} className="flex items-center gap-3 px-3 py-2.5">
                                <div className="min-w-0 flex-1">
                                    <div className="truncate font-mono text-sm font-medium">{name}</div>
                                    <div className="truncate text-xs text-muted-foreground">
                                        {value || "Not set"}
                                    </div>
                                </div>
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => openEditDialog(name)}
                                    disabled={isSaving}
                                    aria-label={`Edit ${name}`}
                                >
                                    <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => setDeleteName(name)}
                                    disabled={isSaving}
                                    aria-label={`Delete ${name}`}
                                    className="text-destructive hover:text-destructive"
                                >
                                    <Trash2Icon className="h-4 w-4" />
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>

            <TemplateVariableFormDialog
                open={dialogOpen}
                mode={dialogMode}
                initialName={selectedName ?? ""}
                initialValue={selectedName ? contextVars[selectedName] ?? "" : ""}
                existingNames={Object.keys(contextVars)}
                onOpenChange={setDialogOpen}
                onSubmit={handleVariableSubmit}
            />

            <AlertDialog open={deleteName !== null} onOpenChange={(open) => !isSaving && !open && setDeleteName(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete template variable?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Deleting <span className="font-mono font-medium text-foreground">{deleteName}</span> may leave unresolved references in workflow prompts. This action can be reversed by adding it again.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isSaving}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={isSaving}
                            onClick={(event) => {
                                event.preventDefault();
                                void handleDelete();
                            }}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                            Delete variable
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    );
}
