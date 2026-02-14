import { useState, useEffect, useRef, useCallback } from 'react';
import { Socket } from 'socket.io-client';

interface WebRTCConnection {
  userId: string;
  userName: string;
  peerConnection: RTCPeerConnection;
  remoteStream?: MediaStream;
}

interface WebRTCHookOptions {
  socket: Socket | null;
  currentUserId: string;
  users: Array<{ id: string; name: string; video_enabled?: boolean; audio_enabled?: boolean }>;
}

export const useWebRTC = ({ socket, currentUserId, users }: WebRTCHookOptions) => {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [connections, setConnections] = useState<Map<string, WebRTCConnection>>(new Map());
  const [isInitializing, setIsInitializing] = useState(false);

  // Use ref for initialization lock to prevent race conditions
  const initializationLock = useRef<Promise<MediaStream | null> | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const connectionsRef = useRef<Map<string, WebRTCConnection>>(new Map());

  // ICE servers configuration
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  // Initialize local media stream with proper locking
  const initializeLocalStream = useCallback(async (): Promise<MediaStream | null> => {
    // If already initializing, wait for that to complete
    if (initializationLock.current) {
      console.log('⏳ Stream initialization already in progress, waiting...');
      return initializationLock.current;
    }

    // If stream already exists, return it
    if (localStream) {
      console.log('✅ Stream already exists, returning existing stream');
      return localStream;
    }

    console.log('🎥 Starting stream initialization...');
    setIsInitializing(true);

    // Create initialization promise and store it
    const initPromise = (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        });

        console.log('✅ Got media stream:', {
          videoTracks: stream.getVideoTracks().length,
          audioTracks: stream.getAudioTracks().length
        });

        // Initially mute both video and audio
        stream.getVideoTracks().forEach(track => track.enabled = false);
        stream.getAudioTracks().forEach(track => track.enabled = false);

        setLocalStream(stream);

        // Assign to video element if available
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          console.log('📺 Stream assigned to video element');
        }

        return stream;
      } catch (error) {
        console.error('❌ Failed to initialize local stream:', error);
        return null;
      } finally {
        // Clear the lock and initialization state
        initializationLock.current = null;
        setIsInitializing(false);
        console.log('🎥 Stream initialization complete');
      }
    })();

    initializationLock.current = initPromise;
    return initPromise;
  }, [localStream]);

  // Separate video element management
  const setVideoRef = useCallback((element: HTMLVideoElement | null) => {
    localVideoRef.current = element;
    if (element && localStream) {
      console.log('📺 Video element mounted, assigning stream');
      element.srcObject = localStream;
      element.muted = true; // Prevent audio feedback
      element.load();
    }
  }, [localStream]);

  // Create peer connection with proper error handling
  const createPeerConnection = useCallback((userId: string, userName: string): RTCPeerConnection => {
    console.log(`🔗 Creating peer connection for ${userName}`);
    const pc = new RTCPeerConnection({ iceServers });

    // Add local stream tracks if available
    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
        console.log(`➕ Added ${track.kind} track to connection with ${userName}`);
      });
    }

    // Handle remote stream
    pc.ontrack = (event) => {
      console.log(`📥 Received ${event.track.kind} track from ${userName}`);
      const [remoteStream] = event.streams;

      setConnections(prev => {
        const newConnections = new Map(prev);
        const connection = newConnections.get(userId);
        if (connection) {
          connection.remoteStream = remoteStream;
          newConnections.set(userId, connection);
        }
        return newConnections;
      });

      // Update ref immediately
      const connection = connectionsRef.current.get(userId);
      if (connection) {
        connection.remoteStream = remoteStream;
      }
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('webrtc_ice_candidate', {
          target_user_id: userId,
          candidate: event.candidate
        });
      }
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      console.log(`🔌 Connection state with ${userName}: ${pc.connectionState}`);

      // Clean up failed/closed connections
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        console.log(`🗑️ Cleaning up ${pc.connectionState} connection with ${userName}`);
        setConnections(prev => {
          const newConnections = new Map(prev);
          newConnections.delete(userId);
          return newConnections;
        });
        connectionsRef.current.delete(userId);
      }
    };

    return pc;
  }, [localStream, socket]);

  // Create offer to connect to a user
  const createOffer = useCallback(async (userId: string, userName: string) => {
    if (!socket) return;

    console.log(`📤 Creating offer for ${userName}`);

    try {
      const pc = createPeerConnection(userId, userName);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const connection: WebRTCConnection = {
        userId,
        userName,
        peerConnection: pc
      };

      setConnections(prev => new Map(prev.set(userId, connection)));
      connectionsRef.current.set(userId, connection);

      socket.emit('webrtc_offer', {
        target_user_id: userId,
        offer: offer
      });

      console.log(`✅ Offer sent to ${userName}`);
    } catch (error) {
      console.error(`❌ Failed to create offer for ${userName}:`, error);
    }
  }, [socket, createPeerConnection]);

  // Handle incoming offer
  const handleOffer = useCallback(async (fromUserId: string, fromUserName: string, offer: RTCSessionDescriptionInit) => {
    if (!socket) return;

    console.log(`📥 Handling offer from ${fromUserName}`);

    try {
      let connection = connectionsRef.current.get(fromUserId);

      if (connection) {
        const pc = connection.peerConnection;

        // Only handle offer if in appropriate state
        if (pc.signalingState === 'stable') {
          console.log(`🔄 Renegotiation offer from ${fromUserName}`);
        } else if (pc.signalingState !== 'have-local-offer') {
          console.log(`⏭️ Skipping offer from ${fromUserName}, state: ${pc.signalingState}`);
          return;
        }

        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit('webrtc_answer', {
          target_user_id: fromUserId,
          answer: answer
        });

        return;
      }

      // Create new connection
      const pc = createPeerConnection(fromUserId, fromUserName);

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      connection = {
        userId: fromUserId,
        userName: fromUserName,
        peerConnection: pc
      };

      setConnections(prev => new Map(prev.set(fromUserId, connection)));
      connectionsRef.current.set(fromUserId, connection);

      socket.emit('webrtc_answer', {
        target_user_id: fromUserId,
        answer: answer
      });

      console.log(`✅ Answer sent to ${fromUserName}`);
    } catch (error) {
      console.error(`❌ Failed to handle offer from ${fromUserName}:`, error);
    }
  }, [socket, createPeerConnection]);

  // Handle incoming answer
  const handleAnswer = useCallback(async (fromUserId: string, answer: RTCSessionDescriptionInit) => {
    const connection = connectionsRef.current.get(fromUserId);
    if (!connection) {
      console.log(`⚠️ No connection found for answer from ${fromUserId}`);
      return;
    }

    try {
      const pc = connection.peerConnection;
      if (pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        console.log(`✅ Answer handled from ${connection.userName}`);
      } else {
        console.log(`⏭️ Cannot handle answer, state: ${pc.signalingState}`);
      }
    } catch (error) {
      console.error('❌ Failed to handle answer:', error);
    }
  }, []);

  // Handle incoming ICE candidate
  const handleIceCandidate = useCallback(async (fromUserId: string, candidate: RTCIceCandidateInit) => {
    const connection = connectionsRef.current.get(fromUserId);
    if (!connection) return;

    try {
      await connection.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error('❌ Failed to add ICE candidate:', error);
    }
  }, []);

  // Toggle video with proper stream management
  const toggleVideo = useCallback(async () => {
    const newVideoEnabled = !videoEnabled;

    if (newVideoEnabled) {
      // Enabling video
      if (!localStream) {
        console.log('📹 No stream, initializing...');
        const stream = await initializeLocalStream();
        if (stream) {
          stream.getVideoTracks().forEach(track => track.enabled = true);
          setVideoEnabled(true);
        }
        return;
      }

      // Enable existing video tracks
      localStream.getVideoTracks().forEach(track => {
        track.enabled = true;
      });
      setVideoEnabled(true);

      // Notify peers about video enable
      if (socket) {
        socket.emit('toggle_video', { enabled: true });
      }
    } else {
      // Disabling video - just mute tracks, don't close connections
      if (localStream) {
        localStream.getVideoTracks().forEach(track => {
          track.enabled = false;
        });
      }
      setVideoEnabled(false);

      // Notify peers about video disable
      if (socket) {
        socket.emit('toggle_video', { enabled: false });
      }
    }
  }, [videoEnabled, localStream, socket, initializeLocalStream]);

  // Toggle audio with proper stream management
  const toggleAudio = useCallback(async () => {
    const newAudioEnabled = !audioEnabled;

    if (newAudioEnabled) {
      // Enabling audio
      if (!localStream) {
        console.log('🎤 No stream, initializing...');
        const stream = await initializeLocalStream();
        if (stream) {
          stream.getAudioTracks().forEach(track => track.enabled = true);
          setAudioEnabled(true);
        }
        return;
      }

      // Enable existing audio tracks
      localStream.getAudioTracks().forEach(track => {
        track.enabled = true;
      });
      setAudioEnabled(true);

      // Notify peers
      if (socket) {
        socket.emit('toggle_audio', { enabled: true });
      }
    } else {
      // Disabling audio
      if (localStream) {
        localStream.getAudioTracks().forEach(track => {
          track.enabled = false;
        });
      }
      setAudioEnabled(false);

      // Notify peers
      if (socket) {
        socket.emit('toggle_audio', { enabled: false });
      }
    }
  }, [audioEnabled, localStream, socket, initializeLocalStream]);

  // Setup WebRTC event listeners
  useEffect(() => {
    if (!socket) return;

    socket.on('webrtc_offer', ({ from_user_id, from_user_name, offer }) => {
      handleOffer(from_user_id, from_user_name, offer);
    });

    socket.on('webrtc_answer', ({ from_user_id, answer }) => {
      handleAnswer(from_user_id, answer);
    });

    socket.on('webrtc_ice_candidate', ({ from_user_id, candidate }) => {
      handleIceCandidate(from_user_id, candidate);
    });

    return () => {
      socket.off('webrtc_offer');
      socket.off('webrtc_answer');
      socket.off('webrtc_ice_candidate');
    };
  }, [socket, handleOffer, handleAnswer, handleIceCandidate]);

  // Manage connections based on users list
  useEffect(() => {
    if (!socket) return;

    // Create connections for new users
    users.forEach(user => {
      if (user.id !== currentUserId && !connectionsRef.current.has(user.id)) {
        console.log(`👤 New user detected: ${user.name}, creating offer`);
        createOffer(user.id, user.name);
      }
    });

    // Clean up connections for users who left
    const currentUserIds = new Set(users.map(u => u.id));
    connectionsRef.current.forEach((connection, userId) => {
      if (!currentUserIds.has(userId)) {
        console.log(`👋 User ${connection.userName} left, closing connection`);
        connection.peerConnection.close();
        connectionsRef.current.delete(userId);
        setConnections(prev => {
          const newConnections = new Map(prev);
          newConnections.delete(userId);
          return newConnections;
        });
      }
    });
  }, [users, currentUserId, socket, createOffer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      console.log('🧹 Cleaning up WebRTC hook');

      // Stop all tracks
      if (localStream) {
        localStream.getTracks().forEach(track => {
          track.stop();
        });
      }

      // Close all peer connections
      connectionsRef.current.forEach(connection => {
        connection.peerConnection.close();
      });
      connectionsRef.current.clear();
    };
  }, [localStream]);

  return {
    localStream,
    connections,
    videoEnabled,
    audioEnabled,
    isInitializing,
    toggleVideo,
    toggleAudio,
    setVideoRef
  };
};
