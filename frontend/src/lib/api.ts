import axios from 'axios';
import { io, Socket } from 'socket.io-client';
import type {
  ContentSearchResponse,
  YouTubeSearchResponse,
  YouTubePlaylistResponse,
  AddMediaResponse,
  MediaStatusResponse,
  ServerToClientEvents,
  ClientToServerEvents
} from '@/types';

// FastAPI backend URL - adjust this based on your setup
let BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
if (BACKEND_URL && !BACKEND_URL.startsWith('http')) {
  // If it's just a hostname (from Render's fromService), append .onrender.com
  if (!BACKEND_URL.includes('.')) {
    BACKEND_URL = `https://${BACKEND_URL}.onrender.com`;
  } else {
    BACKEND_URL = `https://${BACKEND_URL}`;
  }
}
// Strip trailing slashes
BACKEND_URL = BACKEND_URL.replace(/\/+$/, '');

// Export BACKEND_URL for use in other modules
export { BACKEND_URL };

// API client
const api = axios.create({
  baseURL: BACKEND_URL,
  timeout: 30000,
});

// Response interceptor for consistent error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.code === 'ECONNABORTED') {
      return Promise.reject({
        message: 'Request timed out. Please try again.',
        code: 'TIMEOUT',
        originalError: error,
      });
    }
    if (!error.response) {
      return Promise.reject({
        message: 'Network error. Please check your connection and try again.',
        code: 'NETWORK_ERROR',
        originalError: error,
      });
    }
    const status = error.response.status;
    const serverMessage = error.response.data?.detail || error.response.data?.message;
    return Promise.reject({
      message: serverMessage || `Request failed with status ${status}`,
      code: `HTTP_${status}`,
      status,
      originalError: error,
    });
  }
);

// ============================================================================
// P2P Content Search
// ============================================================================

export const searchContent = async (query: string): Promise<ContentSearchResponse> => {
  const response = await api.post<ContentSearchResponse>('/api/search-content', { query });
  return response.data;
};

// ============================================================================
// YouTube Search
// ============================================================================

export const searchYouTube = async (
  query: string,
  maxResults: number = 10
): Promise<YouTubeSearchResponse> => {
  const response = await api.post<YouTubeSearchResponse>('/api/search-youtube', {
    query,
    max_results: maxResults
  });
  return response.data;
};

export const fetchYouTubePlaylist = async (
  playlistUrl: string,
  maxItems: number = 200
): Promise<YouTubePlaylistResponse> => {
  const response = await api.post<YouTubePlaylistResponse>('/api/youtube/playlist', {
    playlist_url: playlistUrl,
    max_items: maxItems
  });
  return response.data;
};

// ============================================================================
// Media Bridge API
// ============================================================================

export const addMediaSource = async (magnetUrl: string): Promise<AddMediaResponse> => {
  const response = await api.post<AddMediaResponse>('/api/media/add', {
    magnet_url: magnetUrl
  });
  return response.data;
};

export const getMediaStatus = async (mediaId: string): Promise<MediaStatusResponse> => {
  const response = await api.get<MediaStatusResponse>(`/api/media/status/${mediaId}`);
  return response.data;
};

export const getMediaStreamUrl = (mediaId: string, fileIndex: number): string => {
  return `${BACKEND_URL}/api/media/stream/${mediaId}/${fileIndex}`;
};

export const clearAllMedia = async (): Promise<{ success: boolean; message: string }> => {
  const response = await api.post<{ success: boolean; message: string }>('/api/media/clear-all');
  return response.data;
};

// ============================================================================
// Socket.IO Connection
// ============================================================================

export const createSocket = (): Socket<ServerToClientEvents, ClientToServerEvents> => {
  return io(BACKEND_URL, {
    path: '/socket.io/',
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15000,
    reconnectionAttempts: 20,
  });
};

export default api;
