"use client"

import { useCallback, useState, use } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Copy, LogOut, Users, MessageCircle, Video, Crown, Music } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CollapsiblePanel } from "@/components/CollapsiblePanel"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { useRoom } from "@/hooks/useRoom"
import { useMediaQuery } from "@/hooks/useMediaQuery"
import { useSidebarPanels } from "@/hooks/useSidebarPanels"
import { VideoChat } from "@/components/VideoChat"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { MediaPlayer } from "@/components/MediaPlayer"
import { ChatPanel } from "@/components/ChatPanel"
import { MediaControls } from "@/components/MediaControls"
import { ThemeToggle } from "@/components/ThemeToggle"
import { logger } from "@/lib/logger"

export const dynamic = 'force-dynamic';

// Toast notification component
function Toast({
  message,
  type,
}: { message: string; type: "info" | "success" | "error" | "warning" }) {
  // Neutral surface in every state; only the text carries the meaning.
  const tone = {
    info: "text-foreground",
    success: "text-pos",
    error: "text-destructive",
    warning: "text-warn",
  }

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 shadow-lg animate-in slide-in-from-right-full duration-200">
      <p className={`text-sm font-medium ${tone[type]}`}>{message}</p>
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

  // Responsive breakpoints for the room layout.
  // - sm (<768px): sidebar stacks below the player, only one panel expanded at a time.
  // - md (768-1023px): sidebar is a narrower right column.
  // - lg (>=1024px): full 400px right column.
  const isDesktop = useMediaQuery("(min-width: 1024px)")
  const isTablet = useMediaQuery("(min-width: 768px) and (max-width: 1023.98px)")
  const isMobile = !isDesktop && !isTablet

  // Collapsible sidebar panels. Smart defaults:
  //   USERS: collapsed on mobile (it's a secondary glance), expanded on desktop.
  //   CHAT: expanded by default everywhere - primary interaction surface.
  //   VIDEO: collapsed by default; auto-expands when a call becomes active
  //          (wired via VideoChat's onActiveChange below).
  const sidebar = useSidebarPanels(
    {
      users: { defaultExpanded: !isMobile },
      chat: { defaultExpanded: true },
      video: { defaultExpanded: false },
    },
    { singleExpandMode: isMobile },
  )

  // Auto-expand/collapse video panel as the call state changes.
  const handleVideoActiveChange = useCallback(
    (active: boolean) => {
      sidebar.setExpanded("video", active)
    },
    [sidebar],
  )

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
      <div className="h-screen flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-lg border border-destructive/40 bg-destructive/10">
            <span className="text-2xl font-semibold text-destructive">!</span>
          </div>
          <h1 className="mb-3 text-2xl font-semibold text-foreground">
            Room not found
          </h1>
          <p className="mb-8 text-sm text-muted-foreground">{roomError}</p>
          <Button onClick={() => router.push('/')} className="h-11">
            Back to home
          </Button>
        </div>
      </div>
    )
  }

  // Loading skeleton state
  if (!connected) {
    return (
      <div className="h-screen flex flex-col bg-background overflow-hidden">
        {/* Header skeleton */}
        <div className="border-b border-border bg-card">
          <div className="max-w-full px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
                <div className="flex items-center gap-3">
                  <div className="h-7 w-24 animate-pulse rounded-md bg-muted" />
                  <div className="h-7 w-16 animate-pulse rounded-md bg-muted" />
                </div>
              </div>
              <div className="h-9 w-32 animate-pulse rounded-md bg-muted" />
            </div>
          </div>
        </div>

        {/* Main content skeleton */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Video player skeleton */}
          <div className="flex-1 flex flex-col border-r border-border">
            <div className="flex-1 bg-muted p-4">
              <div className="aspect-video animate-pulse rounded-lg bg-secondary" />
            </div>
            <div className="border-t border-border bg-card p-4">
              <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
            </div>
          </div>

          {/* Right: Users + Chat skeleton */}
          <div className="w-[400px] flex flex-col bg-card">
            {/* Users skeleton */}
            <div className="border-b border-border p-4">
              <div className="mb-3 h-5 w-24 animate-pulse rounded-md bg-muted" />
              <div className="space-y-2">
                <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
                <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
                <div className="h-10 w-3/4 animate-pulse rounded-md bg-muted" />
              </div>
            </div>

            {/* Chat skeleton */}
            <div className="flex-1 border-b border-border p-4">
              <div className="mb-3 h-5 w-16 animate-pulse rounded-md bg-muted" />
              <div className="space-y-3">
                <div className="h-6 w-4/5 animate-pulse rounded-md bg-muted" />
                <div className="h-6 w-3/5 animate-pulse rounded-md bg-muted" />
                <div className="h-6 w-full animate-pulse rounded-md bg-muted" />
                <div className="h-6 w-2/3 animate-pulse rounded-md bg-muted" />
                <div className="h-6 w-4/5 animate-pulse rounded-md bg-muted" />
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <div className="h-screen flex flex-col bg-background overflow-hidden">
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
        <div className="border-b border-border bg-card">
          <div className="max-w-full px-6 py-4">
            <div className="flex items-center justify-between gap-4">
              {/* Left: Logo + Room Info */}
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-card">
                    <img src="/logo.svg" alt="WatchWithMi" width={24} height={24} />
                  </span>
                  <h1 className="text-2xl font-semibold text-foreground">
                    WatchWithMi
                  </h1>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="secondary" className="num px-3 py-1 font-mono text-sm uppercase">
                    {actualRoomCode}
                  </Badge>
                  <Button
                    variant="outline"
                    onClick={copyRoomCode}
                    className="h-11 transition-colors duration-150"
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    Copy
                  </Button>
                  <ThemeToggle />
                  <Badge
                    variant="outline"
                    className={`px-3 py-1 text-xs ${connected ? 'text-pos' : 'text-destructive'}`}
                  >
                    {connected ? "Connected" : "Disconnected"}
                  </Badge>
                </div>
              </div>

              {/* Right: Leave Button */}
              <Dialog open={showLeaveDialog} onOpenChange={setShowLeaveDialog}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="h-11 text-destructive transition-colors duration-150">
                    <LogOut className="mr-2 h-4 w-4" />
                    Leave room
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Leave room?</DialogTitle>
                    <DialogDescription>
                      Are you sure you want to leave this room?
                    </DialogDescription>
                  </DialogHeader>
                  <div className="flex gap-3 justify-end">
                    <Button
                      variant="outline"
                      onClick={() => setShowLeaveDialog(false)}
                      className="h-11 transition-colors duration-150"
                    >
                      Cancel
                    </Button>
                    {/* Outline, not a destructive fill: shadcn's destructive
                        variant hardcodes text-white, which is 3.06:1 on the
                        dark theme's --neg. */}
                    <Button
                      variant="outline"
                      onClick={handleLeaveRoom}
                      className="h-11 border-destructive/40 text-destructive transition-colors duration-150 hover:bg-destructive/10"
                    >
                      Leave
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>

        {/* Main Content: side-by-side on md+, stacked on mobile so the
            sidebar sections drop BELOW the player instead of squeezing
            beside it. */}
        <div className={`flex-1 flex overflow-hidden ${isMobile ? "flex-col" : "flex-row"}`}>
          {/* Left: Media Player + Controls. On mobile the right-border
              becomes the sidebar's top-border handled by the aside below. */}
          <div className={`flex-1 flex flex-col overflow-y-auto min-h-0 ${isMobile ? "" : ""}`}>
            {/* Media Player */}
            <div className="flex-1 bg-muted">
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
              <div className="border-t border-border bg-card p-4">
                <div className="space-y-3">
                  <div>
                    <div className="mb-2 flex items-baseline justify-between gap-3">
                      <span className="label">Overall</span>
                      <span className="num text-sm text-foreground">
                        {(mediaStatus.progress * 100).toFixed(1)}%
                      </span>
                      <span className="num ml-auto text-sm text-muted-foreground">
                        {mediaStatus.num_peers} peers
                      </span>
                    </div>
                    <Progress value={mediaStatus.progress * 100} className="h-2 bg-secondary" />
                  </div>
                  {mediaStatus.file_progress !== undefined && (
                    <div>
                      <div className="mb-2 flex items-baseline justify-between gap-3">
                        <span className="label">File</span>
                        <span className="num text-sm text-foreground">
                          {(mediaStatus.file_progress * 100).toFixed(1)}%
                        </span>
                        <span className={`ml-auto text-sm ${mediaStatus.streaming_ready ? 'text-pos' : 'text-warn'}`}>
                          {mediaStatus.streaming_ready ? "Ready" : "Buffering"}
                        </span>
                      </div>
                      <Progress value={mediaStatus.file_progress * 100} className="h-2 bg-secondary" />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Media Controls */}
            <div className="border-t border-border bg-card">
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

          {/* Right Sidebar: three collapsible panels (USERS / CHAT / VIDEO CHAT).
              Desktop: fixed-width right column. Tablet: narrower right column.
              Mobile: stacks BELOW the player via flex-col on the outer row,
              see the `isMobile` branch on that row's className above. */}
          <aside
            className={`flex flex-col bg-card min-h-0 overflow-hidden ${
              isMobile
                ? "w-full border-t border-border"
                : isTablet
                  ? "w-[320px] border-l border-border"
                  : "w-[400px] border-l border-border"
            }`}
          >
            <CollapsiblePanel
              title="Users"
              icon={Users}
              count={users.length}
              expanded={sidebar.expanded.users}
              onToggle={() => sidebar.toggle("users")}
              onSolo={() => sidebar.solo("users")}
              className="border-b border-border"
            >
              <div className="p-3 space-y-2 h-full overflow-y-auto">
                {users.map((user) => (
                  <div
                    key={user.id}
                    className="group flex items-center justify-between gap-2 rounded-md border border-border bg-secondary p-2 transition-colors duration-150 hover:border-line-2"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={`h-2 w-2 shrink-0 rounded-full ${user.id === currentUserId ? 'bg-primary' : 'bg-muted-foreground'}`}
                      />
                      <div className="flex flex-col">
                        <span className="text-sm text-foreground">
                          {user.name} {user.id === currentUserId && "(you)"}
                        </span>
                        <div className="flex gap-1 mt-1">
                          {user.is_host && (
                            <span className="label inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
                              <Crown className="h-2.5 w-2.5 text-primary" aria-hidden="true" />
                              Host
                            </span>
                          )}
                          {user.can_control && !user.is_host && (
                            <span className="label inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
                              <Music className="h-2.5 w-2.5 text-primary" aria-hidden="true" />
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
                        variant="outline"
                        className="h-11 px-3 text-xs opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100"
                        onClick={() => grantControl(user.id, !user.can_control)}
                      >
                        {user.can_control ? "Revoke" : "Grant"}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </CollapsiblePanel>

            <CollapsiblePanel
              title="Chat"
              icon={MessageCircle}
              count={chatMessages.filter((m) => !m.isServer).length}
              expanded={sidebar.expanded.chat}
              onToggle={() => sidebar.toggle("chat")}
              onSolo={() => sidebar.solo("chat")}
              className="border-b border-border"
            >
              <ChatPanel
                messages={chatMessages}
                onSendMessage={sendMessage}
                currentUserName={userName}
                currentUserId={currentUserId}
                onToggleReaction={toggleReaction}
              />
            </CollapsiblePanel>

            <CollapsiblePanel
              title="Video chat"
              icon={Video}
              expanded={sidebar.expanded.video}
              onToggle={() => sidebar.toggle("video")}
              onSolo={() => sidebar.solo("video")}
            >
              <div className="p-3 h-full overflow-y-auto">
                {socket && (
                  <VideoChat
                    socket={socket}
                    currentUserId={currentUserId}
                    users={users}
                    onActiveChange={handleVideoActiveChange}
                  />
                )}
              </div>
            </CollapsiblePanel>
          </aside>
        </div>
      </div>
    </ErrorBoundary>
  )
}
