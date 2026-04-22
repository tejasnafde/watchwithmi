import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeGuardedFlag } from "@/lib/guardedFlag";

/**
 * Bug #2 (docs/polishing/02-sync-playback.md):
 *   "Overlapping sync-flag setTimeouts in useYouTubePlayer.ts (173, 272, 297, 372)"
 *
 * Each site mutates a shared `isSyncingRef` / `isSeekingRef` and schedules
 * a clear via `setTimeout(..., N)` without tracking the timer. A rapid
 * sequence of state changes leaves multiple clears pending, each racing
 * to set the flag to false at its own delay. The last scheduled wins;
 * earlier ones fire and potentially clear a flag that was re-set in the
 * meantime.
 *
 * The fix is a single-source-of-truth helper: `makeGuardedFlag()` owns
 * the flag + its current auto-clear timer. Every `set()` cancels the
 * previous timer so at most one clear is ever outstanding.
 */

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("makeGuardedFlag", () => {
    it("starts in the cleared state", () => {
        const flag = makeGuardedFlag();
        expect(flag.get()).toBe(false);
    });

    it("set() turns the flag on", () => {
        const flag = makeGuardedFlag();
        flag.set(100);
        expect(flag.get()).toBe(true);
    });

    it("clears automatically after the supplied duration", () => {
        const flag = makeGuardedFlag();
        flag.set(500);

        vi.advanceTimersByTime(499);
        expect(flag.get()).toBe(true);

        vi.advanceTimersByTime(1);
        expect(flag.get()).toBe(false);
    });

    it("a second set() cancels the first timer so only one clear fires", () => {
        const flag = makeGuardedFlag();

        flag.set(1000); // would clear at t=1000
        vi.advanceTimersByTime(500);
        flag.set(1000); // should cancel first timer, clear at t=1500

        // At t=1000 (would've been cleared under the old buggy pattern),
        // the flag must still be set.
        vi.advanceTimersByTime(500);
        expect(flag.get()).toBe(true);

        // Only the second timer should be outstanding.
        expect(vi.getTimerCount()).toBe(1);

        // At t=1500, the flag clears.
        vi.advanceTimersByTime(500);
        expect(flag.get()).toBe(false);
    });

    it("clear() turns the flag off immediately and cancels the pending timer", () => {
        const flag = makeGuardedFlag();
        flag.set(500);

        flag.clear();
        expect(flag.get()).toBe(false);
        expect(vi.getTimerCount()).toBe(0);

        // Advancing past the original duration must not flip the flag.
        vi.advanceTimersByTime(10_000);
        expect(flag.get()).toBe(false);
    });

    it("many rapid sets never leave more than one pending timer", () => {
        const flag = makeGuardedFlag();

        for (let i = 0; i < 20; i++) {
            flag.set(1000);
            vi.advanceTimersByTime(50);
        }

        // After 20 sets there must still only be one pending timer.
        expect(vi.getTimerCount()).toBe(1);
        expect(flag.get()).toBe(true);
    });
});
