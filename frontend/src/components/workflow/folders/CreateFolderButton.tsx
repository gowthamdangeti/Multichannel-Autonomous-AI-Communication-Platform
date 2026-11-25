'use client';

import { FolderPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { createFolderApiV1FolderPost } from '@/client/sdk.gen';
import type { FolderResponse } from '@/client/types.gen';
import { Button } from '@/components/ui/button';

import { FolderFormDialog } from './FolderFormDialog';

interface CreateFolderButtonProps {
    /** Called immediately with the created folder so the parent can update
     *  its local list without waiting for `router.refresh()` to deliver new
     *  server props (which client `useState` would otherwise ignore). */
    onCreated?: (folder: FolderResponse) => void;
}

export function CreateFolderButton({ onCreated }: CreateFolderButtonProps = {}) {
    const router = useRouter();
    const [isOpen, setIsOpen] = useState(false);

    const handleCreate = async (name: string) => {
        const response = await createFolderApiV1FolderPost({ body: { name } });
        if (response.error) {
            // 409 = duplicate name; surface the server's message when present.
            const detail =
                (response.error as { detail?: string })?.detail ??
                'Failed to create folder';
            toast.error(detail);
            throw new Error(detail);
        }
        toast.success(`Folder "${name}" created`);
        // Optimistic parent update: makes the new folder appear in the
        // filter dropdown instantly, even before server props sync.
        if (response.data) {
            onCreated?.(response.data);
        }
        router.refresh();
    };

    return (
        <>
            <Button variant="outline" onClick={() => setIsOpen(true)} className="w-full sm:w-auto">
                <FolderPlus className="w-4 h-4 mr-2" />
                <span className="hidden sm:inline">New Folder</span>
                <span className="inline sm:hidden">Folder</span>
            </Button>
            <FolderFormDialog
                open={isOpen}
                onOpenChange={setIsOpen}
                title="Create folder"
                submitLabel="Create"
                onSubmit={handleCreate}
            />
        </>
    );
}
