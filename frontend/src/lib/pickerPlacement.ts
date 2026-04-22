/**
 * Placement helper for the chat emoji picker.
 *
 * The picker sits absolutely above its trigger button. The desktop look
 * uses right-anchoring (picker's right edge aligns with the trigger's
 * right edge and grows leftward), which looks balanced for messages on
 * the right side of the chat column. On narrow viewports that placement
 * can push the picker off the left edge — this helper flips to
 * left-anchoring in that case.
 *
 * Keeping the decision pure + testable means the component itself only
 * needs a `useLayoutEffect` that reads the DOM once on mount. See
 * docs/polishing/03-chat-reactions-queue.md item #3.7.
 */
export interface PickerPlacementInput {
    /** `getBoundingClientRect().right` of the trigger button. */
    triggerRight: number;
    /** Current viewport width (typically `window.innerWidth`). */
    viewportWidth: number;
    /** Approximate picker width in px; used to predict overflow. */
    pickerWidth: number;
    /** Minimum pixels from the viewport edge to keep clear. */
    margin: number;
}

export type PickerAnchor = "left" | "right";

export function choosePickerAnchor({
    triggerRight,
    viewportWidth,
    pickerWidth,
    margin,
}: PickerPlacementInput): PickerAnchor {
    // If we right-anchor, the picker's left edge lands at
    // triggerRight - pickerWidth. If that's inside the margin, flip.
    const rightAnchoredLeftEdge = triggerRight - pickerWidth;
    if (rightAnchoredLeftEdge < margin) {
        return "left";
    }

    // Suppress "unused viewportWidth" — kept in the signature so callers
    // can stay forward-compatible with a future bottom/top decision that
    // also needs the viewport height / width.
    void viewportWidth;

    return "right";
}
