import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect } from "react";

/**
 * Regression tests for useYouTubePlayer.
 *
 * Bug #3 (docs/polishing/02-sync-playback.md):
 *   "UNSTARTED state sets buffering=true with no timeout."
 *   If the YouTube iframe never transitions out of UNSTARTED (e.g. autoplay
 *   blocked, video unavailable mid-load) the buffering indicator stays
 *   visible forever. We need a fallback timeout that clears buffering after
 *   a grace period.
 */

// ---------------------------------------------------------------------------
// Fake YT player + loader
// ---------------------------------------------------------------------------

type YTListener = (event: { target: FakePlayer; data?: number }) => void;

class FakePlayer {
    destroy = vi.fn();
    playVideo = vi.fn();
    pauseVideo = vi.fn();
    seekTo = vi.fn();
    getPlayerState = vi.fn().mockReturnValue(-1); // UNSTARTED
    getCurrentTime = vi.fn().mockReturnValue(0);
    getDuration = vi.fn().mockReturnValue(100);
    onReady: YTListener | null = null;
    onStateChange: YTListener | null = null;
    onError: YTListener | null = null;

    constructor(_el: unknown, opts: { events?: Record<string, YTListener> }) {
        this.onReady = opts.events?.onReady ?? null;
        this.onStateChange = opts.events?.onStateChange ?? null;
        this.onError = opts.events?.onError ?? null;
    }
}

// Shared mock state needs to be visible both in the vi.mock factory (which
// vitest hoists above the imports) and in the test bodies, so we declare it
// via vi.hoisted.
interface SharedState {
    latestPlayer: FakePlayer | null;
}
const sharedState: SharedState = vi.hoisted(() => ({ latestPlayer: null }));

vi.mock("@/lib/youtube-api", () => {
    return {
        loadYouTubeAPI: vi.fn().mockImplementation(async () => {
            (window as unknown as { YT: unknown }).YT = {
                Player: function (el: unknown, opts: { events?: Record<string, YTListener> }) {
                    sharedState.latestPlayer = new FakePlayer(el, opts);
                    return sharedState.latestPlayer;
                },
            };
        }),
        YT: {
            PlayerState: {
                UNSTARTED: -1,
                ENDED: 0,
                PLAYING: 1,
                PAUSED: 2,
                BUFFERING: 3,
                CUED: 5,
            },
        },
        extractYouTubeVideoId: (u: string) => u || null,
        extractYouTubePlaylistId: () => null,
    };
});

beforeEach(() => {
    sharedState.latestPlayer = null;
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    delete (window as any).YT;
});

// Flush the loadYouTubeAPI promise + the subsequent new YT.Player call.
async function flushPlayerInit() {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
    });
}

/**
 * Render the hook inside a component that actually mounts the ref'd div
 * so the init effect proceeds past its `playerContainerRef.current` guard.
 * Exposes the hook return value through a capture callback.
 */
function renderYTHookInComponent(
    props: Parameters<typeof import("@/hooks/useYouTubePlayer").useYouTubePlayer>[0],
    capture: (v: ReturnType<typeof import("@/hooks/useYouTubePlayer").useYouTubePlayer>) => void,
    useYouTubePlayer: typeof import("@/hooks/useYouTubePlayer").useYouTubePlayer,
) {
    function Harness() {
        const value = useYouTubePlayer(props);
        useEffect(() => {
            capture(value);
        });
        return <div ref={value.playerContainerRef} />;
    }
    return render(<Harness />);
}

// ---------------------------------------------------------------------------
// Bug #3 — UNSTARTED buffering must time out
// ---------------------------------------------------------------------------

describe("useYouTubePlayer — UNSTARTED buffering timeout (bug #3)", () => {
    it("clears buffering after the fallback window if the player stays UNSTARTED", async () => {
        const { useYouTubePlayer } = await import("@/hooks/useYouTubePlayer");

        let latest: ReturnType<typeof useYouTubePlayer> | null = null;
        renderYTHookInComponent(
            {
                videoUrl: "dQw4w9WgXcQ",
                isHost: true,
                socket: null,
                shouldPlay: false,
                targetTimestamp: 0,
            },
            (v) => {
                latest = v;
            },
            useYouTubePlayer,
        );

        await flushPlayerInit();
        expect(sharedState.latestPlayer).not.toBeNull();

        // Fire onStateChange(UNSTARTED). This sets buffering=true.
        act(() => {
            sharedState.latestPlayer!.onStateChange!({ target: sharedState.latestPlayer!, data: -1 });
        });
        expect(latest!.buffering).toBe(true);

        // After the fallback window, buffering must clear even though no
        // further state change arrived.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(5000);
        });
        expect(latest!.buffering).toBe(false);
    });

    it("does not clear prematurely on its own — the fallback only fires for UNSTARTED", async () => {
        const { useYouTubePlayer } = await import("@/hooks/useYouTubePlayer");

        let latest: ReturnType<typeof useYouTubePlayer> | null = null;
        renderYTHookInComponent(
            {
                videoUrl: "dQw4w9WgXcQ",
                isHost: true,
                socket: null,
                shouldPlay: false,
                targetTimestamp: 0,
            },
            (v) => {
                latest = v;
            },
            useYouTubePlayer,
        );

        await flushPlayerInit();

        // BUFFERING is a separate state that also sets buffering=true but is
        // handled elsewhere (resolved by the currentTime interval when the
        // player transitions to PLAYING/PAUSED). The fallback timeout must
        // NOT override that path.
        act(() => {
            sharedState.latestPlayer!.onStateChange!({ target: sharedState.latestPlayer!, data: 3 }); // BUFFERING
        });
        expect(latest!.buffering).toBe(true);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(5000);
        });
        // Without a state transition to PLAYING/PAUSED, BUFFERING stays true.
        // Only UNSTARTED gets the timeout fallback.
        expect(latest!.buffering).toBe(true);
    });
});
