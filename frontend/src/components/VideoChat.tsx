"use client"

import React, { useEffect, useRef } from 'react';
import { Video, VideoOff, Mic, MicOff, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useWebRTC } from '@/hooks/useWebRTC';
import { Socket } from 'socket.io-client';

interface User {
    id: string;
    name: string;
    isHost: boolean;
    video_enabled?: boolean;
    audio_enabled?: boolean;
}

interface VideoChatProps {
    socket: Socket | null;
    currentUserId: string;
    currentUserName: string;
    users: User[];
    connected: boolean;
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
        <Card className="relative overflow-hidden bg-slate-800 border-slate-700">
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
                    <div className="absolute inset-0 w-full h-full bg-slate-900 flex items-center justify-center">
                        <div className="text-center">
                            <div className="w-16 h-16 bg-slate-700 rounded-full flex items-center justify-center mb-2 mx-auto">
                                <Users className="w-8 h-8 text-slate-400" />
                            </div>
                            <p className="text-slate-400 text-sm">{userName}</p>
                        </div>
                    </div>
                )}

                {/* User info overlay - moved to top to avoid covering controls */}
                <div className="absolute top-2 left-2 flex items-center space-x-1">
                    <Badge
                        variant={isHost ? "default" : "secondary"}
                        className={`text-xs ${isHost ? "bg-purple-600" : "bg-slate-600"} text-white`}
                    >
                        {userName} {isHost && "👑"}
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
  currentUserName,
  users,
  connected
}) => {
  const {
    localVideoRef,
    setVideoRef,
    videoEnabled,
    audioEnabled,
    connections,
    isInitializing,
    toggleVideo,
    toggleAudio
  } = useWebRTC({
    socket,
    currentUserId,
    users
  });

    const currentUser = users.find(u => u.id === currentUserId);
    const otherUsers = users.filter(u => u.id !== currentUserId);

    return (
        <div className="h-full flex flex-col space-y-3">
            {/* Video Controls - Made more compact */}
            <div className="flex items-center justify-center space-x-1 px-2">
                <Button
                    onClick={toggleVideo}
                    variant={videoEnabled ? "default" : "destructive"}
                    size="sm"
                    disabled={!connected || isInitializing}
                    className="flex items-center space-x-1 text-xs px-2 py-1"
                >
                    {videoEnabled ? <Video className="w-3 h-3" /> : <VideoOff className="w-3 h-3" />}
                    <span className="hidden sm:inline">{videoEnabled ? "Video Off" : "Video On"}</span>
                </Button>

                <Button
                    onClick={toggleAudio}
                    variant={audioEnabled ? "default" : "destructive"}
                    size="sm"
                    disabled={!connected || isInitializing}
                    className="flex items-center space-x-1 text-xs px-2 py-1"
                >
                    {audioEnabled ? <Mic className="w-3 h-3" /> : <MicOff className="w-3 h-3" />}
                    <span className="hidden sm:inline">{audioEnabled ? "Mute" : "Unmute"}</span>
                </Button>
            </div>

            {/* Video Grid - More compact */}
            <div className="flex-1 space-y-2">
                {/* Local user video */}
                <div>
                    <h3 className="text-xs font-medium text-slate-300 mb-1 px-1">You</h3>
                    <VideoTile
                        userName={currentUserName}
                        isLocal={true}
                        videoRef={localVideoRef}
                        setVideoRef={setVideoRef}
                        videoEnabled={videoEnabled}
                        audioEnabled={audioEnabled}
                        isHost={currentUser?.isHost}
                    />
                </div>

                {/* Other users' videos */}
                {otherUsers.length > 0 && (
                    <div>
                        <h3 className="text-xs font-medium text-slate-300 mb-1 px-1">
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
                                        isHost={user.isHost}
                                    />
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* Connection Status */}
            {!connected && (
                <div className="text-center py-2">
                    <p className="text-xs text-slate-400">Connecting to room...</p>
                </div>
            )}

            {isInitializing && (
                <div className="text-center py-2">
                    <p className="text-xs text-slate-400">Initializing camera...</p>
                </div>
            )}
        </div>
    );
}; 