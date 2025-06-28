'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Play, Users, Plus, LogIn } from 'lucide-react';

export default function HomePage() {
  const router = useRouter();
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
    
    if (isCreating) {
      console.log('⏳ Room creation already in progress, ignoring...');
      return; // Prevent double-clicking
    }
    
    setError('');
    setIsCreating(true);
    try {
      // Generate a random room code
      const newRoomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      console.log('🆕 Creating room with code:', newRoomCode);
      router.push(`/room/${newRoomCode}?name=${encodeURIComponent(createUserName.trim())}`);
    } catch (error) {
      console.error('Error creating room:', error);
      setError('Failed to create room. Please try again.');
      setIsCreating(false); // Reset on error
    }
    // Don't reset isCreating here - let the navigation handle it
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
    
    if (isJoining) {
      console.log('⏳ Room join already in progress, ignoring...');
      return; // Prevent double-clicking
    }
    
    setError('');
    setIsJoining(true);
    console.log('🔗 Joining room:', roomCode.trim().toUpperCase());
    router.push(`/room/${roomCode.trim().toUpperCase()}?name=${encodeURIComponent(joinUserName.trim())}`);
    // Don't reset isJoining here - let the navigation handle it
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center space-x-3 mb-4">
            <div className="p-3 bg-gradient-to-r from-purple-500 to-blue-500 rounded-xl shadow-lg">
              <Play className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
              WatchWithMi
            </h1>
          </div>
          <p className="text-gray-300 text-lg">
            Watch videos together in real-time
          </p>
        </div>

        <Card className="bg-black/40 backdrop-blur-xl border-white/10 shadow-2xl">
          <CardHeader>
            <CardTitle className="text-white flex items-center">
              <Users className="w-5 h-5 mr-2" />
              Join the Fun
            </CardTitle>
            <CardDescription className="text-gray-300">
              Enter your name to create a new room or join an existing one
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Error Message */}
            {error && (
              <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-3 text-red-300 text-sm">
                {error}
              </div>
            )}

            {/* Username Field - Required for both create and join */}
            <div>
              <label className="text-sm font-medium text-gray-300 mb-2 block">
                Your Name *
              </label>
              <Input
                placeholder="Enter your name..."
                value={createUserName}
                onChange={(e) => {
                  setCreateUserName(e.target.value);
                  setError(''); // Clear error when user types
                }}
                className="bg-gray-800/50 border-gray-600 text-white placeholder-gray-400"
                onKeyPress={(e) => e.key === 'Enter' && createRoom()}
              />
            </div>

            {/* Create Room Button */}
            <Button
              onClick={createRoom}
              disabled={!createUserName.trim() || isCreating}
              className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl"
            >
              <Plus className="w-4 h-4 mr-2" />
              {isCreating ? 'Creating Room...' : 'Create New Room'}
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-600"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-black/40 px-2 text-gray-400">or</span>
              </div>
            </div>

            {/* Join Room Section */}
            <div className="space-y-3 p-4 bg-gray-800/20 rounded-lg border border-gray-600/50">
              <h3 className="text-sm font-medium text-gray-200 mb-3">Join Existing Room</h3>
              
              {/* Name field for joining */}
              <div>
                <label className="text-sm font-medium text-gray-300 mb-2 block">
                  Your Name *
                </label>
                <Input
                  placeholder="Enter your name..."
                  value={joinUserName}
                  onChange={(e) => {
                    setJoinUserName(e.target.value);
                    setError(''); // Clear error when user types
                  }}
                  className="bg-gray-800/50 border-gray-600 text-white placeholder-gray-400"
                />
              </div>

              {/* Room Code Field */}
              <div>
                <label className="text-sm font-medium text-gray-300 mb-2 block">
                  Room Code *
                </label>
                <Input
                  placeholder="Enter 6-digit room code..."
                  value={roomCode}
                  onChange={(e) => {
                    setRoomCode(e.target.value.toUpperCase());
                    setError(''); // Clear error when user types
                  }}
                  className="bg-gray-800/50 border-gray-600 text-white placeholder-gray-400"
                  onKeyPress={(e) => e.key === 'Enter' && joinRoom()}
                  maxLength={6}
                />
              </div>

              <Button
                onClick={joinRoom}
                disabled={!roomCode.trim() || !joinUserName.trim() || isJoining}
                variant="outline"
                className="w-full bg-white/10 border-white/20 text-white hover:bg-white/20 transition-all duration-200"
              >
                <LogIn className="w-4 h-4 mr-2" />
                {isJoining ? 'Joining Room...' : 'Join Existing Room'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="text-center mt-6 text-gray-400 text-sm">
          <p>🎬 Stream YouTube videos, torrents, and direct links</p>
          <p>🔄 Real-time synchronization with friends</p>
          <p>💬 Built-in chat for discussions</p>
        </div>
      </div>
    </div>
  );
} 