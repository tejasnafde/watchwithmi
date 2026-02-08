/**
 * Media Player Component
 * 
 * Handles video playback with synchronized controls across clients
 * Supports YouTube videos (via IFrame API) and direct media files
 */

'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { logger } from '@/lib/logger';
import { useVideoSync } from '@/hooks/useVideoSync';
import { useYouTubePlayer } from '@/hooks/useYouTubePlayer';
import type { MediaState } from '@/types';
import { Button } from '@/components/ui/button';
import { Play, Maximize, Loader2 } from 'lucide-react';

interface MediaPlayerProps {
    currentMedia: MediaState;
    isHost: boolean;
    canControl: boolean;
    socket: Socket | null;
    onPlayPause: (action: 'play' | 'pause', timestamp: number) => void;
    onSeek: (timestamp: number) => void;
}

export const MediaPlayer: React.FC<MediaPlayerProps> = ({
    currentMedia,
    isHost,
    canControl,
    socket,
    onPlayPause,
    onSeek
}) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [videoError, setVideoError] = useState<string | null>(null);
    const [isBuffering, setIsBuffering] = useState(false);
    const videoErrorRetryCount = useRef(0);
    const lastVideoErrorTime = useRef(0);

    // Use video sync hook for synchronized playback
    const {
        handleVideoPlay,
        handleVideoPause,
        handleVideoSeeked,
        handleTimeUpdate
    } = useVideoSync({
        videoRef,
        currentMedia,
        isHost,
        onPlayPause,
        onSeek
    });

    // Handle video errors with retry logic
    const handleVideoError = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;

        const now = Date.now();
        const timeSinceLastError = now - lastVideoErrorTime.current;

        // Reset retry count if it's been a while since last error
        if (timeSinceLastError > 10000) {
            videoErrorRetryCount.current = 0;
        }

        lastVideoErrorTime.current = now;
        videoErrorRetryCount.current++;

        const error = video.error;
        logger.error('Video error occurred', {
            code: error?.code,
            message: error?.message,
            retryCount: videoErrorRetryCount.current,
            src: video.src,
            readyState: video.readyState,
            networkState: video.networkState
        });

        // Retry up to 3 times
        if (videoErrorRetryCount.current <= 3) {
            logger.info('Retrying video load', { attempt: videoErrorRetryCount.current });
            setTimeout(() => {
                if (video) {
                    video.load();
                }
            }, 1000 * videoErrorRetryCount.current);
        } else {
            setVideoError('Failed to load video after multiple attempts');
        }
    }, []);

    // Handle buffering states
    const handleWaiting = useCallback(() => {
        logger.debug('Video buffering...');
        setIsBuffering(true);
    }, []);

    const handleCanPlay = useCallback(() => {
        logger.debug('Video can play');
        setIsBuffering(false);
        setVideoError(null);
    }, []);

    // Reset error state when media changes
    useEffect(() => {
        setVideoError(null);
        videoErrorRetryCount.current = 0;
    }, [currentMedia.url]);

    // Update video source when URL changes
    useEffect(() => {
        if (!videoRef.current) return;

        const video = videoRef.current;

        if (currentMedia.url && currentMedia.type !== 'youtube') {
            if (video.src !== currentMedia.url) {
                logger.info('Updating video source', { url: currentMedia.url });
                video.src = currentMedia.url;
                video.load();
            }
        } else {
            video.src = '';
        }
    }, [currentMedia.url, currentMedia.type]);

    const toggleFullscreen = () => {
        if (videoRef.current) {
            if (document.fullscreenElement) {
                document.exitFullscreen();
            } else {
                videoRef.current.requestFullscreen();
            }
        }
    };

    // YouTube player hook integration
    const ytProps = useYouTubePlayer({
        videoUrl: currentMedia.url,
        isHost: canControl, // Use canControl to determine if events should be emitted
        socket,
        shouldPlay: currentMedia.state === 'playing',
        targetTimestamp: currentMedia.timestamp,
    });

    const {
        playerContainerRef,
        isReady: ytReady,
        isPlaying: ytPlaying,
        currentTime: ytTime,
        duration: ytDuration,
        error: ytError,
        buffering: ytBuffering
    } = ytProps;

    // Empty state
    if (!currentMedia.url) {
        return (
            <div className="aspect-video bg-[#0a0a0a] border-4 border-white flex items-center justify-center">
                <div className="text-center text-white">
                    <Play className="h-16 w-16 mx-auto mb-4" />
                    <p className="text-lg uppercase font-bold">NO MEDIA LOADED</p>
                    <p className="text-sm mt-2 text-gray-400">SEARCH AND SELECT CONTENT TO WATCH TOGETHER</p>
                </div>
            </div>
        );
    }

    // YouTube player rendering
    if (currentMedia.type === 'youtube') {
        return (
            <div className="relative aspect-video rounded-lg overflow-hidden bg-black">
                {/* YouTube Player Container */}
                <div
                    ref={playerContainerRef}
                    className="w-full h-full"
                />

                {/* Interaction blocker for viewers */}
                {!canControl && ytReady && (
                    <div className="absolute inset-0 z-10 bg-transparent cursor-default" />
                )}

                {/* Loading overlay */}
                {(!ytReady || ytBuffering) && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <div className="text-center text-white">
                            <Loader2 className="h-12 w-12 animate-spin mx-auto mb-4" />
                            <p>{!ytReady ? 'Loading YouTube player...' : 'Buffering...'}</p>
                            {currentMedia.title && (
                                <p className="text-sm mt-2 opacity-75">{currentMedia.title}</p>
                            )}
                        </div>
                    </div>
                )}

                {/* Error overlay */}
                {ytError && (
                    <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
                        <div className="text-center text-white p-6">
                            <p className="text-red-400 mb-4">{ytError}</p>
                            <Button
                                onClick={() => window.location.reload()}
                                variant="outline"
                                className="border-white/20 text-white hover:bg-white/10"
                            >
                                Reload
                            </Button>
                        </div>
                    </div>
                )}

                {/* Viewer mode info overlay */}
                {!isHost && ytReady && (
                    <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-sm px-3 py-2 rounded-lg text-white text-sm">
                        {ytPlaying ? '▶️ Playing' : '⏸️ Paused'} • {Math.floor(ytTime)}s / {Math.floor(ytDuration)}s
                    </div>
                )}
            </div>
        );
    }

    // Default Video player rendering
    return (
        <div className="relative aspect-video rounded-lg overflow-hidden bg-black group">
            <video
                ref={videoRef}
                className="w-full h-full"
                onPlay={handleVideoPlay}
                onPause={handleVideoPause}
                onSeeked={handleVideoSeeked}
                onTimeUpdate={handleTimeUpdate}
                onError={handleVideoError}
                onWaiting={handleWaiting}
                onCanPlay={handleCanPlay}
                controls={canControl}
                crossOrigin="anonymous"
                playsInline
            />

            {/* Loading overlay */}
            {(currentMedia.loading || isBuffering) && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <div className="text-center text-white">
                        <Loader2 className="h-12 w-12 animate-spin mx-auto mb-4" />
                        <p>{currentMedia.loading ? 'Loading media...' : 'Buffering...'}</p>
                        {currentMedia.title && (
                            <p className="text-sm mt-2 opacity-75">{currentMedia.title}</p>
                        )}
                    </div>
                </div>
            )}

            {/* Error overlay */}
            {videoError && (
                <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
                    <div className="text-center text-white p-6">
                        <p className="text-red-400 mb-4">{videoError}</p>
                        <Button
                            onClick={() => {
                                setVideoError(null);
                                videoErrorRetryCount.current = 0;
                                if (videoRef.current) {
                                    videoRef.current.load();
                                }
                            }}
                            variant="outline"
                            className="border-white/20 text-white hover:bg-white/10"
                        >
                            Retry
                        </Button>
                    </div>
                </div>
            )}

            {/* Viewer mode indicator */}
            {!isHost && (
                <div className="absolute top-4 right-4 bg-black/50 px-3 py-1 rounded-full text-white text-sm backdrop-blur-sm">
                    Viewer Mode
                </div>
            )}

            {/* Fullscreen button */}
            <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                    size="sm"
                    variant="secondary"
                    className="bg-black/50 hover:bg-black/70 backdrop-blur-sm"
                    onClick={toggleFullscreen}
                >
                    <Maximize className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
};
