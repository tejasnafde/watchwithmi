import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";

import { useSidebarPanels } from "@/hooks/useSidebarPanels";

/**
 * Contract for the sidebar expand/collapse state machine.
 *
 * - Panels are named; each has a default-expanded fallback.
 * - State persists to localStorage per panel so refreshes remember.
 * - `toggle(name)` flips one panel.
 * - `solo(name)` collapses every other panel, keeps/opens the target.
 * - `setExpanded(name, value)` is the imperative hook used for
 *   programmatic auto-expand (e.g. when the WebRTC call becomes active).
 * - `singleExpandMode: true` enforces "only one expanded" — toggling open
 *   a second panel silently collapses the others.
 */

const STORAGE_PREFIX = "watchwithmi.sidebar.";

beforeEach(() => {
    localStorage.clear();
});

describe("useSidebarPanels", () => {
    it("returns each panel with its defaultExpanded value when localStorage is empty", () => {
        const { result } = renderHook(() =>
            useSidebarPanels({
                users: { defaultExpanded: false },
                chat: { defaultExpanded: true },
                video: { defaultExpanded: false },
            }),
        );
        expect(result.current.expanded).toEqual({
            users: false,
            chat: true,
            video: false,
        });
    });

    it("toggle flips a single panel without touching the others", () => {
        const { result } = renderHook(() =>
            useSidebarPanels({
                users: { defaultExpanded: false },
                chat: { defaultExpanded: true },
                video: { defaultExpanded: false },
            }),
        );
        act(() => result.current.toggle("video"));
        expect(result.current.expanded).toEqual({
            users: false,
            chat: true,
            video: true,
        });
        act(() => result.current.toggle("chat"));
        expect(result.current.expanded).toEqual({
            users: false,
            chat: false,
            video: true,
        });
    });

    it("solo collapses every panel except the target and expands the target", () => {
        const { result } = renderHook(() =>
            useSidebarPanels({
                users: { defaultExpanded: true },
                chat: { defaultExpanded: true },
                video: { defaultExpanded: true },
            }),
        );
        act(() => result.current.solo("chat"));
        expect(result.current.expanded).toEqual({
            users: false,
            chat: true,
            video: false,
        });
    });

    it("setExpanded(name, value) forces the exact value", () => {
        const { result } = renderHook(() =>
            useSidebarPanels({
                users: { defaultExpanded: false },
                chat: { defaultExpanded: true },
                video: { defaultExpanded: false },
            }),
        );
        act(() => result.current.setExpanded("video", true));
        expect(result.current.expanded.video).toBe(true);
        act(() => result.current.setExpanded("video", false));
        expect(result.current.expanded.video).toBe(false);
    });

    it("persists expanded state to localStorage on toggle", () => {
        const { result } = renderHook(() =>
            useSidebarPanels({
                chat: { defaultExpanded: true },
            }),
        );
        act(() => result.current.toggle("chat"));
        expect(localStorage.getItem(`${STORAGE_PREFIX}chat`)).toBe("false");
    });

    it("hydrates from localStorage on mount, overriding defaultExpanded", () => {
        localStorage.setItem(`${STORAGE_PREFIX}chat`, "false");
        localStorage.setItem(`${STORAGE_PREFIX}video`, "true");

        const { result } = renderHook(() =>
            useSidebarPanels({
                chat: { defaultExpanded: true },  // overridden → false
                video: { defaultExpanded: false }, // overridden → true
            }),
        );
        expect(result.current.expanded.chat).toBe(false);
        expect(result.current.expanded.video).toBe(true);
    });

    it("singleExpandMode=true: opening a panel collapses the rest", () => {
        const { result } = renderHook(() =>
            useSidebarPanels(
                {
                    users: { defaultExpanded: true },
                    chat: { defaultExpanded: false },
                    video: { defaultExpanded: false },
                },
                { singleExpandMode: true },
            ),
        );
        act(() => result.current.setExpanded("chat", true));
        expect(result.current.expanded).toEqual({
            users: false,
            chat: true,
            video: false,
        });
    });

    it("singleExpandMode=true: closing a panel does NOT auto-open another", () => {
        const { result } = renderHook(() =>
            useSidebarPanels(
                {
                    users: { defaultExpanded: false },
                    chat: { defaultExpanded: true },
                    video: { defaultExpanded: false },
                },
                { singleExpandMode: true },
            ),
        );
        act(() => result.current.setExpanded("chat", false));
        expect(result.current.expanded).toEqual({
            users: false,
            chat: false,
            video: false,
        });
    });
});
