/**
 * Pure helpers used by useWebRTC. Kept outside the hook so the interesting
 * transitions (glare, ordered teardown) can be unit-tested without jsdom
 * emulating the entire RTCPeerConnection API.
 *
 * See docs/polishing/04-webrtc-video-chat.md for the motivating bugs.
 */

import type { WebRTCConnection } from "@/hooks/useWebRTC.types";

// ---------------------------------------------------------------------------
// #4.3 — Glare resolution
// ---------------------------------------------------------------------------

export type GlareAction =
    /** Ignore the incoming offer; peer will accept our answer. */
    | "ignore"
    /** Roll back our local offer and accept theirs. */
    | "rollback-accept"
    /** Standard path: apply remote offer, create answer. */
    | "accept"
    /** No existing connection or state — build a fresh PC. */
    | "create-new";

export interface GlareInput {
    signalingState: RTCSignalingState;
    currentUserId: string;
    fromUserId: string;
}

export function resolveGlareAction({
    signalingState,
    currentUserId,
    fromUserId,
}: GlareInput): GlareAction {
    switch (signalingState) {
        case "closed":
            // The PC is dead; don't try to revive it.
            return "ignore";

        case "have-remote-offer":
            // Already processing an offer from this peer; treat the
            // duplicate as a no-op. Accepting twice would crash setRemoteDescription.
            return "ignore";

        case "have-local-offer":
            // Classic glare: we both offered at once. Lower ID wins.
            if (currentUserId < fromUserId) return "ignore";
            return "rollback-accept";

        case "stable":
            return "accept";

        default:
            // "have-local-pranswer" / "have-remote-pranswer" — rare, treat as
            // "build a fresh PC" so the caller's fallback path kicks in.
            return "create-new";
    }
}

// ---------------------------------------------------------------------------
// #4.4 — ICE state cleanup decision
// ---------------------------------------------------------------------------

/**
 * Returns true when an iceConnectionState signals that the peer connection
 * is unusable and should be dropped from the connections map. `disconnected`
 * is included because chrome/firefox don't always bubble it up to
 * `connectionState=failed` quickly on poor networks; leaving the tile
 * around masks the real state from the user. `closed` is a defensive
 * catch-all (`onconnectionstatechange` already handles it, but the ICE
 * handler runs independently).
 */
export function shouldCleanupOnIceState(state: RTCIceConnectionState): boolean {
    return state === "failed" || state === "disconnected" || state === "closed";
}

// ---------------------------------------------------------------------------
// #4.2 — Ordered teardown
// ---------------------------------------------------------------------------

/**
 * Minimal shape the teardown helper needs from a socket. Structural so
 * both the Socket.IO client Socket and plain fakes satisfy it without
 * requiring the full Socket<ServerEvents, ClientEvents> generic.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EmitOnlySocket = { emit: (ev: string, ...args: any[]) => unknown };

export interface StopVideoChatInput {
    /** Null-safe: callers may tear down without an active socket. */
    socket: EmitOnlySocket | null;
    stream: MediaStream | null;
    connections: Map<string, WebRTCConnection>;
}

export function stopVideoChatInOrder({
    socket,
    stream,
    connections,
}: StopVideoChatInput): void {
    // Emit AV-off first so remote peers flip their UI before their tracks
    // drop, avoiding the "disconnected" flicker described in bug #4.2.
    if (socket) {
        socket.emit("toggle_video", { enabled: false });
        socket.emit("toggle_audio", { enabled: false });
    }

    // Now tear down local tracks + peer connections.
    if (stream) {
        for (const track of stream.getTracks()) {
            track.stop();
        }
    }

    for (const { peerConnection } of connections.values()) {
        peerConnection.close();
    }
    connections.clear();
}
