"use client";

import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode, MouseEvent } from "react";

/**
 * Single collapsible panel used in the room sidebar (USERS / CHAT /
 * VIDEO CHAT). Brutalist-by-design: sharp 2px borders, pure black/white,
 * monospace caps, no rounding, no easing. A header-only when collapsed;
 * `flex-1` content body when expanded so multiple expanded panels share
 * the available vertical space.
 *
 * The parent owns `expanded` state — this component is controlled, and
 * persistence / default behavior (localStorage, auto-expand on video
 * active, etc.) lives with the caller.
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
                className="shrink-0 h-11 flex items-center justify-between px-4 border-b-2 border-white bg-black text-white hover:bg-white hover:text-black transition-colors cursor-pointer font-bold uppercase font-mono text-sm select-none"
            >
                <span className="flex items-center gap-2">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span>{title}</span>
                    {count !== undefined && (
                        <span className="opacity-70">({count})</span>
                    )}
                </span>
                <ChevronDown
                    aria-hidden="true"
                    className={`h-4 w-4 transition-transform duration-150 ${
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
