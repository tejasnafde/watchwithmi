"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * State machine for the collapsible sidebar panels in the room view.
 *
 * - Panels are keyed by string names. Each has a `defaultExpanded` value
 *   used when there's no saved preference in localStorage.
 * - State persists to `localStorage` under `watchwithmi.sidebar.<name>`
 *   so a refresh remembers the user's layout.
 * - `singleExpandMode` (mobile / narrow viewports) enforces "only one
 *   panel expanded at a time": programmatically or interactively opening
 *   a panel collapses the others.
 *
 * The caller feeds the result into <CollapsiblePanel> elements and wires
 * `toggle` / `solo` / `setExpanded` to the appropriate UI handlers. See
 * `frontend/src/components/CollapsiblePanel.tsx`.
 */

export interface PanelConfig {
    defaultExpanded: boolean;
}

export interface UseSidebarPanelsOptions {
    /** When true, opening a panel collapses every other panel. */
    singleExpandMode?: boolean;
    /** Override the localStorage key prefix (tests only). */
    storagePrefix?: string;
}

export interface SidebarPanelsApi<K extends string> {
    expanded: Record<K, boolean>;
    toggle: (name: K) => void;
    solo: (name: K) => void;
    setExpanded: (name: K, value: boolean) => void;
}

const DEFAULT_STORAGE_PREFIX = "watchwithmi.sidebar.";

function safeReadBoolean(key: string): boolean | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.localStorage.getItem(key);
        if (raw === "true") return true;
        if (raw === "false") return false;
        return null;
    } catch {
        return null;
    }
}

function safeWriteBoolean(key: string, value: boolean): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(key, value ? "true" : "false");
    } catch {
        // Private browsing / quota issues — silently drop.
    }
}

export function useSidebarPanels<K extends string>(
    panels: Record<K, PanelConfig>,
    options: UseSidebarPanelsOptions = {},
): SidebarPanelsApi<K> {
    const { singleExpandMode = false, storagePrefix = DEFAULT_STORAGE_PREFIX } =
        options;

    // Initial hydration runs once. We prefer the localStorage value when
    // present so the user's last layout is restored.
    const [expanded, setExpandedState] = useState<Record<K, boolean>>(() => {
        const entries = (Object.keys(panels) as K[]).map((name) => {
            const stored = safeReadBoolean(`${storagePrefix}${name}`);
            const value = stored ?? panels[name].defaultExpanded;
            return [name, value] as const;
        });
        return Object.fromEntries(entries) as Record<K, boolean>;
    });

    // Track the latest singleExpandMode so setExpanded / toggle stay in
    // sync when the caller flips the viewport-derived flag.
    const singleRef = useRef(singleExpandMode);
    singleRef.current = singleExpandMode;

    const setExpanded = useCallback(
        (name: K, value: boolean) => {
            setExpandedState((prev) => {
                const next = { ...prev, [name]: value };
                if (value && singleRef.current) {
                    for (const key of Object.keys(next) as K[]) {
                        if (key !== name) (next as Record<string, boolean>)[key] = false;
                    }
                }
                return next;
            });
        },
        [],
    );

    const toggle = useCallback(
        (name: K) => {
            setExpandedState((prev) => {
                const target = !prev[name];
                const next = { ...prev, [name]: target };
                if (target && singleRef.current) {
                    for (const key of Object.keys(next) as K[]) {
                        if (key !== name) (next as Record<string, boolean>)[key] = false;
                    }
                }
                return next;
            });
        },
        [],
    );

    const solo = useCallback((name: K) => {
        setExpandedState((prev) => {
            const next = { ...prev } as Record<K, boolean>;
            for (const key of Object.keys(next) as K[]) {
                next[key] = key === name;
            }
            return next;
        });
    }, []);

    // Persist whenever the state changes. Writing on every render means we
    // also capture programmatic setExpanded calls (e.g. auto-expand on
    // video isActive).
    useEffect(() => {
        for (const [name, value] of Object.entries(expanded) as [K, boolean][]) {
            safeWriteBoolean(`${storagePrefix}${name}`, value);
        }
    }, [expanded, storagePrefix]);

    return { expanded, toggle, solo, setExpanded };
}
