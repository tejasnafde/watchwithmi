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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
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

        // Auto-detect magnet links and route to P2P handler
        if (directUrl.startsWith('magnet:')) {
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

    if (!canControl) {
        return (
            <div className="bg-[#0a0a0a] border-4 border-white p-6 text-center">
                <Download className="h-12 w-12 mx-auto mb-3 text-white" />
                <p className="text-white uppercase font-bold text-lg">ONLY USERS WITH CONTROL PERMISSIONS CAN LOAD MEDIA</p>
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
                                        <div
                                            key={index}
                                            className="bg-black border-4 border-white p-4 cursor-pointer hover:bg-white hover:text-black transition-colors group"
                                            onClick={() => handleLoadContent(result)}
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
                                                <Download className="h-6 w-6 group-hover:text-black" />
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
                                            className="bg-black border-4 border-white p-4 cursor-pointer hover:bg-white hover:text-black transition-colors group"
                                            onClick={() => result.url && onLoadMedia(result.url, 'youtube')}
                                        >
                                            <div className="flex gap-4">
                                                {result.thumbnail && (
                                                    <div className="border-2 border-current group-hover:border-black">
                                                        <img
                                                            src={result.thumbnail}
                                                            alt={result.title}
                                                            className="w-32 h-20 object-cover"
                                                        />
                                                    </div>
                                                )}
                                                <div className="flex-1 min-w-0">
                                                    <h4 className="text-lg font-bold uppercase line-clamp-2">
                                                        {result.title}
                                                    </h4>
                                                    {result.channel && (
                                                        <p className="text-[10px] font-mono uppercase mt-1 opacity-70 group-hover:opacity-100">
                                                            {result.channel}
                                                        </p>
                                                    )}
                                                    {result.duration && (
                                                        <span className="inline-block text-[10px] px-1 border border-current font-mono mt-2 uppercase">
                                                            {result.duration}
                                                        </span>
                                                    )}
                                                </div>
                                                <Youtube className="h-6 w-6 text-red-600 group-hover:text-black" />
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
                        PASTE A DIRECT VIDEO URL (MP4, WEBM) OR MAGNET LINK FOR P2P STREAMING
                    </p>
                </TabsContent>
            </Tabs>
        </div>
    );
};
