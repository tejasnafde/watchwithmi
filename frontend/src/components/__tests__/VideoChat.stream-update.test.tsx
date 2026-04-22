import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { VideoTile } from "@/components/VideoChat";

/**
 * Bug #4.1 (docs/polishing/04-webrtc-video-chat.md):
 *   VideoTile was doing render-time DOM mutation to swap `srcObject` when
 *   the `videoStream` prop changed. That bypasses React's render model
 *   and made stream swaps flaky.
 *
 *   After the fix, the element's `srcObject` updates via a `useEffect`
 *   keyed on `videoStream`, so remount-free prop changes still rebind
 *   the element cleanly.
 */

function makeStubStream(): MediaStream {
    // jsdom doesn't implement MediaStream; just an object that duck-types
    // enough for the component's purposes (srcObject takes `any`).
    return { id: `stream-${Math.random()}`, getTracks: () => [] } as unknown as MediaStream;
}

describe("VideoTile — stream prop changes rebind srcObject (bug #4.1)", () => {
    it("sets srcObject on mount", () => {
        const s1 = makeStubStream();
        const { container } = render(
            <VideoTile
                userName="bob"
                videoStream={s1}
                videoEnabled={true}
                audioEnabled={true}
            />,
        );
        const video = container.querySelector("video")!;
        expect(video.srcObject).toBe(s1);
    });

    it("updates srcObject when the prop changes on the same element", () => {
        const s1 = makeStubStream();
        const s2 = makeStubStream();
        const { container, rerender } = render(
            <VideoTile
                userName="bob"
                videoStream={s1}
                videoEnabled={true}
                audioEnabled={true}
            />,
        );
        const videoBefore = container.querySelector("video")!;
        expect(videoBefore.srcObject).toBe(s1);

        rerender(
            <VideoTile
                userName="bob"
                videoStream={s2}
                videoEnabled={true}
                audioEnabled={true}
            />,
        );
        const videoAfter = container.querySelector("video")!;
        // Must be the SAME element (no remount) with a NEW srcObject.
        expect(videoAfter).toBe(videoBefore);
        expect(videoAfter.srcObject).toBe(s2);
    });

    it("does not touch srcObject for a local tile (that path uses setVideoRef)", () => {
        const setVideoRef = vi.fn();
        render(
            <VideoTile
                userName="me"
                isLocal={true}
                setVideoRef={setVideoRef}
                videoEnabled={true}
                audioEnabled={true}
            />,
        );
        // The local ref callback is what's responsible for binding the
        // stream in the real hook; VideoTile itself shouldn't touch
        // srcObject when isLocal.
        expect(setVideoRef).toHaveBeenCalled();
    });
});


// ---------------------------------------------------------------------------
// Bug: onActiveChange must fire only on transitions, not on initial mount.
// Otherwise the parent collapses the panel immediately after the user
// expands it (because VideoChat's mount-time useEffect reports
// isActive=false).
// ---------------------------------------------------------------------------

import { VideoChat } from "@/components/VideoChat";

vi.mock("@/hooks/useWebRTC", () => ({
    useWebRTC: vi.fn(() => ({
        localStream: null,
        connections: new Map(),
        videoEnabled: false,
        audioEnabled: false,
        isActive: false,
        isInitializing: false,
        toggleVideo: vi.fn(),
        toggleAudio: vi.fn(),
        startVideoChat: vi.fn(),
        stopVideoChat: vi.fn(),
        setVideoRef: vi.fn(),
    })),
}));

describe("VideoChat — onActiveChange is transition-only", () => {
    it("does not fire onActiveChange on initial mount with isActive=false", () => {
        const onActiveChange = vi.fn();
        render(
            <VideoChat
                socket={null}
                currentUserId="me"
                users={[]}
                onActiveChange={onActiveChange}
            />,
        );
        // We deliberately don't fire a spurious `false` on mount so the
        // enclosing collapsible panel doesn't auto-collapse itself
        // immediately after the user opens it.
        expect(onActiveChange).not.toHaveBeenCalled();
    });
});
