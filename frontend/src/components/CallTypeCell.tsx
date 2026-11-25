import { ArrowDownLeft, ArrowUpRight, MessageSquare } from "lucide-react";

const WEB_CALL_MODES = new Set(["webrtc", "smallwebrtc"]);
const TEXT_CHAT_MODES = new Set(["textchat"]);

const getCallChannel = (mode?: string | null): "phone" | "web" | "chat" => {
    if (mode && TEXT_CHAT_MODES.has(mode)) return "chat";
    if (mode && WEB_CALL_MODES.has(mode)) return "web";
    return "phone";
};

export function CallTypeCell({
    mode,
    callType,
}: {
    mode?: string | null;
    callType?: string | null;
}) {
    if (!mode && !callType) {
        return <span className="text-sm text-muted-foreground">-</span>;
    }

    const channel = getCallChannel(mode);
    const isChat = channel === "chat";

    const isInbound = callType === "inbound";
    const DirectionIcon = isInbound ? ArrowDownLeft : ArrowUpRight;
    const directionLabel = isInbound ? "Inbound" : "Outbound";

    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border select-none ${
            isChat
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
        }`}>
            {isChat && (
                <>
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span>Text</span>
                    <span className="text-muted-foreground/30">•</span>
                </>
            )}
            <DirectionIcon className={`h-3 w-3 ${isInbound ? "text-emerald-500" : "text-blue-500"}`} />
            <span>{directionLabel}</span>
        </span>
    );
}
