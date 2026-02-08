'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Play, Users, Plus, LogIn, ArrowRight, MessageCircle } from 'lucide-react';
import Image from 'next/image';

export default function HomePage() {
  const router = useRouter();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showJoinDialog, setShowJoinDialog] = useState(false);
  const [roomCode, setRoomCode] = useState('');
  const [createUserName, setCreateUserName] = useState('');
  const [joinUserName, setJoinUserName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState('');

  const createRoom = async () => {
    if (!createUserName.trim()) {
      setError('Please enter your name');
      return;
    }

    if (isCreating) return;

    setError('');
    setIsCreating(true);
    try {
      const newRoomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      router.push(`/room/${newRoomCode}?name=${encodeURIComponent(createUserName.trim())}`);
    } catch (error) {
      console.error('Error creating room:', error);
      setError('Failed to create room. Please try again.');
      setIsCreating(false);
    }
  };

  const joinRoom = () => {
    if (!roomCode.trim()) {
      setError('Please enter a room code');
      return;
    }
    if (!joinUserName.trim()) {
      setError('Please enter your name');
      return;
    }

    if (isJoining) return;

    setError('');
    setIsJoining(true);
    router.push(`/room/${roomCode.trim().toUpperCase()}?name=${encodeURIComponent(joinUserName.trim())}`);
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-6">
      {/* Main Container */}
      <div className="w-full max-w-4xl">
        {/* Header */}
        <div className="mb-16 text-center">
          <div className="flex items-center justify-center gap-6 mb-6">
            <div className="w-20 h-20 bg-white flex items-center justify-center border-4 border-white">
              <Image src="/logo.svg" alt="WatchWithMi" width={80} height={80} />
            </div>
            <h1 className="text-6xl md:text-7xl font-bold text-white">
              WATCHWITHMI
            </h1>
          </div>
          <p className="text-xl text-gray-300 uppercase tracking-wide">
            Synchronized Video Watching // Real-Time Chat
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
          <button
            onClick={() => setShowCreateDialog(true)}
            className="group relative p-10 border-4 border-white bg-[#0a0a0a] transition-all duration-300 hover:scale-[1.02]"
          >
            <div className="relative">
              <div className="w-16 h-16 mx-auto mb-4 bg-black flex items-center justify-center">
                <Plus className="w-10 h-10 text-white" strokeWidth={3} />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2 uppercase tracking-wide">Create Room</h2>
              <p className="text-gray-400 text-sm">Start a new watch party</p>
              <ArrowRight className="w-6 h-6 absolute bottom-4 right-4 text-gray-600 group-hover:text-white group-hover:translate-x-1 transition-all" />
            </div>
          </button>

          <button
            onClick={() => setShowJoinDialog(true)}
            className="group relative p-10 border-4 border-white bg-[#0a0a0a] transition-all duration-300 hover:scale-[1.02]"
          >

            <div className="relative">
              <div className="w-16 h-16 mx-auto mb-4 bg-black flex items-center justify-center">
                <LogIn className="w-10 h-10 text-white" strokeWidth={3} />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2 uppercase tracking-wide">Join Room</h2>
              <p className="text-gray-400 text-sm">Enter an existing room</p>
              <ArrowRight className="w-6 h-6 absolute bottom-4 right-4 text-gray-600 group-hover:text-white group-hover:translate-x-1 transition-all" />
            </div>
          </button>
        </div>

        {/* Feature Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 border-2 border-white/10 text-center">
            <Users className="w-12 h-12 mx-auto mb-3 text-white" strokeWidth={2} />
            <h3 className="text-white font-bold text-base mb-2 uppercase">Watch Together</h3>
            <p className="text-gray-400 text-sm">Synchronized playback</p>
          </div>
          <div className="p-6 border-2 border-white/10 text-center">
            <Play className="w-12 h-12 mx-auto mb-3 text-white" strokeWidth={2} />
            <h3 className="text-white font-bold text-base mb-2 uppercase">Multiple Sources</h3>
            <p className="text-gray-400 text-sm">YouTube, links, files</p>
          </div>
          <div className="p-6 border-2 border-white/10 text-center">
            <MessageCircle className="w-12 h-12 mx-auto mb-3 text-white" strokeWidth={2} />
            <h3 className="text-white font-bold text-base mb-2 uppercase">Built-In Chat</h3>
            <p className="text-gray-400 text-sm">Real-time discussion</p>
          </div>
        </div>
      </div>

      {/* Create Room Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="bg-black/95 border-2 border-white/20 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold uppercase flex items-center gap-3">
              <Plus className="w-6 h-6" />
              Create Room
            </DialogTitle>
            <DialogDescription className="text-gray-300">
              Start a new watch party and invite your friends
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 mt-4">
            {error && (
              <div className="bg-red-500/20 border-2 border-red-500/50 p-4 text-red-300 font-mono text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="text-sm font-bold text-gray-300 mb-3 block uppercase tracking-wider">
                Your Name
              </label>
              <Input
                placeholder="ENTER YOUR NAME..."
                value={createUserName}
                onChange={(e) => {
                  setCreateUserName(e.target.value);
                  setError('');
                }}
                className="bg-gray-800/50 border-2 border-gray-600 text-white placeholder-gray-400 text-lg p-6"
                onKeyPress={(e) => e.key === 'Enter' && createRoom()}
                autoFocus
              />
            </div>

            <Button
              onClick={createRoom}
              disabled={!createUserName.trim() || isCreating}
              className="w-full bg-white hover:bg-gray-200 text-black font-bold py-6 text-lg uppercase tracking-wider"
            >
              {isCreating ? 'CREATING...' : 'CREATE ROOM'}
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Join Room Dialog */}
      <Dialog open={showJoinDialog} onOpenChange={setShowJoinDialog}>
        <DialogContent className="bg-black/95 border-2 border-white/20 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold uppercase flex items-center gap-3">
              <LogIn className="w-6 h-6" />
              Join Room
            </DialogTitle>
            <DialogDescription className="text-gray-300">
              Enter a room code to join an existing watch party
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 mt-4">
            {error && (
              <div className="bg-red-500/20 border-2 border-red-500/50 p-4 text-red-300 font-mono text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="text-sm font-bold text-gray-300 mb-3 block uppercase tracking-wider">
                Your Name
              </label>
              <Input
                placeholder="ENTER YOUR NAME..."
                value={joinUserName}
                onChange={(e) => {
                  setJoinUserName(e.target.value);
                  setError('');
                }}
                className="bg-gray-800/50 border-2 border-gray-600 text-white placeholder-gray-400 text-lg p-6"
                autoFocus
              />
            </div>

            <div>
              <label className="text-sm font-bold text-gray-300 mb-3 block uppercase tracking-wider">
                Room Code
              </label>
              <Input
                placeholder="ENTER 6-DIGIT CODE..."
                value={roomCode}
                onChange={(e) => {
                  setRoomCode(e.target.value.toUpperCase());
                  setError('');
                }}
                className="bg-gray-800/50 border-2 border-gray-600 text-white placeholder-gray-400 text-lg p-6 font-mono tracking-widest"
                onKeyPress={(e) => e.key === 'Enter' && joinRoom()}
                maxLength={6}
              />
            </div>

            <Button
              onClick={joinRoom}
              disabled={!roomCode.trim() || !joinUserName.trim() || isJoining}
              variant="outline"
              className="w-full border-2 border-white/30 bg-white/10 text-white hover:bg-white/20 font-bold py-6 text-lg uppercase tracking-wider"
            >
              {isJoining ? 'JOINING...' : 'JOIN ROOM'}
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
} 