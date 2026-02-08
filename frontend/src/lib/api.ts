import axios from 'axios';
import { io, Socket } from 'socket.io-client';
import type {
  ContentSearchResponse,
  YouTubeSearchResponse,
  AddMediaResponse,
  MediaStatusResponse,
  ServerToClientEvents,
  ClientToServerEvents
} from '@/types';

// FastAPI backend URL - adjust this based on your setup
let BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
if (process.env.NEXT_PUBLIC_BACKEND_URL && !BACKEND_URL.startsWith('http')) {
  // If it's just a hostname (from Render's fromService), append .onrender.com
  if (!BACKEND_URL.includes('.')) {
    BACKEND_URL = `https://${BACKEND_URL}.onrender.com`;
  } else {
    BACKEND_URL = `https://${BACKEND_URL}`;
  }
}

// Export BACKEND_URL for use in other modules
export { BACKEND_URL };

// API client
const api = axios.create({
  baseURL: BACKEND_URL,
  timeout: 30000,
});

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
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5,
  });
};

export default api;