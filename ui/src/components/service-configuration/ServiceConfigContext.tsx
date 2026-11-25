"use client";

import { createContext, useContext } from "react";

import type { ServiceConfigEditor } from "./hooks/useServiceConfigurationForm";

const ServiceConfigContext = createContext<ServiceConfigEditor | null>(null);

export const ServiceConfigProvider = ServiceConfigContext.Provider;

/** Editor state shared by every field of the service configuration form. */
export function useServiceConfigEditor(): ServiceConfigEditor {
    const editor = useContext(ServiceConfigContext);
    if (!editor) throw new Error("useServiceConfigEditor must be used inside ServiceConfigProvider");
    return editor;
}
