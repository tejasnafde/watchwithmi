"use client"

import React, { useEffect, useRef } from 'react';
import { Video, VideoOff, Mic, MicOff, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useWebRTC } from '@/hooks/useWebRTC';
import { Socket } from 'socket.io-client';
import type { User } from '@/types';

interface VideoChatProps {
    socket: Socket | null;
    currentUserId: string;
    users: User[];
}

const VideoTile: React.FC<{
    userName: string;
    isLocal?: boolean;
    videoStream?: MediaStream;
    videoRef?: React.RefObject<HTMLVideoElement | null>;
    setVideoRef?: (element: HTMLVideoElement | null) => void;
    videoEnabled?: boolean;
    audioEnabled?: boolean;
    isHost?: boolean;
}> = ({ userName, isLocal = false, videoStream, videoRef, setVideoRef, videoEnabled = false, audioEnabled = false, isHost = false }) => {
    const remoteVideoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        if (!isLocal && videoStream && remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = videoStream;
        }
    }, [videoStream, isLocal]);

    const currentVideoRef = isLocal ? videoRef : remoteVideoRef;

    return (
        <Card className="relative overflow-hidden bg-[#0a0a0a] border-2 border-white">
            <div className="aspect-video relative">
                {/* Always render video element but control visibility */}
                <video
                    ref={isLocal && setVideoRef ? setVideoRef : currentVideoRef}
                    autoPlay
                    playsInline
                    muted={isLocal} // Always mute local video to prevent feedback
                    className={`w-full h-full object-cover ${videoEnabled ? 'block' : 'hidden'}`}
                />

                {/* Avatar/placeholder shown when video is disabled */}
                {!videoEnabled && (
                    <div className="absolute inset-0 w-full h-full bg-black flex items-center justify-center">
                        <div className="text-center">
                            <div className="w-16 h-16 bg-white flex items-center justify-center mb-2 mx-auto">
                                <Users className="w-8 h-8 text-black" />
                            </div>
                            <p className="text-white text-sm font-mono uppercase">{userName}</p>
                        </div>
                    </div>
                )}

                {/* User info overlay - moved to top to avoid covering controls */}
                <div className="absolute top-2 left-2 flex items-center space-x-1">
                    <Badge
                        variant={isHost ? "default" : "secondary"}
                        className={`text-xs font-mono ${isHost ? "bg-white text-black" : "bg-black text-white border border-white"}`}
                    >
                        {userName.toUpperCase()} {isHost && "HOST"}
                    </Badge>
                </div>

                {/* Video/Audio status overlay - smaller and positioned better */}
                <div className="absolute top-2 right-2 flex items-center space-x-1">
                    {!videoEnabled && (
                        <div className="w-5 h-5 bg-red-600 rounded-full flex items-center justify-center">
                            <VideoOff className="w-2.5 h-2.5 text-white" />
                        </div>
                    )}
                    {!audioEnabled && (
                        <div className="w-5 h-5 bg-red-600 rounded-full flex items-center justify-center">
                            <MicOff className="w-2.5 h-2.5 text-white" />
                        </div>
                    )}
                </div>
            </div>
        </Card>
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
        isInitializing,
        connections,
        toggleVideo,
        toggleAudio
    } = useWebRTC({
        socket,
        currentUserId,
        users
    });

    // Create local ref for video element
    const localVideoRef = useRef<HTMLVideoElement>(null);

    const currentUser = users.find(u => u.id === currentUserId);
    const otherUsers = users.filter(u => u.id !== currentUserId);

    return (
        <div className="h-full flex flex-col space-y-3">
            {/* Video Controls - Made more compact */}
            <div className="flex items-center justify-center space-x-1 px-2">
                <Button
                    onClick={toggleVideo}
                    variant="outline"
                    size="sm"
                    className="border-2 border-white bg-black text-white hover:bg-white hover:text-black flex items-center space-x-1 text-xs px-2 py-1"
                    disabled={isInitializing}
                >
                    {videoEnabled ? <Video className="w-3 h-3" /> : <VideoOff className="w-3 h-3" />}
                    <span className="hidden sm:inline uppercase text-xs">{videoEnabled ? "Video Off" : "Video On"}</span>
                </Button>

                <Button
                    onClick={toggleAudio}
                    variant="outline"
                    size="sm"
                    className="border-2 border-white bg-black text-white hover:bg-white hover:text-black flex items-center space-x-1 text-xs px-2 py-1"
                    disabled={isInitializing}
                >
                    {audioEnabled ? <Mic className="w-3 h-3" /> : <MicOff className="w-3 h-3" />}
                    <span className="hidden sm:inline uppercase text-xs">{audioEnabled ? "Mute" : "Unmute"}</span>
                </Button>
            </div>

            {/* Video Grid - More compact */}
            <div className="flex-1 space-y-2">
                {/* Local user video */}
                <div>
                    <h3 className="text-xs font-bold text-white mb-1 px-1 uppercase font-mono">You</h3>
                    <VideoTile
                        userName={currentUser?.name || 'You'}
                        isLocal={true}
                        videoRef={localVideoRef}
                        setVideoRef={setVideoRef}
                        videoEnabled={videoEnabled}
                        audioEnabled={audioEnabled}
                        isHost={currentUser?.is_host}
                    />
                </div>

                {/* Other users' videos */}
                {otherUsers.length > 0 && (
                    <div>
                        <h3 className="text-xs font-bold text-white mb-1 px-1 uppercase font-mono">
                            Others ({otherUsers.length})
                        </h3>
                        <div className="space-y-2">
                            {otherUsers.map(user => {
                                const connection = connections.get(user.id);
                                return (
                                    <VideoTile
                                        key={user.id}
                                        userName={user.name}
                                        videoStream={connection?.remoteStream}
                                        videoEnabled={user.video_enabled}
                                        audioEnabled={user.audio_enabled}
                                        isHost={user.is_host}
                                    />
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* Connection Status */}
            {socket === null && (
                <div className="text-center py-2">
                    <p className="text-xs text-gray-400 uppercase font-mono">Connecting to room...</p>
                </div>
            )}

        </div>
    );
}; 