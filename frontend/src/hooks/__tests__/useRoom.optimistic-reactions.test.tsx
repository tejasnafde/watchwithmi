import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Bug #3.6 (docs/polishing/03-chat-reactions-queue.md):
 *   Reactions currently wait for the server's `reaction_updated` broadcast
 *   before showing on screen, which makes the reactor's own click feel
 *   laggy. Apply the toggle locally on click; reconcile when the server
 *   broadcast arrives (server state is authoritative).
 */

type Handler = (data: unknown) => void;

const makeFakeSocket = (id = "my-sid") => {
    const handlers = new Map<string, Handler>();
    const emitted: Array<{ event: string; data: unknown }> = [];
    const socket = {
        id,
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
        io: { on: vi.fn(), off: vi.fn() },
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
    searchContent: vi.fn(),
    searchYouTube: vi.fn(),
    addMediaSource: vi.fn(),
    fetchYouTubePlaylist: vi.fn(),
}));

beforeEach(() => {
    fakeSocket = makeFakeSocket("my-sid");
});

describe("useRoom — optimistic reactions (bug #3.6)", () => {
    it("adds the emoji to the local message immediately on toggleReaction", async () => {
        const { useRoom } = await import("@/hooks/useRoom");
        const { result } = renderHook(() => useRoom("ABCDEF", "alice"));

        act(() => {
            fakeSocket.__fire("connect");
            fakeSocket.__fire("room_joined", {
                room_code: "ABCDEF",
                users: {},
                chat: [
                    {
                        message_id: "msg-1",
                        user_name: "bob",
                        message: "hi",
                        timestamp: "2026-01-01T00:00:00Z",
                        reactions: {},
                    },
                ],
            });
        });

        act(() => {
            result.current.toggleReaction("msg-1", "🔥");
        });

        // Server hasn't responded yet — local state already reflects it.
        expect(result.current.chatMessages[0].reactions).toEqual({
            "🔥": ["my-sid"],
        });
        expect(
            fakeSocket.__emitted.some(
                (e) =>
                    e.event === "toggle_reaction" &&
                    (e.data as { emoji?: string })?.emoji === "🔥",
            ),
        ).toBe(true);
    });

    it("removes the emoji locally when toggling an already-applied reaction", async () => {
        const { useRoom } = await import("@/hooks/useRoom");
        const { result } = renderHook(() => useRoom("ABCDEF", "alice"));

        act(() => {
            fakeSocket.__fire("connect");
            fakeSocket.__fire("room_joined", {
                room_code: "ABCDEF",
                users: {},
                chat: [
                    {
                        message_id: "msg-1",
                        user_name: "bob",
                        message: "hi",
                        timestamp: "2026-01-01T00:00:00Z",
                        reactions: { "🔥": ["my-sid", "someone-else"] },
                    },
                ],
            });
        });

        act(() => {
            result.current.toggleReaction("msg-1", "🔥");
        });

        expect(result.current.chatMessages[0].reactions).toEqual({
            "🔥": ["someone-else"],
        });
    });

    it("reconciles to server state when reaction_updated arrives", async () => {
        const { useRoom } = await import("@/hooks/useRoom");
        const { result } = renderHook(() => useRoom("ABCDEF", "alice"));

        act(() => {
            fakeSocket.__fire("connect");
            fakeSocket.__fire("room_joined", {
                room_code: "ABCDEF",
                users: {},
                chat: [
                    {
                        message_id: "msg-1",
                        user_name: "bob",
                        message: "hi",
                        timestamp: "2026-01-01T00:00:00Z",
                        reactions: {},
                    },
                ],
            });
        });

        act(() => {
            result.current.toggleReaction("msg-1", "🔥");
        });
        expect(result.current.chatMessages[0].reactions).toEqual({
            "🔥": ["my-sid"],
        });

        // Server ack: confirms the reaction with both my id and another user.
        act(() => {
            fakeSocket.__fire("reaction_updated", {
                message_id: "msg-1",
                reactions: { "🔥": ["my-sid", "carol"] },
            });
        });

        expect(result.current.chatMessages[0].reactions).toEqual({
            "🔥": ["my-sid", "carol"],
        });
    });
});
