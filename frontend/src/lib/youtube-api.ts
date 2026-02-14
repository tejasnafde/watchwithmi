/**
 * YouTube IFrame API Loader
 * 
 * Dynamically loads the YouTube IFrame Player API script and provides
 * TypeScript type definitions for the YouTube Player.
 */

// YouTube Player API Types
declare global {
    interface Window {
        YT: typeof YT;
        onYouTubeIframeAPIReady: () => void;
    }
}

export namespace YT {
    export enum PlayerState {
        UNSTARTED = -1,
        ENDED = 0,
        PLAYING = 1,
        PAUSED = 2,
        BUFFERING = 3,
        CUED = 5,
    }

    export interface PlayerOptions {
        height?: string | number;
        width?: string | number;
        videoId: string;
        playerVars?: PlayerVars;
        events?: Events;
    }

    export interface PlayerVars {
        autoplay?: 0 | 1;
        controls?: 0 | 1;
        disablekb?: 0 | 1;
        enablejsapi?: 0 | 1;
        fs?: 0 | 1;
        iv_load_policy?: 1 | 3;
        modestbranding?: 0 | 1;
        origin?: string;
        rel?: 0 | 1;
        start?: number;
        list?: string;
        listType?: 'playlist' | 'user_uploads';
    }

    export interface Events {
        onReady?: (event: PlayerEvent) => void;
        onStateChange?: (event: OnStateChangeEvent) => void;
        onError?: (event: OnErrorEvent) => void;
    }

    export interface PlayerEvent {
        target: Player;
    }

    export interface OnStateChangeEvent extends PlayerEvent {
        data: PlayerState;
    }

    export interface OnErrorEvent extends PlayerEvent {
        data: number;
    }

    export interface Player {
        // Playback controls
        playVideo(): void;
        pauseVideo(): void;
        stopVideo(): void;
        seekTo(seconds: number, allowSeekAhead: boolean): void;

        // Playback status
        getPlayerState(): PlayerState;
        getCurrentTime(): number;
        getDuration(): number;
        getVideoLoadedFraction(): number;

        // Volume
        setVolume(volume: number): void;
        getVolume(): number;
        mute(): void;
        unMute(): void;
        isMuted(): boolean;

        // Player management
        destroy(): void;

        // Event listeners
        addEventListener(event: string, listener: (event: any) => void): void;
        removeEventListener(event: string, listener: (event: any) => void): void;
    }
}

let apiLoadPromise: Promise<void> | null = null;

/**
 * Load the YouTube IFrame Player API
 * Returns a promise that resolves when the API is ready to use
 */
export const loadYouTubeAPI = (): Promise<void> => {
    // Return existing promise if already loading
    if (apiLoadPromise) {
        return apiLoadPromise;
    }

    // Check if API is already loaded
    if (typeof window !== 'undefined' && window.YT && (window.YT as any).Player) {
        return Promise.resolve();
    }

    apiLoadPromise = new Promise((resolve, reject) => {
        // Set up the callback for when API is ready
        window.onYouTubeIframeAPIReady = () => {
            resolve();
        };

        // Create and inject the script tag
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        tag.async = true;

        tag.onerror = () => {
            apiLoadPromise = null; // Reset so it can be retried
            reject(new Error('Failed to load YouTube IFrame API'));
        };

        const firstScriptTag = document.getElementsByTagName('script')[0];
        if (firstScriptTag && firstScriptTag.parentNode) {
            firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        } else {
            document.head.appendChild(tag);
        }
    });

    return apiLoadPromise;
};

/**
 * Extract YouTube video ID from various URL formats
 */
export const extractYouTubeVideoId = (url: string): string | null => {
    try {
        if (!url) return null;

        // If it's already just an ID
        if (!url.includes('/') && !url.includes('?')) {
            return url;
        }

        const urlObj = new URL(url);

        // Standard URL: https://www.youtube.com/watch?v=VIDEO_ID
        if (urlObj.hostname.includes('youtube.com')) {
            const videoId = urlObj.searchParams.get('v');
            if (videoId) return videoId;
        }

        // Short URL: https://youtu.be/VIDEO_ID
        if (urlObj.hostname.includes('youtu.be')) {
            const videoId = urlObj.pathname.slice(1);
            if (videoId) return videoId;
        }

        // Embed URL: https://www.youtube.com/embed/VIDEO_ID
        if (urlObj.pathname.includes('/embed/')) {
            const videoId = urlObj.pathname.split('/embed/')[1]?.split('?')[0];
            if (videoId) return videoId;
        }

        return null;
    } catch (error) {
        // Silently fail as this may be called with non-YouTube URLs (e.g. magnet links)
        return null;
    }
};

export const extractYouTubePlaylistId = (url: string): string | null => {
    try {
        if (!url) return null;
        const parsed = new URL(url);
        return parsed.searchParams.get('list');
    } catch {
        return null;
    }
};

export const isYouTubePlaylistUrl = (url: string): boolean => {
    if (!url) return false;
    const playlistId = extractYouTubePlaylistId(url);
    return Boolean(playlistId);
};
