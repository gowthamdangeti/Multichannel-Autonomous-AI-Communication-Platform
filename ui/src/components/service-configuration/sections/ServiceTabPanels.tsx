"use client";

import { TabsContent } from "@/components/ui/tabs";

import type { ServiceTab } from "../constants";
import { useServiceConfigEditor } from "../ServiceConfigContext";
import { OverrideToggle } from "./OverrideToggle";
import { ServiceFields } from "./ServiceFields";

/** One tab panel per service; in override mode fields show once the override is on. */
export function ServiceTabPanels({ tabs }: { tabs: ServiceTab[] }) {
    const { mode, enabledOverrides } = useServiceConfigEditor();
    return (
        <>
            {tabs.map(({ key, label }) => (
                <TabsContent key={key} value={key} className="mt-0">
                    {mode === "override" && <OverrideToggle service={key} label={label} />}
                    {(mode === "global" || enabledOverrides[key]) && <ServiceFields service={key} />}
                </TabsContent>
            ))}
        </>
    );
}
