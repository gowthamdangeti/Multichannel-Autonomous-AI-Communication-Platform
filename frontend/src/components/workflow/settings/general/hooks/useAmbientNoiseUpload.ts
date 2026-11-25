"use client";

import { useRef, useState } from "react";

import { getAmbientNoiseUploadUrlApiV1WorkflowAmbientNoiseUploadUrlPost } from "@/client/sdk.gen";
import type { AmbientNoiseConfiguration } from "@/types/workflow-configurations";

const MAX_AMBIENT_NOISE_FILE_SIZE = 10 * 1024 * 1024; // 10MB

type StorageReference = Pick<AmbientNoiseConfiguration, "storage_key" | "storage_backend" | "original_filename">;

/** Upload a custom ambient-noise file to storage via a presigned URL. */
export function useAmbientNoiseUpload(workflowId: number, onUploaded: (ref: StorageReference) => void) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const upload = async (file: File) => {
        if (file.size > MAX_AMBIENT_NOISE_FILE_SIZE) {
            setError(`File too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Maximum is 10MB.`);
            return;
        }
        setIsUploading(true);
        setError(null);
        try {
            const res = await getAmbientNoiseUploadUrlApiV1WorkflowAmbientNoiseUploadUrlPost({
                body: {
                    workflow_id: Number(workflowId),
                    filename: file.name,
                    mime_type: file.type || "audio/wav",
                    file_size: file.size,
                },
            });
            if (res.error || !res.data?.upload_url) throw new Error("Failed to get upload URL");

            const uploadRes = await fetch(res.data.upload_url, {
                method: "PUT",
                body: file,
                headers: { "Content-Type": file.type || "audio/wav" },
            });
            if (!uploadRes.ok) throw new Error("File upload failed");

            onUploaded({
                storage_key: res.data.storage_key,
                storage_backend: res.data.storage_backend,
                original_filename: file.name,
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : "Upload failed");
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    return { fileInputRef, upload, isUploading, error, setError };
}
