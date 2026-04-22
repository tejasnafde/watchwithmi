import { describe, it, expect, vi } from "vitest";
import {
    resolveGlareAction,
    shouldCleanupOnIceState,
    stopVideoChatInOrder,
} from "@/lib/webrtcHelpers";

/**
 * Pure WebRTC helpers extracted so the interesting state transitions can be
 * exercised without a full jsdom RTCPeerConnection stack.
 *
 * Covers docs/polishing/04-webrtc-video-chat.md items:
 *   #4.2 stopVideoChat emits toggle events BEFORE closing tracks / PCs.
 *   #4.3 Glare resolution handles every signaling state explicitly.
 */

// ---------------------------------------------------------------------------
// #4.3 — resolveGlareAction
// ---------------------------------------------------------------------------

describe("resolveGlareAction (bug #4.3)", () => {
    it("accepts the offer in the stable state", () => {
        expect(
            resolveGlareAction({ signalingState: "stable", currentUserId: "a", fromUserId: "b" }),
        ).toBe("accept");
    });

    it("with a local offer pending, ignores the remote offer when we have the lower id", () => {
        expect(
            resolveGlareAction({
                signalingState: "have-local-offer",
                currentUserId: "a", // 'a' < 'b'
                fromUserId: "b",
            }),
        ).toBe("ignore");
    });

    it("with a local offer pending, rolls back and accepts when we have the higher id", () => {
        expect(
            resolveGlareAction({
                signalingState: "have-local-offer",
                currentUserId: "z",
                fromUserId: "a",
            }),
        ).toBe("rollback-accept");
    });

    it("ignores offers while a remote offer is already being processed", () => {
        expect(
            resolveGlareAction({
                signalingState: "have-remote-offer",
                currentUserId: "a",
                fromUserId: "b",
            }),
        ).toBe("ignore");
    });

    it("ignores offers on a closed connection (the PC is already dead)", () => {
        expect(
            resolveGlareAction({
                signalingState: "closed",
                currentUserId: "a",
                fromUserId: "b",
            }),
        ).toBe("ignore");
    });

    it("falls through to the 'create new' path for other states", () => {
        expect(
            resolveGlareAction({
                signalingState: "have-local-pranswer",
                currentUserId: "a",
                fromUserId: "b",
            }),
        ).toBe("create-new");
    });
});

// ---------------------------------------------------------------------------
// #4.2 — stopVideoChatInOrder
// ---------------------------------------------------------------------------

describe("stopVideoChatInOrder (bug #4.2)", () => {
    it("emits toggle_video / toggle_audio BEFORE stopping tracks or closing peer connections", () => {
        const order: string[] = [];

        const socket = {
            emit: vi.fn((event: string) => {
                order.push(`emit:${event}`);
            }),
        };

        const track = {
            stop: vi.fn(() => {
                order.push("track:stop");
            }),
        };
        const stream = {
            getTracks: () => [track],
        } as unknown as MediaStream;

        const pc = {
            close: vi.fn(() => {
                order.push("pc:close");
            }),
        };
        const connections = new Map([
            ["user-1", { peerConnection: pc as unknown as RTCPeerConnection, userId: "user-1", userName: "bob" }],
        ]);

        stopVideoChatInOrder({
            socket: socket as unknown as import("@/lib/webrtcHelpers").EmitOnlySocket,
            stream,
            connections,
        });

        const firstStop = order.findIndex((e) => e === "track:stop");
        const firstClose = order.findIndex((e) => e === "pc:close");
        const lastEmit = order.lastIndexOf(
            order.filter((e) => e.startsWith("emit:")).pop() || "",
        );

        expect(firstStop).toBeGreaterThan(-1);
        expect(firstClose).toBeGreaterThan(-1);
        expect(lastEmit).toBeGreaterThan(-1);
        expect(lastEmit).toBeLessThan(firstStop);
        expect(lastEmit).toBeLessThan(firstClose);

        // And both toggle events are sent.
        expect(socket.emit).toHaveBeenCalledWith("toggle_video", { enabled: false });
        expect(socket.emit).toHaveBeenCalledWith("toggle_audio", { enabled: false });
    });

    it("is safe when there's no socket (offline teardown)", () => {
        const track = { stop: vi.fn() };
        const stream = { getTracks: () => [track] } as unknown as MediaStream;
        const pc = { close: vi.fn() };
        const connections = new Map([
            ["u", { peerConnection: pc as unknown as RTCPeerConnection, userId: "u", userName: "x" }],
        ]);

        expect(() =>
            stopVideoChatInOrder({
                socket: null,
                stream,
                connections,
            }),
        ).not.toThrow();

        expect(track.stop).toHaveBeenCalled();
        expect(pc.close).toHaveBeenCalled();
    });

    it("handles a null stream gracefully", () => {
        const socket = { emit: vi.fn() };
        const connections = new Map();

        expect(() =>
            stopVideoChatInOrder({
                socket: socket as unknown as import("@/lib/webrtcHelpers").EmitOnlySocket,
                stream: null,
                connections,
            }),
        ).not.toThrow();

        expect(socket.emit).toHaveBeenCalledWith("toggle_video", { enabled: false });
        expect(socket.emit).toHaveBeenCalledWith("toggle_audio", { enabled: false });
    });

    it("clears the connections map after closing", () => {
        const connections = new Map([
            ["u", { peerConnection: { close: vi.fn() } as unknown as RTCPeerConnection, userId: "u", userName: "x" }],
        ]);
        stopVideoChatInOrder({
            socket: null,
            stream: null,
            connections,
        });
        expect(connections.size).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// #4.4 — ICE-level cleanup decision
// ---------------------------------------------------------------------------

describe("shouldCleanupOnIceState (bug #4.4)", () => {
    it.each([
        ["new", false],
        ["checking", false],
        ["connected", false],
        ["completed", false],
    ] as const)("keeps the connection on %s", (state, expected) => {
        expect(shouldCleanupOnIceState(state)).toBe(expected);
    });

    it.each([
        ["failed", true],
        ["disconnected", true],
        ["closed", true],
    ] as const)("drops the connection on %s", (state, expected) => {
        expect(shouldCleanupOnIceState(state)).toBe(expected);
    });
});
