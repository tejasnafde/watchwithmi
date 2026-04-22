import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Bug #1 (docs/polishing/01-critical-bugs.md):
 *   "Chat history loses message_id" — useRoom.ts:170.
 *
 * The `room_joined` / `room_created` handler in useRoom maps chat history
 * messages without preserving the server-assigned `message_id`. As a result,
 * a subsequent `reaction_updated` event — which carries the server's
 * message_id — has nothing to match against, and emoji reactions on
 * historical messages silently fail to render.
 *
 * These tests pin the contract:
 *   1. message_id from the server is retained on each historical message.
 *   2. reaction_updated events apply to historical messages.
 */

// ---------------------------------------------------------------------------
// Fake Socket.IO client
// ---------------------------------------------------------------------------

type Handler = (data: unknown) => void;

const makeFakeSocket = () => {
  const handlers = new Map<string, Handler>();
  const managerHandlers = new Map<string, Handler>();
  const emitted: Array<{ event: string; data: unknown }> = [];

  const socket = {
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, handler);
      return socket;
    }),
    off: vi.fn(() => socket),
    emit: vi.fn((event: string, data: unknown) => {
      emitted.push({ event, data });
      return socket;
    }),
    disconnect: vi.fn(),
    io: {
      on: vi.fn((event: string, handler: Handler) => {
        managerHandlers.set(event, handler);
      }),
      off: vi.fn(),
    },
    __fire: (event: string, data?: unknown) => {
      const h = handlers.get(event);
      if (!h) throw new Error(`No handler registered for '${event}'`);
      h(data as never);
    },
    __emitted: emitted,
  };
  return socket;
};

let fakeSocket: ReturnType<typeof makeFakeSocket>;

vi.mock("@/lib/api", () => ({
  createSocket: () => fakeSocket,
  BACKEND_URL: "http://test",
  // Unused in these tests but imported by useRoom at top of file.
  searchContent: vi.fn(),
  searchYouTube: vi.fn(),
  addMediaSource: vi.fn(),
  fetchYouTubePlaylist: vi.fn(),
}));

beforeEach(() => {
  fakeSocket = makeFakeSocket();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useRoom — chat history preserves message_id", () => {
  it("retains message_id on messages received via room_joined", async () => {
    const { useRoom } = await import("@/hooks/useRoom");
    const { result } = renderHook(() => useRoom("ABCDEF", "alice"));

    act(() => {
      fakeSocket.__fire("connect");
      fakeSocket.__fire("room_joined", {
        room_code: "ABCDEF",
        users: {},
        chat: [
          {
            message_id: "server-msg-1",
            user_name: "bob",
            message: "hello world",
            timestamp: "2026-01-01T00:00:00Z",
            reactions: {},
          },
        ],
      });
    });

    expect(result.current.chatMessages).toHaveLength(1);
    expect(result.current.chatMessages[0].message_id).toBe("server-msg-1");
  });

  it("applies a reaction_updated event to a historical message", async () => {
    const { useRoom } = await import("@/hooks/useRoom");
    const { result } = renderHook(() => useRoom("ABCDEF", "alice"));

    act(() => {
      fakeSocket.__fire("connect");
      fakeSocket.__fire("room_joined", {
        room_code: "ABCDEF",
        users: {},
        chat: [
          {
            message_id: "server-msg-1",
            user_name: "bob",
            message: "hello world",
            timestamp: "2026-01-01T00:00:00Z",
            reactions: {},
          },
        ],
      });
    });

    act(() => {
      fakeSocket.__fire("reaction_updated", {
        message_id: "server-msg-1",
        reactions: { "👍": ["user-xyz"] },
      });
    });

    expect(result.current.chatMessages[0].reactions).toEqual({
      "👍": ["user-xyz"],
    });
  });
});
