import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Users } from "lucide-react";

import { CollapsiblePanel } from "@/components/CollapsiblePanel";

/**
 * Contract for the sidebar's collapse/expand primitive.
 *
 * - Header is a real <button role="button"> with aria-expanded reflecting
 *   the current state. Keyboard users can toggle with Space / Enter.
 * - Collapsed state hides the children from the DOM (not just visually)
 *   so focus order stays predictable and screen readers skip it.
 * - Shift-click on the header requests a "solo" - all other panels
 *   collapse, this one stays open. We surface that via an optional
 *   onSolo callback; plain clicks call onToggle.
 * - Header hover is a token class and carries no hardcoded palette colour.
 *   Both halves are pinned so a future edit can't reintroduce a literal theme.
 */

describe("CollapsiblePanel", () => {
    it("renders the header as a button with aria-expanded='true' when expanded", () => {
        render(
            <CollapsiblePanel
                title="CHAT"
                icon={Users}
                expanded={true}
                onToggle={vi.fn()}
            >
                <p>hello</p>
            </CollapsiblePanel>,
        );
        const header = screen.getByRole("button", { name: /chat/i });
        expect(header).toHaveAttribute("aria-expanded", "true");
        expect(screen.getByText("hello")).toBeInTheDocument();
    });

    it("keeps children mounted but visually hidden when collapsed", () => {
        // Children stay mounted so expensive sub-components (VideoChat,
        // ChatPanel) preserve their state across collapse/expand. The
        // body is CSS-hidden via `display: none` so it's out of tab
        // order and accessibility trees.
        render(
            <CollapsiblePanel
                title="VIDEO CHAT"
                icon={Users}
                expanded={false}
                onToggle={vi.fn()}
            >
                <p data-testid="hidden-body">still mounted</p>
            </CollapsiblePanel>,
        );
        const header = screen.getByRole("button", { name: /video chat/i });
        expect(header).toHaveAttribute("aria-expanded", "false");

        const body = screen.getByTestId("hidden-body");
        expect(body).toBeInTheDocument();
        // Its containing wrapper carries the Tailwind `hidden` utility.
        expect(body.closest('[data-panel-body="true"]')).toHaveClass("hidden");
    });

    it("plain click fires onToggle, not onSolo", () => {
        const onToggle = vi.fn();
        const onSolo = vi.fn();
        render(
            <CollapsiblePanel
                title="USERS"
                icon={Users}
                expanded={false}
                onToggle={onToggle}
                onSolo={onSolo}
            >
                <p>body</p>
            </CollapsiblePanel>,
        );
        fireEvent.click(screen.getByRole("button", { name: /users/i }));
        expect(onToggle).toHaveBeenCalledTimes(1);
        expect(onSolo).not.toHaveBeenCalled();
    });

    it("shift+click fires onSolo when provided", () => {
        const onToggle = vi.fn();
        const onSolo = vi.fn();
        render(
            <CollapsiblePanel
                title="USERS"
                icon={Users}
                expanded={false}
                onToggle={onToggle}
                onSolo={onSolo}
            >
                <p>body</p>
            </CollapsiblePanel>,
        );
        fireEvent.click(screen.getByRole("button", { name: /users/i }), {
            shiftKey: true,
        });
        expect(onSolo).toHaveBeenCalledTimes(1);
        expect(onToggle).not.toHaveBeenCalled();
    });

    it("shift+click falls back to onToggle if onSolo is not provided", () => {
        const onToggle = vi.fn();
        render(
            <CollapsiblePanel
                title="USERS"
                icon={Users}
                expanded={false}
                onToggle={onToggle}
            >
                <p>body</p>
            </CollapsiblePanel>,
        );
        fireEvent.click(screen.getByRole("button", { name: /users/i }), {
            shiftKey: true,
        });
        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it("renders the count in parentheses when provided", () => {
        render(
            <CollapsiblePanel
                title="USERS"
                icon={Users}
                count={3}
                expanded={true}
                onToggle={vi.fn()}
            >
                <p>body</p>
            </CollapsiblePanel>,
        );
        expect(screen.getByRole("button", { name: /users.*3/i })).toBeInTheDocument();
    });

    it("pins the themed hover class and stays free of hardcoded colours", () => {
        render(
            <CollapsiblePanel
                title="USERS"
                icon={Users}
                expanded={false}
                onToggle={vi.fn()}
            >
                <p>body</p>
            </CollapsiblePanel>,
        );
        const header = screen.getByRole("button", { name: /users/i });
        // Hover raises the surface with a semantic token, so the header
        // themes itself in light and dark.
        expect(header.className).toMatch(/hover:bg-secondary/);
        // No literal palette colour may come back in.
        expect(header.className).not.toMatch(/bg-(black|white|gray-)/);
        expect(header.className).not.toMatch(/text-(black|white|gray-)/);
        expect(header.className).not.toMatch(/border-(black|white|gray-)/);
        expect(header.className).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
    });
});
