import { useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { createSocket, searchContent, searchYouTube, addMediaSource, fetchYouTubePlaylist, BACKEND_URL } from '@/lib/api';
import { logger } from '@/lib/logger';
import type {
  User,
  ChatMessage,
  MediaState,
  MediaStatus,
  ContentSearchResult,
  YouTubeSearchResult,
  QueueItem
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
    is_playlist: false,
    playlist_id: '',
    playlist_title: '',
    playlist_items: [],
    current_index: 0,
    fallback_mode: false,
  });
  const [contentResults, setContentResults] = useState<ContentSearchResult[]>([]);
  const [mediaStatus, setMediaStatus] = useState<MediaStatus | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);

  // Use a state for actual room code to avoid dependency cycles
  const [actualRoomCode, setActualRoomCode] = useState(roomCode);

  // Track whether this is the initial connection or a reconnection
  const hasConnectedRef = useRef(false);

  useEffect(() => {
    if (!roomCode || !userName) return;

    hasConnectedRef.current = false;

    console.log('🔌 Creating socket connection for room:', roomCode, 'user:', userName);
    const newSocket = createSocket();
    setSocket(newSocket);

    newSocket.on('connect', () => {
      if (!hasConnectedRef.current) {
        // First connection: join the room
        console.log('✅ Socket connected, joining room...');
        hasConnectedRef.current = true;
        newSocket.emit('join_room', { room_code: roomCode, user_name: userName });
      } else {
        // Reconnection: backend should still have session within 30s grace period
        console.log('✅ Socket reconnected, relying on backend session');
      }
      setConnected(true);
    });

    // Handle reconnection after grace period expired (re-join needed)
    newSocket.io.on('reconnect', () => {
      console.log('🔄 Socket.IO reconnect event, re-joining room...');
      newSocket.emit('join_room', { room_code: roomCode, user_name: userName });
    });

    newSocket.on('disconnect', () => {
      console.log('❌ Socket disconnected');
      setConnected(false);
    });

    newSocket.on('error', (error: any) => {
      console.error('🚨 Socket error:', error);

      const errorMsg = error?.message || error?.detail || '';

      // If room not found, try to create it (but only once)
      if (errorMsg === 'Room not found') {
        console.log('🏠 Room not found, creating new room:', roomCode);
        newSocket.emit('create_room', { user_name: userName, room_code: roomCode });
      } else if (errorMsg) {
        setRoomError(errorMsg);
      }
    });

    newSocket.on('room_error', (error: any) => {
      console.error('🚨 Room error:', error);
      const errorMsg = error?.message || error?.detail || 'An unknown error occurred';
      setRoomError(errorMsg);
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

        // Update URL to match actual room code if it changed (e.g. initial creation)
        if (typeof window !== 'undefined' && data.room_code !== roomCode) {
          const currentUrl = new URL(window.location.href);
          currentUrl.pathname = `/room/${data.room_code}`;
          window.history.replaceState({}, '', currentUrl.toString());
          console.log('📍 Updated URL to match actual room code:', data.room_code);
        }
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
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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
          is_playlist: !!m.is_playlist,
          playlist_id: m.playlist_id || '',
          playlist_title: m.playlist_title || '',
          playlist_items: m.playlist_items || [],
          current_index: m.current_index || 0,
          fallback_mode: !!m.fallback_mode,
        });
      }

      // Sync queue state
      if (data.queue && Array.isArray(data.queue)) {
        setQueue(data.queue);
      }
    };

    newSocket.on('room_joined', handleRoomData);
    newSocket.on('room_created', handleRoomData);

    newSocket.on('new_message', (data: any) => {
      setChatMessages(prev => [...prev, {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        message_id: data.message_id,
        user_name: data.user_name,
        message: data.message,
        timestamp: data.timestamp,
        isServer: data.is_server || false,
        reactions: data.reactions || {},
      }]);
    });

    newSocket.on('reaction_updated', (data: { message_id: string; reactions: Record<string, string[]> }) => {
      setChatMessages(prev => prev.map(msg =>
        msg.message_id === data.message_id
          ? { ...msg, reactions: data.reactions }
          : msg
      ));
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
        is_playlist: !!data.is_playlist,
        playlist_id: data.playlist_id || '',
        playlist_title: data.playlist_title || '',
        playlist_items: data.playlist_items || [],
        current_index: data.current_index || 0,
        fallback_mode: !!data.fallback_mode,
      });
    });

    newSocket.on('playlist_updated', (data: any) => {
      setCurrentMedia(prev => ({
        ...prev,
        is_playlist: true,
        playlist_id: data.playlist_id || prev.playlist_id,
        playlist_title: data.playlist_title || prev.playlist_title,
        playlist_items: data.playlist_items || prev.playlist_items || [],
        current_index: typeof data.current_index === 'number' ? data.current_index : (prev.current_index || 0),
      }));
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
      setMediaStatus(data?.media_status || null);
    });

    // Handle user joined
    newSocket.on('user_joined', (data: any) => {
      console.log('👤 User joined:', data);
      if (data.user) {
        setUsers(prev => {
          // Avoid duplicates
          if (prev.some(u => u.id === data.user.id)) return prev;
          return [...prev, {
            id: data.user.id,
            name: data.user.name,
            is_host: data.user.is_host || false,
            can_control: data.user.can_control || false,
            video_enabled: data.user.video_enabled || false,
            audio_enabled: data.user.audio_enabled || false,
          }];
        });
      }
    });

    // Handle user left
    newSocket.on('user_left', (data: any) => {
      console.log('👤 User left:', data);
      if (data.user_id) {
        setUsers(prev => prev.filter(u => u.id !== data.user_id));
      }
    });

    // Handle media loading indicator
    newSocket.on('media_loading', (data: any) => {
      console.log('⏳ Media loading:', data);
      setCurrentMedia(prev => ({
        ...prev,
        loading: data.loading !== undefined ? data.loading : true,
      }));
    });

    // Handle queue updates
    newSocket.on('queue_updated', (data: any) => {
      console.log('📋 Queue updated:', data);
      if (data.queue && Array.isArray(data.queue)) {
        setQueue(data.queue);
      }
    });

    return () => {
      console.log('🔌 Disconnecting socket...');
      // Remove all event listeners before disconnecting
      newSocket.off('connect');
      newSocket.off('disconnect');
      newSocket.off('error');
      newSocket.off('connect_error');
      newSocket.off('users_updated');
      newSocket.off('room_joined');
      newSocket.off('room_created');
      newSocket.off('new_message');
      newSocket.off('media_changed');
      newSocket.off('playlist_updated');
      newSocket.off('media_control');
      newSocket.off('media_play');
      newSocket.off('media_pause');
      newSocket.off('media_seek');
      newSocket.off('media_progress');
      newSocket.off('user_joined');
      newSocket.off('user_left');
      newSocket.off('media_loading');
      newSocket.off('queue_updated');
      newSocket.off('reaction_updated');
      newSocket.off('room_error');
      newSocket.io.off('reconnect');
      newSocket.disconnect();
    };
  }, [roomCode, userName]);

  const sendMessage = (message: string) => {
    if (socket && connected) {
      socket.emit('send_message', { message });
    }
  };

  const toggleReaction = (messageId: string, emoji: string) => {
    if (socket && connected) {
      socket.emit('toggle_reaction', { message_id: messageId, emoji });
    }
  };

  const loadMedia = async (url: string, type: 'youtube' | 'media' | 'direct' | 'youtube_playlist') => {
    if (socket && connected) {
      if (type === 'media') {
        const response = await addMediaSource(url);
        if (!socket?.connected) return;
        if (response.success) {
          const fileIndex = response.status?.largest_file?.index ?? 0;
          const streamUrl = `${BACKEND_URL}/api/media/stream/${response.media_id}/${fileIndex}`;
          socket.emit('media_control', { action: 'change', url: streamUrl, type: 'media', title: 'P2P Video' });
        }
      } else if (type === 'youtube_playlist') {
        try {
          const playlist = await fetchYouTubePlaylist(url, 200);
          if (!socket?.connected) return;
          if (playlist.enabled && playlist.items && playlist.items.length > 0 && !playlist.fallback_mode) {
            socket.emit('media_control', {
              action: 'load_playlist',
              playlist_id: playlist.playlist_id,
              playlist_title: playlist.playlist_title,
              items: playlist.items,
            });
          } else {
            // Graceful fallback: load playlist URL directly in YouTube player.
            socket.emit('media_control', {
              action: 'change',
              url,
              type: 'youtube',
              title: 'YouTube Playlist',
            });
          }
        } catch (error) {
          logger.warn('Playlist expansion failed, falling back to native playlist URL', error);
          if (!socket?.connected) return;
          socket.emit('media_control', {
            action: 'change',
            url,
            type: 'youtube',
            title: 'YouTube Playlist',
          });
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

  const playlistNext = () => {
    if (socket && connected) {
      socket.emit('media_control', { action: 'playlist_next' });
    }
  };

  const playlistPrev = () => {
    if (socket && connected) {
      socket.emit('media_control', { action: 'playlist_prev' });
    }
  };

  const playlistSelect = (index: number) => {
    if (socket && connected) {
      socket.emit('media_control', { action: 'playlist_select', index });
    }
  };

  const addToQueue = (url: string, title: string, mediaType: string, thumbnail?: string) => {
    if (socket && connected) {
      socket.emit('queue_add', { url, title, media_type: mediaType, thumbnail });
    }
  };

  const removeFromQueue = (itemId: string) => {
    if (socket && connected) {
      socket.emit('queue_remove', { item_id: itemId });
    }
  };

  const reorderQueue = (itemId: string, newIndex: number) => {
    if (socket && connected) {
      socket.emit('queue_reorder', { item_id: itemId, new_index: newIndex });
    }
  };

  const playNextFromQueue = () => {
    if (socket && connected) {
      socket.emit('queue_play_next', {});
    }
  };

  const clearQueue = () => {
    if (socket && connected) {
      socket.emit('queue_clear', {});
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
    roomError,
    actualRoomCode,
    currentUserId: socket?.id || '',
    sendMessage,
    toggleReaction,
    loadMedia,
    playPause,
    seekTo,
    grantControl,
    playlistNext,
    playlistPrev,
    playlistSelect,
    queue,
    addToQueue,
    removeFromQueue,
    reorderQueue,
    playNextFromQueue,
    clearQueue,
    searchMediaFiles,
    searchYouTubeVideos,
  };
};
