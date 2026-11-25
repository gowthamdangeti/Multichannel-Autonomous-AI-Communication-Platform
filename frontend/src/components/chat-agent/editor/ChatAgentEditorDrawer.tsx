"use client";

import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";

import { AgentMediaTab } from "@/components/agent/AgentMediaTab";
import { Button } from "@/components/ui/button";
import {
    Sheet,
    SheetBody,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { UnderlineTabs } from "@/components/ui/underline-tabs";

import { ChatModelConfigTab } from "../ChatModelConfigTab";
import { useChatAgentEditor } from "../hooks/useChatAgentEditor";
import { CharactersTab, ConfigTab } from "./ChatAgentCharacterTabs";
import { type ChatAgent, type ChatDrawerTab, DRAWER_TABS } from "./chatAgentDraft";
import { DetailSection } from "./ChatAgentEditorSection";
import { KnowledgeTab, ToolsTab } from "./ChatAgentResourceTabs";
import { AppearanceTab, DomainsTab } from "./ChatAgentWidgetTabs";

interface ChatAgentEditorDrawerProps {
    open: boolean;
    /** The agent to edit; null opens the create form. */
    agent: ChatAgent | null;
    onOpenChange: (open: boolean) => void;
    onSaved: (saved: ChatAgent, created: boolean) => void;
}

/** The chat agent editor off-canvas drawer, shared by the agents list and an agent's page. */
export function ChatAgentEditorDrawer({ open, agent, onOpenChange, onSaved }: ChatAgentEditorDrawerProps) {
    const {
        draft,
        setDraft,
        activeTab,
        setActiveTab,
        error,
        setError,
        saving,
        save,
        handlePrev,
        handleNext,
        pickCharacter,
        characters,
        presets,
        presetsLoading,
        tools,
        toolsLoading,
        documents,
        documentsLoading,
    } = useChatAgentEditor({ open, agent, onSaved, onOpenChange });

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right">
                <SheetHeader>
                    <SheetTitle className="text-base truncate">
                        {draft.id ? "Edit Chat Agent" : "Create Chat Agent"}
                    </SheetTitle>
                    <SheetDescription className="sr-only">
                        Configure your web chat agent
                    </SheetDescription>
                </SheetHeader>

                <Tabs
                    value={activeTab}
                    onValueChange={(value) => {
                        setError(null);
                        setActiveTab(value as ChatDrawerTab);
                    }}
                    className="flex min-h-0 flex-1 flex-col gap-0"
                >
                    {/* Fixed tab bar directly beneath title (identical to Tools, Campaigns, & WhatsApp drawers) */}
                    <div className="shrink-0 border-b border-border px-4 pb-3">
                        <UnderlineTabs
                            value={activeTab}
                            onValueChange={(v) => {
                                setError(null);
                                setActiveTab(v as ChatDrawerTab);
                            }}
                            items={DRAWER_TABS}
                        />
                    </div>

                    <SheetBody className="px-4 py-4 space-y-4">
                        {error && (
                            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                                {error}
                            </div>
                        )}

                        {/* Characters Tab */}
                        <TabsContent value="characters" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                            <DetailSection
                                title="Agent Character"
                                description="Select a predefined character persona or create a custom character."
                            >
                                <CharactersTab
                                    characters={characters}
                                    draft={draft}
                                    pickCharacter={pickCharacter}
                                    setDraft={setDraft}
                                />
                            </DetailSection>
                        </TabsContent>

                        {/* General Information Tab */}
                        <TabsContent value="general" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                            <DetailSection
                                title="General Information"
                                description="Specify agent name, description, greeting message, and instructions."
                            >
                                <ConfigTab draft={draft} setDraft={setDraft} />
                            </DetailSection>
                        </TabsContent>

                        {/* Model Tab */}
                        <TabsContent value="model" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                            <DetailSection
                                title="Model Configuration"
                                description="Choose the language model preset this chat agent replies with."
                            >
                                <ChatModelConfigTab
                                    presets={presets}
                                    loading={presetsLoading}
                                    value={draft.platform_model_configuration_id}
                                    onChange={(id) => setDraft((d) => ({ ...d, platform_model_configuration_id: id }))}
                                />
                            </DetailSection>
                        </TabsContent>

                        {/* Tools Tab */}
                        <TabsContent value="tools" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                            <DetailSection
                                title="Agent Tools"
                                description="Enable external tools that this agent can execute during conversations."
                            >
                                <ToolsTab tools={tools} toolsLoading={toolsLoading} draft={draft} setDraft={setDraft} />
                            </DetailSection>
                        </TabsContent>

                        {/* Knowledge Base Tab */}
                        <TabsContent value="knowledge" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                            <DetailSection
                                title="Knowledge Base"
                                description="Attach documents to enhance the agent's contextual knowledge."
                            >
                                <KnowledgeTab
                                    documents={documents}
                                    documentsLoading={documentsLoading}
                                    draft={draft}
                                    setDraft={setDraft}
                                />
                            </DetailSection>
                        </TabsContent>

                        {/* Media Tab */}
                        <TabsContent value="media" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                            <DetailSection
                                title="Media Configuration"
                                description="Manage allowed media attachments (Images, Documents, Audio) for this agent."
                            >
                                <AgentMediaTab
                                    config={draft.media_config}
                                    showOverviewCards={true}
                                    onChange={(updater) => setDraft((d) => ({ ...d, media_config: updater(d.media_config) }))}
                                />
                            </DetailSection>
                        </TabsContent>

                        {/* Appearance Tab */}
                        <TabsContent value="appearance" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                            <DetailSection
                                title="Widget Appearance"
                                description="Configure header title, subtitle, theme mode, position, and input placeholder."
                            >
                                <AppearanceTab draft={draft} setDraft={setDraft} />
                            </DetailSection>
                        </TabsContent>

                        {/* Domains Tab */}
                        <TabsContent value="domains" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                            <DetailSection
                                title="Allowed Domains"
                                description="Restrict domains allowed to embed and initialize this web chat widget."
                            >
                                <DomainsTab draft={draft} setDraft={setDraft} />
                            </DetailSection>
                        </TabsContent>
                    </SheetBody>

                    {/* Stepper Footer: matches Tools, Campaigns, & WhatsApp drawers */}
                    <SheetFooter className="justify-between border-t border-border px-4 py-3 bg-card/95">
                        <div>
                            {activeTab !== "characters" && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={handlePrev}
                                    disabled={saving}
                                    className="h-8 text-xs font-medium cursor-pointer"
                                >
                                    <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                                    Previous
                                </Button>
                            )}
                        </div>

                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => onOpenChange(false)}
                                disabled={saving}
                                className="h-8 text-xs font-medium cursor-pointer"
                            >
                                Cancel
                            </Button>

                            {activeTab === "domains" ? (
                                <Button
                                    type="button"
                                    size="sm"
                                    onClick={save}
                                    disabled={saving || !draft.name.trim()}
                                    className="h-8 text-xs font-medium gap-1.5 cursor-pointer"
                                >
                                    {saving ? (
                                        <>
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            {draft.id ? "Saving…" : "Creating…"}
                                        </>
                                    ) : draft.id ? (
                                        "Save changes"
                                    ) : (
                                        "Create agent"
                                    )}
                                </Button>
                            ) : (
                                <Button
                                    type="button"
                                    size="sm"
                                    onClick={handleNext}
                                    disabled={saving}
                                    className="h-8 text-xs font-medium gap-1 cursor-pointer"
                                >
                                    Next Step
                                    <ArrowRight className="h-3.5 w-3.5 ml-1" />
                                </Button>
                            )}
                        </div>
                    </SheetFooter>
                </Tabs>
            </SheetContent>
        </Sheet>
    );
}
