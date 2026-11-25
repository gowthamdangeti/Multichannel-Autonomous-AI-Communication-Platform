"use client";

import { ArrowLeft, ArrowRight, Copy, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  createTelephonyConfigurationApiV1OrganizationsTelephonyConfigsPost,
  getTelephonyProvidersMetadataApiV1OrganizationsTelephonyProvidersMetadataGet,
  setDefaultOutboundApiV1OrganizationsTelephonyConfigsConfigIdSetDefaultOutboundPost,
  updateTelephonyConfigurationApiV1OrganizationsTelephonyConfigsConfigIdPut,
} from "@/client/sdk.gen";
import type {
  TelephonyConfigurationCreateRequest,
  TelephonyConfigurationDetail,
  TelephonyProviderMetadata,
} from "@/client/types.gen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { detailFromError } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

type TelephonyConfigPayload = TelephonyConfigurationCreateRequest["config"];

export type ConfigDrawerTab = "general" | "config";

export interface ConfigFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // When provided, the drawer is in edit mode.
  existing?: TelephonyConfigurationDetail | null;
  onSaved: () => void;
}

export type ConfigFormDialogProps = ConfigFormDrawerProps;

type FieldValues = Record<string, string | number | undefined>;

/** Surface of every card in the drawer: white on drawer background (identical to Org and Tools drawers). */
const DRAWER_CARD = "rounded-lg border border-border bg-card p-4 shadow-xs";

function DetailSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={`${DRAWER_CARD} space-y-4`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">{title}</h4>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function ConfigFormDrawer({
  open,
  onOpenChange,
  existing,
  onSaved,
}: ConfigFormDrawerProps) {
  const { user, getAccessToken } = useAuth();
  const [activeTab, setActiveTab] = useState<ConfigDrawerTab>("general");
  const [providers, setProviders] = useState<TelephonyProviderMetadata[]>([]);
  const [providerName, setProviderName] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [nameTouched, setNameTouched] = useState<boolean>(false);
  const [isDefault, setIsDefault] = useState<boolean>(false);
  const [values, setValues] = useState<FieldValues>({});
  const [submitting, setSubmitting] = useState<boolean>(false);

  const isEdit = !!existing;
  const lockedProvider = isEdit;

  const currentProvider = useMemo(
    () => providers.find((p) => p.provider === providerName),
    [providers, providerName],
  );

  // Fetch provider metadata once when the drawer opens.
  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    (async () => {
      const token = await getAccessToken();
      const res = await getTelephonyProvidersMetadataApiV1OrganizationsTelephonyProvidersMetadataGet(
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (cancelled) return;
      const list = res.data?.providers ?? [];
      setProviders(list);
      if (existing) {
        setProviderName(existing.provider);
        setName(existing.name);
        setIsDefault(existing.is_default_outbound);
        setValues((existing.credentials ?? {}) as FieldValues);
      } else if (list.length > 0 && !providerName) {
        setProviderName(list[0].provider);
        setValues({});
      }
      setNameTouched(false);
      setActiveTab("general");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing, user, getAccessToken]);

  // When provider changes during create, clear field values.
  useEffect(() => {
    if (!isEdit) setValues({});
  }, [providerName, isEdit]);

  const updateField = (fieldName: string, value: string | number) => {
    setValues((prev) => ({ ...prev, [fieldName]: value }));
  };

  const handleNext = () => {
    if (!name.trim()) {
      setNameTouched(true);
      toast.error("Configuration name is required");
      return;
    }
    setActiveTab("config");
  };

  const handleTabChange = (tab: ConfigDrawerTab) => {
    if (tab === "config" && !name.trim()) {
      setNameTouched(true);
      toast.error("Configuration name is required");
      return;
    }
    setActiveTab(tab);
  };

  const handleSubmit = async () => {
    if (!currentProvider) return;
    if (!name.trim()) {
      setNameTouched(true);
      toast.error("Configuration name is required");
      setActiveTab("general");
      return;
    }

    setSubmitting(true);
    try {
      const token = await getAccessToken();

      // Build the provider-discriminated config payload from collected values.
      const configPayload = {
        provider: providerName,
        ...values,
      } as unknown as TelephonyConfigPayload;

      if (isEdit && existing) {
        const res = await updateTelephonyConfigurationApiV1OrganizationsTelephonyConfigsConfigIdPut(
          {
            headers: { Authorization: `Bearer ${token}` },
            path: { config_id: existing.id },
            body: { name: name || undefined, config: configPayload },
          },
        );
        if (res.error) throw new Error(detailFromError(res.error, "Failed to save configuration"));

        // If toggled on to become the default outbound provider, update default status
        if (isDefault && !existing.is_default_outbound) {
          const defRes =
            await setDefaultOutboundApiV1OrganizationsTelephonyConfigsConfigIdSetDefaultOutboundPost({
              headers: { Authorization: `Bearer ${token}` },
              path: { config_id: existing.id },
            });
          if (defRes.error) {
            throw new Error(detailFromError(defRes.error, "Failed to set default outbound"));
          }
        }

        toast.success("Configuration updated");
      } else {
        const res = await createTelephonyConfigurationApiV1OrganizationsTelephonyConfigsPost(
          {
            headers: { Authorization: `Bearer ${token}` },
            body: {
              name: name.trim(),
              is_default_outbound: isDefault,
              config: configPayload,
            },
          },
        );
        if (res.error) throw new Error(detailFromError(res.error, "Failed to save configuration"));
        toast.success("Configuration created");
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  };

  const nameError = !name.trim() && nameTouched ? "Configuration name is required" : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle className="text-base truncate">
            {isEdit
              ? `Edit Telephony Provider — ${existing?.name || existing?.provider}`
              : "Add Telephony Provider"}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {isEdit
              ? "Update credentials and routing settings for this provider."
              : "Connect a telephony provider account"}
          </SheetDescription>
        </SheetHeader>

        <Tabs
          value={activeTab}
          onValueChange={(v) => handleTabChange(v as ConfigDrawerTab)}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          {/* Fixed tab bar directly beneath title (identical to Org and Tools drawers) */}
          <div className="shrink-0 border-b border-border px-4 pb-3">
            <UnderlineTabs
              value={activeTab}
              onValueChange={(v) => handleTabChange(v as ConfigDrawerTab)}
              items={[
                { value: "general", label: "General" },
                { value: "config", label: "Configuration" },
              ]}
            />
          </div>

          <SheetBody className="px-4 py-4 space-y-4">
            {/* Tab 1: General (Provider selector, Name, Default for outbound) */}
            <TabsContent value="general" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
              <DetailSection
                title="General Information"
                description="Select the telephony service provider and specify a configuration name."
              >
                <div className="space-y-4">
                  {isEdit && existing && (
                    <div className="space-y-1.5">
                      <Label>Configuration ID</Label>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard
                            .writeText(String(existing.id))
                            .then(() => toast.success("Configuration ID copied"))
                            .catch(() => toast.error("Failed to copy ID"));
                        }}
                        title="Click to copy"
                        className="group flex w-full items-center gap-2 rounded-md border border-border bg-muted/20 p-2.5 text-left font-mono text-xs transition-colors hover:bg-muted/40 cursor-pointer"
                      >
                        <code className="flex-1 truncate">#{existing.id}</code>
                        <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
                      </button>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="cfg-provider">Telephony Provider</Label>
                    <Select
                      value={providerName}
                      onValueChange={setProviderName}
                      disabled={lockedProvider || providers.length === 0}
                    >
                      <SelectTrigger id="cfg-provider" className="w-full text-xs">
                        <SelectValue placeholder="Select a provider" />
                      </SelectTrigger>
                      <SelectContent>
                        {providers.map((p) => (
                          <SelectItem key={p.provider} value={p.provider}>
                            {p.display_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {lockedProvider ? (
                      <p className="text-[11px] text-muted-foreground">
                        Provider type cannot be changed after creation.
                      </p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">
                        Supported providers: Twilio, Telnyx, Asterisk ARI, Plivo, Vonage.
                      </p>
                    )}
                    {currentProvider?.docs_url && (
                      <div className="pt-0.5">
                        <a
                          href={currentProvider.docs_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-primary underline hover:text-primary/80"
                        >
                          {currentProvider.display_name} documentation <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="cfg-name">Configuration Name</Label>
                    <Input
                      id="cfg-name"
                      placeholder="e.g. Twilio US Production, Telnyx Primary"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        if (nameTouched) setNameTouched(false);
                      }}
                      onBlur={() => setNameTouched(true)}
                      className={cn(
                        "text-xs",
                        nameError && "border-destructive focus-visible:ring-destructive",
                      )}
                    />
                    {nameError && (
                      <p className="text-xs text-destructive">{nameError}</p>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      A descriptive label to identify this account in workflows and campaigns.
                    </p>
                  </div>
                </div>
              </DetailSection>

              <DetailSection
                title="Outbound Calling"
                description="Configure default dialing preferences."
              >
                <div className="flex items-center justify-between rounded-md border border-border p-3 bg-muted/20">
                  <div className="space-y-0.5">
                    <Label htmlFor="cfg-default" className="text-xs font-medium cursor-pointer">
                      Set as default for outbound calls
                    </Label>
                    <p className="text-[11px] text-muted-foreground">
                      Used by test calls and campaigns when no specific telephony config is specified.
                    </p>
                  </div>
                  <Switch
                    id="cfg-default"
                    checked={isDefault}
                    onCheckedChange={setIsDefault}
                  />
                </div>
                {isEdit && isDefault && (
                  <p className="text-[11px] text-muted-foreground">
                    This configuration will be used as the default outbound provider for your organization.
                  </p>
                )}
              </DetailSection>
            </TabsContent>

            {/* Tab 2: Configuration (Dynamic Provider Credentials) */}
            <TabsContent value="config" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
              {currentProvider && (
                <DetailSection
                  title={`${currentProvider.display_name} Credentials`}
                  description="Enter your API credentials, tokens, and server endpoints."
                >
                  {currentProvider.fields.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2">
                      No additional credentials required for this provider.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {currentProvider.fields.map((field) => (
                        <div className="space-y-1.5" key={field.name}>
                          <Label htmlFor={`cfg-field-${field.name}`} className="text-xs font-medium">
                            {field.label}
                            {!field.required && (
                              <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                                (optional)
                              </span>
                            )}
                          </Label>
                          <FieldInput
                            field={field}
                            value={values[field.name]}
                            onChange={(v) => updateField(field.name, v)}
                            isEdit={isEdit}
                          />
                          {field.description && (
                            <p className="text-[11px] text-muted-foreground">{field.description}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </DetailSection>
              )}
            </TabsContent>
          </SheetBody>

          {/* Stepper Footer: matches Tools & Campaign drawers */}
          <SheetFooter className="justify-between border-t border-border px-4 py-3 bg-card/95">
            <div>
              {activeTab !== "general" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setActiveTab("general")}
                  disabled={submitting}
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
                disabled={submitting}
                className="h-8 text-xs font-medium cursor-pointer"
              >
                Cancel
              </Button>

              {activeTab === "general" ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={handleNext}
                  disabled={submitting}
                  className="h-8 text-xs font-medium gap-1 cursor-pointer"
                >
                  Next Step
                  <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSubmit}
                  disabled={submitting || !currentProvider}
                  className="h-8 text-xs font-medium gap-1.5 cursor-pointer"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {isEdit ? "Saving…" : "Creating…"}
                    </>
                  ) : (
                    isEdit ? "Save changes" : "Create provider"
                  )}
                </Button>
              )}
            </div>
          </SheetFooter>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

// Backwards-compatibility alias so existing imports work seamlessly
export const ConfigFormDialog = ConfigFormDrawer;

interface FieldInputProps {
  field: TelephonyProviderMetadata["fields"][number];
  value: string | number | undefined;
  onChange: (v: string | number) => void;
  isEdit: boolean;
}

// Skip from_numbers in the metadata-driven form — phone numbers are managed
// via the dedicated phone-numbers endpoints and drawer UI.
function FieldInput({ field, value, onChange, isEdit }: FieldInputProps) {
  if (field.name === "from_numbers") {
    return (
      <p className="text-[11px] text-muted-foreground">
        Phone numbers are managed separately on the configuration page.
      </p>
    );
  }

  const placeholder =
    field.placeholder ??
    (field.sensitive && isEdit ? "Leave masked to keep existing" : "");

  if (field.type === "textarea") {
    return (
      <Textarea
        id={`cfg-field-${field.name}`}
        placeholder={placeholder}
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        className="field-sizing-fixed resize-y break-all font-mono text-xs"
      />
    );
  }
  if (field.type === "number") {
    return (
      <Input
        id={`cfg-field-${field.name}`}
        type="number"
        placeholder={placeholder}
        value={value as number | string | undefined ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        className="text-xs"
      />
    );
  }
  return (
    <Input
      id={`cfg-field-${field.name}`}
      type={field.type === "password" || field.sensitive ? "password" : "text"}
      placeholder={placeholder}
      value={(value as string) ?? ""}
      onChange={(e) => onChange(e.target.value)}
      autoComplete={field.sensitive ? "current-password" : undefined}
      className="text-xs"
    />
  );
}
