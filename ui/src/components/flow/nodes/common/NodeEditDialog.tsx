import { AlertCircle } from "lucide-react";
import {
    createContext,
    ReactNode,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";

import { useWorkflowOptional } from "@/app/workflow/[workflowId]/contexts/WorkflowContext";
import { FlowNodeData } from "@/components/flow/types";
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
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";

export interface NodeEditDrawerContextValue {
    onSave: () => void;
    onCancel: () => void;
    isDirty: boolean;
    documentationUrl?: string;
    readOnly: boolean;
    error?: string | null;
}

export const NodeEditDrawerContext = createContext<NodeEditDrawerContextValue | null>(null);

export function useNodeEditDrawerContext() {
    return useContext(NodeEditDrawerContext);
}

export interface NodeEditDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    nodeData: FlowNodeData;
    title: string;
    children: ReactNode;
    onSave?: () => void;
    error?: string | null;
    isDirty?: boolean;
    documentationUrl?: string;
}

/**
 * Off-canvas drawer for editing node settings, matching the Org and Tools drawer pattern.
 */
export const NodeEditDialog = ({
    open,
    onOpenChange,
    nodeData,
    title,
    children,
    onSave,
    error,
    isDirty = false,
    documentationUrl,
}: NodeEditDialogProps) => {
    const readOnly = useWorkflowOptional()?.readOnly ?? false;
    const [showDiscardAlert, setShowDiscardAlert] = useState(false);

    const handleClose = useCallback(() => onOpenChange(false), [onOpenChange]);

    const handleSave = useCallback(() => {
        if (onSave) {
            onSave();
        }
    }, [onSave]);

    const handleCancel = useCallback(() => {
        if (isDirty) {
            setShowDiscardAlert(true);
        } else {
            handleClose();
        }
    }, [isDirty, handleClose]);

    // Intercept drawer close attempts when dirty
    const handleOpenChange = useCallback((newOpen: boolean) => {
        if (!newOpen && isDirty) {
            setShowDiscardAlert(true);
            return;
        }
        onOpenChange(newOpen);
    }, [isDirty, onOpenChange]);

    const handleConfirmDiscard = useCallback(() => {
        setShowDiscardAlert(false);
        onOpenChange(false);
    }, [onOpenChange]);

    // Handle Cmd+S / Ctrl+S keyboard shortcut to save
    useEffect(() => {
        if (!open || readOnly) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                e.stopImmediatePropagation();
                handleSave();
            }
        };

        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [open, readOnly, handleSave]);

    const contextValue = useMemo<NodeEditDrawerContextValue>(() => ({
        onSave: handleSave,
        onCancel: handleCancel,
        isDirty,
        documentationUrl,
        readOnly,
        error,
    }), [handleSave, handleCancel, isDirty, documentationUrl, readOnly, error]);

    return (
        <Sheet open={open} onOpenChange={handleOpenChange}>
            <SheetContent side="right">
                <SheetHeader>
                    <SheetTitle className="text-base truncate pr-10">{title}</SheetTitle>
                    <SheetDescription className="sr-only">
                        Configure the settings for this node in your workflow.
                    </SheetDescription>
                    {nodeData.invalid && nodeData.validationMessage && (
                        <div className="mt-2 flex items-center gap-2 rounded-md bg-destructive/10 p-2 text-sm text-destructive border border-destructive/30">
                            <AlertCircle className="h-4 w-4" />
                            <span>{nodeData.validationMessage}</span>
                        </div>
                    )}
                </SheetHeader>

                <NodeEditDrawerContext.Provider value={contextValue}>
                    {children}
                </NodeEditDrawerContext.Provider>
            </SheetContent>

            {/* Discard changes confirmation dialog */}
            <AlertDialog open={showDiscardAlert} onOpenChange={setShowDiscardAlert}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Discard changes?</AlertDialogTitle>
                        <AlertDialogDescription>
                            You have unsaved changes. Are you sure you want to discard them?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Keep Editing</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleConfirmDiscard}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Discard
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Sheet>
    );
};

export const NodeEditDrawer = NodeEditDialog;
