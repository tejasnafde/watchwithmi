"use client"

import { useState, use } from "react"
import { useSearchParams } from "next/navigation"
import { Copy, LogOut, Users, MessageCircle, Video, Crown, Music } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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

  const {
    connected,
    users,
    chatMessages,
    currentMedia,
    contentResults,
    mediaStatus,
    isSearching,
    hasSearched,
    actualRoomCode,
    socket,
    currentUserId,
    sendMessage,
    loadMedia,
    playPause,
    seekTo,
    grantControl,
    searchMediaFiles,
    searchYouTubeVideos,
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

  const handleLoadMedia = async (url: string, type: 'youtube' | 'media' | 'direct') => {
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

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 p-4">
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

        {/* Header */}
        <div className="max-w-7xl mx-auto mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">
                WatchWithMi
              </h1>
              <div className="flex items-center gap-3">
                <Badge variant="secondary" className="text-lg px-4 py-1">
                  Room: {actualRoomCode}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={copyRoomCode}
                  className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Copy Code
                </Button>
                <Badge
                  variant={connected ? "default" : "destructive"}
                  className="px-3 py-1"
                >
                  {connected ? "🟢 Connected" : "🔴 Disconnected"}
                </Badge>
              </div>
            </div>

            <Dialog open={showLeaveDialog} onOpenChange={setShowLeaveDialog}>
              <DialogTrigger asChild>
                <Button variant="destructive">
                  <LogOut className="h-4 w-4 mr-2" />
                  Leave Room
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-gray-900 border-white/10">
                <DialogHeader>
                  <DialogTitle className="text-white">Leave Room?</DialogTitle>
                  <DialogDescription className="text-white/60">
                    Are you sure you want to leave this room?
                  </DialogDescription>
                </DialogHeader>
                <div className="flex gap-3 justify-end">
                  <Button
                    variant="outline"
                    onClick={() => setShowLeaveDialog(false)}
                    className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                  >
                    Cancel
                  </Button>
                  <Button variant="destructive" onClick={handleLeaveRoom}>
                    Leave
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Main Content */}
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Video and Controls */}
          <div className="lg:col-span-2 space-y-6">
            {/* Media Player */}
            <MediaPlayer
              currentMedia={currentMedia}
              isHost={isHost}
              canControl={canControl}
              socket={socket}
              onPlayPause={playPause}
              onSeek={seekTo}
            />

            {/* Media Status */}
            {mediaStatus && (
              <Card className="bg-white/5 border-white/10">
                <CardHeader>
                  <CardTitle className="text-white text-lg">
                    Download Progress
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <div className="flex justify-between text-sm text-white/80 mb-2">
                      <span>Overall: {(mediaStatus.progress * 100).toFixed(1)}%</span>
                      <span>{mediaStatus.num_peers} peers</span>
                    </div>
                    <Progress value={mediaStatus.progress * 100} className="h-2" />
                  </div>
                  {mediaStatus.file_progress !== undefined && (
                    <div>
                      <div className="flex justify-between text-sm text-white/80 mb-2">
                        <span>File: {(mediaStatus.file_progress * 100).toFixed(1)}%</span>
                        <span className="text-xs">
                          {mediaStatus.streaming_ready ? "✅ Ready" : "⏳ Buffering"}
                        </span>
                      </div>
                      <Progress value={mediaStatus.file_progress * 100} className="h-2" />
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Media Controls */}
            <MediaControls
              onLoadMedia={handleLoadMedia}
              onSearchContent={handleSearchContent}
              onSearchYouTube={searchYouTubeVideos}
              canControl={canControl}
              isSearching={isSearching}
              hasSearched={hasSearched}
              contentResults={contentResults}
            />
          </div>

          {/* Right Column - Users, Chat, Video */}
          <div className="space-y-6">
            {/* Users */}
            <Card className="bg-white/5 border-white/10">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Users ({users.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {users.map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-white/5 group"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${user.id === currentUserId ? 'bg-blue-400' : 'bg-green-400'}`} />
                        <div className="flex flex-col">
                          <span className="text-white text-sm font-medium">
                            {user.name} {user.id === currentUserId && "(You)"}
                          </span>
                          <div className="flex gap-1 mt-1">
                            {user.is_host && (
                              <Badge variant="outline" className="text-[10px] h-4 px-1 border-yellow-500/50 text-yellow-500 bg-yellow-500/10">
                                <Crown className="h-2 w-2 mr-1" />
                                Host
                              </Badge>
                            )}
                            {user.can_control && !user.is_host && (
                              <Badge variant="outline" className="text-[10px] h-4 px-1 border-purple-500/50 text-purple-500 bg-purple-500/10">
                                <Music className="h-2 w-2 mr-1" />
                                DJ
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Host controls for other users */}
                      {isHost && user.id !== currentUserId && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/10"
                          onClick={() => grantControl(user.id, !user.can_control)}
                        >
                          {user.can_control ? "Revoke Control" : "Grant Control"}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Chat */}
            <Card className="bg-white/5 border-white/10 h-96">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <MessageCircle className="h-5 w-5" />
                  Chat
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 h-[calc(100%-5rem)]">
                <ChatPanel
                  messages={chatMessages}
                  onSendMessage={sendMessage}
                  currentUserName={userName}
                />
              </CardContent>
            </Card>

            {/* Video Chat */}
            <Card className="bg-white/5 border-white/10">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Video className="h-5 w-5" />
                  Video Chat
                </CardTitle>
              </CardHeader>
              <CardContent>
                {socket && (
                  <VideoChat
                    socket={socket}
                    currentUserId={currentUserId}
                    users={users}
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  )
}
