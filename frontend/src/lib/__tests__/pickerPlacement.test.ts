import { describe, it, expect } from "vitest";
import { choosePickerAnchor } from "@/lib/pickerPlacement";

/**
 * Bug #3.7 (docs/polishing/03-chat-reactions-queue.md):
 *   "Emoji picker overflow on small screens — picker renders off-screen
 *    near viewport edges."
 *
 * `choosePickerAnchor` is the pure placement helper the picker uses to
 * decide whether to anchor its right edge or its left edge to the trigger.
 * Default is right-anchoring (the picker extends to the left of the button,
 * matching the current look on desktop); the helper flips to left-anchoring
 * when that would push the picker off-screen.
 */

const PICKER_WIDTH = 280;
const VIEWPORT = 375; // narrow mobile
const MARGIN = 8;

describe("choosePickerAnchor", () => {
    it("picks right-anchor when there's room to the left of the trigger", () => {
        // Trigger is well into the page: right edge at x=360, plenty of
        // space to extend 280px leftward.
        const triggerRight = 340;
        const anchor = choosePickerAnchor({
            triggerRight,
            viewportWidth: 800,
            pickerWidth: PICKER_WIDTH,
            margin: MARGIN,
        });
        expect(anchor).toBe("right");
    });

    it("flips to left-anchor when right-anchor would clip the left edge", () => {
        // Trigger is near the left edge: right edge at x=120. Right-anchoring
        // would push the picker to x=120-280=-160 — clipped.
        const anchor = choosePickerAnchor({
            triggerRight: 120,
            viewportWidth: VIEWPORT,
            pickerWidth: PICKER_WIDTH,
            margin: MARGIN,
        });
        expect(anchor).toBe("left");
    });

    it("respects the configurable margin from the viewport edge", () => {
        // Right-anchor would land exactly at x=0; margin=8 triggers a flip.
        const anchor = choosePickerAnchor({
            triggerRight: 280,
            viewportWidth: 400,
            pickerWidth: PICKER_WIDTH,
            margin: MARGIN,
        });
        expect(anchor).toBe("left");
    });

    it("stays right-anchored when the right-anchor landing spot is safely past the margin", () => {
        const anchor = choosePickerAnchor({
            triggerRight: 300,
            viewportWidth: 800,
            pickerWidth: PICKER_WIDTH,
            margin: MARGIN,
        });
        expect(anchor).toBe("right");
    });
});
