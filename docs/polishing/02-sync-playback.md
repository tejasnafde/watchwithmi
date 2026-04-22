# Sync & Playback

Polish for video sync, buffering, and drift handling. The core loop is working but has a handful of edge cases that cause visible glitches under load or on manual interaction.

## High

- [x] **Early-return in `handleVideoPlay` / `handleVideoPause` skips flag clear** — `frontend/src/hooks/useVideoSync.ts:146-205`
  - Audit note re-verified against current code: neither handler sets a sync flag, they only read `isUpdatingFromSocket`. The functions that do set the flag (`syncPlayState`, `syncTimestamp`) already use try/finally with a single cancel-and-replace timer. Pinned by regression tests in `useVideoSync.test.tsx`.

- [x] **Overlapping sync-flag `setTimeout`s** — `frontend/src/hooks/useYouTubePlayer.ts:173, 272, 297, 372`
  - Multiple timeouts can be outstanding at once, each racing to clear the flag. The last one wins, which may be wrong.
  - Fixed via a reusable `makeGuardedFlag` helper (`frontend/src/lib/guardedFlag.ts`) plus `scheduleSyncingClear` / `scheduleSeekingClear` helpers inside the hook that cancel any pending clear before scheduling a new one.

- [x] **`UNSTARTED` state sets `buffering=true` without a timeout** — `frontend/src/hooks/useYouTubePlayer.ts:123-125`
  - If the YouTube iframe never transitions out of `UNSTARTED` (e.g., autoplay blocked), the buffering indicator stays forever.
  - Fixed: the UNSTARTED branch now schedules a 5s fallback that clears `buffering`; any subsequent state transition cancels it.

## Medium

- [x] **Video error "Retry" button bypasses 3-attempt limit** — `frontend/src/components/MediaPlayer.tsx:137-173`
  - The retry counter is enforced on automatic retries but the manual button skips the check, allowing infinite retries.
  - Fixed: after the auto-retry budget is exhausted, the overlay surfaces "Max retries reached" and offers only Reload Page.

- [x] **`currentTime === 0` rejection is too aggressive** — `frontend/src/hooks/useVideoSync.ts:158, 185`
  - Treating a server time of exactly 0 as a bug prevents legitimate seek-to-start.
  - Fixed: threshold tightened to `currentTime < 0.1 && delta > 3` so floating-point near-zero is caught while small deltas are allowed.

- [x] **Missing cleanup on media type switch** — `frontend/src/components/MediaPlayer.tsx:195-211`
  - Audit-note re-check: `MediaPlayer` never assigns `srcObject` — that's only used in `VideoChat.tsx` / `useWebRTC.ts` for WebRTC streams. The described `src` ↔ `srcObject` flip doesn't happen here, so there is nothing to cleanup. Closing as false positive; the WebRTC-side cleanup is tracked separately in `04-webrtc-video-chat.md`.
