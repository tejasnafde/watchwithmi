import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Bug #3.5 (docs/polishing/03-chat-reactions-queue.md):
 *   Rapid clicks on a queue "remove" or "reorder" button currently fire
 *   overlapping socket emits. Each call lands at the server, and the
 *   second one fails (item already removed) which surfaces as an error
 *   back to the client.
 *
 *   The fix tracks in-flight ops per item_id and treats repeat calls as
 *   no-ops until the server acknowledges with `queue_updated`.
 */

type Handler = (data: unknown) => void;

const makeFakeSocket = () => {
    const handlers = new Map<string, Handler>();
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
    fakeSocket = makeFakeSocket();
});

function countEmits(event: string, matchItemId?: string) {
    return fakeSocket.__emitted.filter(
        (e) =>
            e.event === event &&
            (matchItemId === undefined ||
                (e.data as { item_id?: string })?.item_id === matchItemId),
    ).length;
}

describe("useRoom — queue operation in-flight dedupe (bug #3.5)", () => {
    it("removeFromQueue deduplicates rapid repeat calls for the same item_id", async () => {
        const { useRoom } = await import("@/hooks/useRoom");
        const { result } = renderHook(() => useRoom("ABCDEF", "alice"));

        act(() => {
            fakeSocket.__fire("connect");
        });

        act(() => {
            result.current.removeFromQueue("item-1");
            result.current.removeFromQueue("item-1");
            result.current.removeFromQueue("item-1");
        });

        // Only the first call should have emitted.
        expect(countEmits("queue_remove", "item-1")).toBe(1);
    });

    it("unblocks an item after queue_updated arrives", async () => {
        const { useRoom } = await import("@/hooks/useRoom");
        const { result } = renderHook(() => useRoom("ABCDEF", "alice"));

        act(() => {
            fakeSocket.__fire("connect");
        });

        act(() => {
            result.current.removeFromQueue("item-1");
        });
        expect(countEmits("queue_remove", "item-1")).toBe(1);

        // Server responds with queue_updated (ack for any in-flight op).
        act(() => {
            fakeSocket.__fire("queue_updated", { queue: [] });
        });

        // A subsequent call on the same item can now go through.
        act(() => {
            result.current.removeFromQueue("item-1");
        });
        expect(countEmits("queue_remove", "item-1")).toBe(2);
    });

    it("does not block calls for a different item", async () => {
        const { useRoom } = await import("@/hooks/useRoom");
        const { result } = renderHook(() => useRoom("ABCDEF", "alice"));

        act(() => {
            fakeSocket.__fire("connect");
        });

        act(() => {
            result.current.removeFromQueue("item-1");
            result.current.removeFromQueue("item-2");
        });

        expect(countEmits("queue_remove", "item-1")).toBe(1);
        expect(countEmits("queue_remove", "item-2")).toBe(1);
    });

    it("reorderQueue deduplicates rapid repeat calls for the same item_id", async () => {
        const { useRoom } = await import("@/hooks/useRoom");
        const { result } = renderHook(() => useRoom("ABCDEF", "alice"));

        act(() => {
            fakeSocket.__fire("connect");
        });

        act(() => {
            result.current.reorderQueue("item-1", 3);
            result.current.reorderQueue("item-1", 2);
            result.current.reorderQueue("item-1", 1);
        });

        expect(countEmits("queue_reorder", "item-1")).toBe(1);
    });

    it("exposes an isQueueOpPending(itemId) helper for disabling buttons", async () => {
        const { useRoom } = await import("@/hooks/useRoom");
        const { result } = renderHook(() => useRoom("ABCDEF", "alice"));

        act(() => {
            fakeSocket.__fire("connect");
        });

        expect(result.current.isQueueOpPending("item-1")).toBe(false);

        act(() => {
            result.current.removeFromQueue("item-1");
        });
        expect(result.current.isQueueOpPending("item-1")).toBe(true);

        act(() => {
            fakeSocket.__fire("queue_updated", { queue: [] });
        });
        expect(result.current.isQueueOpPending("item-1")).toBe(false);
    });
});
