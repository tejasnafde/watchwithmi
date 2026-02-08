/**
 * YouTube Player Hook
 * 
 * Manages YouTube IFrame Player lifecycle, events, and synchronization
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { loadYouTubeAPI, YT, extractYouTubeVideoId } from '@/lib/youtube-api';
import { logger } from '@/lib/logger';

interface UseYouTubePlayerProps {
    videoUrl: string;
    isHost: boolean;
    socket: Socket | null;
    shouldPlay: boolean;
    targetTimestamp: number;
}

interface UseYouTubePlayerReturn {
    playerContainerRef: React.RefObject<HTMLDivElement | null>;
    isReady: boolean;
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    error: string | null;
    buffering: boolean;
}

const SYNC_THRESHOLD = 2.0; // seconds
const SYNC_CHECK_INTERVAL = 1000; // ms

export const useYouTubePlayer = ({
    videoUrl,
    isHost,
    socket,
    shouldPlay,
    targetTimestamp,
}: UseYouTubePlayerProps): UseYouTubePlayerReturn => {
    const playerContainerRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<any>(null); // Use any to avoid type issues with method checks
    const [isReady, setIsReady] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [buffering, setBuffering] = useState(false);

    // Track if we're currently syncing to avoid feedback loops
    const isSyncingRef = useRef(false);
    const lastSyncTimeRef = useRef(0);

    // Extract video ID
    const videoId = extractYouTubeVideoId(videoUrl);

    // Helper to safely call player methods
    const callPlayerMethod = useCallback((methodName: string, ...args: any[]) => {
        const player = playerRef.current;
        if (player && typeof player[methodName] === 'function') {
            try {
                return player[methodName](...args);
            } catch (err) {
                logger.error(`Error calling YouTube player method: ${methodName}`, err);
            }
        }
        return null;
    }, []);

    // Handle player state changes
    const handleStateChange = useCallback((event: YT.OnStateChangeEvent) => {
        const state = event.data;
        logger.debug('YouTube player state changed', { state });

        switch (state) {
            case YT.PlayerState.PLAYING:
                setIsPlaying(true);
                setBuffering(false);

                // Host: Emit play event
                if (isHost && !isSyncingRef.current && socket) {
                    const playerCurrentTime = callPlayerMethod('getCurrentTime') || 0;
                    logger.info('Host playing YouTube video', { playerCurrentTime });
                    socket.emit('media_control', {
                        action: 'play',
                        timestamp: playerCurrentTime,
                    });
                }
                break;

            case YT.PlayerState.PAUSED:
                setIsPlaying(false);
                setBuffering(false);

                // Host: Emit pause event
                if (isHost && !isSyncingRef.current && socket) {
                    const playerCurrentTime = callPlayerMethod('getCurrentTime') || 0;
                    logger.info('Host paused YouTube video', { playerCurrentTime });
                    socket.emit('media_control', {
                        action: 'pause',
                        timestamp: playerCurrentTime,
                    });
                }
                break;

            case YT.PlayerState.BUFFERING:
                setBuffering(true);
                break;

            case YT.PlayerState.ENDED:
                setIsPlaying(false);
                setBuffering(false);
                break;

            case YT.PlayerState.UNSTARTED:
                setBuffering(true); // Treat unstarted as buffering/loading
                break;
        }
    }, [isHost, socket, callPlayerMethod]);

    // Handle player errors
    const handleError = useCallback((event: YT.OnErrorEvent) => {
        const errorCode = event.data;
        logger.error('YouTube player error', { errorCode });

        const errorMessages: Record<number, string> = {
            2: 'Invalid video ID',
            5: 'HTML5 player error',
            100: 'Video not found or private',
            101: 'Video not allowed to be played in embedded players',
            150: 'Video not allowed to be played in embedded players',
        };

        setError(errorMessages[errorCode] || `YouTube error: ${errorCode}`);
    }, []);

    // Handle player ready
    const handleReady = useCallback((event: YT.PlayerEvent) => {
        logger.info('YouTube player ready');
        setIsReady(true);

        const player = event.target;
        if (player && typeof player.getDuration === 'function') {
            const videoDuration = player.getDuration();
            setDuration(videoDuration);

            // Sync to initial state for all users (host and viewers)
            isSyncingRef.current = true;

            // Seek if targetTimestamp is ahead
            if (targetTimestamp > 0 && typeof player.seekTo === 'function') {
                logger.info('Seeking to initial timestamp', { targetTimestamp });
                player.seekTo(targetTimestamp, true);
            }

            // Force play/pause state explicitly based on shouldPlay
            if (shouldPlay && typeof player.playVideo === 'function') {
                logger.info('Auto-playing video on ready');
                player.playVideo();
            } else if (!shouldPlay && typeof player.pauseVideo === 'function') {
                logger.info('Keeping video paused on ready');
                player.pauseVideo();
            }

            setTimeout(() => {
                isSyncingRef.current = false;
            }, 1000);
        }
    }, [shouldPlay, targetTimestamp]);

    // Initialize YouTube player
    useEffect(() => {
        if (!videoId || !playerContainerRef.current) {
            return;
        }

        let player: any = null;
        let mounted = true;

        const initPlayer = async () => {
            try {
                // Load YouTube API
                await loadYouTubeAPI();

                if (!mounted) return;

                // Create player
                const YTClass = (window as any).YT;
                if (!YTClass || !YTClass.Player) {
                    throw new Error('YouTube API not ready');
                }

                player = new YTClass.Player(playerContainerRef.current!, {
                    videoId,
                    width: '100%',
                    height: '100%',
                    playerVars: {
                        autoplay: 0,
                        controls: isHost ? 1 : 0, // Only host gets controls
                        disablekb: isHost ? 0 : 1,
                        enablejsapi: 1,
                        fs: 1,
                        modestbranding: 1,
                        rel: 0,
                    },
                    events: {
                        onReady: handleReady,
                        onStateChange: handleStateChange,
                        onError: handleError,
                    },
                });

                playerRef.current = player;
                logger.info('YouTube player initialized', { videoId, isHost });
            } catch (err) {
                logger.error('Failed to initialize YouTube player', err);
                setError('Failed to load YouTube player');
            }
        };

        initPlayer();

        return () => {
            mounted = false;
            setIsReady(false);
            if (player) {
                logger.info('Destroying YouTube player');
                if (typeof player.destroy === 'function') {
                    try {
                        player.destroy();
                    } catch (e) { }
                }
                playerRef.current = null;
            }
        };
    }, [videoId, isHost, handleReady, handleStateChange, handleError]);

    // Sync playback state for viewers
    useEffect(() => {
        if (isHost || !isReady) {
            return;
        }

        // Use a small delay to avoid fighting with immediate player events
        const syncTimer = setTimeout(() => {
            if (isSyncingRef.current) return;

            const currentPlayerTime = callPlayerMethod('getCurrentTime') || 0;
            const drift = Math.abs(currentPlayerTime - targetTimestamp);

            // Sync if drift is significant
            if (drift > SYNC_THRESHOLD) {
                logger.debug('Syncing YouTube player position', {
                    currentTime: currentPlayerTime,
                    targetTime: targetTimestamp,
                    drift,
                });
                isSyncingRef.current = true;
                callPlayerMethod('seekTo', targetTimestamp, true);
                setTimeout(() => { isSyncingRef.current = false; }, 500);
            }

            // Sync play/pause state
            const playerState = callPlayerMethod('getPlayerState');
            const isCurrentlyPlaying = playerState === YT.PlayerState.PLAYING;

            if (shouldPlay && !isCurrentlyPlaying) {
                logger.debug('Forcing YouTube play (sync)');
                isSyncingRef.current = true;
                callPlayerMethod('playVideo');
                setTimeout(() => { isSyncingRef.current = false; }, 500);
            } else if (!shouldPlay && isCurrentlyPlaying) {
                logger.debug('Forcing YouTube pause (sync)');
                isSyncingRef.current = true;
                callPlayerMethod('pauseVideo');
                setTimeout(() => { isSyncingRef.current = false; }, 500);
            }
        }, 100);

        return () => clearTimeout(syncTimer);
    }, [isHost, isReady, shouldPlay, targetTimestamp, isPlaying, callPlayerMethod]);

    // Update current time periodically
    useEffect(() => {
        if (!isReady) return;

        const interval = setInterval(() => {
            const time = callPlayerMethod('getCurrentTime');
            if (time !== null && time !== undefined) {
                // If time is moving, we can't be buffering
                if (Math.abs(time - currentTime) > 0.01 && buffering && isPlaying) {
                    setBuffering(false);
                }
                setCurrentTime(time);
            }

            // Fallback for stuck buffering state
            const state = callPlayerMethod('getPlayerState');
            if (state === YT.PlayerState.PLAYING && buffering) {
                setBuffering(false);
            }
        }, 100);

        return () => clearInterval(interval);
    }, [isReady, callPlayerMethod, buffering, currentTime, isPlaying]);

    // Drift detection for viewers
    useEffect(() => {
        if (isHost || !isReady || !isPlaying) {
            return;
        }

        const interval = setInterval(() => {
            if (isSyncingRef.current) return;

            const playerCurrentTime = callPlayerMethod('getCurrentTime');
            if (playerCurrentTime === null || playerCurrentTime === undefined) return;

            const timeSinceLastSync = (Date.now() - lastSyncTimeRef.current) / 1000;
            const expectedTime = targetTimestamp + timeSinceLastSync;
            const drift = Math.abs(playerCurrentTime - expectedTime);

            if (drift > SYNC_THRESHOLD) {
                logger.debug('Drift detected, correcting', {
                    currentTime: playerCurrentTime,
                    expectedTime,
                    drift,
                });

                isSyncingRef.current = true;
                callPlayerMethod('seekTo', expectedTime, true);
                setTimeout(() => {
                    isSyncingRef.current = false;
                }, 500);
            }
        }, SYNC_CHECK_INTERVAL);

        return () => clearInterval(interval);
    }, [isHost, isReady, isPlaying, targetTimestamp, callPlayerMethod]);

    // Update last sync time when target changes
    useEffect(() => {
        lastSyncTimeRef.current = Date.now();
    }, [targetTimestamp]);

    return {
        playerContainerRef,
        isReady,
        isPlaying,
        currentTime,
        duration,
        error,
        buffering,
    };
};
