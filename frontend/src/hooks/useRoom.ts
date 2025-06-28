import { useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { createSocket, searchTorrents, addTorrent, getTorrentStatus, getTorrentStreamUrl } from '@/lib/api';

interface User {
  id: string;
  name: string;
  isHost: boolean;
}

interface ChatMessage {
  id: number;
  user_name: string;
  message: string;
  timestamp: string;
  isServer: boolean;
}

interface MediaState {
  url: string;
  type: 'youtube' | 'torrent' | 'direct';
  state: 'playing' | 'paused';
  timestamp: number;
  loading: boolean;
  title?: string;
}

interface TorrentResult {
  id: string;
  name: string;
  size: string;
  seeders: number;
  leechers: number;
  magnet_url: string;
  compatibility: 'Compatible' | 'UDP Only';
}

interface TorrentStatus {
  torrent_id: string;
  status: 'downloading' | 'completed' | 'failed';
  progress: number;
  file_progress?: number;
  streaming_ready: boolean;
  streaming_threshold?: number;
  files?: Array<{ index: number; path?: string; name?: string; size: number; is_video?: boolean }>;
}

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
  const [torrentResults, setTorrentResults] = useState<TorrentResult[]>([]);
  const [torrentStatus, setTorrentStatus] = useState<TorrentStatus | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [activeTorrentId, setActiveTorrentId] = useState<string | null>(null);
  
  // Track the actual room code returned by backend (may differ from URL parameter)
  const [actualRoomCode, setActualRoomCode] = useState<string>(roomCode);
  
  // Track if we've already initialized to prevent multiple socket connections
  const socketInitialized = useRef(false);
  
  // Track if we've already attempted room creation to prevent duplicates
  const roomCreationAttempted = useRef(false);
  
  // Track last action for UI feedback
  const [lastAction, setLastAction] = useState<{ type: string; user: string; timestamp: number } | null>(null);

  // Initialize socket connection
  useEffect(() => {
    console.log('🏗️ useRoom useEffect called:', { roomCode, userName, socketInitialized: socketInitialized.current, hasSocket: !!socket });
    
    if (!roomCode || !userName) {
      console.log('❌ Skipping socket creation: missing roomCode or userName');
      return;
    }

    if (socketInitialized.current) {
      console.log('⏳ Socket already initialized, skipping...');
      return;
    }

    if (socket && socket.connected) {
      console.log('✅ Socket already connected, skipping creation');
      return;
    }

    socketInitialized.current = true;
    console.log('🔌 Creating new socket connection...');

    // Clean up existing socket if any
    if (socket) {
      console.log('🧹 Cleaning up existing socket before creating new one');
      socket.disconnect();
    }

    const newSocket = createSocket(roomCode, userName);

    // Socket event handlers
    newSocket.on('connect', () => {
      console.log('Connected to server');
      setConnected(true);

      // Manually emit join_room here as well to ensure it happens
      if (roomCode && userName) {
        console.log('🔗 Manually joining room:', roomCode, 'as user:', userName);
        newSocket.emit('join_room', { room_code: roomCode, user_name: userName });
      }
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from server');
      setConnected(false);
    });

    newSocket.on('error', (error: any) => {
      console.error('🚨 Socket error:', error);
      console.error('🚨 Error type:', typeof error);
      console.error('🚨 Error keys:', Object.keys(error || {}));
      console.error('🚨 Error stringified:', JSON.stringify(error));

      // If room not found, try to create it (but only once)
      if (error && (error.message === 'Room not found' || error.detail === 'Room not found')) {
        if (!roomCreationAttempted.current) {
          console.log('🆕 Room not found, creating new room...');
          roomCreationAttempted.current = true;
          newSocket.emit('create_room', { user_name: userName });
        } else {
          console.log('⏳ Room creation already attempted, skipping...');
        }
      }
    });

    newSocket.on('user_joined', (data: any) => {
      // Don't replace users array here, let users_updated handle it
      setChatMessages(prev => [...prev, {
        id: Date.now(),
        user_name: 'Server',
        message: `${data.user_name} joined the room`,
        timestamp: new Date().toISOString(),
        isServer: true,
      }]);
    });

    newSocket.on('user_left', (data: any) => {
      // Don't replace users array here, let users_updated handle it
      setChatMessages(prev => [...prev, {
        id: Date.now(),
        user_name: 'Server',
        message: `${data.user_name} left the room`,
        timestamp: new Date().toISOString(),
        isServer: true,
      }]);
    });

    newSocket.on('users_updated', (data: any) => {
      const usersArray = Object.entries(data.users).map(([id, user]: [string, any]) => ({
        id,
        name: user.name,
        isHost: user.is_host,
      })) as User[];
      setUsers(usersArray);
    });

    newSocket.on('room_joined', (data: any) => {
      console.log('🎉 Successfully joined room:', data);
      console.log('📺 Room media state:', data.media);
      
      // Update the actual room code (important for correct sharing)
      if (data.room_code) {
        setActualRoomCode(data.room_code);
      }
      
      // Set users
      const usersArray = Object.entries(data.users).map(([id, user]: [string, any]) => ({
        id,
        name: user.name,
        isHost: user.is_host,
      })) as User[];
      setUsers(usersArray);
      
      // Set chat messages
      setChatMessages(data.chat.map((msg: any) => ({
        id: Date.now() + Math.random(),
        user_name: msg.user_name,
        message: msg.message,
        timestamp: msg.timestamp,
        isServer: msg.is_server || false,
      })));
      
      // Sync media state - critical for new users joining rooms with active media
      if (data.media && data.media.url) {
        console.log('🔄 Syncing media state for new user:', {
          url: data.media.url,
          type: data.media.type,
          state: data.media.state,
          timestamp: data.media.timestamp
        });
        setCurrentMedia({
          url: data.media.url,
          type: data.media.type,
          state: data.media.state || 'paused',
          timestamp: data.media.timestamp || 0,
          loading: false,
        });
      } else {
        console.log('📺 No active media in room');
      }
    });

    newSocket.on('new_message', (data: any) => {
      console.log('🔔 Received new_message event:', data);
      setChatMessages(prev => [...prev, {
        id: Date.now(),
        user_name: data.user_name,
        message: data.message,
        timestamp: data.timestamp,
        isServer: data.is_server || false,
      }]);
    });

    newSocket.on('media_changed', (data: any) => {
      console.log('📺 Media changed event received:', data);
      console.log('📺 New media URL:', data.url);
      console.log('📺 Media type:', data.type);
      
      // For torrent media, preserve the loading/torrent status briefly to show progress
      const shouldKeepTorrentStatus = data.type === 'torrent' && data.url.includes('/api/torrent/stream/');
      
      setCurrentMedia({
        url: data.url,
        type: data.type,
        state: 'paused',
        timestamp: 0,
        loading: shouldKeepTorrentStatus, // Keep loading for torrent streams briefly
        title: data.title || '',
      });
      
      // If this is a torrent stream, clear results and loading after a short delay
      if (shouldKeepTorrentStatus) {
        console.log('🔄 Torrent stream ready, clearing results and will clear loading in 2 seconds...');
        // Clear torrent results immediately since stream is ready
        setTorrentResults([]);
        setHasSearched(false);
        
        setTimeout(() => {
          console.log('✅ Clearing torrent loading state');
          setCurrentMedia(prev => ({ ...prev, loading: false }));
          // Don't clear torrentStatus - let it persist to show final state
        }, 2000);
      }
    });

    newSocket.on('media_loading', (data: any) => {
      console.log('⏳ Media loading event received:', data);
      console.log('🔍 Current torrentStatus before loading event:', torrentStatus);
      console.log('🔍 Current media state before loading event:', currentMedia);
      
      setCurrentMedia(prev => {
        console.log('🔍 Setting media loading state, prev:', prev);
        const newState = {
          ...prev,
          loading: true,
          title: data.title || 'Loading media...',
          type: data.type || prev.type,
        };
        console.log('🔍 New media state after loading event:', newState);
        return newState;
      });
      console.log('🔍 After media_loading, torrentStatus should still exist:', torrentStatus);
    });

    newSocket.on('torrent_progress', (data: any) => {
      console.log('📊 Torrent progress event received:', data);
      console.log('📊 Current user who initiated torrent:', activeTorrentId);
      console.log('📊 Progress data received:', {
        progress: data.torrent_status?.progress,
        file_progress: data.torrent_status?.file_progress,
        status: data.torrent_status?.status,
        streaming_ready: data.torrent_status?.streaming_ready
      });
      
      if (data.torrent_status) {
        console.log('📊 Updating torrent status for all users:', data.torrent_status);
        setTorrentStatus(data.torrent_status);
        
        // Also log after setting to verify it took effect
        setTimeout(() => {
          console.log('📊 TorrentStatus after update should be:', data.torrent_status);
        }, 100);
      } else {
        console.warn('📊 No torrent_status in progress event:', data);
      }
    });

    newSocket.on('media_play', (data: any) => {
      console.log('▶️ Media play event received:', data);
      setLastAction({ type: 'play', user: data.user_name, timestamp: Date.now() });
      setCurrentMedia(prev => {
        const newState = {
          ...prev,
          state: 'playing' as const,
          timestamp: data.timestamp,
        };
        console.log('📱 Updating currentMedia to PLAYING:', {
          from: { state: prev.state, timestamp: prev.timestamp },
          to: { state: newState.state, timestamp: newState.timestamp }
        });
        return newState;
      });
    });

    newSocket.on('media_pause', (data: any) => {
      console.log('⏸️ Media pause event received:', data);
      setLastAction({ type: 'pause', user: data.user_name, timestamp: Date.now() });
      setCurrentMedia(prev => {
        const newState = {
          ...prev,
          state: 'paused' as const,
          timestamp: data.timestamp,
        };
        console.log('📱 Updating currentMedia to PAUSED:', {
          from: { state: prev.state, timestamp: prev.timestamp },
          to: { state: newState.state, timestamp: newState.timestamp }
        });
        return newState;
      });
    });

    newSocket.on('media_seek', (data: any) => {
      console.log('⏭️ Media seek event received:', data);
      setLastAction({ type: 'seek', user: data.user_name, timestamp: Date.now() });
      setCurrentMedia(prev => {
        const newState = {
          ...prev,
          timestamp: data.timestamp,
        };
        console.log('📱 Updating currentMedia SEEK:', {
          from: { timestamp: prev.timestamp },
          to: { timestamp: newState.timestamp }
        });
        return newState;
      });
    });

    newSocket.on('room_created', (data: any) => {
      console.log('🎉 Room created successfully:', data);
      // After creating room, immediately join it using the ACTUAL room code returned
      // This handles cases where auto-created room has different code than URL
      console.log('🔄 Joining newly created room:', data.room_code, 'vs URL roomCode:', roomCode);
      newSocket.emit('join_room', { room_code: data.room_code, user_name: userName });
      
      // Update the actual room code state so UI shows correct code
      setActualRoomCode(data.room_code);
      
      // Update URL to reflect the actual room code if different
      if (data.room_code !== roomCode) {
        console.log('🌐 Updating URL to reflect actual room code:', data.room_code);
        window.history.replaceState(null, '', `/room/${data.room_code}?name=${encodeURIComponent(userName)}`);
      }
    });

    newSocket.on('connect_error', (error: any) => {
      console.error('🔥 Socket connection error:', error);
    });

    newSocket.connect();
    setSocket(newSocket);

    return () => {
      console.log('🧹 Cleaning up socket connection');
      socketInitialized.current = false;
      roomCreationAttempted.current = false;
      newSocket.disconnect();
    };
  }, [roomCode, userName]);

  // Auto-clear last action after 3 seconds
  useEffect(() => {
    if (lastAction) {
      const timer = setTimeout(() => {
        setLastAction(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [lastAction]);

  // Functions
  const sendMessage = (message: string) => {
    if (socket && message.trim()) {
      console.log('📤 Sending message:', message.trim(), 'Socket connected:', socket.connected, 'Socket ID:', socket.id);
      socket.emit('send_message', { message: message.trim() });
    } else {
      console.error('❌ Cannot send message: Socket not connected or message empty', { socket: !!socket, connected: socket?.connected, message });
    }
  };

  const loadMedia = async (url: string, type: 'youtube' | 'torrent' | 'direct') => {
    if (!socket) return;

    setCurrentMedia(prev => ({ ...prev, loading: true }));

    if (type === 'torrent') {
      try {
        // Emit loading state to all users immediately, before starting torrent
        console.log('🚀 Emitting start_loading to all users immediately');
        socket.emit('media_control', {
          action: 'start_loading',
          type: 'torrent',
          title: 'Starting torrent download...',
          user_name: userName
        });

        // Add torrent to bridge
        const result = await addTorrent(url);

        if (result.success) {
          setActiveTorrentId(result.torrent_id);
          console.log('🎯 Started torrent:', result.torrent_id);
          
          // Monitor torrent progress
          const monitorProgress = setInterval(async () => {
            try {
              const status = await getTorrentStatus(result.torrent_id);
              console.log('🔄 Torrent status update:', {
                torrent_id: result.torrent_id,
                status: status.status,
                progress: status.progress,
                file_progress: status.file_progress,
                streaming_ready: status.streaming_ready
              });
              setTorrentStatus(status);
              
              // Broadcast progress to all users in the room
              socket.emit('media_control', {
                action: 'torrent_progress',
                torrent_status: status,
                user_name: userName
              });

              if (status.streaming_ready) {
                console.log('🎉 Torrent streaming ready! Files:', status.files);
                // Get the first video file
                const videoFile = status.files?.find((f: { path?: string; name?: string }) => {
                  const fileName = f.path || f.name || '';
                  return fileName.toLowerCase().match(/\.(mp4|mkv|avi|mov|webm)$/);
                });

                if (videoFile) {
                  const streamUrl = getTorrentStreamUrl(result.torrent_id, videoFile.index);
                  const fileName = videoFile.path || videoFile.name || 'unknown';
                  console.log('📺 Starting stream for file:', fileName);
                  console.log('📺 Emitting media_control with stream URL:', streamUrl);
                  
                  // Extract clean title from filename
                  const cleanTitle = fileName.split('/').pop()?.replace(/\.(mp4|mkv|avi|mov|webm)$/i, '') || fileName;
                  
                  socket.emit('media_control', {
                    action: 'change_media',
                    url: streamUrl,
                    type: 'torrent',
                    title: cleanTitle,
                    timestamp: 0
                  });
                  clearInterval(monitorProgress);
                  console.log('✅ Torrent stream started, waiting for media_changed event...');
                  // Keep loading state until media_changed event is received
                } else {
                  console.warn('⚠️ No video file found in torrent:', status.files);
                }
              } else {
                console.log('📊 Torrent progress:', {
                  status: status.status,
                  progress: Math.round(status.progress * 100) + '%',
                  file_progress: status.file_progress ? Math.round(status.file_progress * 100) + '%' : 'N/A',
                  streaming_ready: status.streaming_ready
                });
              }

              if (status.status === 'failed') {
                console.error('❌ Torrent failed:', status);
                clearInterval(monitorProgress);
                setCurrentMedia(prev => ({ ...prev, loading: false }));
              }
            } catch (error) {
              console.error('❌ Error monitoring torrent progress:', error);
              clearInterval(monitorProgress);
              setCurrentMedia(prev => ({ ...prev, loading: false }));
            }
          }, 2000);
        }
      } catch {
        setCurrentMedia(prev => ({ ...prev, loading: false }));
      }
    } else {
      socket.emit('media_control', {
        action: 'change_media',
        url,
        type,
        timestamp: 0
      });
    }
  };

  const playPause = (action: 'play' | 'pause', timestamp: number = 0) => {
    if (socket) {
      socket.emit('media_control', { action, timestamp });
    }
  };

  const seekTo = (timestamp: number) => {
    if (socket) {
      socket.emit('media_control', { action: 'seek', timestamp });
    }
  };

  const searchTorrentFiles = async (query: string): Promise<TorrentResult[]> => {
    setIsSearching(true);
    setTorrentResults([]); // Clear previous results
    setHasSearched(false); // Reset search state
    try {
      const results = await searchTorrents(query);
      console.log('🔍 Search API response:', results);
      console.log('🔍 Results array:', results.results);
      console.log('🔍 Results count:', results.count);
      interface RawTorrentResult {
        id?: string;
        hash?: string;
        title?: string;  // Backend uses 'title'
        name?: string;   // Keep both for compatibility
        size: string;
        seeders?: number;
        leechers?: number;
        magnet_url: string;
      }

      const formattedResults: TorrentResult[] = (results.results || [])
        .filter((result: RawTorrentResult) => (result.title || result.name) && (result.title || result.name)?.trim()) // Filter out results without names
        .map((result: RawTorrentResult) => {
          console.log('🔍 Processing result:', result);
          return {
            id: result.id || result.hash || `${Date.now()}-${Math.random()}`,
            name: result.title || result.name || 'Unknown',
            size: result.size || 'Unknown',
            seeders: result.seeders || 0,
            leechers: result.leechers || 0,
            magnet_url: result.magnet_url || '',
            compatibility: (result.magnet_url && result.magnet_url.includes('udp://')) ? 'UDP Only' : 'Compatible',
          };
        });
      setTorrentResults(formattedResults);
      setHasSearched(true); // Mark that a search has been completed
      return formattedResults;
    } catch (error) {
      console.error('Torrent search error:', error);
      setTorrentResults([]);
      setHasSearched(true); // Mark that a search has been completed (even if it failed)
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
    torrentResults,
    torrentStatus,
    isSearching,
    hasSearched,
    activeTorrentId,
    lastAction,
    actualRoomCode,
    sendMessage,
    loadMedia,
    playPause,
    seekTo,
    searchTorrentFiles,
  };
};