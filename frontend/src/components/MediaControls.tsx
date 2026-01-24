/**
 * Media Controls Component
 * 
 * Handles media search and loading
 */

'use client';

import React, { useState } from 'react';
import { logger } from '@/lib/logger';
import type { ContentSearchResult, MediaType } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Search, Youtube, Download, Link as LinkIcon, Loader2 } from 'lucide-react';

interface MediaControlsProps {
    onLoadMedia: (url: string, type: MediaType) => Promise<void>;
    onSearchContent: (query: string) => Promise<void>;
    onSearchYouTube?: (query: string) => Promise<ContentSearchResult[]>;
    canControl: boolean;
    isSearching: boolean;
    hasSearched: boolean;
    contentResults: ContentSearchResult[];
}

export const MediaControls: React.FC<MediaControlsProps> = ({
    onLoadMedia,
    onSearchContent,
    onSearchYouTube,
    canControl,
    isSearching,
    hasSearched,
    contentResults
}) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [directUrl, setDirectUrl] = useState('');
    const [activeTab, setActiveTab] = useState('content');

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
        await onLoadMedia(directUrl, 'direct');
        setDirectUrl('');
    };

    const handleLoadContent = async (result: ContentSearchResult) => {
        logger.info('Loading P2P content', result.title);
        await onLoadMedia(result.magnet_url, 'media');
    };

    if (!canControl) {
        return (
            <Card className="bg-white/5 border-white/10">
                <CardContent className="p-6 text-center text-white/60">
                    <Download className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>Only users with control permissions can load media</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="bg-white/5 border-white/10">
            <CardContent className="p-6">
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList className="grid w-full grid-cols-3 bg-white/5">
                        <TabsTrigger value="content" className="data-[state=active]:bg-purple-500">
                            <Download className="h-4 w-4 mr-2" />
                            P2P
                        </TabsTrigger>
                        <TabsTrigger value="youtube" className="data-[state=active]:bg-purple-500">
                            <Youtube className="h-4 w-4 mr-2" />
                            YouTube
                        </TabsTrigger>
                        <TabsTrigger value="direct" className="data-[state=active]:bg-purple-500">
                            <LinkIcon className="h-4 w-4 mr-2" />
                            Direct
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="content" className="space-y-4">
                        <div className="flex gap-2">
                            <Input
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                                placeholder="Search for movies, shows..."
                                className="flex-1 bg-white/5 border-white/10 text-white"
                                disabled={isSearching}
                            />
                            <Button
                                onClick={handleSearch}
                                disabled={isSearching || !searchQuery.trim()}
                                className="bg-gradient-to-r from-purple-500 to-pink-500"
                            >
                                {isSearching ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Search className="h-4 w-4" />
                                )}
                            </Button>
                        </div>

                        {hasSearched && (
                            <ScrollArea className="h-64">
                                <div className="space-y-2">
                                    {contentResults.length === 0 ? (
                                        <p className="text-center text-white/60 py-8">
                                            No results found. Try a different search term.
                                        </p>
                                    ) : (
                                        contentResults.map((result, index) => (
                                            <Card
                                                key={index}
                                                className="bg-white/5 border-white/10 hover:bg-white/10 cursor-pointer transition-colors"
                                                onClick={() => handleLoadContent(result)}
                                            >
                                                <CardContent className="p-3">
                                                    <div className="flex justify-between items-start gap-3">
                                                        <div className="flex-1 min-w-0">
                                                            <h4 className="text-white font-medium truncate">
                                                                {result.title}
                                                            </h4>
                                                            <div className="flex gap-2 mt-1 flex-wrap">
                                                                <Badge variant="secondary" className="text-xs">
                                                                    {result.size}
                                                                </Badge>
                                                                {result.quality && (
                                                                    <Badge variant="secondary" className="text-xs">
                                                                        {result.quality}
                                                                    </Badge>
                                                                )}
                                                                <Badge variant="secondary" className="text-xs">
                                                                    ↑ {result.seeders}
                                                                </Badge>
                                                            </div>
                                                        </div>
                                                        <Download className="h-4 w-4 text-white/60 flex-shrink-0" />
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        ))
                                    )}
                                </div>
                            </ScrollArea>
                        )}
                    </TabsContent>

                    <TabsContent value="youtube" className="space-y-4">
                        <div className="flex gap-2">
                            <Input
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                                placeholder="Search YouTube..."
                                className="flex-1 bg-white/5 border-white/10 text-white"
                                disabled={isSearching}
                            />
                            <Button
                                onClick={handleSearch}
                                disabled={isSearching || !searchQuery.trim()}
                                className="bg-gradient-to-r from-red-500 to-pink-500"
                            >
                                {isSearching ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Search className="h-4 w-4" />
                                )}
                            </Button>
                        </div>

                        {hasSearched && (
                            <ScrollArea className="h-64">
                                <div className="space-y-2">
                                    {contentResults.length === 0 ? (
                                        <p className="text-center text-white/60 py-8">
                                            No YouTube videos found. Try a different search term.
                                        </p>
                                    ) : (
                                        contentResults.map((result, index) => (
                                            <Card
                                                key={index}
                                                className="bg-white/5 border-white/10 hover:bg-white/10 cursor-pointer transition-colors"
                                                onClick={() => result.url && onLoadMedia(result.url, 'youtube')}
                                            >
                                                <CardContent className="p-3">
                                                    <div className="flex gap-3">
                                                        {result.thumbnail && (
                                                            <img
                                                                src={result.thumbnail}
                                                                alt={result.title}
                                                                className="w-32 h-20 object-cover rounded"
                                                            />
                                                        )}
                                                        <div className="flex-1 min-w-0">
                                                            <h4 className="text-white font-medium line-clamp-2">
                                                                {result.title}
                                                            </h4>
                                                            {result.channel && (
                                                                <p className="text-white/60 text-sm mt-1">
                                                                    {result.channel}
                                                                </p>
                                                            )}
                                                            {result.duration && (
                                                                <Badge variant="secondary" className="text-xs mt-1">
                                                                    {result.duration}
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        <Youtube className="h-4 w-4 text-red-500 flex-shrink-0" />
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        ))
                                    )}
                                </div>
                            </ScrollArea>
                        )}
                    </TabsContent>

                    <TabsContent value="direct" className="space-y-4">
                        <div className="flex gap-2">
                            <Input
                                value={directUrl}
                                onChange={(e) => setDirectUrl(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && handleLoadDirect()}
                                placeholder="Enter direct video URL..."
                                className="flex-1 bg-white/5 border-white/10 text-white"
                            />
                            <Button
                                onClick={handleLoadDirect}
                                disabled={!directUrl.trim()}
                                className="bg-gradient-to-r from-blue-500 to-cyan-500"
                            >
                                Load
                            </Button>
                        </div>
                        <p className="text-white/60 text-sm">
                            Paste a direct link to a video file (MP4, WebM, etc.)
                        </p>
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    );
};
