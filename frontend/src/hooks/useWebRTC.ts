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
  
  // Track if user wants video/audio enabled (before stream is ready)
  const [pendingVideoEnable, setPendingVideoEnable] = useState(false);
  const [pendingAudioEnable, setPendingAudioEnable] = useState(false);
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const connectionsRef = useRef<Map<string, WebRTCConnection>>(new Map());
  
  // Ref callback to ensure we catch when video element is mounted
  const setVideoRef = useCallback((element: HTMLVideoElement | null) => {
    localVideoRef.current = element;
    if (element && localStream) {
      console.log('🎯 Video element mounted, assigning stream immediately');
      element.srcObject = localStream;
      element.load();
      
      // If video should be enabled, make sure tracks are enabled
      if (videoEnabled && localStream.getVideoTracks().length > 0) {
        localStream.getVideoTracks().forEach(track => track.enabled = true);
      }
    }
  }, [localStream, videoEnabled]);
  
  // ICE servers configuration
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  // Initialize local media stream
  const initializeLocalStream = useCallback(async () => {
    if (isInitializing || localStream) {
      console.log('Skipping stream initialization:', { isInitializing, hasLocalStream: !!localStream });
      return;
    }
    
    console.log('🎥 Starting stream initialization...');
    setIsInitializing(true);
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
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        console.log('📺 Stream assigned to video element');
      } else {
        console.warn('⚠️ No video ref available yet');
      }
    } catch (error) {
      console.error('❌ Failed to initialize local stream:', error);
    } finally {
      setIsInitializing(false);
      console.log('🎥 Stream initialization complete');
    }
  }, [isInitializing, localStream]);

  // Create peer connection
  const createPeerConnection = useCallback((userId: string, userName: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection({ iceServers });
    
    // Add local stream tracks if available
    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
        console.log(`➕ Added ${track.kind} track to new connection with ${userName}`);
      });
    } else {
      console.log(`⚠️ No local stream available when creating connection to ${userName}`);
    }
    
    // Handle remote stream
    pc.ontrack = (event) => {
      console.log('📥 Received remote track from', userName, 'kind:', event.track.kind);
      const [remoteStream] = event.streams;
      
      setConnections(prev => {
        const newConnections = new Map(prev);
        const connection = newConnections.get(userId);
        if (connection) {
          connection.remoteStream = remoteStream;
          newConnections.set(userId, connection);
          console.log(`✅ Set remote stream for ${userName}`);
        }
        return newConnections;
      });
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
    
    pc.onconnectionstatechange = () => {
      console.log(`🔌 Connection state with ${userName}:`, pc.connectionState);
    };
    
    return pc;
  }, [localStream, socket]);

  // Create offer to connect to a user
  const createOffer = useCallback(async (userId: string, userName: string) => {
    if (!socket) return;
    
    console.log('Creating offer for', userName);
    
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
      
      // If we have a local stream, immediately add it to this new connection
      if (localStream) {
        console.log(`📡 Adding existing stream to new connection with ${userName}`);
        setTimeout(async () => {
          try {
            if (pc.signalingState === 'stable') {
              const renegotiationOffer = await pc.createOffer();
              await pc.setLocalDescription(renegotiationOffer);
              
              socket.emit('webrtc_offer', {
                target_user_id: userId,
                offer: renegotiationOffer
              });
              console.log(`🔄 Sent renegotiation offer with stream to ${userName}`);
            }
          } catch (error) {
            console.error(`Failed to renegotiate with ${userName}:`, error);
          }
        }, 500); // Wait for initial connection to stabilize
      }
    } catch (error) {
      console.error(`Failed to create offer for ${userName}:`, error);
    }
  }, [socket, createPeerConnection, localStream]);

  // Handle incoming offer
  const handleOffer = useCallback(async (fromUserId: string, fromUserName: string, offer: RTCSessionDescriptionInit) => {
    if (!socket) return;
    
    console.log('Handling offer from', fromUserName);
    
    try {
      // Check if we already have a connection
      let connection = connectionsRef.current.get(fromUserId);
      
      if (connection) {
        // If connection exists and is in stable state, this might be a renegotiation
        const pc = connection.peerConnection;
        if (pc.signalingState === 'stable') {
          console.log(`🔄 Renegotiation offer from ${fromUserName}`);
        } else if (pc.signalingState !== 'have-local-offer') {
          console.log(`⚠️ Connection with ${fromUserName} is in state ${pc.signalingState}, skipping offer`);
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
    } catch (error) {
      console.error(`Failed to handle offer from ${fromUserName}:`, error);
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
        console.log('Answer handled from', connection.userName);
      } else {
        console.log(`⚠️ Cannot handle answer from ${connection.userName}, signaling state: ${pc.signalingState}`);
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

  // Toggle video
  const toggleVideo = useCallback(async () => {
    const newVideoEnabled = !videoEnabled;
    
    if (newVideoEnabled) {
      // Enabling video - initialize stream if needed
      if (!localStream) {
        console.log('No local stream yet, initializing...');
        setPendingVideoEnable(true);
        await initializeLocalStream();
        return;
      }
      
      // Enable existing tracks
      localStream.getVideoTracks().forEach(track => {
        track.enabled = true;
        console.log('Video track enabled:', track.enabled);
      });
      
      // Note: Track addition and renegotiation will be handled by the useEffect that watches localStream
    } else {
      // Disabling video - completely stop the stream and tracks
      if (localStream) {
        console.log('🛑 Stopping video stream completely');
        
        // First close all connections to prevent errors
        connectionsRef.current.forEach(connection => {
          if (connection.peerConnection.signalingState !== 'closed') {
            connection.peerConnection.close();
          }
        });
        connectionsRef.current.clear();
        setConnections(new Map());
        
        // Then stop the tracks
        localStream.getTracks().forEach(track => {
          track.stop();
          console.log(`Stopped ${track.kind} track`);
        });
        setLocalStream(null);
      }
      
      // Reset audio state too since we stopped the entire stream
      setAudioEnabled(false);
    }
    
    setVideoEnabled(newVideoEnabled);
    
    if (socket) {
      socket.emit('toggle_video', { enabled: newVideoEnabled });
    }
  }, [localStream, videoEnabled, socket, initializeLocalStream]);

  // Toggle audio
  const toggleAudio = useCallback(async () => {
    const newAudioEnabled = !audioEnabled;
    
    if (!localStream) {
      console.log('No local stream yet, initializing...');
      setPendingAudioEnable(newAudioEnabled);
      await initializeLocalStream();
      return;
    }
    
    console.log('Toggling audio:', { from: audioEnabled, to: newAudioEnabled });
    
    if (newAudioEnabled) {
      // Enabling audio - enable the tracks
      localStream.getAudioTracks().forEach(track => {
        track.enabled = true;
        console.log('Audio track enabled:', track.enabled);
      });
    } else {
      // Disabling audio - disable tracks but don't stop them
      localStream.getAudioTracks().forEach(track => {
        track.enabled = false;
        console.log('Audio track disabled:', track.enabled);
      });
    }
    
    setAudioEnabled(newAudioEnabled);
    
    if (socket) {
      socket.emit('toggle_audio', { enabled: newAudioEnabled });
    }
  }, [localStream, audioEnabled, socket, initializeLocalStream]);

  // Socket event listeners
  useEffect(() => {
    if (!socket) return;
    
    const handleWebRTCOffer = (data: { from_user_id: string; from_user_name: string; offer: RTCSessionDescriptionInit }) => {
      handleOffer(data.from_user_id, data.from_user_name, data.offer);
    };
    
    const handleWebRTCAnswer = (data: { from_user_id: string; answer: RTCSessionDescriptionInit }) => {
      handleAnswer(data.from_user_id, data.answer);
    };
    
    const handleWebRTCIceCandidate = (data: { from_user_id: string; candidate: RTCIceCandidateInit }) => {
      handleIceCandidate(data.from_user_id, data.candidate);
    };
    
    socket.on('webrtc_offer', handleWebRTCOffer);
    socket.on('webrtc_answer', handleWebRTCAnswer);
    socket.on('webrtc_ice_candidate', handleWebRTCIceCandidate);
    
    return () => {
      socket.off('webrtc_offer', handleWebRTCOffer);
      socket.off('webrtc_answer', handleWebRTCAnswer);
      socket.off('webrtc_ice_candidate', handleWebRTCIceCandidate);
    };
  }, [socket, handleOffer, handleAnswer, handleIceCandidate]);

  // Handle users joining/leaving - establish connections
  useEffect(() => {
    if (!socket) return;
    
    console.log('🔗 Checking connections for users:', users.map(u => ({ id: u.id, name: u.name, video: u.video_enabled })));
    
    // Create connections to ALL users (regardless of whether we or they have video)
    // This ensures we can receive their streams when they turn on video
    users.forEach(user => {
      if (user.id !== currentUserId && !connectionsRef.current.has(user.id)) {
        console.log('🤝 Creating connection to user:', user.name);
        // Add a small delay to prevent race conditions
        setTimeout(() => {
          if (!connectionsRef.current.has(user.id)) {
            createOffer(user.id, user.name);
          }
        }, 100);
      }
    });
    
    // Clean up connections for users who left
    connectionsRef.current.forEach((connection, userId) => {
      const userExists = users.some(user => user.id === userId);
      if (!userExists) {
        console.log('👋 Cleaning up connection for user who left:', userId);
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

  // When local stream becomes available, add tracks to existing connections
  useEffect(() => {
    if (!localStream) return;
    
    console.log('📡 Adding local stream to existing connections');
    
    // Create a list of connections to renegotiate
    const connectionsToUpdate = Array.from(connectionsRef.current.entries()).filter(([_, connection]) => {
      const pc = connection.peerConnection;
      return pc.signalingState === 'stable' && pc.connectionState !== 'closed';
    });
    
    if (connectionsToUpdate.length === 0) {
      console.log('📡 No stable connections to update');
      return;
    }
    
    connectionsToUpdate.forEach(([userId, connection]) => {
      const pc = connection.peerConnection;
      
      try {
        // Check if we already have tracks
        const senders = pc.getSenders();
        const hasVideoTrack = senders.some(sender => sender.track?.kind === 'video');
        const hasAudioTrack = senders.some(sender => sender.track?.kind === 'audio');
        
        let tracksAdded = false;
        
        // Add video track if not present
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack && !hasVideoTrack) {
          pc.addTrack(videoTrack, localStream);
          tracksAdded = true;
          console.log(`➕ Added video track to ${connection.userName}`);
        }
        
        // Add audio track if not present
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack && !hasAudioTrack) {
          pc.addTrack(audioTrack, localStream);
          tracksAdded = true;
          console.log(`➕ Added audio track to ${connection.userName}`);
        }
        
        // Only renegotiate if we added tracks
        if (tracksAdded && socket) {
          setTimeout(async () => {
            try {
              if (pc.signalingState === 'stable') {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                
                socket.emit('webrtc_offer', {
                  target_user_id: userId,
                  offer: offer
                });
                console.log(`🔄 Sent renegotiation offer to ${connection.userName}`);
              }
            } catch (error) {
              console.error(`Failed to renegotiate with ${connection.userName}:`, error);
            }
          }, 200);
        }
      } catch (error) {
        console.error(`Failed to add tracks to ${connection.userName}:`, error);
      }
    });
  }, [localStream, socket]);

  // Update connections ref when connections state changes
  useEffect(() => {
    connectionsRef.current = connections;
  }, [connections]);

  // Auto-enable video/audio after stream initialization if user clicked button
  useEffect(() => {
    console.log('🔄 Stream effect triggered:', { 
      hasStream: !!localStream, 
      hasVideoRef: !!localVideoRef.current,
      pendingVideo: pendingVideoEnable,
      pendingAudio: pendingAudioEnable
    });
    
    if (localStream) {
      // Always assign stream to video element when available
      if (localVideoRef.current) {
        console.log('🎬 Setting stream to video element');
        localVideoRef.current.srcObject = localStream;
        localVideoRef.current.load();
      }
      
      const videoTracks = localStream.getVideoTracks();
      const audioTracks = localStream.getAudioTracks();
      
      console.log('📊 Stream tracks analysis:', { 
        video: videoTracks.length, 
        audio: audioTracks.length,
        videoEnabled: videoTracks[0]?.enabled,
        audioEnabled: audioTracks[0]?.enabled,
        pendingVideoEnable,
        pendingAudioEnable,
        videoElementSrc: localVideoRef.current?.srcObject ? 'SET' : 'NOT SET'
      });
      
      // Enable video if user previously requested it
      if (pendingVideoEnable && videoTracks.length > 0) {
        console.log('🎥 Enabling video after stream initialization');
        videoTracks.forEach(track => track.enabled = true);
        setVideoEnabled(true);
        setPendingVideoEnable(false);
        
        if (socket) {
          socket.emit('toggle_video', { enabled: true });
        }
      }
      
      // Enable audio if user previously requested it
      if (pendingAudioEnable && audioTracks.length > 0) {
        console.log('🎤 Enabling audio after stream initialization');
        audioTracks.forEach(track => track.enabled = true);
        setAudioEnabled(true);
        setPendingAudioEnable(false);
        
        if (socket) {
          socket.emit('toggle_audio', { enabled: true });
        }
      }
    } else if (!localStream && localVideoRef.current) {
      console.log('📺 Have video ref but no stream yet');
    }
  }, [localStream, pendingVideoEnable, pendingAudioEnable, socket]);

  // Separate effect to handle when video ref becomes available after stream
  useEffect(() => {
    if (localStream && localVideoRef.current && !localVideoRef.current.srcObject) {
      console.log('🔧 Video ref became available, setting stream retroactively');
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.load();
      
      // If video should be enabled, make sure it's visible
      if (videoEnabled && localStream.getVideoTracks().length > 0) {
        console.log('🎥 Enabling video tracks for retroactive assignment');
        localStream.getVideoTracks().forEach(track => track.enabled = true);
      }
    }
  }, [localStream, videoEnabled]);

  // Cleanup function to properly stop all tracks
  const stopLocalStream = useCallback(() => {
    if (localStream) {
      console.log('🛑 Stopping local stream tracks');
      
      // Close connections first
      connectionsRef.current.forEach(connection => {
        if (connection.peerConnection.signalingState !== 'closed') {
          connection.peerConnection.close();
        }
      });
      
      // Then stop tracks
      localStream.getTracks().forEach(track => {
        track.stop();
        console.log(`Stopped ${track.kind} track`);
      });
      setLocalStream(null);
      setVideoEnabled(false);
      setAudioEnabled(false);
    }
  }, [localStream]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      console.log('🧹 Cleaning up WebRTC resources');
      
      // Close connections first
      connectionsRef.current.forEach(connection => {
        if (connection.peerConnection.signalingState !== 'closed') {
          connection.peerConnection.close();
        }
      });
      
      // Then stop tracks
      localStream?.getTracks().forEach(track => {
        track.stop();
        console.log(`Cleanup: Stopped ${track.kind} track`);
      });
    };
  }, [localStream]);

  return {
    localStream,
    localVideoRef,
    setVideoRef,
    videoEnabled,
    audioEnabled,
    connections,
    isInitializing,
    initializeLocalStream,
    toggleVideo,
    toggleAudio
  };
}; 