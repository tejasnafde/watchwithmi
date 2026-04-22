/**
 * Chat Panel Component
 *
 * Displays chat messages and input with emoji reactions
 */

'use client';

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { logger } from '@/lib/logger';
import type { ChatMessage } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Send, Plus } from 'lucide-react';
import { choosePickerAnchor, type PickerAnchor } from '@/lib/pickerPlacement';

const REACTION_EMOJIS = ['😂', '❤️', '👍', '👎', '🔥', '😮', '😢', '🎉'];

interface ChatPanelProps {
    messages: ChatMessage[];
    onSendMessage: (message: string) => void;
    currentUserName: string;
    currentUserId?: string;
    onToggleReaction?: (messageId: string, emoji: string) => void;
}

// Approximate picker width: 8 columns × 32px + gaps + padding. Kept in
// sync with the grid below. Precise measurement is done at runtime via
// the ref after mount.
const PICKER_ESTIMATED_WIDTH = 280;
const PICKER_EDGE_MARGIN = 8;

function EmojiPicker({
    onSelect,
    onClose,
    triggerRef,
}: {
    onSelect: (emoji: string) => void;
    onClose: () => void;
    triggerRef: React.RefObject<HTMLElement | null>;
}) {
    const ref = useRef<HTMLDivElement>(null);
    // Start right-anchored to preserve desktop look; useLayoutEffect flips
    // to left-anchor if that would clip the viewport edge on narrow screens
    // (bug #3.7 in docs/polishing/03-chat-reactions-queue.md).
    const [anchor, setAnchor] = useState<PickerAnchor>('right');

    useLayoutEffect(() => {
        const trigger = triggerRef.current;
        if (!trigger || typeof window === 'undefined') return;

        const rect = trigger.getBoundingClientRect();
        const measured = ref.current?.getBoundingClientRect().width;
        setAnchor(
            choosePickerAnchor({
                triggerRight: rect.right,
                viewportWidth: window.innerWidth,
                pickerWidth: measured || PICKER_ESTIMATED_WIDTH,
                margin: PICKER_EDGE_MARGIN,
            }),
        );
    }, [triggerRef]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);

    return (
        <div
            ref={ref}
            className={`absolute bottom-full mb-1 ${anchor === 'right' ? 'right-0' : 'left-0'} z-50 bg-black border-2 border-white p-1.5 grid grid-cols-8 gap-1`}
        >
            {REACTION_EMOJIS.map((emoji) => (
                <button
                    key={emoji}
                    onClick={() => {
                        onSelect(emoji);
                        onClose();
                    }}
                    className="w-8 h-8 flex items-center justify-center text-base hover:bg-white/20 transition-colors"
                >
                    {emoji}
                </button>
            ))}
        </div>
    );
}

function MessageReactions({
    reactions,
    currentUserId,
    onToggle,
}: {
    reactions: Record<string, string[]>;
    currentUserId: string;
    onToggle: (emoji: string) => void;
}) {
    const [showPicker, setShowPicker] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);

    // Memoize the picker callbacks so their identity is stable across
    // parent re-renders; otherwise EmojiPicker's document-listener effect
    // detaches and reattaches on every re-render (bug #3.2 in
    // docs/polishing/03-chat-reactions-queue.md).
    const closePicker = useCallback(() => setShowPicker(false), []);
    const selectEmoji = useCallback(
        (emoji: string) => onToggle(emoji),
        [onToggle],
    );

    const entries = Object.entries(reactions).filter(([, users]) => users.length > 0);

    return (
        <div className="flex items-center gap-1 mt-1 flex-wrap relative">
            {entries.map(([emoji, users]) => {
                const isActive = users.includes(currentUserId);
                return (
                    <button
                        key={emoji}
                        onClick={() => onToggle(emoji)}
                        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono border transition-colors ${
                            isActive
                                ? 'bg-white/20 border-white/40 text-white'
                                : 'bg-transparent border-white/20 text-white/70 hover:border-white/40'
                        }`}
                    >
                        <span>{emoji}</span>
                        <span>{users.length}</span>
                    </button>
                );
            })}
            <div className="relative">
                <button
                    ref={triggerRef}
                    onClick={() => setShowPicker(!showPicker)}
                    className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-mono border border-white/20 text-white/50 hover:border-white/40 hover:text-white transition-colors"
                >
                    <Plus className="w-3 h-3" />
                </button>
                {showPicker && (
                    <EmojiPicker
                        triggerRef={triggerRef}
                        onSelect={selectEmoji}
                        onClose={closePicker}
                    />
                )}
            </div>
        </div>
    );
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
    messages,
    onSendMessage,
    currentUserName,
    currentUserId = '',
    onToggleReaction,
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
                                    {msg.message_id && onToggleReaction && (
                                        <MessageReactions
                                            reactions={msg.reactions || {}}
                                            currentUserId={currentUserId}
                                            onToggle={(emoji) => onToggleReaction(msg.message_id!, emoji)}
                                        />
                                    )}
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
