'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Play, Users, Plus, LogIn, ArrowRight, MessageCircle } from 'lucide-react';
import Image from 'next/image';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ThemeToggle } from '@/components/ThemeToggle';

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
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      const newRoomCode = Array.from({length: 6}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      router.push(`/room/${newRoomCode}?name=${encodeURIComponent(createUserName.trim())}`);
      // Fallback reset in case navigation doesn't unmount this component
      setTimeout(() => setIsCreating(false), 2000);
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

  const features = [
    { icon: Users, label: 'In sync', copy: 'Everyone sees the same frame at the same moment.' },
    { icon: Play, label: 'Any source', copy: 'YouTube, a direct link, or a file you already have.' },
    { icon: MessageCircle, label: 'Chat', copy: 'React and talk without leaving the video.' },
  ];

  return (
    <ErrorBoundary>
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      {/* pb-20 keeps the last row clear of the tn07 ring bar pinned to the bottom */}
      <div className="w-full max-w-4xl pb-20">
        <div className="mb-6 flex justify-end">
          <ThemeToggle />
        </div>

        <header className="mb-14">
          <div className="flex items-center gap-4 mb-5">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
              <Image src="/logo.svg" alt="" width={32} height={32} aria-hidden="true" />
            </div>
            <h1 className="text-3xl md:text-4xl font-semibold">
              WatchWithMi
            </h1>
          </div>
          <p className="text-lg text-muted-foreground">
            Start a room, send the code to a friend, and watch the same thing at the same time.
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-14">
          <button
            onClick={() => setShowCreateDialog(true)}
            className="group relative rounded-lg border border-border bg-card p-6 text-left transition-colors duration-150 hover:border-primary"
          >
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Plus className="h-5 w-5" />
            </div>
            <h2 className="mb-1 text-lg font-semibold">Create a room</h2>
            <p className="text-sm text-muted-foreground">Start a new watch party.</p>
            <ArrowRight className="absolute bottom-6 right-6 h-4 w-4 text-muted-foreground transition-transform duration-150 group-hover:translate-x-1 group-hover:text-primary" />
          </button>

          <button
            onClick={() => setShowJoinDialog(true)}
            className="group relative rounded-lg border border-border bg-card p-6 text-left transition-colors duration-150 hover:border-primary"
          >
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-md border border-border bg-secondary text-foreground">
              <LogIn className="h-5 w-5" />
            </div>
            <h2 className="mb-1 text-lg font-semibold">Join a room</h2>
            <p className="text-sm text-muted-foreground">Enter a code you were sent.</p>
            <ArrowRight className="absolute bottom-6 right-6 h-4 w-4 text-muted-foreground transition-transform duration-150 group-hover:translate-x-1 group-hover:text-primary" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3">
          {features.map(({ icon: Icon, label, copy }) => (
            <div key={label} className="bg-card p-5">
              <Icon className="mb-3 h-4 w-4 text-primary" />
              <p className="label mb-2">{label}</p>
              <p className="text-sm text-muted-foreground">{copy}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Create Room Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Plus className="h-5 w-5 text-primary" />
              Create a room
            </DialogTitle>
            <DialogDescription>
              Start a new watch party and invite your friends.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2 space-y-5">
            {error && (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </p>
            )}

            <div>
              <label htmlFor="create-name" className="label mb-2 block">
                Your name
              </label>
              <Input
                id="create-name"
                placeholder="Who is watching?"
                value={createUserName}
                onChange={(e) => {
                  setCreateUserName(e.target.value);
                  setError('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && createRoom()}
                autoFocus
              />
            </div>

            <Button
              onClick={createRoom}
              disabled={!createUserName.trim() || isCreating}
              className="w-full"
            >
              {isCreating ? 'Creating...' : 'Create room'}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Join Room Dialog */}
      <Dialog open={showJoinDialog} onOpenChange={setShowJoinDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <LogIn className="h-5 w-5 text-primary" />
              Join a room
            </DialogTitle>
            <DialogDescription>
              Enter a room code to join an existing watch party.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2 space-y-5">
            {error && (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </p>
            )}

            <div>
              <label htmlFor="join-name" className="label mb-2 block">
                Your name
              </label>
              <Input
                id="join-name"
                placeholder="Who is watching?"
                value={joinUserName}
                onChange={(e) => {
                  setJoinUserName(e.target.value);
                  setError('');
                }}
                autoFocus
              />
            </div>

            <div>
              <label htmlFor="join-code" className="label mb-2 block">
                Room code
              </label>
              <Input
                id="join-code"
                placeholder="6 characters"
                value={roomCode}
                onChange={(e) => {
                  setRoomCode(e.target.value.toUpperCase());
                  setError('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && joinRoom()}
                maxLength={6}
                className="num font-mono tracking-[0.3em] uppercase"
              />
            </div>

            <Button
              onClick={joinRoom}
              disabled={!roomCode.trim() || !joinUserName.trim() || isJoining}
              variant="outline"
              className="w-full"
            >
              {isJoining ? 'Joining...' : 'Join room'}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
    </ErrorBoundary>
  );
}
