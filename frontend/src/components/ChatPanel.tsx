/**
 * Chat Panel Component
 * 
 * Displays chat messages and input
 */

'use client';

import React, { useState, useRef, useEffect } from 'react';
import { logger } from '@/lib/logger';
import type { ChatMessage } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Send } from 'lucide-react';

interface ChatPanelProps {
    messages: ChatMessage[];
    onSendMessage: (message: string) => void;
    currentUserName: string;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
    messages,
    onSendMessage,
    currentUserName
}) => {
    const [messageInput, setMessageInput] = useState('');
    const viewportRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when new messages arrive
    useEffect(() => {
        if (viewportRef.current) {
            viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSendMessage = () => {
        if (messageInput.trim()) {
            logger.debug('Sending message', messageInput);
            onSendMessage(messageInput);
            setMessageInput('');
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    return (
        <div className="flex flex-col h-full min-h-0">
            <ScrollArea className="flex-1 min-h-0 p-4" viewportRef={viewportRef}>
                <div className="space-y-3">
                    {messages.map((msg) => (
                        <div
                            key={msg.id}
                            className={`${msg.isServer
                                ? 'text-center text-sm text-white/60 italic'
                                : msg.user_name === currentUserName
                                    ? 'text-right'
                                    : 'text-left'
                                }`}
                        >
                            {!msg.isServer && (
                                <div className="inline-block max-w-[80%]">
                                    <div className="text-[10px] text-white/80 font-mono uppercase mb-1">
                                        {msg.user_name}
                                    </div>
                                    <div
                                        className={`px-4 py-2 border-2 ${msg.user_name === currentUserName
                                            ? 'bg-white text-black border-white font-bold'
                                            : 'bg-black text-white border-white'
                                            }`}
                                    >
                                        {msg.message}
                                    </div>
                                    <div className="text-[10px] text-white/60 font-mono mt-1 uppercase">
                                        {new Date(msg.timestamp).toLocaleTimeString()}
                                    </div>
                                </div>
                            )}
                            {msg.isServer && <div>{msg.message}</div>}
                        </div>
                    ))}
                </div>
            </ScrollArea>

            <div className="shrink-0 p-4 border-t-2 border-white">
                <div className="flex gap-2">
                    <Input
                        value={messageInput}
                        onChange={(e) => setMessageInput(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder="TYPE A MESSAGE..."
                        className="flex-1 bg-black border-2 border-white text-white placeholder:text-white/40 font-mono"
                    />
                    <Button
                        onClick={handleSendMessage}
                        disabled={!messageInput.trim()}
                        className="bg-white text-black hover:bg-gray-200 border-2 border-white rounded-none"
                    >
                        <Send className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
};
