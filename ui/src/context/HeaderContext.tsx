"use client";

import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export interface Breadcrumb {
  label: ReactNode;
  /** Omitted on the current page; a link renders every ancestor that has one. */
  href?: string;
}

export interface HeaderData {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  searchBar?: ReactNode;
  customHeader?: ReactNode;
  // A page nested deeper than its nav item supplies its full trail, so the top
  // bar can show the path instead of just "nav item / title".
  breadcrumbs?: Breadcrumb[];
  // List pages: a title row with refresh and the create button, then a toolbar
  // row for search and filters. Any of these turns that layout on.
  primaryAction?: ReactNode;
  toolbar?: ReactNode;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  /** Internal ID to track which PageHeader instance owns this header */
  _instanceId?: number;
}

interface HeaderContextType {
  headerData: HeaderData | null;
  setHeaderData: (data: HeaderData | null | ((prev: HeaderData | null) => HeaderData | null)) => void;
}

const HeaderContext = createContext<HeaderContextType | undefined>(undefined);
const HasCustomHeaderContext = createContext<boolean>(false);

export function useHasCustomHeader(): boolean {
  return useContext(HasCustomHeaderContext);
}

function areValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a && !b) return true;
  if (!a || !b) return false;

  if (typeof a === "function" && typeof b === "function") {
    return true;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!areValuesEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (React.isValidElement(a) && React.isValidElement(b)) {
    return areNodesEqual(a, b);
  }

  if (typeof a === "object" && typeof b === "object") {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!areValuesEqual(aObj[key], bObj[key])) return false;
    }
    return true;
  }

  return false;
}

function areNodesEqual(a: ReactNode, b: ReactNode): boolean {
  if (a === b) return true;
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!areNodesEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (!React.isValidElement(a) || !React.isValidElement(b)) return false;
  if (a.type !== b.type || a.key !== b.key) return false;

  const aProps = a.props as Record<string, unknown>;
  const bProps = b.props as Record<string, unknown>;
  const aKeys = Object.keys(aProps);
  const bKeys = Object.keys(bProps);
  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (key === "children") {
      if (!areNodesEqual(aProps.children as ReactNode, bProps.children as ReactNode)) {
        return false;
      }
      continue;
    }
    if (!areValuesEqual(aProps[key], bProps[key])) {
      return false;
    }
  }
  return true;
}

function areBreadcrumbsEqual(a?: Breadcrumb[], b?: Breadcrumb[]): boolean {
  if (a === b) return true;
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].label !== b[i].label || a[i].href !== b[i].href) return false;
  }
  return true;
}

function areHeaderDataEqual(prev: HeaderData | null, next: HeaderData | null): boolean {
  if (prev === next) return true;
  if (!prev && !next) return true;
  if (!prev || !next) return false;
  if (prev._instanceId !== next._instanceId) return false;
  if (prev.title !== next.title) return false;
  if (prev.subtitle !== next.subtitle) return false;
  if (prev.isRefreshing !== next.isRefreshing) return false;
  if (!areBreadcrumbsEqual(prev.breadcrumbs, next.breadcrumbs)) return false;
  if (Boolean(prev.onRefresh) !== Boolean(next.onRefresh)) return false;
  if (!areNodesEqual(prev.primaryAction, next.primaryAction)) return false;
  if (!areNodesEqual(prev.actions, next.actions)) return false;
  if (!areNodesEqual(prev.searchBar, next.searchBar)) return false;
  if (!areNodesEqual(prev.customHeader, next.customHeader)) return false;
  if (!areNodesEqual(prev.toolbar, next.toolbar)) return false;
  return true;
}

export function HeaderProvider({ children }: { children: ReactNode }) {
  const [headerData, setHeaderDataState] = useState<HeaderData | null>(null);
  const latestOnRefreshRef = useRef<(() => void) | undefined>(undefined);

  const setHeaderData = useCallback(
    (action: HeaderData | null | ((prev: HeaderData | null) => HeaderData | null)) => {
      setHeaderDataState((prev) => {
        const rawNext = typeof action === "function" ? action(prev) : action;
        if (!rawNext) {
          latestOnRefreshRef.current = undefined;
          return null;
        }

        latestOnRefreshRef.current = rawNext.onRefresh;

        // Create normalized data with stable onRefresh delegate
        const normalizedNext: HeaderData = {
          ...rawNext,
          onRefresh: rawNext.onRefresh ? () => latestOnRefreshRef.current?.() : undefined,
        };

        if (areHeaderDataEqual(prev, normalizedNext)) {
          return prev;
        }
        return normalizedNext;
      });
    },
    []
  );

  const contextValue = useMemo(() => ({ headerData, setHeaderData }), [headerData, setHeaderData]);
  const hasCustomHeader = Boolean(headerData?.customHeader);

  return (
    <HeaderContext.Provider value={contextValue}>
      <HasCustomHeaderContext.Provider value={hasCustomHeader}>
        {children}
      </HasCustomHeaderContext.Provider>
    </HeaderContext.Provider>
  );
}

export function useHeader() {
  const context = useContext(HeaderContext);
  if (!context) {
    throw new Error("useHeader must be used within a HeaderProvider");
  }
  return context;
}

type PageHeaderProps = HeaderData;

let nextHeaderInstanceId = 0;

export function PageHeader({
  title,
  subtitle,
  actions,
  searchBar,
  customHeader,
  breadcrumbs,
  primaryAction,
  toolbar,
  onRefresh,
  isRefreshing,
}: PageHeaderProps) {
  const { setHeaderData } = useHeader();
  const instanceIdRef = useRef<number>(0);
  if (!instanceIdRef.current) {
    instanceIdRef.current = ++nextHeaderInstanceId;
  }

  // Clear headerData ONLY when this PageHeader component unmounts AND it is still the owner
  useEffect(() => {
    const id = instanceIdRef.current;
    return () => {
      setHeaderData((prev) => {
        if (prev && prev._instanceId === id) {
          return null;
        }
        return prev;
      });
    };
  }, [setHeaderData]);

  // Update headerData when props change
  useEffect(() => {
    setHeaderData({
      _instanceId: instanceIdRef.current,
      title,
      subtitle,
      actions,
      searchBar,
      customHeader,
      breadcrumbs,
      primaryAction,
      toolbar,
      onRefresh,
      isRefreshing,
    });
  }, [
    title,
    subtitle,
    actions,
    searchBar,
    customHeader,
    breadcrumbs,
    primaryAction,
    toolbar,
    onRefresh,
    isRefreshing,
    setHeaderData,
  ]);

  return null;
}
