'use client';

import { useRouter } from 'next/navigation';

interface WorkflowCardProps {
    id: number;
    name: string;
    createdAt: string;
}

export function WorkflowCard({ id, name, createdAt }: WorkflowCardProps) {
    const router = useRouter();

    const handleClick = () => {
        router.push(`/voice/agents/${id}`);
    };

    return (
        <div
            data-slot="card"
            className="bg-card border-[length:var(--surface-border-width)] border-border rounded-[var(--radius-card)] overflow-hidden shadow-surface hover:shadow-surface-lg transition-all duration-200 p-4 cursor-pointer transform hover:-translate-y-1"
            onClick={handleClick}
        >
            <div>
                <h3 className="text-lg font-semibold mb-2 text-card-foreground">{name}</h3>
                <p className="text-muted-foreground mb-2">
                    Created: {new Date(createdAt).toLocaleDateString()}
                </p>
            </div>
        </div>
    );
}
