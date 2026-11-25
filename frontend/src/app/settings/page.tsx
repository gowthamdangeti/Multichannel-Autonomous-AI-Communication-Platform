import { redirect } from "next/navigation";

import { DEFAULT_SETTINGS_URL } from "@/components/settings/hooks/settingsSections";

export default function SettingsPage() {
  redirect(DEFAULT_SETTINGS_URL);
}
