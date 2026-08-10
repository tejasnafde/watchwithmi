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

const REACTION_EMOJIS = ['', '', '', '', '', '', '', ''];

interface ChatPanelProps {
    messages: ChatMessage[];
    onSendMessage: (message: string) => void;
    currentUserName: string;
    currentUserId?: string;
    onToggleReaction?: (messageId: string, emoji: string) => void;
}

// Fallback only; the real width is measured from the ref after mount.
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
            className={`absolute bottom-full mb-1 ${anchor === 'right' ? 'right-0' : 'left-0'} z-50 grid grid-cols-4 gap-1 rounded-lg border border-border bg-card p-1.5 shadow-md`}
        >
            {REACTION_EMOJIS.map((emoji) => (
                <button
                    key={emoji}
                    onClick={() => {
                        onSelect(emoji);
                        onClose();
                    }}
                    className="flex h-11 w-11 items-center justify-center rounded-md text-base transition-colors duration-150 hover:bg-accent"
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
                        className={`inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs transition-colors duration-150 ${
                            isActive
                                ? 'border-primary bg-secondary text-foreground'
                                : 'border-border bg-card text-muted-foreground hover:border-line-2 hover:text-foreground'
                        }`}
                    >
                        <span>{emoji}</span>
                        <span className="num">{users.length}</span>
                    </button>
                );
            })}
            <div className="relative">
                {/* 28px, not the house 44px: at 44px an inline chip is taller
                    than the message it annotates. Clears WCAG 2.5.8 AA (24px). */}
                <button
                    ref={triggerRef}
                    data-testid="add-reaction"
                    onClick={() => setShowPicker(!showPicker)}
                    aria-label="Add reaction"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors duration-150 hover:border-line-2 hover:text-foreground"
                >
                    <Plus className="w-3 h-3" aria-hidden="true" />
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
                                ? 'text-center text-sm text-muted-foreground italic'
                                : msg.user_name === currentUserName
                                    ? 'text-right'
                                    : 'text-left'
                                }`}
                        >
                            {!msg.isServer && (
                                <div className="inline-block max-w-[80%]">
                                    <div className="label mb-1">
                                        {msg.user_name}
                                    </div>
                                    <div
                                        className={`rounded-lg px-4 py-2 text-sm ${msg.user_name === currentUserName
                                            ? 'bg-primary text-primary-foreground'
                                            : 'border border-border bg-secondary text-foreground'
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
                                    <div className="num mt-1 font-mono text-xs text-muted-foreground">
                                        {new Date(msg.timestamp).toLocaleTimeString()}
                                    </div>
                                </div>
                            )}
                            {msg.isServer && <div>{msg.message}</div>}
                        </div>
                    ))}
                </div>
            </ScrollArea>

            <div className="shrink-0 border-t border-border p-4">
                <div className="flex gap-2">
                    <Input
                        value={messageInput}
                        onChange={(e) => setMessageInput(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder="Type a message..."
                        className="h-11 flex-1"
                    />
                    <Button
                        onClick={handleSendMessage}
                        disabled={!messageInput.trim()}
                        size="icon"
                        aria-label="Send message"
                        className="h-11 w-11 shrink-0"
                    >
                        <Send className="h-4 w-4" aria-hidden="true" />
                    </Button>
                </div>
            </div>
        </div>
    );
};
