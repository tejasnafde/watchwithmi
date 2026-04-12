"use client"

import { useState, use } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Copy, LogOut, Users, MessageCircle, Video, Crown, Music } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { useRoom } from "@/hooks/useRoom"
import { VideoChat } from "@/components/VideoChat"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { MediaPlayer } from "@/components/MediaPlayer"
import { ChatPanel } from "@/components/ChatPanel"
import { MediaControls } from "@/components/MediaControls"
import { logger } from "@/lib/logger"

export const dynamic = 'force-dynamic';

// Toast notification component
function Toast({
  message,
  type,
}: { message: string; type: "info" | "success" | "error" | "warning" }) {
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
  const resolvedParams = use(params)
  const searchParams = useSearchParams()
  const userName = searchParams.get('name') || 'Guest'
  const roomCode = resolvedParams.roomCode.toUpperCase()

  const router = useRouter()

  const {
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
    socket,
    currentUserId,
    sendMessage,
    loadMedia,
    playPause,
    seekTo,
    playlistNext,
    playlistPrev,
    playlistSelect,
    grantControl,
    toggleReaction,
    queue,
    addToQueue,
    removeFromQueue,
    reorderQueue,
    playNextFromQueue,
    clearQueue,
    searchMediaFiles,
    searchYouTubeVideos,
    videoReactions,
    sendVideoReaction,
  } = useRoom(roomCode, userName)

  const [showLeaveDialog, setShowLeaveDialog] = useState(false)
  const [toasts, setToasts] = useState<
    Array<{ id: number; message: string; type: "info" | "success" | "error" | "warning" }>
  >([])

  const showToast = (message: string, type: "info" | "success" | "error" | "warning" = "info") => {
    const id = Date.now()
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => removeToast(id), 3000)
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

  const handleLoadMedia = async (url: string, type: 'youtube' | 'media' | 'direct' | 'youtube_playlist') => {
    logger.info('Loading media', { url, type })
    showToast(`Loading ${type} media...`, "info")

    try {
      await loadMedia(url, type)
      showToast("Media loaded successfully!", "success")
    } catch (error) {
      logger.error('Failed to load media', error)
      showToast("Failed to load media", "error")
    }
  }

  const handleSearchContent = async (query: string) => {
    logger.info('Searching content', query)
    showToast("Searching content...", "info")

    try {
      await searchMediaFiles(query)
      showToast("Search completed!", "success")
    } catch (error) {
      logger.error('Search failed', error)
      showToast("Search failed", "error")
    }
  }

  const currentUser = users.find(u => u.id === currentUserId)
  const isHost = currentUser?.is_host || false
  const canControl = currentUser?.can_control || false

  // Room error state
  if (roomError) {
    return (
      <div className="h-screen flex items-center justify-center bg-black">
        <div className="text-center max-w-md px-6">
          <div className="w-16 h-16 border-4 border-white flex items-center justify-center mx-auto mb-6">
            <span className="text-white text-2xl font-bold">!</span>
          </div>
          <h1 className="text-2xl font-bold text-white uppercase tracking-tight mb-3">
            Room Not Found
          </h1>
          <p className="text-zinc-400 mb-8 font-mono text-sm">{roomError}</p>
          <Button
            onClick={() => router.push('/')}
            className="bg-white text-black hover:bg-zinc-200 border-2 border-white font-bold uppercase"
          >
            Back to Home
          </Button>
        </div>
      </div>
    )
  }

  // Loading skeleton state
  if (!connected) {
    return (
      <div className="h-screen flex flex-col bg-black overflow-hidden">
        {/* Header skeleton */}
        <div className="border-b-4 border-white bg-black">
          <div className="max-w-full px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div className="h-8 w-48 animate-pulse bg-zinc-800 rounded" />
                <div className="flex items-center gap-3">
                  <div className="h-7 w-24 animate-pulse bg-zinc-800 rounded" />
                  <div className="h-7 w-16 animate-pulse bg-zinc-800 rounded" />
                </div>
              </div>
              <div className="h-9 w-32 animate-pulse bg-zinc-800 rounded" />
            </div>
          </div>
        </div>

        {/* Main content skeleton */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Video player skeleton */}
          <div className="flex-1 flex flex-col border-r-4 border-white">
            <div className="flex-1 bg-[#0a0a0a] p-4">
              <div className="aspect-video animate-pulse bg-zinc-800 rounded" />
            </div>
            <div className="bg-black border-t-4 border-white p-4">
              <div className="h-10 w-full animate-pulse bg-zinc-800 rounded" />
            </div>
          </div>

          {/* Right: Users + Chat skeleton */}
          <div className="w-[400px] flex flex-col bg-black">
            {/* Users skeleton */}
            <div className="border-b-4 border-white p-4">
              <div className="h-5 w-24 animate-pulse bg-zinc-800 rounded mb-3" />
              <div className="space-y-2">
                <div className="h-10 w-full animate-pulse bg-zinc-800 rounded" />
                <div className="h-10 w-full animate-pulse bg-zinc-800 rounded" />
                <div className="h-10 w-3/4 animate-pulse bg-zinc-800 rounded" />
              </div>
            </div>

            {/* Chat skeleton */}
            <div className="flex-1 border-b-4 border-white p-4">
              <div className="h-5 w-16 animate-pulse bg-zinc-800 rounded mb-3" />
              <div className="space-y-3">
                <div className="h-6 w-4/5 animate-pulse bg-zinc-800 rounded" />
                <div className="h-6 w-3/5 animate-pulse bg-zinc-800 rounded" />
                <div className="h-6 w-full animate-pulse bg-zinc-800 rounded" />
                <div className="h-6 w-2/3 animate-pulse bg-zinc-800 rounded" />
                <div className="h-6 w-4/5 animate-pulse bg-zinc-800 rounded" />
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <div className="h-screen flex flex-col bg-black overflow-hidden">
        {/* Toast Notifications */}
        <div className="fixed top-4 right-4 z-50 space-y-2">
          {toasts.map((toast) => (
            <Toast
              key={toast.id}
              message={toast.message}
              type={toast.type}
            />
          ))}
        </div>

        {/* Header - Single Row */}
        <div className="border-b-4 border-white bg-black">
          <div className="max-w-full px-6 py-4">
            <div className="flex items-center justify-between">
              {/* Left: Logo + Room Info */}
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-3">
                  <img src="/logo.svg" alt="WatchWithMi" width={32} height={32} className="bg-white p-1" />
                  <h1 className="text-2xl font-bold text-white uppercase tracking-tight">
                    WATCHWITHMI
                  </h1>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="secondary" className="bg-white text-black text-sm px-3 py-1 font-mono">
                    {actualRoomCode}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={copyRoomCode}
                    className="border-2 border-white bg-black text-white hover:bg-white hover:text-black h-8"
                  >
                    <Copy className="h-3 w-3 mr-2" />
                    COPY
                  </Button>
                  <Badge
                    variant={connected ? "default" : "destructive"}
                    className={`px-3 py-1 font-mono text-xs ${connected ? 'bg-white text-black' : 'bg-black text-white border-2 border-white'}`}
                  >
                    {connected ? "CONNECTED" : "DISCONNECTED"}
                  </Badge>
                </div>
              </div>

              {/* Right: Leave Button */}
              <Dialog open={showLeaveDialog} onOpenChange={setShowLeaveDialog}>
                <DialogTrigger asChild>
                  <Button variant="destructive" className="bg-white text-black hover:bg-gray-200 border-2 border-white">
                    <LogOut className="h-4 w-4 mr-2" />
                    LEAVE ROOM
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-black border-4 border-white">
                  <DialogHeader>
                    <DialogTitle className="text-white uppercase">Leave Room?</DialogTitle>
                    <DialogDescription className="text-gray-400">
                      Are you sure you want to leave this room?
                    </DialogDescription>
                  </DialogHeader>
                  <div className="flex gap-3 justify-end">
                    <Button
                      variant="outline"
                      onClick={() => setShowLeaveDialog(false)}
                      className="border-2 border-white bg-black text-white hover:bg-white hover:text-black"
                    >
                      CANCEL
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleLeaveRoom}
                      className="bg-white text-black hover:bg-gray-200"
                    >
                      LEAVE
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>

        {/* Main Content - Full Width Layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Media Player + Controls (70%) */}
          <div className="flex-1 flex flex-col border-r-4 border-white overflow-y-auto min-h-0">
            {/* Media Player */}
            <div className="flex-1 bg-[#0a0a0a]">
              <MediaPlayer
                currentMedia={currentMedia}
                canControl={canControl}
                socket={socket}
                mediaStatus={mediaStatus}
                onPlayPause={playPause}
                onSeek={seekTo}
                onPlaylistNext={playlistNext}
                onPlaylistPrev={playlistPrev}
                videoReactions={videoReactions}
                onVideoReaction={sendVideoReaction}
              />
            </div>

            {/* Media Status */}
            {mediaStatus && (
              <div className="bg-black border-t-4 border-white p-4">
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-sm text-white mb-2 font-mono">
                      <span>OVERALL: {(mediaStatus.progress * 100).toFixed(1)}%</span>
                      <span>{mediaStatus.num_peers} PEERS</span>
                    </div>
                    <Progress value={mediaStatus.progress * 100} className="h-2 bg-gray-800" />
                  </div>
                  {mediaStatus.file_progress !== undefined && (
                    <div>
                      <div className="flex justify-between text-sm text-white mb-2 font-mono">
                        <span>FILE: {(mediaStatus.file_progress * 100).toFixed(1)}%</span>
                        <span className="text-xs">
                          {mediaStatus.streaming_ready ? "READY" : "BUFFERING"}
                        </span>
                      </div>
                      <Progress value={mediaStatus.file_progress * 100} className="h-2 bg-gray-800" />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Media Controls */}
            <div className="bg-black border-t-4 border-white">
              <MediaControls
                onLoadMedia={handleLoadMedia}
                onSearchContent={handleSearchContent}
                onSearchYouTube={searchYouTubeVideos}
                canControl={canControl}
                isSearching={isSearching}
                hasSearched={hasSearched}
                contentResults={contentResults}
                playlistItems={currentMedia.playlist_items || []}
                currentPlaylistIndex={currentMedia.current_index || 0}
                onPlaylistSelect={playlistSelect}
                queue={queue}
                onAddToQueue={addToQueue}
                onRemoveFromQueue={removeFromQueue}
                onReorderQueue={reorderQueue}
                onPlayNext={playNextFromQueue}
                onClearQueue={clearQueue}
                currentUserId={currentUserId}
                isHost={isHost}
              />
            </div>
          </div>

          {/* Right Sidebar: Users + Chat (30%) */}
          <div className="w-[400px] flex flex-col bg-black min-h-0 overflow-hidden">
            {/* Users Section */}
            <div className="shrink-0 max-h-[30%] overflow-y-auto border-b-4 border-white bg-black p-4">
              <h3 className="text-white font-bold uppercase mb-3 flex items-center gap-2">
                <Users className="h-4 w-4" />
                USERS ({users.length})
              </h3>
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {users.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between p-2 bg-[#0a0a0a] border-2 border-white/20 group hover:border-white/40"
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 ${user.id === currentUserId ? 'bg-white' : 'bg-gray-500'}`} />
                      <div className="flex flex-col">
                        <span className="text-white text-sm font-mono">
                          {user.name} {user.id === currentUserId && "(YOU)"}
                        </span>
                        <div className="flex gap-1 mt-1">
                          {user.is_host && (
                            <span className="text-[10px] px-1 border border-white text-white bg-black font-mono">
                              <Crown className="h-2 w-2 inline mr-1" />
                              HOST
                            </span>
                          )}
                          {user.can_control && !user.is_host && (
                            <span className="text-[10px] px-1 border border-white text-white bg-black font-mono">
                              <Music className="h-2 w-2 inline mr-1" />
                              DJ
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Host controls */}
                    {isHost && user.id !== currentUserId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs opacity-0 group-hover:opacity-100 border border-white text-white hover:bg-white hover:text-black"
                        onClick={() => grantControl(user.id, !user.can_control)}
                      >
                        {user.can_control ? "REVOKE" : "GRANT"}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Chat Section - Takes remaining space, always visible */}
            <div className="flex-1 min-h-[200px] flex flex-col border-b-4 border-white overflow-hidden">
              <div className="p-4 border-b-2 border-white bg-black shrink-0">
                <h3 className="text-white font-bold uppercase flex items-center gap-2">
                  <MessageCircle className="h-4 w-4" />
                  CHAT
                </h3>
              </div>
              <div className="flex-1 overflow-hidden min-h-0">
                <ChatPanel
                  messages={chatMessages}
                  onSendMessage={sendMessage}
                  currentUserName={userName}
                  currentUserId={currentUserId}
                  onToggleReaction={toggleReaction}
                />
              </div>
            </div>

            {/* Video Chat Section */}
            <div className="shrink-0 max-h-[40%] overflow-y-auto bg-black p-4">
              <h3 className="text-white font-bold uppercase mb-3 flex items-center gap-2">
                <Video className="h-4 w-4" />
                VIDEO CHAT
              </h3>
              {socket && (
                <VideoChat
                  socket={socket}
                  currentUserId={currentUserId}
                  users={users}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  )
}
