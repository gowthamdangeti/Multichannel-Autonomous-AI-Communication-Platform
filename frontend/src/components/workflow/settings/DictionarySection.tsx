"use client";


import { BookA } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useUnsavedChanges } from "@/context/UnsavedChangesContext";
import logger from "@/lib/logger";


// ---------------------------------------------------------------------------
// Section: Dictionary
// ---------------------------------------------------------------------------

export function DictionarySection({
    dictionary,
    onSave,
}: {
    dictionary: string;
    onSave: (dictionary: string) => Promise<void>;
}) {
    const [dictionaryValue, setDictionaryValue] = useState(dictionary);
    const [isSaving, setIsSaving] = useState(false);

    const isDirty = dictionaryValue !== dictionary;

    useUnsavedChanges("dictionary", isDirty);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await onSave(dictionaryValue);
            toast.success("Dictionary saved successfully");
        } catch (error) {
            logger.error("Failed to save dictionary:", error);
            toast.error("Failed to save dictionary. Please try again.");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Card id="dictionary">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                    <BookA className="h-4 w-4" />
                    Dictionary
                </CardTitle>
                <CardDescription>
                    Add words the agent should actively listen for &mdash; company jargon, names,
                    industry terms. May incur extra cost depending on provider.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Textarea
                    placeholder="Enter words separated by comma (e.g. billing department, tretinoin)"
                    value={dictionaryValue}
                    onChange={(e) => setDictionaryValue(e.target.value)}
                    rows={4}
                    className="resize-none"
                />
            </CardContent>
            <CardFooter className="justify-end gap-3 border-t pt-6">
                {isDirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
                <Button onClick={handleSave} disabled={isSaving || !isDirty}>
                    {isSaving ? "Saving..." : "Save Dictionary"}
                </Button>
            </CardFooter>
        </Card>
    );
}
