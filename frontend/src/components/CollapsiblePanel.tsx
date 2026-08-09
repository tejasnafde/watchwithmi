"use client";

import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode, MouseEvent } from "react";

/**
 * Single collapsible panel used in the room sidebar. Header-only when
 * collapsed; `flex-1` body when expanded so several open panels share the
 * available height.
 *
 * The parent owns `expanded` state - this component is controlled, and
 * persistence / default behavior lives with the caller.
 *
 * Shift-click on the header requests a "solo" (the caller collapses
 * every other panel). Plain click is a normal toggle.
 */
export interface CollapsiblePanelProps {
    title: string;
    icon: LucideIcon;
    count?: number;
    expanded: boolean;
    onToggle: () => void;
    /** Shift-click hook for "maximize this panel, collapse the others". */
    onSolo?: () => void;
    /** Extra Tailwind classes for the outer <section>. */
    className?: string;
    children: ReactNode;
}

export function CollapsiblePanel({
    title,
    icon: Icon,
    count,
    expanded,
    onToggle,
    onSolo,
    className,
    children,
}: CollapsiblePanelProps) {
    const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
        if (e.shiftKey && onSolo) {
            onSolo();
            return;
        }
        onToggle();
    };

    return (
        <section
            className={`flex flex-col min-h-0 ${expanded ? "flex-1" : "shrink-0"} ${className ?? ""}`}
        >
            <button
                type="button"
                aria-expanded={expanded}
                onClick={handleClick}
                className="shrink-0 h-11 flex items-center justify-between gap-2 px-4 border-b border-border bg-card hover:bg-secondary transition-colors duration-150 cursor-pointer select-none"
            >
                <span className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
                    <span className="label">{title}</span>
                    {count !== undefined && (
                        <span className="label num">({count})</span>
                    )}
                </span>
                <ChevronDown
                    aria-hidden="true"
                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
                        expanded ? "rotate-0" : "-rotate-90"
                    }`}
                />
            </button>
            {/* Children stay mounted so stateful sub-components (video
                calls, chat scroll position, WebRTC peer connections)
                survive a collapse/expand cycle. `display: none` via the
                `hidden` utility removes the subtree from tab order and
                the accessibility tree. */}
            <div
                data-panel-body="true"
                aria-hidden={!expanded}
                className={`flex-1 min-h-0 overflow-hidden ${expanded ? "" : "hidden"}`}
            >
                {children}
            </div>
        </section>
    );
}
