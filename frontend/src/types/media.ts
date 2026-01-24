/**
 * Media-related Type Definitions
 * 
 * Types for media sources, playback, and P2P content
 */

import { MediaType, MediaStatus, MediaFile } from './socket';

// ============================================================================
// Media Source Types
// ============================================================================

export interface MediaSource {
    id: string;
    type: MediaType;
    url: string;
    title?: string;
    thumbnail?: string;
}

export interface YouTubeVideo extends MediaSource {
    type: 'youtube';
    videoId: string;
    channel: string;
    description: string;
}

export interface P2PContent extends MediaSource {
    type: 'media';
    magnetUrl: string;
    fileIndex?: number;
    files?: MediaFile[];
}

export interface DirectMedia extends MediaSource {
    type: 'direct';
    contentType?: string;
}

// ============================================================================
// Playback State
// ============================================================================

export interface PlaybackState {
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    volume: number;
    muted: boolean;
    buffering: boolean;
}

// ============================================================================
// Media Loading State
// ============================================================================

export interface MediaLoadingState {
    isLoading: boolean;
    progress: number;
    error: string | null;
    canPlay: boolean;
}

// ============================================================================
// Search State
// ============================================================================

export interface SearchState {
    query: string;
    isSearching: boolean;
    hasSearched: boolean;
    error: string | null;
}

// ============================================================================
// Re-export from socket types for convenience
// ============================================================================

export type { MediaStatus, MediaFile, MediaType };
