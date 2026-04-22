import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Bug #2 (docs/polishing/01-critical-bugs.md):
 *   "Video reaction setTimeout leak" — useRoom.ts:351-353.
 *
 * `video_reaction` events trigger a setTimeout that clears the ephemeral
 * reaction after 3s. The timeout ID is not tracked, so if the component
 * unmounts before 3s elapses the callback still fires and calls
 * `setVideoReactions` on an unmounted hook — a "leak" in two senses: the
 * timer stays scheduled, and React warns about the late state update.
 *
 * These tests pin the expected cleanup behavior:
 *   1. A reaction appears when the event arrives.
 *   2. It's removed 3s later (happy path).
 *   3. If the hook unmounts within the window, no timers remain pending.
 */

// ---------------------------------------------------------------------------
// Fake Socket.IO client
// ---------------------------------------------------------------------------

type Handler = (data: unknown) => void;

const makeFakeSocket = () => {
  const handlers = new Map<string, Handler>();
  const socket = {
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, handler);
      return socket;
    }),
    off: vi.fn(() => socket),
    emit: vi.fn(() => socket),
    disconnect: vi.fn(),
    io: {
      on: vi.fn(),
      off: vi.fn(),
    },
    __fire: (event: string, data?: unknown) => {
      const h = handlers.get(event);
      if (!h) throw new Error(`No handler registered for '${event}'`);
      h(data as never);
    },
  };
  return socket;
};

let fakeSocket: ReturnType<typeof makeFakeSocket>;

vi.mock("@/lib/api", () => ({
  createSocket: () => fakeSocket,
  BACKEND_URL: "http://test",
  searchContent: vi.fn(),
  searchYouTube: vi.fn(),
  addMediaSource: vi.fn(),
  fetchYouTubePlaylist: vi.fn(),
}));

beforeEach(() => {
  fakeSocket = makeFakeSocket();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useRoom — video reactions", () => {
  it("adds a reaction to state when a video_reaction event arrives", async () => {
    const { useRoom } = await import("@/hooks/useRoom");
    const { result } = renderHook(() => useRoom("ABCDEF", "alice"));

    act(() => {
      fakeSocket.__fire("connect");
      fakeSocket.__fire("video_reaction", {
        emoji: "🎉",
        user_name: "bob",
        user_id: "bob-sid",
      });
    });

    expect(result.current.videoReactions).toHaveLength(1);
    expect(result.current.videoReactions[0]).toMatchObject({
      emoji: "🎉",
      user_name: "bob",
    });
  });

  it("removes a reaction 3s after it arrives", async () => {
    const { useRoom } = await import("@/hooks/useRoom");
    const { result } = renderHook(() => useRoom("ABCDEF", "alice"));

    act(() => {
      fakeSocket.__fire("connect");
      fakeSocket.__fire("video_reaction", {
        emoji: "🎉",
        user_name: "bob",
        user_id: "bob-sid",
      });
    });
    expect(result.current.videoReactions).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.videoReactions).toHaveLength(0);
  });

  it("clears pending reaction timeouts on unmount (no leak)", async () => {
    const { useRoom } = await import("@/hooks/useRoom");
    const { result, unmount } = renderHook(() => useRoom("ABCDEF", "alice"));

    act(() => {
      fakeSocket.__fire("connect");
      fakeSocket.__fire("video_reaction", {
        emoji: "🎉",
        user_name: "bob",
        user_id: "bob-sid",
      });
      fakeSocket.__fire("video_reaction", {
        emoji: "🔥",
        user_name: "carol",
        user_id: "carol-sid",
      });
    });

    expect(result.current.videoReactions).toHaveLength(2);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();

    // After unmount, no stray timers should still be scheduled. Otherwise,
    // they fire against a detached hook and React warns about state updates
    // on an unmounted component.
    expect(vi.getTimerCount()).toBe(0);
  });
});
