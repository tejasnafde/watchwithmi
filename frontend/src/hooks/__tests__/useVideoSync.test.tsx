import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useRef } from "react";

import { useVideoSync } from "@/hooks/useVideoSync";
import type { MediaState } from "@/types";

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

/**
 * The hook's own `useEffect` runs `syncPlayState` on mount, which briefly
 * flips `isUpdatingFromSocket` true and schedules a 100ms clear. All tests
 * below advance past that window before exercising the handlers under test.
 */
const SYNC_DEBOUNCE_MS = 100;
const settleMountEffects = () => {
    act(() => {
        vi.advanceTimersByTime(SYNC_DEBOUNCE_MS + 1);
    });
};

/**
 * Regression tests for useVideoSync behavior.
 *
 * Item #1 from docs/polishing/02-sync-playback.md claimed
 * "early-return in handleVideoPlay/handleVideoPause skips a sync-flag clear."
 * Auditing the current code showed no such leak — these handlers don't set
 * `isUpdatingFromSocket` at all, only read it. The tests below pin that
 * invariant so any future refactor that introduces a leak is caught.
 *
 * Item #5 is fixed alongside: the rejection threshold is tightened from
 * `currentTime === 0 && lastKnownTime > 5` to `currentTime < 0.1 && delta > 3`
 * so floating-point near-zero glitches are caught and the check no longer
 * triggers on tiny lastKnownTime values.
 */

// ---------------------------------------------------------------------------
// Fake <video> element
// ---------------------------------------------------------------------------

type FakeVideo = {
    currentTime: number;
    paused: boolean;
    readyState: number;
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
};

function makeFakeVideo(overrides: Partial<FakeVideo> = {}): FakeVideo {
    return {
        currentTime: 0,
        paused: true,
        readyState: 4, // HAVE_ENOUGH_DATA
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
        ...overrides,
    };
}

// Harness that wires useRef + useVideoSync together so the hook sees a
// stable videoRef whose .current is a FakeVideo.
function useTestHarness(opts: {
    video: FakeVideo;
    currentMedia: MediaState;
    canControl: boolean;
    onPlayPause: (action: "play" | "pause", timestamp: number) => void;
    onSeek: (timestamp: number) => void;
}) {
    const videoRef = useRef<HTMLVideoElement | null>(opts.video as unknown as HTMLVideoElement);
    return useVideoSync({
        videoRef,
        currentMedia: opts.currentMedia,
        canControl: opts.canControl,
        onPlayPause: opts.onPlayPause,
        onSeek: opts.onSeek,
    });
}

const makeMedia = (overrides: Partial<MediaState> = {}): MediaState => ({
    url: "https://example.com/v.mp4",
    type: "media",
    state: "playing",
    // Tests align `timestamp` with `video.currentTime` to keep the mount
    // syncTimestamp effect a no-op; otherwise the hook would rewrite
    // `video.currentTime` during mount and skew lastKnownTimeRef.
    timestamp: 10,
    loading: false,
    is_playlist: false,
    playlist_id: "",
    playlist_title: "",
    playlist_items: [],
    current_index: 0,
    fallback_mode: false,
    ...overrides,
});

// ---------------------------------------------------------------------------
// Item #1 — Early returns don't leak state
// ---------------------------------------------------------------------------

describe("useVideoSync — early returns are idempotent (bug #1 invariant)", () => {
    it("a rejected play event does not block a subsequent legitimate play event", () => {
        const video = makeFakeVideo({ currentTime: 10, paused: false });
        const onPlayPause = vi.fn();

        const { result } = renderHook(() =>
            useTestHarness({
                video,
                currentMedia: makeMedia({ timestamp: video.currentTime }),
                canControl: true,
                onPlayPause,
                onSeek: vi.fn(),
            }),
        );

        settleMountEffects();

        // Seed lastKnownTimeRef by firing handleTimeUpdate at t=10.
        act(() => {
            result.current.handleTimeUpdate();
        });

        // Reject path: currentTime jumps to 0 while lastKnownTime is 10.
        video.currentTime = 0;
        act(() => {
            result.current.handleVideoPlay();
        });
        expect(onPlayPause).not.toHaveBeenCalled();

        // Legitimate follow-up at t=10 must still go through.
        video.currentTime = 10;
        act(() => {
            result.current.handleVideoPlay();
        });
        expect(onPlayPause).toHaveBeenCalledTimes(1);
        expect(onPlayPause).toHaveBeenCalledWith("play", 10);
    });

    it("a rejected pause event does not block a subsequent legitimate pause event", () => {
        const video = makeFakeVideo({ currentTime: 40, paused: false });
        const onPlayPause = vi.fn();

        const { result } = renderHook(() =>
            useTestHarness({
                video,
                // Align timestamp with currentTime so mount syncTimestamp
                // doesn't overwrite the video position.
                currentMedia: makeMedia({ timestamp: 40 }),
                canControl: true,
                onPlayPause,
                onSeek: vi.fn(),
            }),
        );

        settleMountEffects();

        // Seed lastKnownTimeRef at 40.
        act(() => result.current.handleTimeUpdate());

        // Reject via the stale-pause clause: lastKnownTime 40, currentTime 5 → delta 35 > 30.
        video.currentTime = 5;
        act(() => result.current.handleVideoPause());
        expect(onPlayPause).not.toHaveBeenCalled();

        // Legitimate pause: small delta.
        video.currentTime = 38;
        act(() => result.current.handleVideoPause());

        expect(onPlayPause).toHaveBeenCalledTimes(1);
        expect(onPlayPause).toHaveBeenCalledWith("pause", 38);
    });
});

// ---------------------------------------------------------------------------
// Item #5 — Tighter reset-timestamp threshold
// ---------------------------------------------------------------------------

describe("useVideoSync — reset-timestamp detection (bug #5)", () => {
    it("rejects a float-near-zero play event when we were clearly ahead", () => {
        // Buffer glitches frequently land at 0.03 or similar rather than exact 0.
        // The stricter check (currentTime < 0.1) catches these.
        const video = makeFakeVideo({ currentTime: 10 });
        const onPlayPause = vi.fn();

        const { result } = renderHook(() =>
            useTestHarness({
                video,
                currentMedia: makeMedia({ timestamp: video.currentTime }),
                canControl: true,
                onPlayPause,
                onSeek: vi.fn(),
            }),
        );

        settleMountEffects();
        act(() => result.current.handleTimeUpdate());

        video.currentTime = 0.03;
        act(() => result.current.handleVideoPlay());

        expect(onPlayPause).not.toHaveBeenCalled();
    });

    it("does not reject a play event when we were only slightly ahead (delta <= 3s)", () => {
        // Previously: `lastKnownTime > 5` — a user who started, played 2s,
        // then seeked to 0 would not trigger the check anyway. The new
        // delta-based rule (`delta > 3`) keeps this allowed while making the
        // condition symmetric with the threshold.
        const video = makeFakeVideo({ currentTime: 2 });
        const onPlayPause = vi.fn();

        const { result } = renderHook(() =>
            useTestHarness({
                video,
                currentMedia: makeMedia({ timestamp: video.currentTime }),
                canControl: true,
                onPlayPause,
                onSeek: vi.fn(),
            }),
        );

        settleMountEffects();
        act(() => result.current.handleTimeUpdate()); // lastKnownTime = 2

        video.currentTime = 0;
        act(() => result.current.handleVideoPlay());

        // Delta is 2, below the 3s threshold — should accept.
        expect(onPlayPause).toHaveBeenCalledTimes(1);
        expect(onPlayPause).toHaveBeenCalledWith("play", 0);
    });
});
