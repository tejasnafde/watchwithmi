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
 * - Shift-click on the header requests a "solo" — all other panels
 *   collapse, this one stays open. We surface that via an optional
 *   onSolo callback; plain clicks call onToggle.
 * - Visual language stays brutalist: hover flips to bg-white text-black.
 *   That class combination is pinned so a future refactor can't quietly
 *   soften the aesthetic.
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

    it("aria-expanded is 'false' and children are NOT in the DOM when collapsed", () => {
        render(
            <CollapsiblePanel
                title="VIDEO CHAT"
                icon={Users}
                expanded={false}
                onToggle={vi.fn()}
            >
                <p data-testid="hidden-body">should not render</p>
            </CollapsiblePanel>,
        );
        const header = screen.getByRole("button", { name: /video chat/i });
        expect(header).toHaveAttribute("aria-expanded", "false");
        expect(screen.queryByTestId("hidden-body")).not.toBeInTheDocument();
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

    it("pins the brutalist hover class so the aesthetic can't regress silently", () => {
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
        // Exact hover tokens required: invert on hover with no rounding.
        expect(header.className).toMatch(/hover:bg-white/);
        expect(header.className).toMatch(/hover:text-black/);
        expect(header.className).not.toMatch(/rounded/);
    });
});
