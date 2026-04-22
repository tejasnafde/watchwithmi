/**
 * `makeGuardedFlag` is a small state machine for boolean flags that should
 * auto-clear after a configurable delay. It replaces the ad-hoc
 * "setTimeout to flip a ref false" pattern used in useYouTubePlayer.ts,
 * which leaked because every call scheduled a fresh timer without
 * cancelling the previous one.
 *
 * Exactly one auto-clear timer is ever outstanding. Calling `set()` again
 * replaces the timer; calling `clear()` cancels it. See
 * frontend/src/lib/__tests__/guardedFlag.test.ts for the contract and
 * docs/polishing/02-sync-playback.md item #2 for the original bug.
 */
export interface GuardedFlag {
    /**
     * Turn the flag on and schedule it to auto-clear after `durationMs`.
     * If a previous auto-clear was pending, it is cancelled.
     */
    set(durationMs: number): void;
    /** Current boolean value. */
    get(): boolean;
    /** Turn the flag off and cancel any pending auto-clear. */
    clear(): void;
}

export function makeGuardedFlag(): GuardedFlag {
    let value = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cancelPendingTimer = () => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    };

    return {
        set(durationMs: number) {
            cancelPendingTimer();
            value = true;
            timer = setTimeout(() => {
                value = false;
                timer = null;
            }, durationMs);
        },
        get() {
            return value;
        },
        clear() {
            cancelPendingTimer();
            value = false;
        },
    };
}
