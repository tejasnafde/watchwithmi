import { render, fireEvent, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";

import { ChatPanel } from "@/components/ChatPanel";
import type { ChatMessage } from "@/types";

/**
 * Bug #3.2 (docs/polishing/03-chat-reactions-queue.md):
 *   The emoji picker's `useEffect` that attaches a document `mousedown`
 *   listener depends on `onClose`. In the current code, `MessageReactions`
 *   passes `() => setShowPicker(false)` inline, so the function identity
 *   changes on every parent render and the effect re-attaches the listener
 *   each time.
 *
 * Observable regression: document.addEventListener is called O(renders)
 * times while the picker stays open. After the fix, it's called exactly
 * once for the lifetime of a single picker-open session.
 */

let addSpy: ReturnType<typeof vi.spyOn>;
let removeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    addSpy = vi.spyOn(document, "addEventListener");
    removeSpy = vi.spyOn(document, "removeEventListener");
});

afterEach(() => {
    addSpy.mockRestore();
    removeSpy.mockRestore();
});

function countMousedown(spy: ReturnType<typeof vi.spyOn>) {
    return spy.mock.calls.filter((c: unknown[]) => c[0] === "mousedown").length;
}

const baseMessage: ChatMessage = {
    id: "m1",
    message_id: "m1",
    user_name: "bob",
    message: "hi",
    timestamp: "2026-01-01T00:00:00Z",
    reactions: {},
};

/**
 * Test harness: renders <ChatPanel> and exposes a "bump" button to force
 * an unrelated state change in the parent, which re-renders the whole
 * subtree including the open picker.
 */
function Harness() {
    const [tick, setTick] = useState(0);
    const message: ChatMessage = { ...baseMessage, reactions: {} };
    return (
        <>
            <button data-testid="bump" onClick={() => setTick((t) => t + 1)}>
                bump {tick}
            </button>
            <ChatPanel
                messages={[message]}
                onSendMessage={vi.fn()}
                currentUserName="alice"
                currentUserId="alice-id"
                onToggleReaction={vi.fn()}
            />
        </>
    );
}

describe("ChatPanel — emoji picker listener stability (bug #3.2)", () => {
    it("attaches the mousedown listener exactly once per open session, even across parent re-renders", () => {
        render(<Harness />);

        // Open the picker. Each message renders a single "+" button via
        // MessageReactions; getAllByRole('button') includes it. We target
        // by its svg lucide class-name via testid-ish fallback: it's the
        // only button with no text inside MessageReactions. Easiest:
        // grab via its sibling SVG title — or just pick the last button in
        // the message row. Using querySelector to avoid brittle selectors.
        const plusButton = document.querySelector<HTMLButtonElement>(
            'button.w-5.h-5',
        );
        expect(plusButton).not.toBeNull();

        act(() => {
            plusButton!.click();
        });

        // Picker is now mounted; a mousedown listener should have been
        // attached exactly once.
        const initialMousedown = countMousedown(addSpy);
        expect(initialMousedown).toBeGreaterThanOrEqual(1);

        // Force 5 unrelated parent re-renders. With a memoized onClose the
        // picker's effect must not re-run, so addEventListener count stays
        // flat.
        const bump = screen.getByTestId("bump");
        for (let i = 0; i < 5; i++) {
            act(() => {
                fireEvent.click(bump);
            });
        }

        expect(countMousedown(addSpy)).toBe(initialMousedown);
    });
});
