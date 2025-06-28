"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Play, Users, MessageCircle, Video, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { createSocket } from "@/lib/api"

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

export default function WatchWithMi() {
  const [createUserName, setCreateUserName] = useState("")
  const [joinUserName, setJoinUserName] = useState("")
  const [roomCode, setRoomCode] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [toasts, setToasts] = useState<
    Array<{ id: number; message: string; type: "info" | "success" | "error" | "warning" }>
  >([])

  const showToast = (message: string, type: "info" | "success" | "error" | "warning" = "info") => {
    const id = Date.now()
    setToasts((prev) => [...prev, { id, message, type }])
  }

  const removeToast = (id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }

  const validateCreateInput = () => {
    const userName = createUserName.trim()
    if (!userName) {
      showToast("Please enter your name", "warning")
      return false
    }
    if (userName.length < 2) {
      showToast("Name must be at least 2 characters", "warning")
      return false
    }
    return userName
  }

  const validateJoinInput = () => {
    const userName = joinUserName.trim()
    if (!userName) {
      showToast("Please enter your name", "warning")
      return false
    }
    if (userName.length < 2) {
      showToast("Name must be at least 2 characters", "warning")
      return false
    }
    return userName
  }

  const handleCreateRoom = () => {
    const userName = validateCreateInput()
    if (!userName) return

    setIsLoading(true)
    
    // Create socket connection and emit create_room event
    const socket = createSocket("", userName)
    
    socket.on('room_created', (data) => {
      setIsLoading(false)
      showToast(`Room ${data.room_code} created!`, "success")
      window.location.href = `/room/${data.room_code}?name=${encodeURIComponent(userName)}`
    })
    
    socket.on('error', (error) => {
      setIsLoading(false)
      showToast(`Failed to create room: ${error.message}`, "error")
    })
    
    socket.connect()
    socket.emit('create_room', { user_name: userName })
  }

  const handleJoinRoom = () => {
    const userName = validateJoinInput()
    if (!userName) return

    const code = roomCode.trim().toUpperCase()
    if (!code) {
      showToast("Please enter a room code", "warning")
      return
    }
    if (code.length !== 6) {
      showToast("Room code must be 6 characters", "warning")
      return
    }

    setIsLoading(true)
    
    // Create socket connection and emit join_room event
    const socket = createSocket(code, userName)
    
    socket.on('joined_room', () => {
      setIsLoading(false)
      showToast(`Joined room ${code}!`, "success")
      window.location.href = `/room/${code}?name=${encodeURIComponent(userName)}`
    })
    
    socket.on('error', (error) => {
      setIsLoading(false)
      showToast(`Failed to join room: ${error.message}`, "error")
    })
    
    socket.connect()
    socket.emit('join_room', { room_code: code, user_name: userName })
  }

  const handleRoomCodeChange = (value: string) => {
    setRoomCode(value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
  }

  const handleKeyPress = (e: React.KeyboardEvent, action: () => void) => {
    if (e.key === "Enter") {
      action()
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse delay-1000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-indigo-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse delay-500"></div>
      </div>

      <div className="relative z-10 w-full max-w-md space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center space-x-3">
            <div className="p-3 bg-gradient-to-r from-purple-500 to-blue-500 rounded-2xl shadow-lg">
              <Play className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
              WatchWithMi
            </h1>
          </div>
          <p className="text-lg text-gray-300 font-medium">Watch videos together in perfect sync</p>

          {/* Feature badges */}
          <div className="flex justify-center space-x-2">
            <Badge
              variant="secondary"
              className="bg-white/10 text-white border-white/20 hover:bg-white/20 transition-colors"
            >
              <Video className="w-3 h-3 mr-1" />
              Sync Playback
            </Badge>
            <Badge
              variant="secondary"
              className="bg-white/10 text-white border-white/20 hover:bg-white/20 transition-colors"
            >
              <MessageCircle className="w-3 h-3 mr-1" />
              Live Chat
            </Badge>
            <Badge
              variant="secondary"
              className="bg-white/10 text-white border-white/20 hover:bg-white/20 transition-colors"
            >
              <Users className="w-3 h-3 mr-1" />
              Video Chat
            </Badge>
          </div>
        </div>

        {/* Main content cards */}
        <div className="space-y-6">
          {/* Create Room Card */}
          <Card className="bg-white/10 backdrop-blur-lg border-white/20 shadow-xl">
            <CardHeader className="text-center">
              <CardTitle className="text-white flex items-center justify-center space-x-2">
                <Play className="w-5 h-5" />
                <span>Start New Room</span>
              </CardTitle>
              <CardDescription className="text-gray-300">
                Create a room and invite friends to watch together
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="create-name" className="text-gray-200 font-medium">
                  Your Name
                </Label>
                <Input
                  id="create-name"
                  type="text"
                  placeholder="Enter your name"
                  value={createUserName}
                  onChange={(e) => setCreateUserName(e.target.value)}
                  onKeyDown={(e) => handleKeyPress(e, handleCreateRoom)}
                  className="bg-white/10 border-white/20 text-white placeholder:text-gray-400 focus:border-purple-400 focus:ring-purple-400/20"
                  disabled={isLoading}
                />
              </div>
              <Button
                onClick={handleCreateRoom}
                disabled={isLoading}
                className="w-full bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white border-0 font-semibold py-3 transition-all duration-200 disabled:opacity-50"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating Room...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-2" />
                    Create Room
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          <Separator className="bg-white/20" />

          {/* Join Room Card */}
          <Card className="bg-white/10 backdrop-blur-lg border-white/20 shadow-xl">
            <CardHeader className="text-center">
              <CardTitle className="text-white flex items-center justify-center space-x-2">
                <Users className="w-5 h-5" />
                <span>Join Room</span>
              </CardTitle>
              <CardDescription className="text-gray-300">
                Enter a room code to join an existing session
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="join-name" className="text-gray-200 font-medium">
                  Your Name
                </Label>
                <Input
                  id="join-name"
                  type="text"
                  placeholder="Enter your name"
                  value={joinUserName}
                  onChange={(e) => setJoinUserName(e.target.value)}
                  className="bg-white/10 border-white/20 text-white placeholder:text-gray-400 focus:border-purple-400 focus:ring-purple-400/20"
                  disabled={isLoading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="room-code" className="text-gray-200 font-medium">
                  Room Code
                </Label>
                <Input
                  id="room-code"
                  type="text"
                  placeholder="ABC123"
                  value={roomCode}
                  onChange={(e) => handleRoomCodeChange(e.target.value)}
                  onKeyDown={(e) => handleKeyPress(e, handleJoinRoom)}
                  maxLength={6}
                  className="bg-white/10 border-white/20 text-white placeholder:text-gray-400 focus:border-purple-400 focus:ring-purple-400/20 font-mono text-center tracking-wider"
                  disabled={isLoading}
                />
              </div>
              <Button
                onClick={handleJoinRoom}
                disabled={isLoading}
                className="w-full bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white border-0 font-semibold py-3 transition-all duration-200 disabled:opacity-50"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Joining Room...
                  </>
                ) : (
                  <>
                    <Users className="w-4 h-4 mr-2" />
                    Join Room
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Footer */}
        <div className="text-center text-gray-400 text-sm">
          <p>Sync up with friends and watch together!</p>
        </div>
      </div>


    </div>
  )
} 