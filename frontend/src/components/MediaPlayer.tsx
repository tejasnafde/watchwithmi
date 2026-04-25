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
import { explainPlaybackFailure } from '@/lib/codecHint';
import type { MediaState, MediaStatus } from '@/types';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Play, Maximize, Loader2, SkipBack, SkipForward } from 'lucide-react';

interface VideoReaction {
    id: string;
    emoji: string;
    user_name: string;
}

interface MediaPlayerProps {
    currentMedia: MediaState;
    canControl: boolean;
    socket: Socket | null;
    mediaStatus?: MediaStatus | null;
    onPlayPause: (action: 'play' | 'pause', timestamp: number) => void;
    onSeek: (timestamp: number) => void;
    onPlaylistNext?: () => void;
    onPlaylistPrev?: () => void;
    videoReactions?: VideoReaction[];
    onVideoReaction?: (emoji: string) => void;
}

const REACTION_EMOJIS = ['😂', '❤️', '👍', '🔥', '😮', '🎉'];

const floatUpKeyframes = `
@keyframes floatUpReaction {
  0% { opacity: 1; transform: translateY(0) scale(1); }
  70% { opacity: 1; transform: translateY(-200px) scale(1.2); }
  100% { opacity: 0; transform: translateY(-300px) scale(0.8); }
}
`;

const VideoReactions: React.FC<{ reactions: VideoReaction[] }> = ({ reactions }) => {
    // Memoize random positions per reaction id so they don't shift on re-render
    const positionsRef = useRef<Record<string, number>>({});

    return (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-30">
            <style>{floatUpKeyframes}</style>
            {reactions.map((reaction) => {
                if (!(reaction.id in positionsRef.current)) {
                    positionsRef.current[reaction.id] = 60 + Math.random() * 35;
                }
                const leftPos = positionsRef.current[reaction.id];
                return (
                    <div
                        key={reaction.id}
                        style={{
                            position: 'absolute',
                            bottom: '60px',
                            left: `${leftPos}%`,
                            animation: 'floatUpReaction 3s ease-out forwards',
                        }}
                        className="flex flex-col items-center"
                    >
                        <span className="text-2xl">{reaction.emoji}</span>
                        <span className="text-[10px] text-white bg-black/60 px-1 rounded whitespace-nowrap">
                            {reaction.user_name}
                        </span>
                    </div>
                );
            })}
        </div>
    );
};

const ReactionBar: React.FC<{ onReaction: (emoji: string) => void }> = ({ onReaction }) => {
    return (
        <div className="absolute bottom-0 left-0 right-0 z-20 flex justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
            <div className="flex gap-1 bg-black/50 backdrop-blur-sm rounded-t-lg px-2 py-1.5 pointer-events-auto">
                {REACTION_EMOJIS.map((emoji) => (
                    <button
                        key={emoji}
                        onClick={() => onReaction(emoji)}
                        className="text-xl hover:scale-125 transition-transform duration-150 px-1 cursor-pointer"
                        title={`React with ${emoji}`}
                    >
                        {emoji}
                    </button>
                ))}
            </div>
        </div>
    );
};

export const MediaPlayer: React.FC<MediaPlayerProps> = ({
    currentMedia,
    canControl,
    socket,
    mediaStatus,
    onPlayPause,
    onSeek,
    onPlaylistNext,
    onPlaylistPrev,
    videoReactions = [],
    onVideoReaction,
}) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [videoError, setVideoError] = useState<string | null>(null);
    // Set alongside videoError when the failure looks like a codec/container
    // problem (MediaError code 4). Drives the "try an x264/MP4 release"
    // hint in the error overlay; null falls back to the generic message.
    const [videoErrorDetail, setVideoErrorDetail] = useState<string | null>(null);
    const [isBuffering, setIsBuffering] = useState(false);
    const videoErrorRetryCount = useRef(0);
    const lastVideoErrorTime = useRef(0);

    // Use video sync hook for synchronized playback
    const {
        handleVideoPlay,
        handleVideoPause,
        handleVideoSeeked,
        handleTimeUpdate,
        handleWaiting: syncHandleWaiting,
        handleCanPlay: syncHandleCanPlay
    } = useVideoSync({
        videoRef,
        currentMedia,
        canControl,
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

        // MEDIA_ERR_SRC_NOT_SUPPORTED (code 4) is *ambiguous* — Firefox /
        // Chrome fire it for both:
        //   (a) genuine codec/container mismatch (HEVC in Firefox,
        //       MKV outside Chrome+H.264), AND
        //   (b) any HTTP failure during the initial load — 4xx / 5xx /
        //       CORS rejection. The MediaError API can't distinguish.
        //
        // We disambiguate via `explainPlaybackFailure`: it only returns a
        // string when the release title clearly matches a known-bad codec
        // (severity === "warn"). For H.264/MP4 / unknown titles it returns
        // null, which we treat as a transient HTTP failure (the common
        // case here is HTTP 425 "Too Early" while the torrent is still
        // buffering on the backend) and fall through to the retry path.
        const isUnsupported = error?.code === 4;
        const codecExplanation =
            isUnsupported && currentMedia.title
                ? explainPlaybackFailure(currentMedia.title)
                : null;

        if (isUnsupported && codecExplanation) {
            // Codec is the actual culprit — retrying won't help.
            setVideoError("This video can't play in your browser.");
            setVideoErrorDetail(codecExplanation);
            return;
        }

        // Exponential backoff — 1s, 2s, 4s, 8s, 16s = ~31s total over 5
        // retries. The earlier 1s/2s/3s linear ramp totalled ~6s, which
        // wasn't enough for a cold libtorrent on Render to buffer 5+ MB.
        const MAX_RETRIES = 5;
        if (videoErrorRetryCount.current <= MAX_RETRIES) {
            const delayMs = 1000 * Math.pow(2, videoErrorRetryCount.current - 1);
            logger.info('Retrying video load', {
                attempt: videoErrorRetryCount.current,
                delayMs,
            });
            setTimeout(() => {
                if (video) {
                    video.load();
                }
            }, delayMs);
        } else if (isUnsupported) {
            // Exhausted retries on a code-4 we couldn't pin to a codec —
            // almost certainly an HTTP/buffering problem on the backend
            // (most often "still downloading the torrent header"). Don't
            // mislead the user about codecs.
            setVideoError("Couldn't start playback.");
            setVideoErrorDetail(
                "The server may still be buffering the torrent. Give it a few seconds and try Reload Page, or pick a different release with more seeders."
            );
        } else {
            setVideoError('Failed to load video after multiple attempts');
            setVideoErrorDetail(null);
        }
    }, [currentMedia.title]);

    // Handle buffering states (combines local UI state + sync hook buffering ref)
    const handleWaiting = useCallback(() => {
        logger.debug('Video buffering...');
        setIsBuffering(true);
        syncHandleWaiting();
    }, [syncHandleWaiting]);

    const handleCanPlay = useCallback(() => {
        logger.debug('Video can play');
        setIsBuffering(false);
        setVideoError(null);
        syncHandleCanPlay();
    }, [syncHandleCanPlay]);

    // Reset error state when media changes
    useEffect(() => {
        setVideoError(null);
        setVideoErrorDetail(null);
        videoErrorRetryCount.current = 0;
    }, [currentMedia.url]);

    // Update video source when URL changes
    useEffect(() => {
        if (!videoRef.current) return;

        const video = videoRef.current;

        if (currentMedia.url && currentMedia.type !== 'youtube') {
            if (video.src !== currentMedia.url) {
                logger.info('Updating video source', { url: currentMedia.url });
                video.pause();
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
        buffering: ytBuffering,
        clearError: ytClearError
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
            <div className="relative aspect-video rounded-lg overflow-hidden bg-black group">
                {/* YouTube Player Container */}
                <div
                    ref={playerContainerRef}
                    className="w-full h-full"
                />

                {/* Floating emoji reactions */}
                <VideoReactions reactions={videoReactions} />

                {/* Reaction bar */}
                {onVideoReaction && (
                    <ReactionBar onReaction={onVideoReaction} />
                )}

                {/* Interaction blocker for viewers */}
                {!canControl && ytReady && (
                    <div className="absolute inset-0 z-10 bg-transparent cursor-default" />
                )}

                {/* Loading overlay.
                    When the player isn't ready yet there's nothing under us
                    to interact with, so we want the overlay to block clicks
                    (default behaviour). Once the player is ready and we're
                    only showing this for `ytBuffering`, we make it
                    pointer-events-none so YT's native play button stays
                    clickable as a manual escape hatch — combined with the
                    8s buffering watchdog in useYouTubePlayer, this prevents
                    the "stuck buffering after pause" trap. */}
                {(!ytReady || ytBuffering) && (
                    <div
                        className={`absolute inset-0 bg-black/50 flex items-center justify-center ${
                            ytReady ? 'pointer-events-none' : ''
                        }`}
                    >
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
                            <div className="flex gap-3 justify-center">
                                <Button
                                    onClick={() => {
                                        // Clear error state to allow the player to retry
                                        ytClearError();
                                    }}
                                    variant="outline"
                                    className="border-white/20 text-white hover:bg-white/10"
                                >
                                    Retry
                                </Button>
                                <Button
                                    onClick={() => window.location.reload()}
                                    variant="outline"
                                    className="border-red-400/30 text-red-300 hover:bg-red-400/10"
                                    title="This will disconnect you from the room"
                                >
                                    Reload Page
                                </Button>
                            </div>
                            <p className="text-xs text-gray-500 mt-2">Reload Page will disconnect you from the room</p>
                        </div>
                    </div>
                )}

                {/* Viewer mode info overlay */}
                {!canControl && ytReady && (
                    <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-sm px-3 py-2 rounded-lg text-white text-sm">
                        {ytPlaying ? '▶️ Playing' : '⏸️ Paused'} • {Math.floor(ytTime)}s / {Math.floor(ytDuration)}s
                    </div>
                )}

                {/* Playlist controls for controllers */}
                {currentMedia.is_playlist && canControl && (
                    <div className="absolute bottom-4 right-4 flex items-center gap-2 z-20">
                        <Button
                            size="sm"
                            variant="secondary"
                            className="bg-black/60 hover:bg-black/80 text-white"
                            onClick={onPlaylistPrev}
                        >
                            <SkipBack className="h-4 w-4" />
                        </Button>
                        <Button
                            size="sm"
                            variant="secondary"
                            className="bg-black/60 hover:bg-black/80 text-white"
                            onClick={onPlaylistNext}
                        >
                            <SkipForward className="h-4 w-4" />
                        </Button>
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

            {/* Floating emoji reactions */}
            <VideoReactions reactions={videoReactions} />

            {/* Reaction bar */}
            {onVideoReaction && (
                <ReactionBar onReaction={onVideoReaction} />
            )}

            {/* Loading overlay */}
            {(currentMedia.loading || isBuffering) && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <div className="text-center text-white w-80 max-w-[90%]">
                        {currentMedia.loading && mediaStatus ? (
                            <>
                                {currentMedia.title && (
                                    <p className="text-sm font-medium mb-3 opacity-90 truncate">{currentMedia.title}</p>
                                )}
                                <div className="mb-3">
                                    <div className="flex justify-between text-xs font-mono mb-1 opacity-75">
                                        <span>{(mediaStatus.progress * 100).toFixed(1)}%</span>
                                        {mediaStatus.download_rate > 0 && (
                                            <span>{(mediaStatus.download_rate / 1024 / 1024).toFixed(1)} MB/s</span>
                                        )}
                                    </div>
                                    <Progress value={mediaStatus.progress * 100} className="h-2 bg-white/20" />
                                </div>
                                {mediaStatus.file_progress !== undefined && mediaStatus.file_progress !== mediaStatus.progress && (
                                    <div className="mb-3">
                                        <div className="flex justify-between text-xs font-mono mb-1 opacity-75">
                                            <span>File: {(mediaStatus.file_progress * 100).toFixed(1)}%</span>
                                            <span>{mediaStatus.streaming_ready ? 'READY' : 'BUFFERING'}</span>
                                        </div>
                                        <Progress value={mediaStatus.file_progress * 100} className="h-2 bg-white/20" />
                                    </div>
                                )}
                                <p className="text-xs opacity-50 font-mono">{mediaStatus.num_peers} peers connected</p>
                            </>
                        ) : (
                            <>
                                <Loader2 className="h-12 w-12 animate-spin mx-auto mb-4" />
                                <p>{currentMedia.loading ? 'Loading media...' : 'Buffering...'}</p>
                                {currentMedia.title && (
                                    <p className="text-sm mt-2 opacity-75">{currentMedia.title}</p>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Error overlay — the videoError state is only set after the
                auto-retry budget is exhausted (handleVideoError increments
                `videoErrorRetryCount` up to 3 before surfacing this). The
                overlay therefore represents the "max retries reached" state
                and does not offer another Retry button (which used to reset
                the counter and let the user loop forever — bug #4). */}
            {videoError && (
                <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
                    <div className="text-center text-white p-6">
                        <p className="text-red-400 mb-2">{videoError}</p>
                        <p className="text-xs text-gray-400 mb-4 max-w-md mx-auto">
                            {videoErrorDetail ?? 'Max retries reached. Reload the page to try again.'}
                        </p>
                        <Button
                            onClick={() => window.location.reload()}
                            variant="outline"
                            className="border-red-400/30 text-red-300 hover:bg-red-400/10"
                            title="This will disconnect you from the room"
                        >
                            Reload Page
                        </Button>
                    </div>
                </div>
            )}

            {/* Viewer mode indicator */}
            {!canControl && (
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
