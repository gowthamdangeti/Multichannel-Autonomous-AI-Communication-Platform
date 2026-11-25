"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/lib/auth";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const { user, loading } = useAuth();
    const router = useRouter();

    const pathname = usePathname();
    const isEditorPage = pathname?.startsWith("/admin/models/") && pathname !== "/admin/models";

    useEffect(() => {
        if (loading) return;
        if (!(user as import('@/lib/auth/types').LocalUser)?.is_superuser) {
            router.replace("/");
        }
    }, [user, loading, router]);

    if (loading || !(user as import('@/lib/auth/types').LocalUser)?.is_superuser) {
        return null;
    }

    return (
        <div className={isEditorPage ? "flex-1 w-full h-full flex flex-col p-0" : "flex-1 w-full h-full flex flex-col px-4 lg:px-6 pt-1 pb-6 space-y-4"}>
            {children}
        </div>
    );
}
