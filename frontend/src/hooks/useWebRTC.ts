import { useState, useEffect, useRef, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import type { WebRTCConnection } from '@/hooks/useWebRTC.types';
import { resolveGlareAction, shouldCleanupOnIceState, stopVideoChatInOrder } from '@/lib/webrtcHelpers';

// Re-export so existing importers see the same symbol via useWebRTC.
export type { WebRTCConnection };

interface WebRTCHookOptions {
  socket: Socket | null;
  currentUserId: string;
  users: Array<{ id: string; name: string; video_enabled?: boolean; audio_enabled?: boolean }>;
}

export const useWebRTC = ({ socket, currentUserId, users }: WebRTCHookOptions) => {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [connections, setConnections] = useState<Map<string, WebRTCConnection>>(new Map());
  const [isInitializing, setIsInitializing] = useState(false);

  const initializationLock = useRef<Promise<MediaStream | null> | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const connectionsRef = useRef<Map<string, WebRTCConnection>>(new Map());
  const isActiveRef = useRef(false);

  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  // Initialize local media stream with proper locking
  const initializeLocalStream = useCallback(async (): Promise<MediaStream | null> => {
    if (initializationLock.current) {
      return initializationLock.current;
    }

    if (localStream) {
      return localStream;
    }

    setIsInitializing(true);

    const initPromise = (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        });

        // Start with tracks enabled since user is actively joining
        stream.getVideoTracks().forEach(track => track.enabled = true);
        stream.getAudioTracks().forEach(track => track.enabled = true);

        localStreamRef.current = stream;
        setLocalStream(stream);

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          localVideoRef.current.play().catch(() => {});
        }

        return stream;
      } catch (error) {
        console.error('Failed to initialize local stream:', error);
        return null;
      } finally {
        initializationLock.current = null;
        setIsInitializing(false);
      }
    })();

    initializationLock.current = initPromise;
    return initPromise;
  }, [localStream]);

  const setVideoRef = useCallback((element: HTMLVideoElement | null) => {
    localVideoRef.current = element;
    const stream = localStreamRef.current;
    if (element && stream) {
      element.srcObject = stream;
      element.muted = true;
      element.play().catch(() => {});
    }
  }, []);

  // Create peer connection
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const createPeerConnection = useCallback((userId: string, _userName: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection({ iceServers });

    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;

      setConnections(prev => {
        const newConnections = new Map(prev);
        const connection = newConnections.get(userId);
        if (connection) {
          newConnections.set(userId, { ...connection, remoteStream });
        }
        return newConnections;
      });

      const connection = connectionsRef.current.get(userId);
      if (connection) {
        connectionsRef.current.set(userId, { ...connection, remoteStream });
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('webrtc_ice_candidate', {
          target_user_id: userId,
          candidate: event.candidate
        });
      }
    };

    const dropConnection = () => {
      setConnections(prev => {
        const newConnections = new Map(prev);
        newConnections.delete(userId);
        return newConnections;
      });
      connectionsRef.current.delete(userId);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        dropConnection();
      }
    };

    // Also drop on ICE-layer failures. Browsers don't always bubble
    // `disconnected` up to `connectionState=failed` fast enough, so the
    // tile can linger showing a frozen frame. See bug #4.4 in
    // docs/polishing/04-webrtc-video-chat.md.
    pc.oniceconnectionstatechange = () => {
      if (shouldCleanupOnIceState(pc.iceConnectionState)) {
        dropConnection();
      }
    };

    return pc;
  }, [localStream, socket]);

  // Create offer to connect to a user
  const createOffer = useCallback(async (userId: string, userName: string) => {
    if (!socket) return;

    try {
      const pc = createPeerConnection(userId, userName);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const connection: WebRTCConnection = {
        userId,
        userName,
        peerConnection: pc
      };

      setConnections(prev => { const m = new Map(prev); m.set(userId, connection); return m; });
      connectionsRef.current.set(userId, connection);

      socket.emit('webrtc_offer', {
        target_user_id: userId,
        offer: offer
      });
    } catch (error) {
      console.error(`Failed to create offer for ${userName}:`, error);
    }
  }, [socket, createPeerConnection]);

  // Handle incoming offer
  const handleOffer = useCallback(async (fromUserId: string, fromUserName: string, offer: RTCSessionDescriptionInit) => {
    if (!socket) return;

    // If we're not active, auto-activate to accept the incoming call
    if (!isActiveRef.current) {
      const stream = await initializeLocalStream();
      if (!stream) return;

      stream.getVideoTracks().forEach(track => track.enabled = true);
      stream.getAudioTracks().forEach(track => track.enabled = true);

      setVideoEnabled(true);
      setAudioEnabled(true);
      setIsActive(true);
      isActiveRef.current = true;

      socket.emit('toggle_video', { enabled: true });
      socket.emit('toggle_audio', { enabled: true });
    }

    try {
      let connection = connectionsRef.current.get(fromUserId);

      if (connection) {
        const pc = connection.peerConnection;

        // Explicit decision for every signaling state (bug #4.3).
        const action = resolveGlareAction({
          signalingState: pc.signalingState,
          currentUserId,
          fromUserId,
        });

        if (action === 'ignore') {
          return;
        }

        if (action === 'accept' || action === 'rollback-accept') {
          if (action === 'rollback-accept') {
            await pc.setLocalDescription({ type: 'rollback' });
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

        // action === 'create-new' falls through to the fresh-PC path below.
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

      setConnections(prev => { const m = new Map(prev); m.set(fromUserId, connection); return m; });
      connectionsRef.current.set(fromUserId, connection);

      socket.emit('webrtc_answer', {
        target_user_id: fromUserId,
        answer: answer
      });
    } catch (error) {
      console.error(`Failed to handle offer from ${fromUserName}:`, error);
    }
  }, [socket, createPeerConnection, currentUserId, initializeLocalStream]);

  // Handle incoming answer
  const handleAnswer = useCallback(async (fromUserId: string, answer: RTCSessionDescriptionInit) => {
    const connection = connectionsRef.current.get(fromUserId);
    if (!connection) return;

    try {
      const pc = connection.peerConnection;
      if (pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    } catch (error) {
      console.error('Failed to handle answer:', error);
    }
  }, []);

  // Handle incoming ICE candidate
  const handleIceCandidate = useCallback(async (fromUserId: string, candidate: RTCIceCandidateInit) => {
    const connection = connectionsRef.current.get(fromUserId);
    if (!connection) return;

    try {
      await connection.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error('Failed to add ICE candidate:', error);
    }
  }, []);

  // Start video chat: initialize stream, enable tracks, connect to peers
  const startVideoChat = useCallback(async () => {
    const stream = await initializeLocalStream();
    if (!stream) return;

    stream.getVideoTracks().forEach(track => track.enabled = true);
    stream.getAudioTracks().forEach(track => track.enabled = true);

    setVideoEnabled(true);
    setAudioEnabled(true);
    setIsActive(true);
    isActiveRef.current = true;

    if (socket) {
      socket.emit('toggle_video', { enabled: true });
      socket.emit('toggle_audio', { enabled: true });
    }

    // Connect to all other users who are in the room
    users.forEach(user => {
      if (user.id !== currentUserId && !connectionsRef.current.has(user.id)) {
        createOffer(user.id, user.name);
      }
    });
  }, [initializeLocalStream, socket, users, currentUserId, createOffer]);

  // Stop video chat: emit toggle events BEFORE tearing down tracks and
  // peer connections (bug #4.2) — remote peers flip their UI on the
  // socket events; closing first causes a brief "disconnected" flicker.
  const stopVideoChat = useCallback(() => {
    stopVideoChatInOrder({
      socket,
      stream: localStream,
      connections: connectionsRef.current,
    });

    localStreamRef.current = null;
    setLocalStream(null);
    setConnections(new Map());

    setVideoEnabled(false);
    setAudioEnabled(false);
    setIsActive(false);
    isActiveRef.current = false;
  }, [localStream, socket]);

  // Toggle video track
  const toggleVideo = useCallback(async () => {
    if (!isActive || !localStream) return;

    const newEnabled = !videoEnabled;
    localStream.getVideoTracks().forEach(track => {
      track.enabled = newEnabled;
    });
    setVideoEnabled(newEnabled);

    if (socket) {
      socket.emit('toggle_video', { enabled: newEnabled });
    }
  }, [videoEnabled, localStream, isActive, socket]);

  // Toggle audio track
  const toggleAudio = useCallback(async () => {
    if (!isActive || !localStream) return;

    const newEnabled = !audioEnabled;
    localStream.getAudioTracks().forEach(track => {
      track.enabled = newEnabled;
    });
    setAudioEnabled(newEnabled);

    if (socket) {
      socket.emit('toggle_audio', { enabled: newEnabled });
    }
  }, [audioEnabled, localStream, isActive, socket]);

  // Sync localStream to video element when both are available
  useEffect(() => {
    if (localStream && localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play().catch(() => {});
    }
  }, [localStream]);

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

  // When active, connect to new users who join the room
  useEffect(() => {
    if (!socket || !isActive) return;

    users.forEach(user => {
      if (user.id !== currentUserId && !connectionsRef.current.has(user.id)) {
        createOffer(user.id, user.name);
      }
    });

    // Clean up connections for users who left
    const currentUserIds = new Set(users.map(u => u.id));
    connectionsRef.current.forEach((connection, userId) => {
      if (!currentUserIds.has(userId)) {
        connection.peerConnection.close();
        connectionsRef.current.delete(userId);
        setConnections(prev => {
          const newConnections = new Map(prev);
          newConnections.delete(userId);
          return newConnections;
        });
      }
    });
  }, [users, currentUserId, socket, createOffer, isActive]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (localStream) {
        localStream.getTracks().forEach(track => {
          track.stop();
        });
      }
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
    isActive,
    isInitializing,
    toggleVideo,
    toggleAudio,
    startVideoChat,
    stopVideoChat,
    setVideoRef
  };
};
