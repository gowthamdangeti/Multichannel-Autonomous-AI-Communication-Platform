"use client";

import { Camera, Eye, EyeOff, Loader2, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
    changePasswordApiV1AuthChangePasswordPost,
    getAvatarUploadUrlApiV1AuthMeAvatarUploadUrlPost,
    getCurrentUserApiV1AuthMeGet,
    updateCurrentUserApiV1AuthMePut,
} from "@/client/sdk.gen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";

const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES: Record<string, true> = {
    "image/jpeg": true,
    "image/png": true,
    "image/webp": true,
};

function errorDetail(err: unknown): string | undefined {
    if (!err || typeof err !== "object" || !("detail" in err)) return undefined;
    const detail = err.detail;
    return typeof detail === "string" ? detail : undefined;
}

export function ProfileSettings() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const next = searchParams.get("next") || "";
    const isSetup = next !== "";

    const { user, loading: authLoading, getAccessToken } = useAuth();
    const authEmail =
        (user && "email" in user && typeof user.email === "string" && user.email) ||
        (user && "primaryEmail" in user && typeof user.primaryEmail === "string" && user.primaryEmail) ||
        "";

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    // Saved state from /auth/me
    const [avatarKey, setAvatarKey] = useState<string | null>(null);
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    // Pending (unsaved) avatar change: { key, preview } or { key: null, preview: null } to remove.
    const [pendingAvatar, setPendingAvatar] = useState<{
        key: string | null;
        preview: string | null;
    } | null>(null);

    // Change-password form state (standard 3-field secure model)
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showCurrentPassword, setShowCurrentPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [passwordSaving, setPasswordSaving] = useState(false);
    const [passwordError, setPasswordError] = useState<string | null>(null);

    const loadProfile = useCallback(async () => {
        try {
            const token = await getAccessToken();
            const res = await getCurrentUserApiV1AuthMeGet({
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (res.data) {
                setFirstName(res.data.first_name ?? "");
                setLastName(res.data.last_name ?? "");
                setEmail(res.data.email ?? authEmail);
                setPhone(res.data.phone_number ?? "");
                setAvatarKey(res.data.avatar_key ?? null);
                setAvatarUrl(res.data.avatar_url ?? null);
                setPendingAvatar(null);
            }
        } catch {
            setError("Failed to load your profile. Please try again.");
        } finally {
            setLoading(false);
        }
    }, [getAccessToken, authEmail]);

    useEffect(() => {
        if (!authLoading) {
            void loadProfile();
        }
    }, [authLoading, loadProfile]);

    const handleFileSelected = async (file: File | undefined) => {
        setError(null);
        if (!file) return;
        if (!(file.type in ALLOWED_TYPES)) {
            setError("Please choose a JPG, PNG or WebP image.");
            return;
        }
        if (file.size > MAX_AVATAR_SIZE_BYTES) {
            setError("Image is too large. Maximum size is 5MB.");
            return;
        }
        setUploading(true);
        try {
            const token = await getAccessToken();
            const headers = token ? { Authorization: `Bearer ${token}` } : {};
            const urlRes = await getAvatarUploadUrlApiV1AuthMeAvatarUploadUrlPost({
                body: { content_type: file.type },
                headers,
            });
            if (urlRes.error || !urlRes.data) throw new Error("Failed to get upload URL");
            const uploadRes = await fetch(urlRes.data.upload_url, {
                method: "PUT",
                body: file,
                headers: {
                    "Content-Type": file.type,
                },
            });
            if (!uploadRes.ok) throw new Error("Image upload failed");
            setPendingAvatar({
                key: urlRes.data.avatar_key,
                preview: URL.createObjectURL(file),
            });
        } catch {
            setError("Failed to upload the image. Please try again.");
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const avatarChanged = pendingAvatar !== null;

    const handleSave = async () => {
        setError(null);
        if (!firstName.trim() && !lastName.trim()) {
            setError("Please enter your first name and last name.");
            return;
        }
        setSaving(true);
        try {
            const token = await getAccessToken();
            const headers = token ? { Authorization: `Bearer ${token}` } : {};
            const body: {
                first_name: string;
                last_name: string;
                phone_number: string | null;
                avatar_key?: string | null;
            } = {
                first_name: firstName.trim(),
                last_name: lastName.trim(),
                // Empty input clears the stored number (validator maps "" to null).
                phone_number: phone.trim() || null,
            };
            if (avatarChanged) {
                body.avatar_key = pendingAvatar!.key;
            }
            const res = await updateCurrentUserApiV1AuthMePut({ body, headers });
            if (res.error) throw new Error("Failed to save profile");
            toast.success("Profile updated");
            if (res.data && typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("autonomous_ai_os:user-updated", { detail: res.data }));
            }
            await loadProfile();
            if (isSetup) {
                router.replace(next);
            }
        } catch {
            setError("Failed to save your profile. Please try again.");
        } finally {
            setSaving(false);
        }
    };

    const handleChangePassword = async () => {
        setPasswordError(null);
        if (!currentPassword || !newPassword || !confirmPassword) {
            setPasswordError("Please enter all password fields.");
            return;
        }
        if (newPassword.length < 8) {
            setPasswordError("New password must be at least 8 characters.");
            return;
        }
        if (newPassword !== confirmPassword) {
            setPasswordError("New password and confirm password do not match.");
            return;
        }
        if (currentPassword === newPassword) {
            setPasswordError("New password must be different from your current password.");
            return;
        }
        setPasswordSaving(true);
        try {
            const token = await getAccessToken();
            const res = await changePasswordApiV1AuthChangePasswordPost({
                body: { current_password: currentPassword, new_password: newPassword },
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (res.error) {
                setPasswordError(errorDetail(res.error) || "Failed to update password.");
                return;
            }
            toast.success("Password updated successfully");
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
            setShowCurrentPassword(false);
            setShowNewPassword(false);
            setShowConfirmPassword(false);
        } catch {
            setPasswordError("Failed to update password. Please try again.");
        } finally {
            setPasswordSaving(false);
        }
    };

    const displayUrl = pendingAvatar?.preview ?? avatarUrl;
    const displayKey = pendingAvatar?.key ?? avatarKey;
    const initials = `${firstName.trim().charAt(0)}${lastName.trim().charAt(0)}`.toUpperCase() || "?";

    return (
        <>
            {isSetup && (
                <div className="rounded-lg border border-border bg-muted/40 p-4">
                    <p className="text-sm font-medium">Complete your profile</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                        Set your name and profile picture to continue to the workspace.
                    </p>
                </div>
            )}

            {authLoading || loading ? (
                <div className="rounded-lg border border-border p-4 settings-row-container">
                    <div className="flex flex-col sm:flex-row items-center sm:items-stretch gap-4 sm:gap-6">
                        <div className="flex flex-col justify-between items-center shrink-0 w-24 sm:w-28 gap-3 py-0.5">
                            <Skeleton className="h-20 w-20 rounded-md" />
                            <Skeleton className="h-8 w-full rounded-md" />
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col justify-between gap-4 w-full">
                            <div className="space-y-1.5">
                                <Skeleton className="h-4 w-20" />
                                <Skeleton className="h-9 w-full" />
                            </div>
                            <div className="space-y-1.5">
                                <Skeleton className="h-4 w-20" />
                                <Skeleton className="h-9 w-full" />
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <>
                    <div className="space-y-4 rounded-lg border border-border p-4 settings-row-container">
                        <div className="flex flex-col sm:flex-row items-center sm:items-stretch gap-4 sm:gap-6">
                            <div className="flex flex-col justify-between items-center shrink-0 w-24 sm:w-28 gap-3 py-0.5">
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    title="Upload a new photo"
                                    className="group relative h-20 w-20 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border bg-muted"
                                >
                                    {displayUrl ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={displayUrl} alt="Profile" className="h-full w-full object-cover" />
                                    ) : (
                                        <span className="flex h-full w-full items-center justify-center text-lg font-semibold text-muted-foreground">
                                            {initials}
                                        </span>
                                    )}
                                    <span className="absolute inset-0 flex items-center justify-center bg-background/50 opacity-0 transition-opacity group-hover:opacity-100">
                                        <Camera className="h-6 w-6 text-foreground" />
                                    </span>
                                    {uploading && (
                                        <span className="absolute inset-0 flex items-center justify-center bg-background/60">
                                            <Loader2 className="h-6 w-6 animate-spin" />
                                        </span>
                                    )}
                                </button>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp"
                                    className="hidden"
                                    onChange={(e) => void handleFileSelected(e.target.files?.[0])}
                                />
                                <div className="flex items-center gap-1.5 w-full">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-8 flex-1 text-xs whitespace-nowrap cursor-pointer px-2"
                                        disabled={uploading}
                                        onClick={() => fileInputRef.current?.click()}
                                    >
                                        <Camera className="h-3.5 w-3.5 mr-1" />
                                        {displayKey ? "Change" : "Upload photo"}
                                    </Button>
                                    {displayKey && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 w-8 p-0 text-xs text-muted-foreground hover:text-destructive cursor-pointer shrink-0"
                                            disabled={uploading}
                                            title="Remove photo"
                                            onClick={() => setPendingAvatar({ key: null, preview: null })}
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    )}
                                </div>
                            </div>
                            <div className="flex min-w-0 flex-1 flex-col justify-between gap-4 w-full">
                                <div className="space-y-1.5">
                                    <Label htmlFor="first-name">First name</Label>
                                    <Input
                                        id="first-name"
                                        value={firstName}
                                        onChange={(e) => setFirstName(e.target.value)}
                                        placeholder="Ada"
                                        maxLength={100}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="last-name">Last name</Label>
                                    <Input
                                        id="last-name"
                                        value={lastName}
                                        onChange={(e) => setLastName(e.target.value)}
                                        placeholder="Lovelace"
                                        maxLength={100}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4 rounded-lg border border-border p-4 settings-row-container">
                        <div className="space-y-1">
                            <Label>Email</Label>
                            <p className="truncate text-sm font-medium text-foreground">{email || "—"}</p>
                            <p className="text-xs text-muted-foreground">
                                Your sign-in email. Managed by your account provider.
                            </p>
                        </div>
                        <div className="space-y-1.5 pt-1">
                            <Label htmlFor="phone">Mobile number</Label>
                            <Input
                                id="phone"
                                type="tel"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                placeholder="+1 555 123 4567"
                                maxLength={30}
                            />
                            <p className="text-xs text-muted-foreground">
                                Optional contact number for your profile.
                            </p>
                        </div>
                    </div>

                    <div className="space-y-4 rounded-lg border border-border p-4 settings-row-container">
                        <div className="space-y-1">
                            <p className="text-sm font-medium">Change password</p>
                            <p className="text-sm text-muted-foreground">
                                Update your password to keep your account secure.
                            </p>
                        </div>

                        {/* Current Password */}
                        <div className="space-y-1.5">
                            <Label htmlFor="current-password">Current password</Label>
                            <div className="relative">
                                <Input
                                    id="current-password"
                                    type={showCurrentPassword ? "text" : "password"}
                                    value={currentPassword}
                                    onChange={(e) => setCurrentPassword(e.target.value)}
                                    placeholder="Enter current password"
                                    autoComplete="current-password"
                                    className="pr-10"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none transition-colors cursor-pointer"
                                    aria-label={showCurrentPassword ? "Hide current password" : "Show current password"}
                                >
                                    {showCurrentPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                                </button>
                            </div>
                        </div>

                        {/* New Password & Confirm Password */}
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label htmlFor="new-password">New password</Label>
                                <div className="relative">
                                    <Input
                                        id="new-password"
                                        type={showNewPassword ? "text" : "password"}
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        placeholder="At least 8 characters"
                                        autoComplete="new-password"
                                        className="pr-10"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowNewPassword(!showNewPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none transition-colors cursor-pointer"
                                        aria-label={showNewPassword ? "Hide new password" : "Show new password"}
                                    >
                                        {showNewPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                                    </button>
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="confirm-password">Confirm new password</Label>
                                <div className="relative">
                                    <Input
                                        id="confirm-password"
                                        type={showConfirmPassword ? "text" : "password"}
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        placeholder="Re-enter new password"
                                        autoComplete="new-password"
                                        className="pr-10"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none transition-colors cursor-pointer"
                                        aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                                    >
                                        {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Password Requirements & Match Feedback */}
                        {(newPassword.length > 0 || confirmPassword.length > 0) && (
                            <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-1.5 text-xs">
                                <div className="flex items-center gap-2">
                                    <span className={newPassword.length >= 8 ? "text-emerald-500 font-bold" : "text-muted-foreground"}>
                                        {newPassword.length >= 8 ? "✓" : "○"}
                                    </span>
                                    <span className={newPassword.length >= 8 ? "text-foreground font-medium" : "text-muted-foreground"}>
                                        At least 8 characters
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span
                                        className={
                                            newPassword === confirmPassword && confirmPassword.length > 0
                                                ? "text-emerald-500 font-bold"
                                                : "text-muted-foreground"
                                        }
                                    >
                                        {newPassword === confirmPassword && confirmPassword.length > 0 ? "✓" : "○"}
                                    </span>
                                    <span
                                        className={
                                            newPassword === confirmPassword && confirmPassword.length > 0
                                                ? "text-foreground font-medium"
                                                : "text-muted-foreground"
                                        }
                                    >
                                        Passwords match
                                    </span>
                                </div>
                                {currentPassword && newPassword && currentPassword === newPassword && (
                                    <div className="flex items-center gap-2 pt-0.5 text-amber-500">
                                        <span>⚠</span>
                                        <span>New password should be different from current password</span>
                                    </div>
                                )}
                            </div>
                        )}

                        {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}

                        <div className="flex justify-end">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => void handleChangePassword()}
                                disabled={
                                    passwordSaving ||
                                    !currentPassword ||
                                    !newPassword ||
                                    !confirmPassword ||
                                    newPassword.length < 8 ||
                                    newPassword !== confirmPassword ||
                                    newPassword === currentPassword
                                }
                                className="cursor-pointer"
                            >
                                {passwordSaving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                                Update password
                            </Button>
                        </div>
                    </div>

                    {error && <p className="text-sm text-destructive">{error}</p>}

                    {/* Footer Section */}
                    <div className="border-t border-border pt-4 flex items-center justify-between gap-3">
                        {isSetup ? (
                            <span className="text-sm text-muted-foreground">
                                {saving ? "Saving…" : "You'll continue to the workspace after saving."}
                            </span>
                        ) : (
                            <span />
                        )}
                        <Button
                            type="button"
                            onClick={() => void handleSave()}
                            disabled={saving || uploading}
                            className="cursor-pointer ml-auto shrink-0 self-end"
                        >
                            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                            Save changes
                        </Button>
                    </div>
                </>
            )}
        </>
    );
}
