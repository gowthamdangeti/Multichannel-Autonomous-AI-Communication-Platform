"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { SettingsBlock } from "./SettingsBlock";

interface PositiveIntFieldProps {
    id: string;
    label: string;
    hint: string;
    value: number;
    onChange: (value: number) => void;
}

function PositiveIntField({ id, label, hint, value, onChange }: PositiveIntFieldProps) {
    return (
        <div className="space-y-2">
            <Label htmlFor={id} className="text-xs">{label}</Label>
            <Input
                id={id}
                type="number"
                min="1"
                value={value}
                onChange={(e) => {
                    const next = parseInt(e.target.value);
                    if (!isNaN(next) && next > 0) onChange(next);
                }}
            />
            <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
    );
}

interface CallManagementSettingsProps {
    maxCallDuration: number;
    onMaxCallDurationChange: (secs: number) => void;
    maxUserIdleTimeout: number;
    onMaxUserIdleTimeoutChange: (secs: number) => void;
}

/** Call duration limit and user idle timeout. */
export function CallManagementSettings(props: CallManagementSettingsProps) {
    return (
        <SettingsBlock title="Call Management" description="Configure call duration limits and idle timeout settings.">
            <div className="grid grid-cols-2 gap-4">
                <PositiveIntField
                    id="max_call_duration"
                    label="Max Call Duration (seconds)"
                    hint="Default: 600 (10 minutes)"
                    value={props.maxCallDuration}
                    onChange={props.onMaxCallDurationChange}
                />
                <PositiveIntField
                    id="max_user_idle_timeout"
                    label="Max User Idle Timeout (seconds)"
                    hint="Default: 10 seconds"
                    value={props.maxUserIdleTimeout}
                    onChange={props.onMaxUserIdleTimeoutChange}
                />
            </div>
        </SettingsBlock>
    );
}
