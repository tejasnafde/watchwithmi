"use client"

import React, { useEffect, useRef } from 'react';
import { Video, VideoOff, Mic, MicOff, PhoneOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWebRTC } from '@/hooks/useWebRTC';
import { Socket } from 'socket.io-client';
import type { User } from '@/types';

interface VideoChatProps {
    socket: Socket | null;
    currentUserId: string;
    users: User[];
    /**
     * Fires when the call's `isActive` state changes. Used by the parent
     * to auto-expand the sidebar's Video Chat panel the moment someone
     * starts a call (so the tiles aren't hidden in a collapsed strip)
     * and to auto-collapse it when the call ends.
     */
    onActiveChange?: (isActive: boolean) => void;
}

function getInitials(name: string): string {
    return name
        .split(' ')
        .map(part => part[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
}

export const VideoTile: React.FC<{
    userName: string;
    isLocal?: boolean;
    videoStream?: MediaStream;
    setVideoRef?: (element: HTMLVideoElement | null) => void;
    videoEnabled?: boolean;
    audioEnabled?: boolean;
}> = ({ userName, isLocal = false, videoStream, setVideoRef, videoEnabled = false, audioEnabled = false }) => {
    const remoteVideoElementRef = useRef<HTMLVideoElement | null>(null);

    // Bind / rebind the remote stream via useEffect keyed on videoStream.
    // The previous implementation did render-time DOM mutation (bug #4.1
    // in docs/polishing/04-webrtc-video-chat.md), which bypassed React's
    // render model and left stale bindings on rapid prop changes.
    useEffect(() => {
        if (isLocal) return;
        const el = remoteVideoElementRef.current;
        if (!el || !videoStream) return;
        el.srcObject = videoStream;
        // el.play() is a real Promise in browsers and may reject when the
        // element isn't user-activated. In jsdom it's unimplemented (returns
        // undefined), so guard before calling .catch.
        const maybePromise = el.play() as unknown;
        if (maybePromise && typeof (maybePromise as Promise<void>).catch === 'function') {
            (maybePromise as Promise<void>).catch(() => {});
        }
    }, [videoStream, isLocal]);

    return (
        <div className="relative aspect-video overflow-hidden rounded-lg border border-border bg-card">
            {/* Video element */}
            <video
                ref={isLocal && setVideoRef ? setVideoRef : remoteVideoElementRef}
                autoPlay
                playsInline
                muted={isLocal}
                className={`w-full h-full object-cover ${videoEnabled ? 'block' : 'hidden'}`}
            />

            {/* Avatar placeholder when video is off */}
            {!videoEnabled && (
                <div className="absolute inset-0 flex items-center justify-center bg-muted">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary">
                        <span className="font-mono text-sm font-semibold text-primary-foreground">
                            {getInitials(userName)}
                        </span>
                    </div>
                </div>
            )}

            {/* Name label */}
            <div className="absolute bottom-1 left-1">
                <span className="rounded-md border border-border bg-card/90 px-1.5 py-0.5 text-xs text-foreground">
                    {isLocal ? 'You' : userName}
                </span>
            </div>

            {/* Status indicators */}
            <div className="absolute top-1 right-1 flex items-center gap-1">
                {!audioEnabled && (
                    <span
                        role="img"
                        aria-label="Microphone off"
                        className="flex h-5 w-5 items-center justify-center rounded-full border border-destructive/40 bg-card/90 text-destructive"
                    >
                        <MicOff className="h-3 w-3" aria-hidden="true" />
                    </span>
                )}
                {!videoEnabled && (
                    <span
                        role="img"
                        aria-label="Camera off"
                        className="flex h-5 w-5 items-center justify-center rounded-full border border-destructive/40 bg-card/90 text-destructive"
                    >
                        <VideoOff className="h-3 w-3" aria-hidden="true" />
                    </span>
                )}
            </div>
        </div>
    );
};

export const VideoChat: React.FC<VideoChatProps> = ({
    socket,
    currentUserId,
    users,
    onActiveChange,
}) => {
    const {
        setVideoRef,
        videoEnabled,
        audioEnabled,
        isActive,
        isInitializing,
        connections,
        toggleVideo,
        toggleAudio,
        startVideoChat,
        stopVideoChat
    } = useWebRTC({
        socket,
        currentUserId,
        users
    });

    // Surface isActive *transitions* to the parent so it can auto-expand
    // the enclosing collapsible panel. Firing on initial mount would
    // call onActiveChange(false) every render and collapse the panel
    // immediately after the user expanded it.
    const prevActiveRef = useRef<boolean>(isActive);
    useEffect(() => {
        if (prevActiveRef.current === isActive) return;
        prevActiveRef.current = isActive;
        onActiveChange?.(isActive);
    }, [isActive, onActiveChange]);

    const currentUser = users.find(u => u.id === currentUserId);
    const otherUsers = users.filter(u => u.id !== currentUserId);

    // Inactive state: show a compact start button
    if (!isActive) {
        return (
            <div className="flex flex-col items-center gap-2 py-2">
                <Button
                    onClick={startVideoChat}
                    disabled={isInitializing}
                    className="h-11 w-full"
                >
                    <Video className="mr-2 h-4 w-4" aria-hidden="true" />
                    {isInitializing ? 'Starting...' : 'Start video chat'}
                </Button>
                <p className="text-xs text-muted-foreground">
                    Camera and mic will be requested
                </p>
            </div>
        );
    }

    // Active state: show video grid and controls
    return (
        <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto">
            {/* Video grid */}
            <div className="grid grid-cols-2 gap-2">
                {/* Local tile */}
                <VideoTile
                    userName={currentUser?.name || 'You'}
                    isLocal={true}
                    setVideoRef={setVideoRef}
                    videoEnabled={videoEnabled}
                    audioEnabled={audioEnabled}
                />

                {/* Remote tiles */}
                {otherUsers.map(user => {
                    const connection = connections.get(user.id);
                    return (
                        <VideoTile
                            key={user.id}
                            userName={user.name}
                            videoStream={connection?.remoteStream}
                            videoEnabled={user.video_enabled}
                            audioEnabled={user.audio_enabled}
                        />
                    );
                })}
            </div>

            {/* Controls */}
            <div className="flex items-center justify-center gap-2 pt-1">
                <Button
                    onClick={toggleVideo}
                    variant="secondary"
                    size="icon"
                    className={`h-11 w-11 border transition-colors duration-150 ${
                        videoEnabled
                            ? 'border-border'
                            : 'border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20'
                    }`}
                    aria-label={videoEnabled ? 'Turn off camera' : 'Turn on camera'}
                    title={videoEnabled ? 'Turn off camera' : 'Turn on camera'}
                >
                    {videoEnabled
                        ? <Video className="h-4 w-4" aria-hidden="true" />
                        : <VideoOff className="h-4 w-4" aria-hidden="true" />}
                </Button>

                <Button
                    onClick={toggleAudio}
                    variant="secondary"
                    size="icon"
                    className={`h-11 w-11 border transition-colors duration-150 ${
                        audioEnabled
                            ? 'border-border'
                            : 'border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20'
                    }`}
                    aria-label={audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
                    title={audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
                >
                    {audioEnabled
                        ? <Mic className="h-4 w-4" aria-hidden="true" />
                        : <MicOff className="h-4 w-4" aria-hidden="true" />}
                </Button>

                <Button
                    onClick={stopVideoChat}
                    variant="secondary"
                    size="icon"
                    className="h-11 w-11 border border-destructive/40 bg-destructive/10 text-destructive transition-colors duration-150 hover:bg-destructive/20"
                    aria-label="End video chat"
                    title="End video chat"
                >
                    <PhoneOff className="h-4 w-4" aria-hidden="true" />
                </Button>
            </div>

            {/* Connection info */}
            {otherUsers.length === 0 && (
                <p className="text-center text-xs text-muted-foreground">
                    No other users in room
                </p>
            )}
        </div>
    );
};
