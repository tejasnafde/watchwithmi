import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Bug #4 (docs/polishing/02-sync-playback.md):
 *   "Video error 'Retry' button bypasses 3-attempt limit."
 *
 * Automatic retries stop after 3 failures and the error overlay appears.
 * The previous manual-Retry onClick reset `videoErrorRetryCount` to 0,
 * so the user could click Retry indefinitely. Once the auto-retry budget
 * is spent, the overlay should surface "Max retries reached" and offer
 * only Reload Page, not a resetting Retry button.
 */

vi.mock("@/hooks/useVideoSync", () => ({
    useVideoSync: () => ({
        handleVideoPlay: vi.fn(),
        handleVideoPause: vi.fn(),
        handleVideoSeeked: vi.fn(),
        handleTimeUpdate: vi.fn(),
        handleWaiting: vi.fn(),
        handleCanPlay: vi.fn(),
        isUpdatingFromSocket: false,
    }),
}));

vi.mock("@/hooks/useYouTubePlayer", () => ({
    useYouTubePlayer: () => ({
        playerContainerRef: { current: null },
        isReady: false,
        isPlaying: false,
        currentTime: 0,
        duration: 0,
        error: null,
        buffering: false,
        clearError: vi.fn(),
    }),
}));

import { MediaPlayer } from "@/components/MediaPlayer";
import type { MediaState } from "@/types";

const baseMedia: MediaState = {
    url: "https://example.com/video.mp4",
    type: "media",
    state: "paused",
    timestamp: 0,
    loading: false,
    is_playlist: false,
    playlist_id: "",
    playlist_title: "",
    playlist_items: [],
    current_index: 0,
    fallback_mode: false,
};

beforeEach(() => {
    vi.useFakeTimers();
});

/**
 * Fire 4 consecutive error events on the <video>. The handler increments
 * the retry counter each time; by the 4th call it exceeds 3 and setVideoError
 * is called, rendering the overlay.
 */
function exhaustRetries(video: HTMLVideoElement) {
    for (let i = 0; i < 4; i++) {
        act(() => {
            fireEvent.error(video);
        });
    }
}

describe("MediaPlayer — retry exhaustion (bug #4)", () => {
    it("surfaces 'max retries' copy once automatic retries are exhausted", () => {
        const { container } = render(
            <MediaPlayer
                currentMedia={baseMedia}
                canControl={true}
                socket={null}
                onPlayPause={vi.fn()}
                onSeek={vi.fn()}
            />,
        );

        const video = container.querySelector("video")!;
        expect(video).toBeTruthy();

        exhaustRetries(video);

        // Error overlay appears.
        expect(
            screen.getByText(/failed to load video after multiple attempts/i),
        ).toBeInTheDocument();

        // Max-retries message must be visible.
        expect(screen.getByText(/max(imum)? retries reached/i)).toBeInTheDocument();
    });

    it("does not render a Retry button in the exhausted overlay", () => {
        const { container } = render(
            <MediaPlayer
                currentMedia={baseMedia}
                canControl={true}
                socket={null}
                onPlayPause={vi.fn()}
                onSeek={vi.fn()}
            />,
        );

        const video = container.querySelector("video")!;
        exhaustRetries(video);

        // The button that used to reset the counter and retry is gone.
        expect(screen.queryByRole("button", { name: /^retry$/i })).toBeNull();

        // Reload is still offered as the escape hatch.
        expect(screen.getByRole("button", { name: /reload page/i })).toBeInTheDocument();
    });
});
