/**
 * Video Synchronization Hook
 * 
 * Handles synchronized video playback across multiple clients
 * Manages play/pause state, seeking, and timestamp synchronization
 */

import { useEffect, useRef, useCallback } from 'react';
import { logger } from '@/lib/logger';
import type { MediaState } from '@/types';

interface UseVideoSyncOptions {
    videoRef: React.RefObject<HTMLVideoElement | null>;
    currentMedia: MediaState;
    canControl: boolean;
    onPlayPause: (action: 'play' | 'pause', timestamp: number) => void;
    onSeek: (timestamp: number) => void;
}

export const useVideoSync = ({
    videoRef,
    currentMedia,
    canControl,
    onPlayPause,
    onSeek
}: UseVideoSyncOptions) => {
    // Track if we're updating from socket to prevent feedback loops
    const isUpdatingFromSocket = useRef(false);
    const syncTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
    const lastSyncTime = useRef<number>(0);

    // Constants for sync behavior
    const SYNC_THRESHOLD = 1.0; // seconds - only sync if diff > this
    const SYNC_DEBOUNCE = 100; // ms - debounce time for sync operations
    const MIN_SYNC_INTERVAL = 500; // ms - minimum time between syncs

    /**
     * Sync video state (play/pause) with socket events
     */
    const syncPlayState = useCallback(() => {
        if (!videoRef.current || !currentMedia.url) return;

        const video = videoRef.current;

        // Skip if video not ready
        if (video.readyState === 0) {
            logger.debug('Video not ready for sync');
            return;
        }

        isUpdatingFromSocket.current = true;

        try {
            if (currentMedia.state === 'playing' && video.paused) {
                logger.info('Syncing video: PLAY');
                video.play().catch(err => {
                    logger.error('Failed to play video', err);
                });
            } else if (currentMedia.state === 'paused' && !video.paused) {
                logger.info('Syncing video: PAUSE');
                video.pause();

                // Sync timestamp when pausing to ensure everyone is at same point
                const timeDiff = Math.abs(video.currentTime - currentMedia.timestamp);
                if (timeDiff > SYNC_THRESHOLD) {
                    video.currentTime = currentMedia.timestamp;
                    logger.debug('Synced timestamp on pause', {
                        from: video.currentTime,
                        to: currentMedia.timestamp
                    });
                }
            }
        } finally {
            // Reset flag after a brief delay
            setTimeout(() => {
                isUpdatingFromSocket.current = false;
            }, SYNC_DEBOUNCE);
        }
    }, [currentMedia.state, currentMedia.timestamp, currentMedia.url, videoRef]);

    /**
     * Sync video timestamp (seeking)
     */
    const syncTimestamp = useCallback(() => {
        if (!videoRef.current || !currentMedia.url) return;

        const video = videoRef.current;
        const timeDiff = Math.abs(video.currentTime - currentMedia.timestamp);

        // Only sync if difference is significant
        if (timeDiff > SYNC_THRESHOLD) {
            // Prevent too frequent syncs
            const now = Date.now();
            if (now - lastSyncTime.current < MIN_SYNC_INTERVAL) {
                return;
            }

            isUpdatingFromSocket.current = true;
            video.currentTime = currentMedia.timestamp;
            lastSyncTime.current = now;

            logger.debug('Synced timestamp', {
                from: video.currentTime,
                to: currentMedia.timestamp,
                diff: timeDiff
            });

            setTimeout(() => {
                isUpdatingFromSocket.current = false;
            }, SYNC_DEBOUNCE);
        }
    }, [currentMedia.timestamp, currentMedia.url, videoRef]);

    /**
     * Handle video play event (host only)
     */
    const handleVideoPlay = useCallback(() => {
        if (!videoRef.current || !canControl || isUpdatingFromSocket.current) return;

        logger.debug('Video play event (controller)');
        onPlayPause('play', videoRef.current.currentTime);
    }, [canControl, onPlayPause, videoRef]);

    /**
     * Handle video pause event (host only)
     */
    const handleVideoPause = useCallback(() => {
        if (!videoRef.current || !canControl || isUpdatingFromSocket.current) return;

        logger.debug('Video pause event (controller)');
        onPlayPause('pause', videoRef.current.currentTime);
    }, [canControl, onPlayPause, videoRef]);

    /**
     * Handle video seek event (host only)
     */
    const handleVideoSeeked = useCallback(() => {
        if (!videoRef.current || !canControl || isUpdatingFromSocket.current) return;

        logger.debug('Video seeked event (controller)', { time: videoRef.current.currentTime });
        onSeek(videoRef.current.currentTime);
    }, [canControl, onSeek, videoRef]);

    /**
     * Handle video time update for drift detection
     */
    const handleTimeUpdate = useCallback(() => {
        if (!videoRef.current || !currentMedia.url || currentMedia.state !== 'playing') return;
        if (canControl || isUpdatingFromSocket.current) return;

        const video = videoRef.current;
        const timeDiff = Math.abs(video.currentTime - currentMedia.timestamp);

        // If drift is too large, resync
        if (timeDiff > SYNC_THRESHOLD * 2) {
            logger.warn('Video drift detected, resyncing', {
                currentTime: video.currentTime,
                expectedTime: currentMedia.timestamp,
                diff: timeDiff
            });
            syncTimestamp();
        }
    }, [currentMedia.timestamp, currentMedia.url, currentMedia.state, canControl, syncTimestamp, videoRef]);

    // Sync play/pause state when it changes
    useEffect(() => {
        syncPlayState();
    }, [syncPlayState]);

    // Sync timestamp when it changes significantly
    useEffect(() => {
        // Clear any pending sync
        if (syncTimeoutRef.current) {
            clearTimeout(syncTimeoutRef.current);
        }

        // Debounce timestamp syncs
        syncTimeoutRef.current = setTimeout(() => {
            syncTimestamp();
        }, SYNC_DEBOUNCE);

        return () => {
            if (syncTimeoutRef.current) {
                clearTimeout(syncTimeoutRef.current);
            }
        };
    }, [syncTimestamp]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (syncTimeoutRef.current) {
                clearTimeout(syncTimeoutRef.current);
            }
        };
    }, []);

    return {
        handleVideoPlay,
        handleVideoPause,
        handleVideoSeeked,
        handleTimeUpdate,
        isUpdatingFromSocket: isUpdatingFromSocket.current
    };
};
