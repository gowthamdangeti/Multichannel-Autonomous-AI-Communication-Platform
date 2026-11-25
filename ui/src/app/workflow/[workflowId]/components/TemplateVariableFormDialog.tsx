"use client";

import { Loader2, X } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

type TemplateVariableFormDialogProps = {
    open: boolean;
    mode: "add" | "edit";
    initialName?: string;
    initialValue?: string;
    existingNames: string[];
    onOpenChange: (open: boolean) => void;
    onSubmit: (name: string, value: string) => Promise<void>;
};

export function TemplateVariableFormDialog({
    open,
    mode,
    initialName = "",
    initialValue = "",
    existingNames,
    onOpenChange,
    onSubmit,
}: TemplateVariableFormDialogProps) {
    const nameId = useId();
    const valueId = useId();
    const [name, setName] = useState(initialName);
    const [value, setValue] = useState(initialValue);
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (!open) return;
        setName(initialName);
        setValue(initialValue);
        setError(null);
        setIsSubmitting(false);
    }, [initialName, initialValue, open]);

    const handleSubmit = async () => {
        const normalizedName = name.trim();
        if (!normalizedName) {
            setError("Variable name is required.");
            return;
        }
        if (!VARIABLE_NAME_PATTERN.test(normalizedName)) {
            setError("Use letters, numbers, and underscores; the first character cannot be a number.");
            return;
        }
        if (mode === "add" && existingNames.includes(normalizedName)) {
            setError("A variable with this name already exists.");
            return;
        }

        setError(null);
        setIsSubmitting(true);
        try {
            await onSubmit(normalizedName, value);
            onOpenChange(false);
        } catch {
            // The parent surfaces the API error. Keep this form open for retry.
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => !isSubmitting && onOpenChange(nextOpen)}>
            <DialogContent hideCloseButton className="sm:max-w-xl">
                <DialogHeader className="-mx-6 -mt-1 flex-row items-start justify-between gap-4 border-b px-6 pb-4 text-left">
                    <div className="min-w-0 flex-1 space-y-1.5">
                        <DialogTitle className="text-lg leading-6">
                            {mode === "add" ? "Add template variable" : "Edit template variable"}
                        </DialogTitle>
                        <DialogDescription className="leading-5 sm:whitespace-nowrap">
                            {mode === "add"
                                ? "Create a prompt variable and optionally set its default test value."
                                : "Set the fallback value used when a run does not provide this variable."}
                        </DialogDescription>
                    </div>
                    <DialogClose asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            disabled={isSubmitting}
                            className="h-9 w-9 shrink-0 rounded-md border bg-muted/30 shadow-sm hover:bg-muted"
                            aria-label="Close variable dialog"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </DialogClose>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div className="space-y-2">
                        <Label htmlFor={nameId}>Variable name</Label>
                        <Input
                            id={nameId}
                            value={name}
                            onChange={(event) => {
                                setName(event.target.value);
                                setError(null);
                            }}
                            placeholder="customer_name"
                            readOnly={mode === "edit"}
                            disabled={isSubmitting}
                            className="font-mono"
                            aria-describedby={error ? `${nameId}-error` : undefined}
                        />
                        <p className="text-xs text-muted-foreground">
                            {mode === "add"
                                ? "Use letters, numbers, and underscores, such as customer_name."
                                : <>Names cannot be changed because prompts may reference {`{{${initialName}}}`}.</>}
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor={valueId}>Test/default value</Label>
                        <Input
                            id={valueId}
                            value={value}
                            onChange={(event) => setValue(event.target.value)}
                            placeholder="Enter a value, or leave it empty"
                            disabled={isSubmitting}
                        />
                        <p className="text-xs text-muted-foreground">
                            API Trigger initial context can replace this value for each call.
                        </p>
                    </div>

                    {error && (
                        <p id={`${nameId}-error`} role="alert" className="text-sm text-destructive">
                            {error}
                        </p>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit} disabled={isSubmitting}>
                        {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                        {mode === "add" ? "Add variable" : "Save value"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
