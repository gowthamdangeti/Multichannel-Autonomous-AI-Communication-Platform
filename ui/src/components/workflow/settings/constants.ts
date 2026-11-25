import { BookA, Brain, FileDown, Fingerprint, Mic, PhoneOff, Rocket, Settings, Users, Variable } from "lucide-react";

import type { AmbientNoiseConfiguration } from "@/types/workflow-configurations";

export const DEFAULT_AMBIENT_NOISE_CONFIG: AmbientNoiseConfiguration = {
    enabled: false,
    volume: 0.3,
};

export const DEFAULT_VOICEMAIL_SYSTEM_PROMPT = `You are a voicemail detection classifier for an OUTBOUND calling system. A bot has called a phone number and you need to determine if a human answered or if the call went to voicemail based on the provided text.

HUMAN ANSWERED - LIVE CONVERSATION (respond "CONVERSATION"):
- Personal greetings: "Hello?", "Hi", "Yeah?", "John speaking"
- Interactive responses: "Who is this?", "What do you want?", "Can I help you?"
- Conversational tone expecting back-and-forth dialogue
- Questions directed at the caller: "Hello? Anyone there?"
- Informal responses: "Yep", "What's up?", "Speaking"
- Natural, spontaneous speech patterns
- Immediate acknowledgment of the call

VOICEMAIL SYSTEM (respond "VOICEMAIL"):
- Automated voicemail greetings: "Hi, you've reached [name], please leave a message"
- Phone carrier messages: "The number you have dialed is not in service", "Please leave a message", "All circuits are busy"
- Professional voicemail: "This is [name], I'm not available right now"
- Instructions about leaving messages: "leave a message", "leave your name and number"
- References to callback or messaging: "call me back", "I'll get back to you"
- Carrier system messages: "mailbox is full", "has not been set up"
- Business hours messages: "our office is currently closed"

Respond with ONLY "CONVERSATION" if a person answered, or "VOICEMAIL" if it's voicemail/recording.`;

// Sidebar navigation items
export const NAV_ITEMS = [
    { id: "general", label: "General", icon: Settings },
    { id: "utilisation", label: "Utilisation", icon: Users },
    { id: "models", label: "Model Overrides", icon: Brain },
    { id: "variables", label: "Template Variables", icon: Variable },
    { id: "dictionary", label: "Dictionary", icon: BookA },
    { id: "voicemail", label: "Voicemail Detection", icon: PhoneOff },
    { id: "recordings", label: "Recordings", icon: Mic },
    { id: "deployment", label: "Add to Website", icon: Rocket },
    { id: "report", label: "Report", icon: FileDown },
    { id: "identity", label: "Agent UUID", icon: Fingerprint },
];
