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
}

function getInitials(name: string): string {
    return name
        .split(' ')
        .map(part => part[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
}

function getAvatarColor(name: string): string {
    const colors = [
        'bg-blue-600', 'bg-green-600', 'bg-purple-600',
        'bg-pink-600', 'bg-yellow-600', 'bg-red-600',
        'bg-indigo-600', 'bg-teal-600'
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
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
        <div className="relative overflow-hidden bg-[#111] border border-white/20 aspect-video">
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
                <div className="absolute inset-0 flex items-center justify-center bg-[#111]">
                    <div className={`w-10 h-10 rounded-full ${getAvatarColor(userName)} flex items-center justify-center`}>
                        <span className="text-white text-sm font-bold font-mono">
                            {getInitials(userName)}
                        </span>
                    </div>
                </div>
            )}

            {/* Name label */}
            <div className="absolute bottom-1 left-1">
                <span className="text-[10px] font-mono text-white bg-black/70 px-1.5 py-0.5">
                    {isLocal ? 'YOU' : userName.toUpperCase()}
                </span>
            </div>

            {/* Status indicators */}
            <div className="absolute top-1 right-1 flex items-center gap-0.5">
                {!audioEnabled && (
                    <div className="w-4 h-4 bg-red-600/90 rounded-full flex items-center justify-center">
                        <MicOff className="w-2.5 h-2.5 text-white" />
                    </div>
                )}
                {!videoEnabled && (
                    <div className="w-4 h-4 bg-red-600/90 rounded-full flex items-center justify-center">
                        <VideoOff className="w-2.5 h-2.5 text-white" />
                    </div>
                )}
            </div>
        </div>
    );
};

export const VideoChat: React.FC<VideoChatProps> = ({
    socket,
    currentUserId,
    users
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

    const currentUser = users.find(u => u.id === currentUserId);
    const otherUsers = users.filter(u => u.id !== currentUserId);

    // Inactive state: show a compact start button
    if (!isActive) {
        return (
            <div className="flex flex-col items-center gap-2 py-2">
                <Button
                    onClick={startVideoChat}
                    disabled={isInitializing}
                    className="w-full border-2 border-white bg-black text-white hover:bg-white hover:text-black font-mono uppercase text-xs"
                >
                    <Video className="w-3.5 h-3.5 mr-2" />
                    {isInitializing ? 'STARTING...' : 'START VIDEO CHAT'}
                </Button>
                <p className="text-[10px] text-gray-500 font-mono">
                    Camera and mic will be requested
                </p>
            </div>
        );
    }

    // Active state: show video grid and controls
    return (
        <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto">
            {/* Video grid */}
            <div className="grid grid-cols-2 gap-1">
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
            <div className="flex items-center justify-center gap-1 pt-1">
                <Button
                    onClick={toggleVideo}
                    size="sm"
                    className={`h-7 w-7 p-0 border border-white ${
                        videoEnabled
                            ? 'bg-black text-white hover:bg-white hover:text-black'
                            : 'bg-red-600 text-white border-red-600 hover:bg-red-700'
                    }`}
                    title={videoEnabled ? 'Turn off camera' : 'Turn on camera'}
                >
                    {videoEnabled ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5" />}
                </Button>

                <Button
                    onClick={toggleAudio}
                    size="sm"
                    className={`h-7 w-7 p-0 border border-white ${
                        audioEnabled
                            ? 'bg-black text-white hover:bg-white hover:text-black'
                            : 'bg-red-600 text-white border-red-600 hover:bg-red-700'
                    }`}
                    title={audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
                >
                    {audioEnabled ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
                </Button>

                <Button
                    onClick={stopVideoChat}
                    size="sm"
                    className="h-7 w-7 p-0 bg-red-600 text-white border border-red-600 hover:bg-red-700"
                    title="End video chat"
                >
                    <PhoneOff className="w-3.5 h-3.5" />
                </Button>
            </div>

            {/* Connection info */}
            {otherUsers.length === 0 && (
                <p className="text-[10px] text-gray-500 font-mono text-center">
                    No other users in room
                </p>
            )}
        </div>
    );
};
