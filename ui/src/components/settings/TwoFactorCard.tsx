"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

import { useTwoFactor } from "./hooks/useTwoFactor";
import { RecoveryCodesDialog } from "./RecoveryCodesDialog";
import { TwoFactorCodeDialog } from "./TwoFactorCodeDialog";

interface TwoFactorCardProps {
  email: string;
  initiallyEnabled: boolean;
}

function recoveryStatus(remaining: number | null) {
  if (remaining === null) return "Checking your recovery codes...";
  if (remaining === 0)
    return "You have none left. Generate new codes so you don't get locked out.";
  return `${remaining} unused ${remaining === 1 ? "code" : "codes"} left. Each one works once.`;
}

export function TwoFactorCard({ email, initiallyEnabled }: TwoFactorCardProps) {
  const twoFactor = useTwoFactor(initiallyEnabled);
  const { enabled, remainingCodes, isSending } = twoFactor;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            Email verification
            <Badge variant={enabled ? "default" : "outline"}>
              {enabled ? "On" : "Off"}
            </Badge>
          </div>
          <p className="truncate text-sm text-muted-foreground">
            Codes are sent to {email}
          </p>
        </div>
        <Switch
          aria-label="Two-Factor Authentication"
          checked={enabled}
          disabled={isSending}
          onCheckedChange={(checked) =>
            void twoFactor.begin(checked ? "enable" : "disable")
          }
        />
      </div>

      {enabled && (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium text-foreground">
              Recovery codes
            </p>
            <p className="text-sm text-muted-foreground">
              {recoveryStatus(remainingCodes)}
            </p>
          </div>
          <Button
            variant="outline"
            className="shrink-0"
            disabled={isSending}
            onClick={() => void twoFactor.begin("regenerate")}
          >
            Generate new codes
          </Button>
        </div>
      )}

      <TwoFactorCodeDialog
        action={twoFactor.pendingAction}
        email={email}
        isSending={isSending}
        isSubmitting={twoFactor.isSubmitting}
        onResend={twoFactor.sendCode}
        onSubmit={twoFactor.submitCode}
        onCancel={twoFactor.cancel}
      />
      <RecoveryCodesDialog
        codes={twoFactor.newCodes}
        onDone={twoFactor.dismissCodes}
      />
    </div>
  );
}
