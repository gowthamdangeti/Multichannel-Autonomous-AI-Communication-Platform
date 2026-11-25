"use client";

import type { ChatAgentResponse } from "@/client/types.gen";
import { type AgentMediaConfig, DEFAULT_MEDIA_CONFIG } from "@/components/agent/AgentMediaTab";

export interface Appearance {
    theme?: "dark" | "light";
    title?: string;
    subtitle?: string;
    placeholder?: string;
    position?: string;
    button_title?: string;
    brand_color?: string;
}

export type ChatAgent = Omit<ChatAgentResponse, "appearance" | "model_config_ref"> & {
    appearance: Appearance;
    model_config_ref?: Record<string, unknown>;
};

export interface ChatCharacter {
    key: string;
    name: string;
    gender: string;
    description: string;
    persona: string;
    greeting: string;
}


export interface AgentDraft {
    id?: number;
    name: string;
    character: string;
    description: string;
    system_prompt: string;
    greeting: string;
    allowed_domains: string; // raw textarea (one domain per line)
    theme: "dark" | "light";
    title: string;
    subtitle: string;
    placeholder: string;
    position: string;
    button_title: string;
    /** Launcher button background, "#RRGGBB"; empty keeps the theme colour. */
    brand_color: string;
    tool_ids: number[];
    document_uuids: string[];
    allowed_media: string[];
    media_config: AgentMediaConfig;
    platform_model_configuration_id: number | null;
}

export const EMPTY: AgentDraft = {
    name: "",
    character: "",
    description: "",
    system_prompt: "",
    greeting: "",
    allowed_domains: "",
    theme: "dark",
    title: "Chat with us",
    subtitle: "",
    placeholder: "Type a message…",
    position: "bottom-right",
    button_title: "",
    brand_color: "",
    tool_ids: [],
    document_uuids: [],
    allowed_media: [],
    media_config: DEFAULT_MEDIA_CONFIG,
    platform_model_configuration_id: null,
};

export const DEFAULT_CHAT_CHARACTERS: ChatCharacter[] = [
    {
        key: "aria",
        name: "Aria",
        gender: "feminine",
        description: "Warm and friendly, feminine voice.",
        persona: "Your name is Aria. You speak with a warm, feminine voice and a friendly, approachable manner. Come across as genuinely human — natural and personable, never robotic — and be easy to talk to.",
        greeting: "Hi, this is Aria! How can I help you today?",
    },
    {
        key: "david",
        name: "David",
        gender: "masculine",
        description: "Calm and professional, male voice.",
        persona: "Your name is David. You speak with a calm, masculine voice and a composed, professional manner. Sound natural and human — measured, clear, and reassuring, never stiff.",
        greeting: "Hello, this is David. How can I help?",
    },
    {
        key: "maya",
        name: "Maya",
        gender: "feminine",
        description: "Cheerful and upbeat, feminine voice.",
        persona: "Your name is Maya. You speak with a bright, feminine voice and a cheerful, energetic manner. Be lively and warm, sound genuinely human, and keep the conversation upbeat.",
        greeting: "Hey! Maya here — lovely to hear from you. What can I do for you?",
    },
    {
        key: "leo",
        name: "Leo",
        gender: "masculine",
        description: "Confident and upbeat, male voice.",
        persona: "Your name is Leo. You speak with a confident, masculine voice and an upbeat, energetic manner. Be personable and human — friendly, direct, and positive, without sounding scripted.",
        greeting: "Hey, this is Leo! How can I help you out?",
    },
    {
        key: "sophie",
        name: "Sophie",
        gender: "feminine",
        description: "Gentle and empathetic, feminine voice.",
        persona: "Your name is Sophie. You speak with a soft, feminine voice and a gentle, empathetic manner. Be caring and patient, sound genuinely human, and make the other person feel heard.",
        greeting: "Hi, I'm Sophie. I'm here to help — what's on your mind?",
    },
    {
        key: "arjun",
        name: "Arjun",
        gender: "masculine",
        description: "Friendly and approachable, male voice.",
        persona: "Your name is Arjun. You speak with a friendly, masculine voice and a relaxed, approachable manner. Be warm and personable, sound naturally human, and keep things easy and conversational.",
        greeting: "Hi, this is Arjun! How can I help you today?",
    },
    {
        key: "sam",
        name: "Sam",
        gender: "neutral",
        description: "Balanced and personable, gender-neutral voice.",
        persona: "Your name is Sam. You speak in a warm, gender-neutral voice with a friendly, personable manner. Sound genuinely human — natural, easygoing, and clear.",
        greeting: "Hi, I'm Sam! How can I help?",
    },
];

export type ChatDrawerTab =
    | "characters"
    | "general"
    | "model"
    | "tools"
    | "knowledge"
    | "media"
    | "appearance"
    | "domains";

export const DRAWER_TABS: { value: ChatDrawerTab; label: string }[] = [
    { value: "characters", label: "Characters" },
    { value: "general", label: "General" },
    { value: "model", label: "Model" },
    { value: "tools", label: "Tools" },
    { value: "knowledge", label: "Knowledge Base" },
    { value: "media", label: "Media" },
    { value: "appearance", label: "Appearance" },
    { value: "domains", label: "Domains" },
];

/** A blank draft for "New agent", defaulting to the first model preset. */
export function emptyDraft(defaultPresetId: number | null): AgentDraft {
    return { ...EMPTY, platform_model_configuration_id: defaultPresetId };
}

/** The editor's draft for an existing agent. */
export function draftFromAgent(a: ChatAgent, defaultPresetId: number | null): AgentDraft {
    const existingRef = a.model_config_ref || {};
    const media_config: AgentMediaConfig = existingRef.media_config
        ? { ...DEFAULT_MEDIA_CONFIG, ...(existingRef.media_config as Partial<AgentMediaConfig>) }
        : DEFAULT_MEDIA_CONFIG;

    const tool_ids = (Array.isArray(a.tool_ids) && a.tool_ids.length > 0)
        ? a.tool_ids
        : Array.isArray(existingRef.tool_ids)
            ? (existingRef.tool_ids as number[])
            : [];

    const document_uuids = (Array.isArray(a.document_uuids) && a.document_uuids.length > 0)
        ? a.document_uuids
        : Array.isArray(existingRef.document_uuids)
            ? (existingRef.document_uuids as string[])
            : [];

    return {
        id: a.id,
        name: a.name,
        character: a.character ?? "",
        description: a.description ?? "",
        system_prompt: a.system_prompt ?? "",
        greeting: a.greeting ?? "",
        allowed_domains: (a.allowed_domains ?? []).join("\n"),
        theme: a.appearance?.theme === "light" ? "light" : "dark",
        title: a.appearance?.title ?? "Chat with us",
        subtitle: a.appearance?.subtitle ?? "",
        placeholder: a.appearance?.placeholder ?? "Type a message…",
        position: a.appearance?.position ?? "bottom-right",
        button_title: a.appearance?.button_title ?? "",
        brand_color: a.appearance?.brand_color ?? "",
        tool_ids,
        document_uuids,
        allowed_media: [],
        media_config,
        platform_model_configuration_id:
            existingRef.platform_model_configuration_id != null
                ? Number(existingRef.platform_model_configuration_id)
                : defaultPresetId,
    };
}

/** The create/update request body for a draft; keeps the agent's other model settings. */
export function buildAgentPayload(draft: AgentDraft, existing: ChatAgent | null) {
    return {
        name: draft.name.trim(),
        character: draft.character || "custom",
        description: draft.description.trim() || null,
        system_prompt: draft.system_prompt,
        greeting: draft.greeting.trim() || null,
        tool_ids: draft.tool_ids,
        document_uuids: draft.document_uuids,
        allowed_domains: draft.allowed_domains
            .split(/[\n,]/)
            .map((s) => s.trim())
            .filter(Boolean),
        appearance: {
            theme: draft.theme,
            title: draft.title,
            subtitle: draft.subtitle,
            placeholder: draft.placeholder,
            position: draft.position,
            button_title: (draft.button_title ?? "").trim(),
            brand_color: /^#[0-9a-fA-F]{6}$/.test(draft.brand_color ?? "") ? draft.brand_color : "",
        },
        model_config_ref: {
            ...(existing?.model_config_ref || {}),
            tool_ids: draft.tool_ids,
            document_uuids: draft.document_uuids,
            media_config: draft.media_config,
            platform_model_configuration_id: draft.platform_model_configuration_id,
        },
    };
}

