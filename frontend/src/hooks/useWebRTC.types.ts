/**
 * Shared WebRTC types. Extracted so helpers in `@/lib/webrtcHelpers` can
 * import them without creating a circular dep with `useWebRTC.ts`.
 */

export interface WebRTCConnection {
    userId: string;
    userName: string;
    peerConnection: RTCPeerConnection;
    remoteStream?: MediaStream;
}
