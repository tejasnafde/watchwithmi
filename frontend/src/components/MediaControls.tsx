/**
 * Media Controls Component
 *
 * Handles media search, loading, and queue management
 */

'use client';

import React, { useState } from 'react';
import { logger } from '@/lib/logger';
import type { ContentSearchResult, MediaType, QueueItem } from '@/types';
import { isYouTubePlaylistUrl } from '@/lib/youtube-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Youtube, Download, Link as LinkIcon, Loader2, ListMusic, Plus, Play, Trash2, ChevronUp, ChevronDown, ListOrdered, X } from 'lucide-react';

interface MediaControlsProps {
    onLoadMedia: (url: string, type: MediaType) => Promise<void>;
    onSearchContent: (query: string) => Promise<void>;
    onSearchYouTube?: (query: string) => Promise<ContentSearchResult[]>;
    canControl: boolean;
    isSearching: boolean;
    hasSearched: boolean;
    contentResults: ContentSearchResult[];
    playlistItems?: Array<{ title: string; url: string }>;
    currentPlaylistIndex?: number;
    onPlaylistSelect?: (index: number) => void;
    queue?: QueueItem[];
    onAddToQueue?: (url: string, title: string, mediaType: string, thumbnail?: string) => void;
    onRemoveFromQueue?: (itemId: string) => void;
    onReorderQueue?: (itemId: string, newIndex: number) => void;
    onPlayNext?: () => void;
    onClearQueue?: () => void;
    currentUserId?: string;
    isHost?: boolean;
}

export const MediaControls: React.FC<MediaControlsProps> = ({
    onLoadMedia,
    onSearchContent,
    onSearchYouTube,
    canControl,
    isSearching,
    hasSearched,
    contentResults,
    playlistItems = [],
    currentPlaylistIndex = 0,
    onPlaylistSelect,
    queue = [],
    onAddToQueue,
    onRemoveFromQueue,
    onReorderQueue,
    onPlayNext,
    onClearQueue,
    currentUserId,
    isHost = false,
}) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [directUrl, setDirectUrl] = useState('');
    const [activeTab, setActiveTab] = useState('content');

    const canDJ = canControl || isHost;

    const handleSearch = async () => {
        if (!searchQuery.trim()) return;

        logger.info('Searching for content', searchQuery);

        if (activeTab === 'content') {
            await onSearchContent(searchQuery);
        } else if (activeTab === 'youtube' && onSearchYouTube) {
            await onSearchYouTube(searchQuery);
        }
    };

    const handleLoadDirect = async () => {
        if (!directUrl.trim()) return;

        logger.info('Loading direct URL', directUrl);

        // Auto-detect magnet links and route to P2P handler
        if (isYouTubePlaylistUrl(directUrl)) {
            logger.info('Detected YouTube playlist link, routing to playlist handler');
            await onLoadMedia(directUrl, 'youtube_playlist');
        } else if (directUrl.startsWith('magnet:')) {
            logger.info('Detected magnet link, routing to P2P handler');
            await onLoadMedia(directUrl, 'media');
        } else {
            await onLoadMedia(directUrl, 'direct');
        }

        setDirectUrl('');
    };

    const handleLoadContent = async (result: ContentSearchResult) => {
        logger.info('Loading P2P content', result.title);
        await onLoadMedia(result.magnet_url, 'media');
    };

    const handleAddContentToQueue = (result: ContentSearchResult) => {
        if (onAddToQueue) {
            onAddToQueue(result.magnet_url, result.title, 'media');
        }
    };

    const handleAddYouTubeToQueue = (result: ContentSearchResult) => {
        if (onAddToQueue && result.url) {
            onAddToQueue(result.url, result.title, 'youtube', result.thumbnail);
        }
    };

    if (!canControl) {
        return (
            <div className="bg-black p-6">
                {/* Even non-controllers can view and add to queue */}
                <div className="bg-[#0a0a0a] border-4 border-white p-6 text-center mb-6">
                    <Download className="h-12 w-12 mx-auto mb-3 text-white" />
                    <p className="text-white uppercase font-bold text-lg">ONLY USERS WITH CONTROL PERMISSIONS CAN LOAD MEDIA</p>
                </div>

                {/* Queue button for non-controllers */}
                <QueuePanel
                    queue={queue}
                    onRemoveFromQueue={onRemoveFromQueue}
                    onReorderQueue={onReorderQueue}
                    onPlayNext={onPlayNext}
                    onClearQueue={onClearQueue}
                    currentUserId={currentUserId}
                    isHost={isHost}
                    canDJ={false}
                />
            </div>
        );
    }

    return (
        <div className="bg-black p-6">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="flex w-full bg-black border-4 border-white h-12 p-1 rounded-none mb-6">
                    <TabsTrigger value="content" className="flex-1 bg-black text-white font-bold uppercase text-xs data-[state=active]:bg-white data-[state=active]:text-black rounded-none border-0 h-full">
                        <Download className="h-4 w-4 mr-2" />
                        P2P
                    </TabsTrigger>
                    <TabsTrigger value="youtube" className="flex-1 bg-black text-white font-bold uppercase text-xs data-[state=active]:bg-white data-[state=active]:text-black rounded-none border-0 h-full">
                        <Youtube className="h-4 w-4 mr-2" />
                        YOUTUBE
                    </TabsTrigger>
                    <TabsTrigger value="direct" className="flex-1 bg-black text-white font-bold uppercase text-xs data-[state=active]:bg-white data-[state=active]:text-black rounded-none border-0 h-full">
                        <LinkIcon className="h-4 w-4 mr-2" />
                        DIRECT
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="content" className="space-y-4">
                    <div className="flex gap-3">
                        <Input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                            placeholder="SEARCH FOR MOVIES, SHOWS..."
                            className="flex-1 bg-black border-4 border-white text-white placeholder:text-white/40 font-mono h-12 uppercase"
                            disabled={isSearching}
                        />
                        <Button
                            onClick={handleSearch}
                            disabled={isSearching || !searchQuery.trim()}
                            className="bg-white text-black hover:bg-gray-200 border-4 border-white h-12 px-6 rounded-none font-bold uppercase"
                        >
                            {isSearching ? (
                                <Loader2 className="h-5 w-5 animate-spin" />
                            ) : (
                                <Search className="h-5 w-5" />
                            )}
                        </Button>
                    </div>

                    {hasSearched && (
                        <ScrollArea className="h-64 mt-6">
                            <div className="space-y-4 pr-4">
                                {contentResults.length === 0 ? (
                                    <p className="text-center text-white font-mono uppercase border-2 border-white py-8">
                                        NO RESULTS FOUND. TRY A DIFFERENT SEARCH TERM.
                                    </p>
                                ) : (
                                    contentResults.map((result, index) => (
                                        // Whole card is the primary "PLAY" affordance —
                                        // click anywhere to load. The QUEUE button stops
                                        // propagation so the two actions stay separable.
                                        <div
                                            key={index}
                                            role="button"
                                            tabIndex={0}
                                            aria-label={`Play ${result.title}`}
                                            onClick={() => handleLoadContent(result)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter" || e.key === " ") {
                                                    e.preventDefault()
                                                    handleLoadContent(result)
                                                }
                                            }}
                                            className="bg-black border-4 border-white p-4 group cursor-pointer transition-colors hover:bg-white hover:text-black focus:outline-none focus:bg-white focus:text-black"
                                        >
                                            <div className="flex justify-between items-start gap-4">
                                                <div className="flex-1 min-w-0">
                                                    <h4 className="text-lg font-bold uppercase truncate">
                                                        {result.title}
                                                    </h4>
                                                    <div className="flex gap-2 mt-2 flex-wrap">
                                                        <span className="text-[10px] px-2 border-2 border-current font-mono font-bold">
                                                            {result.size.toUpperCase()}
                                                        </span>
                                                        {result.quality && (
                                                            <span className="text-[10px] px-2 border-2 border-current font-mono font-bold">
                                                                {result.quality.toUpperCase()}
                                                            </span>
                                                        )}
                                                        <span className="text-[10px] px-2 border-2 border-current font-mono font-bold">
                                                            UP {result.seeders}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="flex gap-2 shrink-0">
                                                    {onAddToQueue && (
                                                        <Button
                                                            size="sm"
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                handleAddContentToQueue(result)
                                                            }}
                                                            className="bg-transparent text-current border-2 border-current hover:bg-current hover:text-black group-hover:text-black h-8 px-3 rounded-none font-bold uppercase text-xs"
                                                            aria-label={`Add ${result.title} to queue`}
                                                        >
                                                            <Plus className="h-3 w-3 mr-1" />
                                                            QUEUE
                                                        </Button>
                                                    )}
                                                    <div
                                                        className="flex items-center gap-1 px-3 h-8 border-2 border-current font-bold uppercase text-xs pointer-events-none"
                                                        aria-hidden="true"
                                                    >
                                                        <Play className="h-3 w-3" />
                                                        PLAY
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </ScrollArea>
                    )}
                </TabsContent>

                <TabsContent value="youtube" className="space-y-4">
                    <div className="flex gap-3">
                        <Input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                            placeholder="SEARCH YOUTUBE..."
                            className="flex-1 bg-black border-4 border-white text-white placeholder:text-white/40 font-mono h-12 uppercase"
                            disabled={isSearching}
                        />
                        <Button
                            onClick={handleSearch}
                            disabled={isSearching || !searchQuery.trim()}
                            className="bg-white text-black hover:bg-gray-200 border-4 border-white h-12 px-6 rounded-none font-bold uppercase"
                        >
                            {isSearching ? (
                                <Loader2 className="h-5 w-5 animate-spin" />
                            ) : (
                                <Search className="h-5 w-5" />
                            )}
                        </Button>
                    </div>

                    {hasSearched && (
                        <ScrollArea className="h-64 mt-6">
                            <div className="space-y-4 pr-4">
                                {contentResults.length === 0 ? (
                                    <p className="text-center text-white font-mono uppercase border-2 border-white py-8">
                                        NO YOUTUBE VIDEOS FOUND. TRY A DIFFERENT SEARCH TERM.
                                    </p>
                                ) : (
                                    contentResults.map((result, index) => (
                                        <div
                                            key={index}
                                            className="bg-black border-4 border-white p-4 group"
                                        >
                                            <div className="flex gap-4">
                                                {result.thumbnail && (
                                                    <div className="border-2 border-white">
                                                        <img
                                                            src={result.thumbnail}
                                                            alt={result.title}
                                                            className="w-32 h-20 object-cover"
                                                        />
                                                    </div>
                                                )}
                                                <div className="flex-1 min-w-0">
                                                    <h4 className="text-lg font-bold uppercase line-clamp-2 text-white">
                                                        {result.title}
                                                    </h4>
                                                    {result.channel && (
                                                        <p className="text-[10px] font-mono uppercase mt-1 text-white/70">
                                                            {result.channel}
                                                        </p>
                                                    )}
                                                    {result.duration && (
                                                        <span className="inline-block text-[10px] px-1 border border-white text-white font-mono mt-2 uppercase">
                                                            {result.duration}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex flex-col gap-2 shrink-0">
                                                    {onAddToQueue && (
                                                        <Button
                                                            size="sm"
                                                            onClick={() => handleAddYouTubeToQueue(result)}
                                                            className="bg-black text-white border-2 border-white hover:bg-white hover:text-black h-8 px-3 rounded-none font-bold uppercase text-xs"
                                                        >
                                                            <Plus className="h-3 w-3 mr-1" />
                                                            QUEUE
                                                        </Button>
                                                    )}
                                                    <Button
                                                        size="sm"
                                                        onClick={() => result.url && onLoadMedia(result.url, 'youtube')}
                                                        className="bg-white text-black hover:bg-gray-200 border-2 border-white h-8 px-3 rounded-none font-bold uppercase text-xs"
                                                    >
                                                        <Play className="h-3 w-3 mr-1" />
                                                        PLAY
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </ScrollArea>
                    )}
                </TabsContent>

                <TabsContent value="direct" className="space-y-4">
                    <div className="flex gap-3">
                        <Input
                            value={directUrl}
                            onChange={(e) => setDirectUrl(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleLoadDirect()}
                            placeholder="ENTER VIDEO URL OR MAGNET LINK..."
                            className="flex-1 bg-black border-4 border-white text-white placeholder:text-white/40 font-mono h-12 uppercase"
                        />
                        <Button
                            onClick={handleLoadDirect}
                            disabled={!directUrl.trim()}
                            className="bg-white text-black hover:bg-gray-200 border-4 border-white h-12 px-6 rounded-none font-bold uppercase"
                        >
                            LOAD
                        </Button>
                    </div>
                    <p className="text-white font-mono text-xs uppercase opacity-70">
                        PASTE A DIRECT VIDEO URL, YOUTUBE PLAYLIST LINK, OR MAGNET LINK FOR P2P STREAMING
                    </p>
                </TabsContent>
            </Tabs>

            {playlistItems.length > 0 && (
                <div className="mt-6 border-4 border-white p-3">
                    <div className="flex items-center gap-2 mb-3 text-white">
                        <ListMusic className="h-4 w-4" />
                        <h4 className="font-bold uppercase text-sm">Playlist ({playlistItems.length})</h4>
                    </div>
                    <ScrollArea className="h-48">
                        <div className="space-y-2 pr-2">
                            {playlistItems.map((item, index) => (
                                <button
                                    key={`${item.url}-${index}`}
                                    type="button"
                                    className={`w-full text-left p-2 border-2 font-mono text-xs uppercase ${index === currentPlaylistIndex
                                        ? 'bg-white text-black border-white'
                                        : 'bg-black text-white border-white/50 hover:border-white'
                                        }`}
                                    onClick={() => onPlaylistSelect?.(index)}
                                >
                                    {index + 1}. {item.title}
                                </button>
                            ))}
                        </div>
                    </ScrollArea>
                </div>
            )}

            {/* Queue Panel */}
            <QueuePanel
                queue={queue}
                onRemoveFromQueue={onRemoveFromQueue}
                onReorderQueue={onReorderQueue}
                onPlayNext={onPlayNext}
                onClearQueue={onClearQueue}
                currentUserId={currentUserId}
                isHost={isHost}
                canDJ={canDJ}
            />
        </div>
    );
};

// ============================================================================
// Queue Panel Component
// ============================================================================

interface QueuePanelProps {
    queue: QueueItem[];
    onRemoveFromQueue?: (itemId: string) => void;
    onReorderQueue?: (itemId: string, newIndex: number) => void;
    onPlayNext?: () => void;
    onClearQueue?: () => void;
    currentUserId?: string;
    isHost: boolean;
    canDJ: boolean;
}

const QueuePanel: React.FC<QueuePanelProps> = ({
    queue,
    onRemoveFromQueue,
    onReorderQueue,
    onPlayNext,
    onClearQueue,
    currentUserId,
    isHost,
    canDJ,
}) => {
    return (
        <div className="mt-6 border-4 border-white p-3">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-white">
                    <ListOrdered className="h-4 w-4" />
                    <h4 className="font-bold uppercase text-sm">QUEUE ({queue.length})</h4>
                </div>
                <div className="flex gap-2">
                    {canDJ && queue.length > 0 && (
                        <Button
                            size="sm"
                            onClick={onPlayNext}
                            className="bg-white text-black hover:bg-gray-200 border-2 border-white h-7 px-3 rounded-none font-bold uppercase text-[10px]"
                        >
                            <Play className="h-3 w-3 mr-1" />
                            PLAY NEXT
                        </Button>
                    )}
                    {isHost && queue.length > 0 && (
                        <Button
                            size="sm"
                            onClick={onClearQueue}
                            className="bg-black text-white hover:bg-white hover:text-black border-2 border-white h-7 px-3 rounded-none font-bold uppercase text-[10px]"
                        >
                            <X className="h-3 w-3 mr-1" />
                            CLEAR
                        </Button>
                    )}
                </div>
            </div>

            {queue.length === 0 ? (
                <p className="text-center text-white/50 font-mono text-xs uppercase py-6 border-2 border-white/20">
                    QUEUE IS EMPTY — SEARCH AND ADD MEDIA ABOVE
                </p>
            ) : (
                <ScrollArea className="h-48">
                    <div className="space-y-2 pr-2">
                        {queue.map((item, index) => {
                            const canRemove = isHost || canDJ || item.added_by === currentUserId;
                            return (
                                <div
                                    key={item.id}
                                    className="flex items-center gap-2 p-2 bg-black border-2 border-white/50 hover:border-white group"
                                >
                                    {/* Position number */}
                                    <span className="text-white/50 font-mono text-xs w-5 shrink-0 text-center">
                                        {index + 1}
                                    </span>

                                    {/* Thumbnail */}
                                    {item.thumbnail && (
                                        <div className="border border-white/30 shrink-0">
                                            <img
                                                src={item.thumbnail}
                                                alt={item.title}
                                                className="w-12 h-8 object-cover"
                                            />
                                        </div>
                                    )}

                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-white font-mono text-xs uppercase truncate">
                                            {item.title}
                                        </p>
                                        <p className="text-white/40 font-mono text-[10px] uppercase">
                                            ADDED BY {item.added_by_name}
                                        </p>
                                    </div>

                                    {/* Reorder buttons (host/DJ only) */}
                                    {canDJ && onReorderQueue && (
                                        <div className="flex flex-col gap-0.5 shrink-0 opacity-0 group-hover:opacity-100">
                                            <button
                                                type="button"
                                                disabled={index === 0}
                                                onClick={() => onReorderQueue(item.id, index - 1)}
                                                className="text-white hover:bg-white hover:text-black disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-white p-0.5 border border-white/30"
                                            >
                                                <ChevronUp className="h-3 w-3" />
                                            </button>
                                            <button
                                                type="button"
                                                disabled={index === queue.length - 1}
                                                onClick={() => onReorderQueue(item.id, index + 1)}
                                                className="text-white hover:bg-white hover:text-black disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-white p-0.5 border border-white/30"
                                            >
                                                <ChevronDown className="h-3 w-3" />
                                            </button>
                                        </div>
                                    )}

                                    {/* Remove button */}
                                    {canRemove && onRemoveFromQueue && (
                                        <button
                                            type="button"
                                            onClick={() => onRemoveFromQueue(item.id)}
                                            className="text-white/50 hover:text-white hover:bg-white hover:text-black p-1 border border-white/30 opacity-0 group-hover:opacity-100 shrink-0"
                                        >
                                            <Trash2 className="h-3 w-3" />
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </ScrollArea>
            )}
        </div>
    );
};
