"use client";

import { useEffect, useState } from "react";

/**
 * React wrapper around `window.matchMedia`. Returns the current match
 * state and re-renders when it flips. Used by the room page to pick
 * between mobile / tablet / desktop sidebar layouts.
 *
 * SSR-safe: during server render it returns `false` (no match) and
 * hydrates with the real value on the client-side effect.
 */
export function useMediaQuery(query: string): boolean {
    const [matches, setMatches] = useState<boolean>(() => {
        if (typeof window === "undefined" || !window.matchMedia) return false;
        return window.matchMedia(query).matches;
    });

    useEffect(() => {
        if (typeof window === "undefined" || !window.matchMedia) return;
        const mql = window.matchMedia(query);
        const handler = (e: MediaQueryListEvent | { matches: boolean }) => {
            setMatches(e.matches);
        };
        mql.addEventListener("change", handler as (e: MediaQueryListEvent) => void);
        setMatches(mql.matches);
        return () => {
            mql.removeEventListener(
                "change",
                handler as (e: MediaQueryListEvent) => void,
            );
        };
    }, [query]);

    return matches;
}
