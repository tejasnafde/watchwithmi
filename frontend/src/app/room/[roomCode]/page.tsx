"use client"
import { useState, useEffect, useRef, use } from "react"
import { useSearchParams } from "next/navigation"
import {
  Play,
  Users,
  MessageCircle,
  Video,
  Loader2,
  Copy,
  LogOut,
  Youtube,
  Download,
  Link,
  Search,
  Send,
  Pause,
  Volume2,
  Maximize,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { useRoom } from "@/hooks/useRoom"

// Toast notification component
function Toast({
  message,
  type,
  onClose,
}: { message: string; type: "info" | "success" | "error" | "warning"; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000)
    return () => clearTimeout(timer)
  }, [onClose])

  const colors = {
    info: "bg-blue-500 border-blue-400",
    success: "bg-green-500 border-green-400",
    error: "bg-red-500 border-red-400",
    warning: "bg-yellow-500 border-yellow-400",
  }

  return (
    <div
      className={`${colors[type]} text-white px-4 py-3 rounded-lg shadow-lg border backdrop-blur-sm animate-in slide-in-from-right-full duration-300`}
    >
      <p className="text-sm font-medium">{message}</p>
    </div>
  )
}

export default function RoomPage({ params }: { params: Promise<{ roomCode: string }> }) {
  // Fix Next.js 15 params issue
  const resolvedParams = use(params)
  const searchParams = useSearchParams()
  const userName = searchParams.get('name') || 'Guest'
  const roomCode = resolvedParams.roomCode.toUpperCase()
  
  // Use our custom room hook
  const {
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
  } = useRoom(roomCode, userName)

  // Debug torrent status updates
  useEffect(() => {
    if (torrentStatus) {
      console.log('🎯 Torrent status in component:', {
        status: torrentStatus.status,
        progress: torrentStatus.progress,
        progressPercent: (torrentStatus.progress * 100).toFixed(1),
        file_progress: torrentStatus.file_progress,
        fileProgressPercent: torrentStatus.file_progress ? (torrentStatus.file_progress * 100).toFixed(1) : 'N/A',
        streaming_ready: torrentStatus.streaming_ready
      });
    }
  }, [torrentStatus]);

  // Debug currentMedia state changes
  useEffect(() => {
    console.log('🔔 CurrentMedia state changed in component:', {
      url: currentMedia.url,
      type: currentMedia.type,
      state: currentMedia.state,
      timestamp: currentMedia.timestamp,
      loading: currentMedia.loading
    });
  }, [currentMedia]);

  const [chatInput, setChatInput] = useState("")
  const [mediaInputs, setMediaInputs] = useState({
    youtube: "",
    torrent: "",
    direct: "",
  })
  const [showLeaveDialog, setShowLeaveDialog] = useState(false)
  const [toasts, setToasts] = useState<
    Array<{ id: number; message: string; type: "info" | "success" | "error" | "warning" }>
  >([])

  const chatScrollRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const isUpdatingFromSocket = useRef(false)
  const videoErrorRetryCount = useRef<number>(0)
  const lastVideoErrorTime = useRef<number>(0)

  // Video control state
  const [videoProgress, setVideoProgress] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'out_of_sync'>('synced')

  const showToast = (message: string, type: "info" | "success" | "error" | "warning" = "info") => {
    const id = Date.now()
    setToasts((prev) => [...prev, { id, message, type }])
  }

  const removeToast = (id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }

  const copyRoomCode = () => {
    navigator.clipboard.writeText(actualRoomCode)
    showToast("Room code copied to clipboard!", "success")
  }

  const handleLeaveRoom = () => {
    showToast("Leaving room...", "info")
    setTimeout(() => {
      window.location.href = "/"
    }, 1000)
  }

  const handleSendMessage = () => {
    if (chatInput.trim()) {
      sendMessage(chatInput.trim())
      setChatInput("")

      // Auto-scroll to bottom
      setTimeout(() => {
        if (chatScrollRef.current) {
          chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
        }
      }, 100)
    }
  }

  const handleMediaLoad = async (type: string) => {
    const url = mediaInputs[type as keyof typeof mediaInputs]
    if (!url.trim()) {
      showToast("Please enter a URL", "warning")
      return
    }

    showToast(`Loading ${type} media...`, "info")
    
    try {
      await loadMedia(url, type as 'youtube' | 'torrent' | 'direct')
      showToast("Media loaded successfully!", "success")
      setMediaInputs((prev) => ({ ...prev, [type]: "" }))
    } catch {
      showToast("Failed to load media", "error")
    }
  }

  const handleTorrentSearch = async () => {
    const query = mediaInputs.torrent.trim()
    if (!query) {
      showToast("Please enter a search term", "warning")
      return
    }

    showToast("Searching torrents...", "info")

    try {
      await searchTorrentFiles(query)
      showToast("Search completed!", "success")
    } catch {
      showToast("Search failed", "error")
    }
  }

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }

  const formatVideoTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = Math.round(seconds % 60)
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`
  }

  // Sync is now handled directly in the useEffect above - no separate function needed

  // Sync video player with socket events - simplified to only sync play/pause state
  useEffect(() => {
    console.log('🔄 Video sync useEffect triggered:', {
      hasVideo: !!videoRef.current,
      hasUrl: !!currentMedia.url,
      mediaState: currentMedia.state,
      mediaTimestamp: currentMedia.timestamp,
      videoExists: !!videoRef.current,
      isLoading: currentMedia.loading
    });

    // Don't sync if we don't have video element or URL
    if (!videoRef.current || !currentMedia.url) {
      console.log('❌ Skipping video sync: no video element or URL');
      return;
    }

    // For torrent streams, be more lenient with readyState check
    if (currentMedia.type === 'torrent') {
      const video = videoRef.current;
      if (video.readyState === 0) { // Only skip if HAVE_NOTHING
        console.log('📺 Skipping torrent sync: video not ready (readyState:', video.readyState, ')');
        return;
      }
    }

    // Allow sync if we have a video with valid src
    const video = videoRef.current;
    if (!video.src || video.src === 'about:blank') {
      console.log('⏳ Skipping sync: no valid video src');
      return;
    }

    console.log('🎬 Current video state:', {
      videoPaused: video.paused,
      videoCurrentTime: video.currentTime,
      mediaState: currentMedia.state,
      mediaTimestamp: currentMedia.timestamp,
      timeDiff: Math.abs(video.currentTime - currentMedia.timestamp),
      readyState: video.readyState,
      videoSrc: video.src
    });

    isUpdatingFromSocket.current = true;

    try {
      if (currentMedia.state === 'playing' && video.paused) {
        console.log('🎮 Syncing video: PLAY (video was paused, now playing)');
        // Don't sync timestamp on play - let video continue from current position
        video.play().catch((error) => {
          console.error('❌ Error playing video:', error);
        });
      } else if (currentMedia.state === 'paused' && !video.paused) {
        console.log('🎮 Syncing video: PAUSE (video was playing, now paused)');
        video.pause();
        // Only sync timestamp when pausing - bring everyone to same point
        video.currentTime = currentMedia.timestamp;
      }
      // Removed continuous seeking - no timestamp sync during playback
    } finally {
      // Reset flag after a brief delay to allow event handlers to process
      setTimeout(() => {
        isUpdatingFromSocket.current = false;
        console.log('🏳️ Reset isUpdatingFromSocket flag');
      }, 100);
    }
  }, [currentMedia.state, currentMedia.timestamp, currentMedia.url, currentMedia.loading]);

  // Additional effect to force video sync when media state changes
  useEffect(() => {
    console.log('🎬 Media state effect triggered:', currentMedia.state, 'loading:', currentMedia.loading);
    
    // Allow sync even during loading for better responsiveness
    if (videoRef.current && currentMedia.url && currentMedia.state) {
      const video = videoRef.current;
      
      // For torrent streams, be more lenient with readyState
      if (currentMedia.type === 'torrent' && video.readyState === 0) {
        console.log('📺 Skipping torrent state sync: video not ready (readyState:', video.readyState, ')');
        return;
      }
      
      console.log('🎮 Force syncing video state:', {
        mediaState: currentMedia.state,
        videoPaused: video.paused,
        needsPlay: currentMedia.state === 'playing' && video.paused,
        needsPause: currentMedia.state === 'paused' && !video.paused,
        readyState: video.readyState
      });
      
      // Set flag to prevent infinite loops
      isUpdatingFromSocket.current = true;
      
      if (currentMedia.state === 'playing' && video.paused) {
        console.log('🚀 Force playing video');
        video.play().catch(console.error);
      } else if (currentMedia.state === 'paused' && !video.paused) {
        console.log('🛑 Force pausing video');
        video.pause();
      }
      
      // Reset flag after a brief delay
      setTimeout(() => {
        isUpdatingFromSocket.current = false;
      }, 100);
    }
  }, [currentMedia.state, currentMedia.loading])

  // No continuous sync - only sync on pause events

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Header */}
      <header className="relative z-10 bg-black/20 backdrop-blur-xl border-b border-white/10 shadow-2xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-6">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-gradient-to-r from-purple-500 to-blue-500 rounded-xl shadow-lg">
                  <Play className="w-6 h-6 text-white" />
                </div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                  WatchWithMi
                </h1>
              </div>

              <Button
                onClick={copyRoomCode}
                variant="outline"
                className="bg-white/10 border-white/20 text-white hover:bg-white/20 transition-all duration-200 shadow-lg hover:shadow-xl"
              >
                <Copy className="w-4 h-4 mr-2" />
                Room: {actualRoomCode}
              </Button>
            </div>

            <div className="flex items-center space-x-4">
              <Badge variant="secondary" className="bg-green-500/20 text-green-300 border-green-500/30">
                <Users className="w-3 h-3 mr-1" />
                {users.length} online
              </Badge>

              <Badge 
                variant="secondary" 
                className={`${connected ? 'bg-green-500/20 text-green-300 border-green-500/30' : 'bg-red-500/20 text-red-300 border-red-500/30'}`}
              >
                {connected ? '🟢 Connected' : '🔴 Disconnected'}
              </Badge>

              <Dialog open={showLeaveDialog} onOpenChange={setShowLeaveDialog}>
                <DialogTrigger asChild>
                  <Button variant="destructive" className="shadow-lg hover:shadow-xl transition-all duration-200">
                    <LogOut className="w-4 h-4 mr-2" />
                    Leave Room
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-gray-900 border-gray-700">
                  <DialogHeader>
                    <DialogTitle className="text-white flex items-center">
                      <LogOut className="w-5 h-5 mr-2" />
                      Leave Room?
                    </DialogTitle>
                    <DialogDescription className="text-gray-300">
                      Are you sure you want to leave this room? You&apos;ll need the room code to rejoin.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="flex space-x-3 justify-end mt-6">
                    <Button variant="outline" onClick={() => setShowLeaveDialog(false)}>
                      Cancel
                    </Button>
                    <Button variant="destructive" onClick={handleLeaveRoom}>
                      Yes, Leave
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>
      </header>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main Content Area */}
          <div className="lg:col-span-3 space-y-6">
            {/* Media Player */}
            <Card className="bg-black/40 backdrop-blur-xl border-white/10 shadow-2xl overflow-hidden">
              <div className="aspect-video bg-black flex items-center justify-center relative">
                {currentMedia.loading ? (
                  <div className="text-center text-white">
                    <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4" />
                    <h3 className="text-xl font-semibold mb-2">
                      {currentMedia.title || 'Loading Media'}
                    </h3>
                    <p className="text-gray-300">Please wait while we prepare your content...</p>
                    
                    {torrentStatus ? (
                      <div className="mt-4 space-y-2">
                        <Progress value={torrentStatus.progress * 100} className="w-64 mx-auto" />
                        <p className="text-sm text-gray-400">
                          {(torrentStatus.progress * 100).toFixed(1)}% downloaded
                          {torrentStatus.file_progress && ` • File: ${(torrentStatus.file_progress * 100).toFixed(1)}%`}
                        </p>
                        {torrentStatus.streaming_ready && (
                          <p className="text-green-400">🎬 Ready to stream!</p>
                        )}
                      </div>
                    ) : (
                      <div className="mt-4 text-gray-500 text-sm">
                        No torrent status available
                      </div>
                    )}
                  </div>
                ) : currentMedia.url ? (
                  <div className="w-full h-full relative">
                    <video
                      key={currentMedia.url}
                      ref={videoRef}
                      src={currentMedia.url}
                      controls={false}
                      className="w-full h-full object-contain"
                      onPlay={(e) => {
                        const video = e.target as HTMLVideoElement;
                        console.log('▶️ Video onPlay event:', {
                          isUpdatingFromSocket: isUpdatingFromSocket.current,
                          currentTime: video.currentTime,
                          userTriggered: !isUpdatingFromSocket.current
                        });
                        if (!isUpdatingFromSocket.current) {
                          console.log('🚀 User clicked play, emitting to room');
                          playPause('play', video.currentTime);
                        } else {
                          console.log('🔄 Play event from socket, not emitting');
                        }
                      }}
                      onPause={(e) => {
                        const video = e.target as HTMLVideoElement;
                        console.log('⏸️ Video onPause event:', {
                          isUpdatingFromSocket: isUpdatingFromSocket.current,
                          currentTime: video.currentTime,
                          userTriggered: !isUpdatingFromSocket.current
                        });
                        if (!isUpdatingFromSocket.current) {
                          console.log('🚀 User clicked pause, emitting to room');
                          playPause('pause', video.currentTime);
                        } else {
                          console.log('🔄 Pause event from socket, not emitting');
                        }
                      }}
                      onSeeked={(e) => {
                        const video = e.target as HTMLVideoElement;
                        console.log('⏭️ Video onSeeked event:', {
                          isUpdatingFromSocket: isUpdatingFromSocket.current,
                          currentTime: video.currentTime,
                          userTriggered: !isUpdatingFromSocket.current
                        });
                        if (!isUpdatingFromSocket.current) {
                          // Only emit seek if the time difference is significant (> 1 second)
                          const timeDiff = Math.abs(video.currentTime - currentMedia.timestamp);
                          if (timeDiff > 1.0) {
                            console.log('🚀 User seeked video significantly, emitting to room');
                            seekTo(video.currentTime);
                          } else {
                            console.log('⏭️ Minor seek, not emitting (diff:', timeDiff, ')');
                          }
                        } else {
                          console.log('🔄 Seek event from socket, not emitting');
                        }
                      }}
                      onError={(e) => {
                        console.error('🚨 Video error:', e);
                        const video = e.target as HTMLVideoElement;
                        const errorCode = video.error?.code;
                        const errorMessage = video.error?.message;
                        
                        let userFriendlyError = 'Unknown video error';
                        if (errorCode === 1) userFriendlyError = 'Video aborted by user';
                        else if (errorCode === 2) userFriendlyError = 'Network error loading video';
                        else if (errorCode === 3) userFriendlyError = 'Video format not supported by browser';
                        else if (errorCode === 4) {
                          if (currentMedia.type === 'torrent') {
                            userFriendlyError = 'Torrent stream not ready yet - may need more download progress';
                          } else {
                            userFriendlyError = 'Video source not accessible or corrupted';
                          }
                        }
                        
                        console.error('🚨 Video error details:', {
                          error: video.error,
                          code: errorCode,
                          message: errorMessage,
                          userFriendlyError,
                          networkState: video.networkState,
                          readyState: video.readyState,
                          src: video.src,
                          mediaType: currentMedia.type
                        });
                        
                        // For torrent streams with MediaError 4, show a more helpful message
                        if (errorCode === 4 && currentMedia.type === 'torrent') {
                          const now = Date.now();
                          const timeSinceLastError = now - lastVideoErrorTime.current;
                          
                          // Reset retry count if enough time has passed (5+ seconds)
                          if (timeSinceLastError > 5000) {
                            videoErrorRetryCount.current = 0;
                          }
                          
                          lastVideoErrorTime.current = now;
                          const maxRetries = 3;
                          
                          const isReady = torrentStatus?.streaming_ready;
                          const progress = torrentStatus?.file_progress ? 
                            (torrentStatus.file_progress * 100).toFixed(1) : 
                            torrentStatus?.progress ? (torrentStatus.progress * 100).toFixed(1) : '0';
                          
                          if (isReady && videoErrorRetryCount.current < maxRetries) {
                            videoErrorRetryCount.current++;
                            const retryDelay = Math.min(5000, 1000 * Math.pow(2, videoErrorRetryCount.current - 1)); // Exponential backoff: 1s, 2s, 4s
                            
                            showToast(`Stream failed (attempt ${videoErrorRetryCount.current}/${maxRetries}). Retrying in ${retryDelay/1000}s...`, "warning");
                            
                            // Try to reload the video after exponential backoff delay
                            setTimeout(() => {
                              if (videoRef.current && videoErrorRetryCount.current <= maxRetries) {
                                console.log(`🔄 Retrying video load (attempt ${videoErrorRetryCount.current}/${maxRetries})`);
                                videoRef.current.load();
                              }
                            }, retryDelay);
                          } else if (isReady && videoErrorRetryCount.current >= maxRetries) {
                            showToast(`Stream failed after ${maxRetries} attempts. May need more download progress.`, "error");
                          } else {
                            const threshold = torrentStatus?.streaming_threshold ? 
                              (torrentStatus.streaming_threshold * 100).toFixed(0) : '12';
                            showToast(`Torrent needs ${threshold}% download. Currently at ${progress}%. Please wait...`, "info");
                          }
                        } else {
                          showToast(`Video Error: ${userFriendlyError}`, "error");
                        }
                      }}
                      onLoadStart={() => {
                        console.log('📺 Video loading started');
                      }}
                      onCanPlay={() => {
                        console.log('📺 Video can start playing');
                        // Reset error retry counter on successful load
                        videoErrorRetryCount.current = 0;
                      }}
                      onLoadedData={() => {
                        console.log('📺 Video data loaded');
                        // Reset error retry counter on successful data load
                        videoErrorRetryCount.current = 0;
                      }}
                      onTimeUpdate={(e) => {
                        const video = e.target as HTMLVideoElement;
                        setVideoProgress(video.currentTime);
                        setVideoDuration(video.duration || 0);
                      }}
                    />
                    
                    {/* Teleparty-style sync overlay */}
                    <div className="absolute top-4 left-4 z-10">
                      <div className="bg-black/80 backdrop-blur-sm rounded-lg px-3 py-2 text-white text-sm flex items-center space-x-2">
                        <div className="flex items-center space-x-1">
                          {syncStatus === 'synced' && (
                            <>
                              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                              <span className="text-green-400">Synced</span>
                            </>
                          )}
                          {syncStatus === 'syncing' && (
                            <>
                              <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
                              <span className="text-yellow-400">Syncing...</span>
                            </>
                          )}
                          {syncStatus === 'out_of_sync' && (
                            <>
                              <div className="w-2 h-2 bg-red-500 rounded-full animate-bounce"></div>
                              <span className="text-red-400">Buffering</span>
                            </>
                          )}
                        </div>
                        <div className="text-gray-400">•</div>
                        <div className="flex items-center space-x-1">
                          <Users className="w-3 h-3" />
                          <span>{users.length}</span>
                        </div>
                      </div>
                    </div>

                    {/* Action notification overlay */}
                    {lastAction && (
                      <div className="absolute top-4 right-4 z-10">
                        <div className="bg-blue-600/90 backdrop-blur-sm rounded-lg px-3 py-2 text-white text-sm animate-in slide-in-from-right duration-300">
                          <div className="flex items-center space-x-2">
                            <span className="text-lg">
                              {lastAction.type === 'play' ? '▶️' : lastAction.type === 'pause' ? '⏸️' : '⏭️'}
                            </span>
                            <span>
                              <span className="font-medium">{lastAction.user}</span> {
                                lastAction.type === 'play' ? 'played' :
                                lastAction.type === 'pause' ? 'paused' :
                                lastAction.type === 'seek' ? 'seeked' :
                                `${lastAction.type}ed`
                              }
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Buffer status overlay (center of screen) */}
                    {currentMedia.state === 'paused' && lastAction && lastAction.type === 'pause' && Date.now() - lastAction.timestamp < 5000 && (
                      <div className="absolute inset-0 flex items-center justify-center z-20">
                        <div className="bg-black/90 backdrop-blur-sm rounded-xl px-6 py-4 text-white text-center">
                          <div className="flex items-center space-x-3">
                            <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
                            <span className="text-lg">Someone paused the video</span>
                          </div>
                          <p className="text-sm text-gray-300 mt-2">
                            <span className="font-medium">{lastAction.user}</span> pressed pause
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Custom video controls */}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
                      {/* Progress bar */}
                      <div className="mb-4">
                        <div 
                          className="w-full h-2 bg-white/20 rounded-full cursor-pointer relative group"
                          onClick={(e) => {
                            if (videoRef.current) {
                              const rect = e.currentTarget.getBoundingClientRect();
                              const percent = (e.clientX - rect.left) / rect.width;
                              const newTime = percent * videoDuration;
                              seekTo(newTime);
                            }
                          }}
                        >
                          <div 
                            className="h-full bg-red-500 rounded-full transition-all duration-100"
                            style={{ width: `${(videoProgress / videoDuration) * 100 || 0}%` }}
                          ></div>
                          
                          {/* Hover time indicator */}
                          <div className="absolute -top-8 left-0 bg-black/80 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                            {formatVideoTime(videoProgress)}
                          </div>
                        </div>
                      </div>

                      {/* Control buttons */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-white hover:bg-white/20 p-2"
                            onClick={() => {
                              console.log('🎮 Custom control button clicked:', {
                                currentState: currentMedia.state,
                                isLoading: currentMedia.loading,
                                videoCurrentTime: videoRef.current?.currentTime,
                                videoPaused: videoRef.current?.paused,
                                action: currentMedia.state === 'playing' ? 'pause' : 'play'
                              });
                              
                              if (currentMedia.state === 'playing') {
                                console.log('🚀 Calling playPause(pause)');
                                playPause('pause', videoRef.current?.currentTime || 0);
                              } else {
                                console.log('🚀 Calling playPause(play)');
                                playPause('play', videoRef.current?.currentTime || 0);
                              }
                            }}
                          >
                            {currentMedia.state === 'playing' ? (
                              <Pause className="w-6 h-6" />
                            ) : (
                              <Play className="w-6 h-6" />
                            )}
                          </Button>

                          <div className="text-white text-sm">
                            {formatVideoTime(videoProgress)} / {formatVideoTime(videoDuration)}
                          </div>
                        </div>

                        <div className="flex items-center space-x-3">
                          {/* Volume control */}
                          <div className="flex items-center space-x-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-white hover:bg-white/20 p-2"
                              onClick={() => {
                                if (videoRef.current) {
                                  videoRef.current.muted = !videoRef.current.muted;
                                }
                              }}
                            >
                              <Volume2 className="w-4 h-4" />
                            </Button>
                          </div>

                          {/* Fullscreen */}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-white hover:bg-white/20 p-2"
                            onClick={() => {
                              if (videoRef.current) {
                                if (document.fullscreenElement) {
                                  document.exitFullscreen();
                                } else {
                                  videoRef.current.requestFullscreen();
                                }
                              }
                            }}
                          >
                            <Maximize className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-gray-400">
                    <Video className="w-16 h-16 mx-auto mb-4" />
                    <h3 className="text-xl font-semibold mb-2">No Media Selected</h3>
                    <p className="text-sm">Add media using the controls below to start watching together</p>
                  </div>
                )}
              </div>

              {/* Media Controls */}
              <CardContent className="p-6 bg-gray-900/50 backdrop-blur-sm">
                <Tabs defaultValue="torrent" className="w-full">
                  <TabsList className="grid w-full grid-cols-3 bg-gray-800/50 border border-gray-700">
                    <TabsTrigger
                      value="torrent"
                      className="data-[state=active]:bg-orange-600 data-[state=active]:text-white"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Torrent
                    </TabsTrigger>
                    <TabsTrigger
                      value="youtube"
                      className="data-[state=active]:bg-red-600 data-[state=active]:text-white"
                    >
                      <Youtube className="w-4 h-4 mr-2" />
                      YouTube
                    </TabsTrigger>
                    <TabsTrigger
                      value="direct"
                      className="data-[state=active]:bg-green-600 data-[state=active]:text-white"
                    >
                      <Link className="w-4 h-4 mr-2" />
                      Direct URL
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="youtube" className="space-y-4 mt-6">
                    <div className="flex space-x-3">
                      <Input
                        placeholder="Paste YouTube URL (youtube.com/watch?v=...)"
                        value={mediaInputs.youtube}
                        onChange={(e) => setMediaInputs(prev => ({...prev, youtube: e.target.value}))}
                        className="bg-gray-800/50 border-gray-600 text-white placeholder-gray-400"
                      />
                      <Button
                        onClick={() => handleMediaLoad("youtube")}
                        disabled={currentMedia.loading}
                        className="bg-red-600 hover:bg-red-700 text-white min-w-[100px]"
                      >
                        {currentMedia.loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Load Video"}
                      </Button>
                    </div>
                  </TabsContent>

                  <TabsContent value="torrent" className="space-y-4 mt-6">
                    <div className="flex space-x-3">
                      <Input
                        placeholder="Search for movies, TV shows..."
                        value={mediaInputs.torrent}
                        onChange={(e) => setMediaInputs(prev => ({...prev, torrent: e.target.value}))}
                        onKeyPress={(e) => e.key === 'Enter' && handleTorrentSearch()}
                        className="bg-gray-800/50 border-gray-600 text-white placeholder-gray-400"
                      />
                      <Button
                        onClick={handleTorrentSearch}
                        disabled={isSearching}
                        className="bg-orange-600 hover:bg-orange-700 text-white min-w-[100px]"
                      >
                        {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                      </Button>
                    </div>

                    {/* Torrent Results */}
                    {currentMedia.loading && currentMedia.type === 'torrent' && !currentMedia.url ? (
                      <div className="text-center py-8 text-gray-400">
                        <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin" />
                        <h3 className="text-lg font-semibold mb-2">Starting torrent download...</h3>
                        <p className="text-sm text-gray-300">Starting torrent download...</p>
                        {torrentStatus && (
                          <div className="mt-4">
                            <Progress value={torrentStatus.progress * 100} className="w-64 mx-auto mb-2" />
                            <p className="text-xs text-gray-400">
                              {(torrentStatus.progress * 100).toFixed(1)}% downloaded
                              {torrentStatus.file_progress && ` • File: ${(torrentStatus.file_progress * 100).toFixed(1)}%`}
                            </p>
                          </div>
                        )}
                      </div>
                    ) : hasSearched && torrentResults.length === 0 ? (
                      <div className="text-center py-8 text-gray-400">
                        <Download className="w-12 h-12 mx-auto mb-4 opacity-50" />
                        <h3 className="text-lg font-semibold mb-2">No torrents found</h3>
                        <p className="text-sm">Try different keywords or check your connection.</p>
                      </div>
                    ) : (
                      torrentResults.length > 0 && (
                        <ScrollArea className="h-64 w-full border border-gray-600 rounded-lg bg-gray-800/30">
                          <div className="p-4 space-y-3">
                            {torrentResults.map((result) => (
                              <div
                                key={result.id}
                                className="bg-gray-700/50 rounded-lg p-3 hover:bg-gray-600/50 transition-colors"
                              >
                                <div className="flex justify-between items-start">
                                  <div className="flex-1">
                                    <h4 className="font-medium text-white text-sm mb-1">{result.name}</h4>
                                    <div className="flex items-center space-x-4 text-xs text-gray-400">
                                      <span>📁 {result.size}</span>
                                      <span>🌱 {result.seeders}</span>
                                      <span>📥 {result.leechers}</span>
                                                            <Badge
                        variant={result.compatibility === 'Compatible' ? 'default' : 'secondary'}
                        className="text-xs"
                      >
                        {result.compatibility === 'Compatible' ? '✅ Compatible' : '⚠️ UDP Only'}
                      </Badge>
                                    </div>
                                  </div>
                                  <Button
                                    size="sm"
                                                        onClick={async () => {
                      if (result.compatibility === 'UDP Only') {
                        // Copy magnet link for UDP only torrents
                        await navigator.clipboard.writeText(result.magnet_url);
                        showToast("Magnet link copied! Use in torrent client.", "info");
                      } else {
                        // Stream directly via bridge for compatible torrents
                        showToast("Starting torrent stream...", "info");
                        await loadMedia(result.magnet_url, "torrent");
                      }
                    }}
                                    disabled={currentMedia.loading}
                                    className="bg-orange-600 hover:bg-orange-700 text-white ml-3"
                                  >
                                                        {currentMedia.loading && activeTorrentId ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : result.compatibility === 'UDP Only' ? (
                      '📋 Copy'
                    ) : (
                      '🎬 Stream'
                    )}
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      )
                    )}
                  </TabsContent>

                  <TabsContent value="direct" className="space-y-4 mt-6">
                    <div className="flex space-x-3">
                      <Input
                        placeholder="Direct video URL (.mp4, .mkv, .webm...)"
                        value={mediaInputs.direct}
                        onChange={(e) => setMediaInputs(prev => ({...prev, direct: e.target.value}))}
                        className="bg-gray-800/50 border-gray-600 text-white placeholder-gray-400"
                      />
                      <Button
                        onClick={() => handleMediaLoad("direct")}
                        disabled={currentMedia.loading}
                        className="bg-green-600 hover:bg-green-700 text-white min-w-[100px]"
                      >
                        {currentMedia.loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Load Video"}
                      </Button>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-1 space-y-6">
            {/* Users Panel */}
            <Card className="bg-black/40 backdrop-blur-xl border-white/10 shadow-2xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-white flex items-center">
                  <Users className="w-5 h-5 mr-2" />
                  Online Users ({users.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ScrollArea className="h-32">
                  <div className="space-y-2">
                    {users.map((user) => (
                      <div key={user.id} className="flex items-center space-x-2 text-sm">
                        <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                        <span className="text-white">{user.name}</span>
                        {user.isHost && (
                          <Badge variant="secondary" className="text-xs bg-purple-500/20 text-purple-300">
                            Host
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Chat Panel */}
            <Card className="bg-black/40 backdrop-blur-xl border-white/10 shadow-2xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-white flex items-center">
                  <MessageCircle className="w-5 h-5 mr-2" />
                  Chat
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-4">
                <ScrollArea className="h-64" ref={chatScrollRef}>
                  <div className="space-y-3 pr-4">
                    {chatMessages.map((message) => (
                      <div key={message.id} className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <span
                            className={`text-xs font-medium ${
                              message.isServer
                                ? "text-blue-400"
                                : message.user_name === userName
                                ? "text-green-400"
                                : "text-gray-300"
                            }`}
                          >
                            {message.user_name}
                          </span>
                          <span className="text-xs text-gray-500">
                            {formatTime(message.timestamp)}
                          </span>
                        </div>
                        <p className="text-sm text-gray-200 break-words">{message.message}</p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                <div className="flex space-x-2">
                  <Input
                    placeholder="Type a message..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                    className="bg-gray-800/50 border-gray-600 text-white placeholder-gray-400 text-sm"
                  />
                  <Button
                    onClick={handleSendMessage}
                    size="sm"
                    disabled={!chatInput.trim()}
                    className="bg-blue-600 hover:bg-blue-700 text-white min-w-[60px]"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Toast Container - Bottom Right */}
      <div className="fixed bottom-4 right-4 z-50 space-y-2">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            onClose={() => removeToast(toast.id)}
          />
        ))}
      </div>
    </div>
  )
}
