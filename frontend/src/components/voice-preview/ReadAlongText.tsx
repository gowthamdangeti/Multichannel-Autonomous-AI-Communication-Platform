import { cn } from "@/lib/utils";

interface ReadAlongTextProps {
    words: string[];
    /** Word being spoken; -1 before the first word. */
    activeIndex: number;
    /** While paused, a click returns to editing. */
    onEdit?: () => void;
    className?: string;
}

/** The preview sentence: words turn active as they are spoken. */
export function ReadAlongText({ words, activeIndex, onEdit, className }: ReadAlongTextProps) {
    return (
        <p
            aria-live="off"
            onClick={onEdit}
            title={onEdit ? "Click to edit" : undefined}
            className={cn(className, onEdit && "cursor-text")}
        >
            {words.map((word, index) => (
                <span
                    key={`${index}-${word}`}
                    className={cn(
                        "rounded-sm transition-colors duration-150",
                        index === activeIndex && "bg-primary/15 text-primary",
                        index < activeIndex && "text-foreground",
                        (activeIndex === -1 || index > activeIndex) && "text-muted-foreground/50",
                    )}
                >
                    {word}{" "}
                </span>
            ))}
        </p>
    );
}
