/**
 * Media Controls Component
 *
 * Handles media search, loading, and queue management
 */

'use client';

import React, { useState, useMemo } from 'react';
import { logger } from '@/lib/logger';
import type { ContentSearchResult, MediaType, QueueItem } from '@/types';
import { isYouTubePlaylistUrl } from '@/lib/youtube-api';
import { detectCodec, byPlayability } from '@/lib/codecHint';
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

// One pill style for every result badge (size, quality, seeders, codec).
const BADGE = 'inline-flex items-center rounded-full border border-border px-2 py-0.5 font-mono text-xs';

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

    // Pre-sort P2P results so browser-playable releases (x264 / MP4) bubble
    // to the top before HEVC / MKV / 10-bit ones that won't play in <video>.
    // Stable within each bucket - preserves the seeder ordering from the API.
    const sortedContentResults = useMemo(
        () => [...contentResults].sort(byPlayability),
        [contentResults]
    );

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
            <div className="bg-card p-6">
                {/* Even non-controllers can view and add to queue */}
                <div className="mb-6 rounded-lg border border-border bg-secondary p-6 text-center">
                    <Download className="mx-auto mb-3 h-8 w-8 text-primary" />
                    <p className="text-sm text-muted-foreground">
                        Only users with control permissions can load media.
                    </p>
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
        <div className="bg-card p-6">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="mb-6 flex h-12 w-full rounded-md border border-border bg-secondary p-0.5">
                    <TabsTrigger value="content" className="h-full flex-1 rounded-md text-sm font-medium text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground">
                        <Download className="mr-2 h-4 w-4" />
                        P2P
                    </TabsTrigger>
                    <TabsTrigger value="youtube" className="h-full flex-1 rounded-md text-sm font-medium text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground">
                        <Youtube className="mr-2 h-4 w-4" />
                        YouTube
                    </TabsTrigger>
                    <TabsTrigger value="direct" className="h-full flex-1 rounded-md text-sm font-medium text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground">
                        <LinkIcon className="mr-2 h-4 w-4" />
                        Direct
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="content" className="space-y-4">
                    <div className="flex gap-3">
                        <Input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                            placeholder="Search for movies, shows..."
                            className="h-11 flex-1"
                            disabled={isSearching}
                        />
                        <Button
                            onClick={handleSearch}
                            disabled={isSearching || !searchQuery.trim()}
                            aria-label="Search"
                            className="h-11 w-11 shrink-0 p-0"
                        >
                            {isSearching ? (
                                <Loader2 className="h-5 w-5 animate-spin" />
                            ) : (
                                <Search className="h-5 w-5" />
                            )}
                        </Button>
                    </div>

                    {hasSearched && (
                        <ScrollArea className="mt-6 h-64">
                            <div className="space-y-3 pr-4">
                                {contentResults.length === 0 ? (
                                    <p className="rounded-lg border border-border py-8 text-center text-sm text-muted-foreground">
                                        No results found. Try a different search term.
                                    </p>
                                ) : (
                                    sortedContentResults.map((result, index) => (
                                        // Whole card is the primary "play"affordance -
                                        // click anywhere to load. The queue button stops
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
                                            className="group cursor-pointer rounded-lg border border-border bg-secondary p-4 transition-colors duration-150 hover:border-primary"
                                        >
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="min-w-0 flex-1">
                                                    <h4 className="truncate text-base font-semibold transition-colors duration-150 group-hover:text-primary">
                                                        {result.title}
                                                    </h4>
                                                    <div className="mt-2 flex flex-wrap gap-2">
                                                        <span className={`${BADGE} num text-muted-foreground`}>
                                                            {result.size}
                                                        </span>
                                                        {result.quality && (
                                                            <span className={`${BADGE} num text-muted-foreground`}>
                                                                {result.quality}
                                                            </span>
                                                        )}
                                                        <span className={`${BADGE} text-muted-foreground`}>
                                                            <span className="num">{result.seeders}</span>
                                                            <span className="ml-1">seeders</span>
                                                        </span>
                                                        {(() => {
                                                            // Codec badge - green when the release should play in
                                                            // browsers (x264/MP4), amber when it likely won't
                                                            // (HEVC/MKV/10-bit).
                                                            const hint = detectCodec(result.title);
                                                            if (!hint.label) return null;
                                                            const cls =
                                                                hint.severity === "good"
                                                                    ? "text-pos"
                                                                    : "text-warn";
                                                            return (
                                                                <span
                                                                    className={`${BADGE} ${cls}`}
                                                                    title={
                                                                        hint.severity === "warn"
                                                                            ? "May not play in this browser"
                                                                            : "Should play in this browser"
                                                                    }
                                                                >
                                                                    {hint.label}
                                                                </span>
                                                            );
                                                        })()}
                                                    </div>
                                                </div>
                                                <div className="flex shrink-0 gap-2">
                                                    {onAddToQueue && (
                                                        <Button
                                                            variant="outline"
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                handleAddContentToQueue(result)
                                                            }}
                                                            className="h-11 px-4"
                                                            aria-label={`Add ${result.title} to queue`}
                                                        >
                                                            <Plus className="mr-1 h-4 w-4" />
                                                            Queue
                                                        </Button>
                                                    )}
                                                    <div
                                                        className="flex h-11 items-center gap-1 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
                                                        aria-hidden="true"
                                                    >
                                                        <Play className="h-4 w-4" />
                                                        Play
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
                            placeholder="Search YouTube..."
                            className="h-11 flex-1"
                            disabled={isSearching}
                        />
                        <Button
                            onClick={handleSearch}
                            disabled={isSearching || !searchQuery.trim()}
                            aria-label="Search YouTube"
                            className="h-11 w-11 shrink-0 p-0"
                        >
                            {isSearching ? (
                                <Loader2 className="h-5 w-5 animate-spin" />
                            ) : (
                                <Search className="h-5 w-5" />
                            )}
                        </Button>
                    </div>

                    {hasSearched && (
                        <ScrollArea className="mt-6 h-64">
                            <div className="space-y-3 pr-4">
                                {contentResults.length === 0 ? (
                                    <p className="rounded-lg border border-border py-8 text-center text-sm text-muted-foreground">
                                        No YouTube videos found. Try a different search term.
                                    </p>
                                ) : (
                                    contentResults.map((result, index) => (
                                        <div
                                            key={index}
                                            className="group rounded-lg border border-border bg-secondary p-4 transition-colors duration-150 hover:border-primary"
                                        >
                                            <div className="flex gap-4">
                                                {result.thumbnail && (
                                                    <div className="overflow-hidden rounded-md border border-border">
                                                        <img
                                                            src={result.thumbnail}
                                                            alt={result.title}
                                                            className="h-20 w-32 object-cover"
                                                        />
                                                    </div>
                                                )}
                                                <div className="min-w-0 flex-1">
                                                    <h4 className="line-clamp-2 text-base font-semibold text-foreground">
                                                        {result.title}
                                                    </h4>
                                                    {result.channel && (
                                                        <p className="mt-1 text-xs text-muted-foreground">
                                                            {result.channel}
                                                        </p>
                                                    )}
                                                    {result.duration && (
                                                        <span className={`${BADGE} num mt-2 text-muted-foreground`}>
                                                            {result.duration}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex shrink-0 flex-col gap-2">
                                                    {onAddToQueue && (
                                                        <Button
                                                            variant="outline"
                                                            onClick={() => handleAddYouTubeToQueue(result)}
                                                            className="h-11 px-4"
                                                            aria-label={`Add ${result.title} to queue`}
                                                        >
                                                            <Plus className="mr-1 h-4 w-4" />
                                                            Queue
                                                        </Button>
                                                    )}
                                                    <Button
                                                        onClick={() => result.url && onLoadMedia(result.url, 'youtube')}
                                                        className="h-11 px-4"
                                                        aria-label={`Play ${result.title}`}
                                                    >
                                                        <Play className="mr-1 h-4 w-4" />
                                                        Play
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
                            placeholder="Enter a video URL or magnet link..."
                            className="h-11 flex-1"
                        />
                        <Button
                            onClick={handleLoadDirect}
                            disabled={!directUrl.trim()}
                            className="h-11 px-6"
                        >
                            Load
                        </Button>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Paste a direct video URL, a YouTube playlist link, or a magnet link for P2P streaming.
                    </p>
                </TabsContent>
            </Tabs>

            {playlistItems.length > 0 && (
                <div className="mt-6 rounded-lg border border-border p-4">
                    <div className="mb-3 flex items-center gap-2">
                        <ListMusic className="h-4 w-4 text-primary" />
                        <h4 className="text-sm font-semibold">
                            Playlist (<span className="num">{playlistItems.length}</span>)
                        </h4>
                    </div>
                    <ScrollArea className="h-48">
                        <div className="space-y-2 pr-2">
                            {playlistItems.map((item, index) => (
                                <button
                                    key={`${item.url}-${index}`}
                                    type="button"
                                    className={`flex min-h-11 w-full items-center rounded-md border px-3 py-2 text-left text-sm transition-colors duration-150 ${index === currentPlaylistIndex
                                        ? 'border-primary bg-primary text-primary-foreground'
                                        : 'border-border bg-secondary text-foreground hover:border-primary'
                                        }`}
                                    onClick={() => onPlaylistSelect?.(index)}
                                >
                                    <span className="num mr-2 shrink-0">{index + 1}.</span>
                                    <span className="truncate">{item.title}</span>
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
        <div className="mt-6 rounded-lg border border-border p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <ListOrdered className="h-4 w-4 text-primary" />
                    <h4 className="text-sm font-semibold">
                        Queue (<span className="num">{queue.length}</span>)
                    </h4>
                </div>
                <div className="flex gap-2">
                    {canDJ && queue.length > 0 && (
                        <Button onClick={onPlayNext} className="h-11 px-4">
                            <Play className="mr-1 h-4 w-4" />
                            Play next
                        </Button>
                    )}
                    {isHost && queue.length > 0 && (
                        <Button variant="outline" onClick={onClearQueue} className="h-11 px-4">
                            <X className="mr-1 h-4 w-4" />
                            Clear
                        </Button>
                    )}
                </div>
            </div>

            {queue.length === 0 ? (
                <p className="rounded-lg border border-border py-6 text-center text-sm text-muted-foreground">
                    Queue is empty. Search and add media above.
                </p>
            ) : (
                <ScrollArea className="h-48">
                    <div className="space-y-2 pr-2">
                        {queue.map((item, index) => {
                            const canRemove = isHost || canDJ || item.added_by === currentUserId;
                            return (
                                <div
                                    key={item.id}
                                    className="group flex items-center gap-2 rounded-md border border-border bg-secondary p-2 transition-colors duration-150 hover:border-primary"
                                >
                                    {/* Position number */}
                                    <span className="num w-5 shrink-0 text-center text-xs text-muted-foreground">
                                        {index + 1}
                                    </span>

                                    {/* Thumbnail */}
                                    {item.thumbnail && (
                                        <div className="shrink-0 overflow-hidden rounded-md border border-border">
                                            <img
                                                src={item.thumbnail}
                                                alt={item.title}
                                                className="h-8 w-12 object-cover"
                                            />
                                        </div>
                                    )}

                                    {/* Info */}
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm text-foreground">
                                            {item.title}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            Added by {item.added_by_name}
                                        </p>
                                    </div>

                                    {/* Reorder buttons (host/DJ only) */}
                                    {canDJ && onReorderQueue && (
                                        <div className="flex shrink-0 gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100">
                                            <button
                                                type="button"
                                                disabled={index === 0}
                                                onClick={() => onReorderQueue(item.id, index - 1)}
                                                aria-label={`Move ${item.title} up`}
                                                className="flex h-11 w-11 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                                            >
                                                <ChevronUp className="h-4 w-4" />
                                            </button>
                                            <button
                                                type="button"
                                                disabled={index === queue.length - 1}
                                                onClick={() => onReorderQueue(item.id, index + 1)}
                                                aria-label={`Move ${item.title} down`}
                                                className="flex h-11 w-11 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                                            >
                                                <ChevronDown className="h-4 w-4" />
                                            </button>
                                        </div>
                                    )}

                                    {/* Remove button */}
                                    {canRemove && onRemoveFromQueue && (
                                        <button
                                            type="button"
                                            onClick={() => onRemoveFromQueue(item.id)}
                                            aria-label={`Remove ${item.title} from queue`}
                                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                                        >
                                            <Trash2 className="h-4 w-4" />
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
