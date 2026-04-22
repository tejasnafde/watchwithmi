/**
 * YouTube Player Hook
 * 
 * Manages YouTube IFrame Player lifecycle, events, and synchronization
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { loadYouTubeAPI, YT, extractYouTubeVideoId, extractYouTubePlaylistId } from '@/lib/youtube-api';
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
    clearError: () => void;
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
    const isSeekingRef = useRef(false);
    const lastSyncTimeRef = useRef(0);

    // Auto-clear timers for isSyncingRef / isSeekingRef. Each auto-clear
    // site cancels its previous pending clear so rapid sync bursts don't
    // accumulate timers racing to flip the flag (bug #2 in
    // docs/polishing/02-sync-playback.md).
    const syncingClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const seekingClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const scheduleSyncingClear = useCallback((ms: number) => {
        if (syncingClearTimerRef.current) clearTimeout(syncingClearTimerRef.current);
        syncingClearTimerRef.current = setTimeout(() => {
            isSyncingRef.current = false;
            syncingClearTimerRef.current = null;
        }, ms);
    }, []);

    const scheduleSeekingClear = useCallback((ms: number) => {
        if (seekingClearTimerRef.current) clearTimeout(seekingClearTimerRef.current);
        seekingClearTimerRef.current = setTimeout(() => {
            isSeekingRef.current = false;
            seekingClearTimerRef.current = null;
        }, ms);
    }, []);

    // Fallback timer for the UNSTARTED state — if the iframe never leaves
    // UNSTARTED (autoplay blocked, private video, etc.) we still want the
    // buffering UI to clear instead of hanging forever. See bug #3 in
    // docs/polishing/02-sync-playback.md.
    const unstartedBufferingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const UNSTARTED_BUFFERING_TIMEOUT_MS = 5000;

    const cancelUnstartedBufferingFallback = useCallback(() => {
        if (unstartedBufferingTimerRef.current) {
            clearTimeout(unstartedBufferingTimerRef.current);
            unstartedBufferingTimerRef.current = null;
        }
    }, []);

    // Cancel any pending auto-clears on unmount so they don't fire after
    // the host has already destroyed the player.
    useEffect(() => {
        return () => {
            if (syncingClearTimerRef.current) clearTimeout(syncingClearTimerRef.current);
            if (seekingClearTimerRef.current) clearTimeout(seekingClearTimerRef.current);
            cancelUnstartedBufferingFallback();
        };
    }, [cancelUnstartedBufferingFallback]);

    // Extract video ID
    const videoId = extractYouTubeVideoId(videoUrl);
    const playlistId = extractYouTubePlaylistId(videoUrl);

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
        logger.debug('YouTube player state changed', { state, isSyncing: isSyncingRef.current, isSeeking: isSeekingRef.current });

        // Any transition out of UNSTARTED means the player is responding,
        // so cancel the stuck-in-UNSTARTED fallback.
        if (state !== YT.PlayerState.UNSTARTED) {
            cancelUnstartedBufferingFallback();
        }

        switch (state) {
            case YT.PlayerState.PLAYING:
                setIsPlaying(true);
                setBuffering(false);
                isSeekingRef.current = false;

                // Host: Emit play event (skip if syncing, seeking, or buffering recovery)
                if (isHost && !isSyncingRef.current && !isSeekingRef.current && socket) {
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
                isSeekingRef.current = false;

                // Host: Emit pause event (skip if syncing or seeking)
                if (isHost && !isSyncingRef.current && !isSeekingRef.current && socket) {
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
                // Don't emit any sync events while buffering — this is a transient state.
                // Mark as seeking so no sync operations overlap with the buffer resolution.
                isSeekingRef.current = true;
                break;

            case YT.PlayerState.ENDED:
                setIsPlaying(false);
                setBuffering(false);
                isSeekingRef.current = false;
                break;

            case YT.PlayerState.UNSTARTED:
                setBuffering(true); // Treat unstarted as buffering/loading
                // Schedule a fallback so the indicator clears if the player
                // never transitions (e.g. autoplay blocked, video unavailable).
                cancelUnstartedBufferingFallback();
                unstartedBufferingTimerRef.current = setTimeout(() => {
                    setBuffering(false);
                    unstartedBufferingTimerRef.current = null;
                }, UNSTARTED_BUFFERING_TIMEOUT_MS);
                break;
        }
    }, [isHost, socket, callPlayerMethod, cancelUnstartedBufferingFallback]);

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

            scheduleSyncingClear(1000);
        }
    }, [shouldPlay, targetTimestamp, scheduleSyncingClear]);

    // Initialize YouTube player
    useEffect(() => {
        if ((!videoId && !playlistId) || !playerContainerRef.current) {
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
                    videoId: videoId || '',
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
                        ...(playlistId ? { list: playlistId, listType: 'playlist' as const } : {}),
                    },
                    events: {
                        onReady: handleReady,
                        onStateChange: handleStateChange,
                        onError: handleError,
                    },
                });

                playerRef.current = player;
                logger.info('YouTube player initialized', { videoId, playlistId, isHost });
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
    }, [videoId, playlistId, isHost, handleReady, handleStateChange, handleError]);

    // Sync playback state for viewers
    useEffect(() => {
        if (isHost || !isReady) {
            return;
        }

        // Use a small delay to avoid fighting with immediate player events
        const syncTimer = setTimeout(() => {
            if (isSyncingRef.current || isSeekingRef.current) return;

            const playerState = callPlayerMethod('getPlayerState');
            const isCurrentlyPlaying = playerState === YT.PlayerState.PLAYING;
            const isCurrentlyBuffering = playerState === YT.PlayerState.BUFFERING;

            // Don't try to sync while YouTube is buffering — let it resolve naturally
            if (isCurrentlyBuffering) {
                logger.debug('Skipping sync: player is buffering');
                return;
            }

            // Sync play/pause state first
            if (shouldPlay && !isCurrentlyPlaying) {
                logger.debug('Forcing YouTube play (sync)');
                isSyncingRef.current = true;
                callPlayerMethod('playVideo');
                scheduleSyncingClear(500);
            } else if (!shouldPlay && isCurrentlyPlaying) {
                logger.debug('Forcing YouTube pause (sync)');
                isSyncingRef.current = true;
                callPlayerMethod('pauseVideo');
                scheduleSyncingClear(500);
            }

            // Only seek if drift is significant — and skip seeking entirely when paused
            // and the player is already paused (no point seeking a paused video unless
            // the timestamp jumped significantly, e.g., host seeked while paused)
            const currentPlayerTime = callPlayerMethod('getCurrentTime') || 0;
            const drift = Math.abs(currentPlayerTime - targetTimestamp);

            if (drift > SYNC_THRESHOLD) {
                // When paused: only seek if drift is very large (host explicitly seeked)
                // This prevents the pause→seek→buffer→stuck loop
                const seekThreshold = shouldPlay ? SYNC_THRESHOLD : SYNC_THRESHOLD * 3;
                if (drift > seekThreshold) {
                    logger.debug('Syncing YouTube player position', {
                        currentTime: currentPlayerTime,
                        targetTime: targetTimestamp,
                        drift,
                        shouldPlay,
                    });
                    isSyncingRef.current = true;
                    isSeekingRef.current = true;
                    callPlayerMethod('seekTo', targetTimestamp, true);
                    scheduleSyncingClear(1000);
                    scheduleSeekingClear(1000);
                }
            }
        }, 100);

        return () => clearTimeout(syncTimer);
    }, [
        isHost,
        isReady,
        shouldPlay,
        targetTimestamp,
        isPlaying,
        callPlayerMethod,
        scheduleSyncingClear,
        scheduleSeekingClear,
    ]);

    // Update current time periodically
    useEffect(() => {
        if (!isReady) return;

        const interval = setInterval(() => {
            const time = callPlayerMethod('getCurrentTime');
            if (time !== null && time !== undefined) {
                // If time is moving, we can't be buffering
                if (Math.abs(time - currentTime) > 0.01 && buffering && isPlaying) {
                    setBuffering(false);
                    isSeekingRef.current = false;
                }
                setCurrentTime(time);
            }

            // Fallback for stuck buffering state: clear buffering if player
            // has resolved to PLAYING or PAUSED
            const state = callPlayerMethod('getPlayerState');
            if (buffering && (state === YT.PlayerState.PLAYING || state === YT.PlayerState.PAUSED)) {
                setBuffering(false);
                isSeekingRef.current = false;
            }
        }, 100);

        return () => clearInterval(interval);
    }, [isReady, callPlayerMethod, buffering, currentTime, isPlaying]);

    // Drift detection for viewers — only runs while playing
    useEffect(() => {
        // Completely disable drift detection when paused, not ready, or host
        if (isHost || !isReady || !isPlaying || !shouldPlay) {
            return;
        }

        const interval = setInterval(() => {
            if (isSyncingRef.current || isSeekingRef.current) return;

            // Double-check actual player state to avoid acting on stale React state
            const playerState = callPlayerMethod('getPlayerState');
            if (playerState !== YT.PlayerState.PLAYING) {
                logger.debug('Drift check skipped: player not actually playing', { playerState });
                return;
            }

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
                isSeekingRef.current = true;
                callPlayerMethod('seekTo', expectedTime, true);
                scheduleSyncingClear(1000);
                scheduleSeekingClear(1000);
            }
        }, SYNC_CHECK_INTERVAL);

        return () => clearInterval(interval);
    }, [
        isHost,
        isReady,
        isPlaying,
        shouldPlay,
        targetTimestamp,
        callPlayerMethod,
        scheduleSyncingClear,
        scheduleSeekingClear,
    ]);

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
        clearError: useCallback(() => setError(null), []),
    };
};
