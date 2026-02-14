/**
 * Socket.IO Event Types
 * 
 * Centralized type definitions for all Socket.IO events and payloads
 */

// ============================================================================
// User Types
// ============================================================================

export interface User {
    id: string;
    name: string;
    is_host: boolean;
    can_control: boolean;
    joined_at?: string;
    video_enabled?: boolean;
    audio_enabled?: boolean;
}

// ============================================================================
// Chat Types
// ============================================================================

export interface ChatMessage {
    id: number;
    user_name: string;
    message: string;
    timestamp: string;
    isServer?: boolean;
}

// ============================================================================
// Media Types
// ============================================================================

export type MediaType = 'youtube' | 'media' | 'direct' | 'youtube_playlist';
export type MediaPlayState = 'playing' | 'paused';

export interface PlaylistItem {
    id?: string;
    title: string;
    url: string;
    thumbnail?: string;
    channel?: string;
    position?: number;
}

export interface MediaState {
    url: string;
    type: MediaType;
    state: MediaPlayState;
    timestamp: number;
    loading: boolean;
    title?: string;
    is_playlist?: boolean;
    playlist_id?: string;
    playlist_title?: string;
    playlist_items?: PlaylistItem[];
    current_index?: number;
    fallback_mode?: boolean;
}

export interface MediaStatus {
    id: string;
    name: string;
    status: string;
    progress: number;
    download_rate: number;
    upload_rate: number;
    num_peers: number;
    files: MediaFile[];
    largest_file: MediaFile | null;
    total_size: number;
    has_metadata: boolean;
    streaming_ready: boolean;
    file_progress: number;
    streaming_threshold: number;
}

export interface MediaFile {
    index: number;
    path: string;
    name?: string;
    size: number;
    is_video: boolean;
}

// ============================================================================
// Socket Event Payloads
// ============================================================================

export interface RoomJoinedData {
    room_code: string;
    user_id: string;
    users: User[] | Record<string, User>;
    chat_history?: ChatMessage[];
    chat?: ChatMessage[];
    media: Partial<MediaState> | null;
}

export interface UserJoinedData {
    user_id: string;
    user_name: string;
    is_host: boolean;
}

export interface UserLeftData {
    user_id: string;
    user_name: string;
    new_host_id?: string;
}

export interface ChatMessageData {
    id: number;
    user_name: string;
    message: string;
    timestamp: string;
}

export type MediaAction =
    | 'play'
    | 'pause'
    | 'seek'
    | 'change'
    | 'change_media'
    | 'load_playlist'
    | 'playlist_next'
    | 'playlist_prev'
    | 'playlist_select';

export interface MediaControlData {
    action: MediaAction;
    timestamp?: number;
    url?: string;
    type?: MediaType;
    title?: string;
    user_name: string;
}

export interface MediaProgressData {
    media_status: MediaStatus;
    user_name: string;
}

export interface WebRTCOfferData {
    from_user_id: string;
    from_user_name: string;
    offer: RTCSessionDescriptionInit;
}

export interface WebRTCAnswerData {
    from_user_id: string;
    answer: RTCSessionDescriptionInit;
}

export interface WebRTCIceCandidateData {
    from_user_id: string;
    candidate: RTCIceCandidateInit;
}

export interface ErrorData {
    message: string;
    code?: string;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface ContentSearchResult {
    title: string;
    magnet_url: string;
    size: string;
    seeders: number;
    leechers: number;
    quality: string;
    is_placeholder?: boolean;
    // YouTube-specific fields (optional)
    url?: string;
    thumbnail?: string;
    channel?: string;
    duration?: string;
    videoId?: string;
}

export interface ContentSearchResponse {
    query: string;
    results: ContentSearchResult[];
    count: number;
}

export interface YouTubeSearchResult {
    id: string;
    title: string;
    description: string;
    channel: string;
    published_at: string;
    thumbnail: string;
    thumbnail_high: string;
    url: string;
    embed_url: string;
}

export interface YouTubeSearchResponse {
    query: string;
    results: YouTubeSearchResult[];
    count: number;
}

export interface YouTubePlaylistResponse {
    enabled: boolean;
    fallback_mode: boolean;
    error?: string;
    playlist_id: string;
    playlist_title: string;
    playlist_channel?: string;
    items: PlaylistItem[];
    count?: number;
}

export interface AddMediaResponse {
    success: boolean;
    media_id: string;
    status: MediaStatus;
}

export interface MediaStatusResponse extends MediaStatus { }

export interface RoomStatsResponse {
    total_rooms: number;
    total_users: number;
    rooms: Record<string, number>;
}

// ============================================================================
// Socket Event Map (for type-safe socket.on/emit)
// ============================================================================

export interface ServerToClientEvents {
    room_joined: (data: RoomJoinedData) => void;
    user_joined: (data: UserJoinedData) => void;
    user_left: (data: UserLeftData) => void;
    users_updated: (data: { users: Record<string, any>; host: string }) => void;
    chat_message: (data: ChatMessageData) => void;
    new_message: (data: ChatMessageData) => void; // Alias for chat_message
    media_control: (data: MediaControlData) => void;
    media_changed: (data: any) => void; // Legacy event
    media_loading: (data: any) => void; // Legacy event
    media_play: (data: any) => void; // Legacy event
    media_pause: (data: any) => void; // Legacy event
    media_seek: (data: any) => void; // Legacy event
    media_progress: (data: MediaProgressData) => void;
    playlist_updated: (data: {
        playlist_id: string;
        playlist_title: string;
        playlist_items: PlaylistItem[];
        current_index: number;
        user_name: string;
    }) => void;
    room_created: (data: { room_code: string }) => void;
    webrtc_offer: (data: WebRTCOfferData) => void;
    webrtc_answer: (data: WebRTCAnswerData) => void;
    webrtc_ice_candidate: (data: WebRTCIceCandidateData) => void;
    error: (data: ErrorData) => void;
}

export interface ClientToServerEvents {
    join_room: (data: { room_code: string; user_name: string }) => void;
    create_room: (data: { user_name: string; room_code?: string }) => void;
    send_message: (data: { message: string }) => void;
    media_control: (data: {
        action: MediaAction;
        timestamp?: number;
        url?: string;
        type?: MediaType;
        title?: string;
        playlist_id?: string;
        playlist_title?: string;
        items?: PlaylistItem[];
        index?: number;
    }) => void;
    toggle_video: (data: { enabled: boolean }) => void;
    toggle_audio: (data: { enabled: boolean }) => void;
    webrtc_offer: (data: { target_user_id: string; offer: RTCSessionDescriptionInit }) => void;
    webrtc_answer: (data: { target_user_id: string; answer: RTCSessionDescriptionInit }) => void;
    webrtc_ice_candidate: (data: { target_user_id: string; candidate: RTCIceCandidateInit }) => void;
    grant_control: (data: { user_id: string; enabled: boolean }) => void;
}
