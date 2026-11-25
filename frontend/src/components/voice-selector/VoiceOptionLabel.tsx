interface VoiceOptionLabelProps {
    name: string;
    /** Secondary text on the right, e.g. "Female" or "Custom". */
    detail?: string;
    /** Extra right padding so the label clears the select's check / chevron. */
    padding?: "trigger" | "item";
}

/** Voice name with its gender (or another tag) aligned to the right. */
export function VoiceOptionLabel({ name, detail, padding = "item" }: VoiceOptionLabelProps) {
    return (
        <div className={`flex items-center justify-between w-full gap-4 ${padding === "trigger" ? "pr-4" : "pr-5"}`}>
            <span className="font-medium truncate">{name}</span>
            {detail && <span className="text-xs text-muted-foreground font-medium shrink-0">{detail}</span>}
        </div>
    );
}
