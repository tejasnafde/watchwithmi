import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { useMediaQuery } from "@/hooks/useMediaQuery";

/**
 * Tiny wrapper around window.matchMedia that re-renders when the query's
 * match state flips. Used by page.tsx to drive the mobile / tablet /
 * desktop sidebar layout.
 */

interface MockMediaQueryList {
    matches: boolean;
    listeners: Array<(e: { matches: boolean }) => void>;
    addEventListener: (type: string, cb: (e: { matches: boolean }) => void) => void;
    removeEventListener: (type: string, cb: (e: { matches: boolean }) => void) => void;
    dispatch: (matches: boolean) => void;
}

function installMatchMedia(initial: boolean): MockMediaQueryList {
    const mql: MockMediaQueryList = {
        matches: initial,
        listeners: [],
        addEventListener: (_t, cb) => {
            mql.listeners.push(cb);
        },
        removeEventListener: (_t, cb) => {
            mql.listeners = mql.listeners.filter((l) => l !== cb);
        },
        dispatch: (matches: boolean) => {
            mql.matches = matches;
            for (const cb of mql.listeners) cb({ matches });
        },
    };
    window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;
    return mql;
}

beforeEach(() => {
    vi.restoreAllMocks();
});

describe("useMediaQuery", () => {
    it("returns the initial matches value from window.matchMedia", () => {
        installMatchMedia(true);
        const { result } = renderHook(() => useMediaQuery("(min-width: 768px)"));
        expect(result.current).toBe(true);
    });

    it("updates when the underlying MediaQueryList changes", () => {
        const mql = installMatchMedia(false);
        const { result } = renderHook(() => useMediaQuery("(min-width: 768px)"));
        expect(result.current).toBe(false);

        act(() => mql.dispatch(true));
        expect(result.current).toBe(true);
    });

    it("removes its listener on unmount", () => {
        const mql = installMatchMedia(false);
        const { unmount } = renderHook(() => useMediaQuery("(min-width: 768px)"));
        expect(mql.listeners.length).toBeGreaterThan(0);
        unmount();
        expect(mql.listeners.length).toBe(0);
    });
});
