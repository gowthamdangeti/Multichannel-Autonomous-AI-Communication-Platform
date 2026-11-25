import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  disable2FaApiV1Auth2FaDisablePost,
  get2FaRecoveryStatusApiV1Auth2FaRecoveryCodesGet,
  regenerate2FaRecoveryCodesApiV1Auth2FaRecoveryCodesPost,
  send2FaEmailOtpEndpointApiV1Auth2FaSendEmailOtpPost,
  verify2FaEmailOtpEndpointApiV1Auth2FaVerifyEmailOtpPost,
} from "@/client/sdk.gen";
import { useAuth } from "@/lib/auth";

export type TwoFactorAction = "enable" | "disable" | "regenerate";

const INVALID_CODE = "That code is invalid or has expired.";

export function useTwoFactor(initiallyEnabled: boolean) {
  const { getAccessToken } = useAuth();
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [remainingCodes, setRemainingCodes] = useState<number | null>(null);
  const [pendingAction, setPendingAction] = useState<TwoFactorAction | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);

  const withAuth = useCallback(async () => {
    const token = await getAccessToken();
    return { headers: token ? { Authorization: `Bearer ${token}` } : {} };
  }, [getAccessToken]);

  const refreshStatus = useCallback(async () => {
    const response = await get2FaRecoveryStatusApiV1Auth2FaRecoveryCodesGet(await withAuth());
    setRemainingCodes(response.data ? response.data.remaining : null);
  }, [withAuth]);

  useEffect(() => {
    if (enabled) void refreshStatus();
  }, [enabled, refreshStatus]);

  const sendCode = useCallback(async () => {
    setIsSending(true);
    const response = await send2FaEmailOtpEndpointApiV1Auth2FaSendEmailOtpPost(await withAuth()).catch(() => null);
    setIsSending(false);
    if (!response?.data) {
      toast.error("We couldn't send the verification code. Please try again.");
      return false;
    }
    return true;
  }, [withAuth]);

  const begin = useCallback(
    async (action: TwoFactorAction) => {
      if (await sendCode()) setPendingAction(action);
    },
    [sendCode],
  );

  const submitCode = useCallback(
    async (otp: string) => {
      setIsSubmitting(true);
      const options = { ...(await withAuth()), body: { otp } };
      let succeeded = false;
      if (pendingAction === "disable") {
        const response = await disable2FaApiV1Auth2FaDisablePost(options).catch(() => null);
        succeeded = Boolean(response?.data);
        if (succeeded) {
          setEnabled(false);
          setRemainingCodes(null);
          toast.success("Two-Factor Authentication turned off.");
        }
      } else {
        const request =
          pendingAction === "enable"
            ? verify2FaEmailOtpEndpointApiV1Auth2FaVerifyEmailOtpPost
            : regenerate2FaRecoveryCodesApiV1Auth2FaRecoveryCodesPost;
        const response = await request(options).catch(() => null);
        succeeded = Boolean(response?.data);
        if (response?.data) {
          setEnabled(true);
          setNewCodes(response.data.recovery_codes);
          setRemainingCodes(response.data.recovery_codes.length);
        }
      }
      setIsSubmitting(false);
      if (succeeded) setPendingAction(null);
      else toast.error(INVALID_CODE);
    },
    [pendingAction, withAuth],
  );

  return {
    enabled,
    remainingCodes,
    pendingAction,
    isSending,
    isSubmitting,
    newCodes,
    begin,
    sendCode,
    submitCode,
    cancel: () => setPendingAction(null),
    dismissCodes: () => setNewCodes(null),
  };
}
