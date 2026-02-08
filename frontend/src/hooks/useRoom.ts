import { useState, useEffect } from 'react';
import { Socket } from 'socket.io-client';
import { createSocket, searchContent, searchYouTube, addMediaSource } from '@/lib/api';
import { logger } from '@/lib/logger';
import type {
  User,
  ChatMessage,
  MediaState,
  MediaStatus,
  ContentSearchResult,
  YouTubeSearchResult
} from '@/types';

export const useRoom = (roomCode: string, userName: string) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [currentMedia, setCurrentMedia] = useState<MediaState>({
    url: '',
    type: 'youtube',
    state: 'paused',
    timestamp: 0,
    loading: false,
  });
  const [contentResults, setContentResults] = useState<ContentSearchResult[]>([]);
  const [mediaStatus, setMediaStatus] = useState<MediaStatus | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Use a state for actual room code to avoid dependency cycles
  const [actualRoomCode, setActualRoomCode] = useState(roomCode);

  useEffect(() => {
    if (!roomCode || !userName) return;

    console.log('🔌 Creating socket connection for room:', roomCode, 'user:', userName);
    const newSocket = createSocket();
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('✅ Socket connected, joining room...');
      setConnected(true);
      newSocket.emit('join_room', { room_code: roomCode, user_name: userName });
    });

    newSocket.on('disconnect', () => {
      console.log('❌ Socket disconnected');
      setConnected(false);
    });

    newSocket.on('error', (error: any) => {
      console.error('🚨 Socket error:', error);

      // If room not found, try to create it (but only once)
      if (error && (error.message === 'Room not found' || error.detail === 'Room not found')) {
        console.log('🏠 Room not found, creating new room:', roomCode);
        newSocket.emit('create_room', { user_name: userName });
      }
    });

    newSocket.on('connect_error', (error: any) => {
      console.error('❌ Socket connection error:', error);
      setConnected(false);
    });

    // Handle users_updated event - backend sends users as object, convert to array
    newSocket.on('users_updated', (data: any) => {
      console.log('👥 Users updated event received:', data);

      // Convert users object to array
      const usersArray = Object.entries(data.users || {}).map(([id, user]: [string, any]) => ({
        id,
        name: user.name,
        is_host: user.is_host,
        can_control: user.can_control || false,
        video_enabled: user.video_enabled || false,
        audio_enabled: user.audio_enabled || false,
      }));

      console.log('👥 Setting users array after update:', usersArray);
      setUsers(usersArray);
    });

    const handleRoomData = (data: any) => {
      console.log(' Successfully joined/created room:', data);

      // Update the actual room code (important for correct sharing)
      if (data.room_code) {
        setActualRoomCode(data.room_code);
      }

      // Convert users object to array if needed (backend sends object)
      let usersArray: User[] = [];
      const rawUsers = data.users || {};

      if (Array.isArray(rawUsers)) {
        usersArray = rawUsers.map(user => ({
          id: user.id || '',
          name: user.name || 'Unknown',
          is_host: user.is_host || false,
          can_control: user.can_control || false,
          video_enabled: user.video_enabled || false,
          audio_enabled: user.audio_enabled || false,
        }));
      } else if (typeof rawUsers === 'object') {
        usersArray = Object.entries(rawUsers).map(([id, user]: [string, any]) => ({
          id,
          name: user.name || 'Unknown',
          is_host: user.is_host || false,
          can_control: user.can_control || false,
          video_enabled: user.video_enabled || false,
          audio_enabled: user.audio_enabled || false,
        }));
      }

      console.log('👥 Setting users array after join/create:', usersArray);
      setUsers(usersArray);

      // Set chat messages (backend might send 'chat' or 'chat_history')
      const rawChat = data.chat || data.chat_history || [];
      if (Array.isArray(rawChat)) {
        setChatMessages(rawChat.map((msg: any) => ({
          id: Date.now() + Math.random(),
          user_name: msg.user_name,
          message: msg.message,
          timestamp: msg.timestamp,
          isServer: msg.is_server || false,
        })));
      }

      // Sync media state
      if (data.media && data.media.url) {
        const m = data.media;
        console.log(' Syncing media state:', m);
        setCurrentMedia({
          url: m.url,
          type: m.type || 'youtube',
          state: m.state || 'paused',
          timestamp: m.timestamp || 0,
          loading: false,
          title: m.title || '',
        });
      }
    };

    newSocket.on('room_joined', handleRoomData);
    newSocket.on('room_created', handleRoomData);

    newSocket.on('new_message', (data: any) => {
      setChatMessages(prev => [...prev, {
        id: Date.now(),
        user_name: data.user_name,
        message: data.message,
        timestamp: data.timestamp,
        isServer: data.is_server || false,
      }]);
    });

    newSocket.on('media_changed', (data: any) => {
      console.log(' Media changed:', data);
      setCurrentMedia({
        url: data.url,
        type: data.type,
        state: 'paused',
        timestamp: 0,
        loading: data.type === 'media',
        title: data.title || '',
      });
    });

    // Listen for media control events to sync state
    newSocket.on('media_control', (data: any) => {
      console.log(' Media control event:', data);
      setCurrentMedia(prev => ({
        ...prev,
        state: data.action === 'play' ? 'playing' : (data.action === 'pause' ? 'paused' : prev.state),
        timestamp: data.timestamp !== undefined ? data.timestamp : prev.timestamp,
        url: data.url || prev.url,
        type: data.type || prev.type,
        title: data.title || prev.title,
      }));
    });

    // Unified play handler
    newSocket.on('media_play', (data: any) => {
      console.log(' ▶️ Media play received:', data);
      setCurrentMedia(prev => ({
        ...prev,
        state: 'playing',
        timestamp: data.timestamp !== undefined ? data.timestamp : prev.timestamp,
      }));
    });

    // Unified pause handler
    newSocket.on('media_pause', (data: any) => {
      console.log(' ⏸️ Media pause received:', data);
      setCurrentMedia(prev => ({
        ...prev,
        state: 'paused',
        timestamp: data.timestamp !== undefined ? data.timestamp : prev.timestamp,
      }));
    });

    // Unified seek handler
    newSocket.on('media_seek', (data: any) => {
      console.log(' ⏭️ Media seek received:', data);
      setCurrentMedia(prev => ({
        ...prev,
        timestamp: data.timestamp,
      }));
    });

    // Update media status (progress)
    newSocket.on('media_progress', (data: any) => {
      setMediaStatus(data);
    });

    return () => {
      console.log('🔌 Disconnecting socket...');
      newSocket.disconnect();
    };
  }, [roomCode, userName]);

  const sendMessage = (message: string) => {
    if (socket && connected) {
      socket.emit('send_message', { message });
    }
  };

  const loadMedia = async (url: string, type: 'youtube' | 'media' | 'direct') => {
    if (socket && connected) {
      if (type === 'media') {
        const response = await addMediaSource(url);
        if (response.success) {
          const streamUrl = `/api/media/stream/${response.media_id}/0`;
          socket.emit('media_control', { action: 'change', url: streamUrl, type: 'media', title: 'P2P Video' });
        }
      } else {
        socket.emit('media_control', { action: 'change', url, type, title: 'YouTube Video' });
      }
    }
  };

  const playPause = (action: 'play' | 'pause', timestamp: number) => {
    if (socket && connected) {
      socket.emit('media_control', { action, timestamp });
    }
  };

  const seekTo = (timestamp: number) => {
    if (socket && connected) {
      socket.emit('media_control', { action: 'seek', timestamp });
    }
  };

  const grantControl = (userId: string, enabled: boolean) => {
    if (socket && connected) {
      socket.emit('grant_control', { user_id: userId, enabled });
    }
  };

  const searchMediaFiles = async (query: string): Promise<ContentSearchResult[]> => {
    setIsSearching(true);
    setHasSearched(false);
    try {
      const results = await searchContent(query);
      const formatted = results.results || [];
      setContentResults(formatted);
      setHasSearched(true);
      return formatted;
    } catch (error) {
      logger.error('Search error', error);
      setHasSearched(true);
      return [];
    } finally {
      setIsSearching(false);
    }
  };

  const searchYouTubeVideos = async (query: string): Promise<ContentSearchResult[]> => {
    setIsSearching(true);
    setHasSearched(false);
    try {
      const results = await searchYouTube(query, 10);
      const formatted: ContentSearchResult[] = results.results.map((video: YouTubeSearchResult) => ({
        title: video.title,
        url: video.url,
        thumbnail: video.thumbnail,
        channel: video.channel,
        videoId: video.id,
        magnet_url: '',
        size: '',
        seeders: 0,
        leechers: 0,
        quality: '',
      }));
      setContentResults(formatted);
      setHasSearched(true);
      return formatted;
    } catch (error) {
      logger.error('YouTube search error', error);
      setHasSearched(true);
      return [];
    } finally {
      setIsSearching(false);
    }
  };

  return {
    socket,
    connected,
    users,
    chatMessages,
    currentMedia,
    contentResults,
    mediaStatus,
    isSearching,
    hasSearched,
    actualRoomCode,
    currentUserId: socket?.id || '',
    sendMessage,
    loadMedia,
    playPause,
    seekTo,
    grantControl,
    searchMediaFiles,
    searchYouTubeVideos,
  };
};