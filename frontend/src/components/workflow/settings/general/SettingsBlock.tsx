import type { ReactNode } from "react";

interface SettingsBlockProps {
    title: string;
    description: string;
    children: ReactNode;
}

/** A titled group of settings inside a settings card. */
export function SettingsBlock({ title, description, children }: SettingsBlockProps) {
    return (
        <div className="space-y-4">
            <div>
                <h3 className="text-sm font-medium">{title}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
            </div>
            {children}
        </div>
    );
}
