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
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when new messages arrive
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
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
        <div className="flex flex-col h-full">
            <ScrollArea className="flex-1 p-4" ref={scrollRef}>
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
                                    <div className="text-xs text-white/60 mb-1">
                                        {msg.user_name}
                                    </div>
                                    <div
                                        className={`px-4 py-2 rounded-lg ${msg.user_name === currentUserName
                                                ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white'
                                                : 'bg-white/10 text-white'
                                            }`}
                                    >
                                        {msg.message}
                                    </div>
                                    <div className="text-xs text-white/40 mt-1">
                                        {new Date(msg.timestamp).toLocaleTimeString()}
                                    </div>
                                </div>
                            )}
                            {msg.isServer && <div>{msg.message}</div>}
                        </div>
                    ))}
                </div>
            </ScrollArea>

            <div className="p-4 border-t border-white/10">
                <div className="flex gap-2">
                    <Input
                        value={messageInput}
                        onChange={(e) => setMessageInput(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder="Type a message..."
                        className="flex-1 bg-white/5 border-white/10 text-white placeholder:text-white/40"
                    />
                    <Button
                        onClick={handleSendMessage}
                        disabled={!messageInput.trim()}
                        className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
                    >
                        <Send className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
};
