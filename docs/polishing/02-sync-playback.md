# Sync & Playback

Polish for video sync, buffering, and drift handling. The core loop is working but has a handful of edge cases that cause visible glitches under load or on manual interaction.

## High

- [ ] **Early-return in `handleVideoPlay` / `handleVideoPause` skips flag clear** — `frontend/src/hooks/useVideoSync.ts:146-205`
  - If an early `return` fires before the sync-flag is cleared, the flag stays set and blocks the next event.
  - Fix: restructure as `try { ... } finally { clearFlag() }`, or lift flag management above the early returns.

- [ ] **Overlapping sync-flag `setTimeout`s** — `frontend/src/hooks/useYouTubePlayer.ts:173, 272, 297, 372`
  - Multiple timeouts can be outstanding at once, each racing to clear the flag. The last one wins, which may be wrong.
  - Fix: track a single timeout ID per flag; `clearTimeout` the previous before setting a new one.

- [ ] **`UNSTARTED` state sets `buffering=true` without a timeout** — `frontend/src/hooks/useYouTubePlayer.ts:123-125`
  - If the YouTube iframe never transitions out of `UNSTARTED` (e.g., autoplay blocked), the buffering indicator stays forever.
  - Fix: schedule a fallback to clear `buffering` after N seconds if no state change arrives.

## Medium

- [ ] **Video error "Retry" button bypasses 3-attempt limit** — `frontend/src/components/MediaPlayer.tsx:137-173`
  - The retry counter is enforced on automatic retries but the manual button skips the check, allowing infinite retries.
  - Fix: route the manual retry through the same counter; show "Max retries reached" once exhausted.

- [ ] **`currentTime === 0` rejection is too aggressive** — `frontend/src/hooks/useVideoSync.ts:158, 185`
  - Treating a server time of exactly 0 as a bug prevents legitimate seek-to-start.
  - Fix: use threshold `< 0.1 && delta > 3` so a deliberate seek to 0 still applies.

- [ ] **Missing cleanup on media type switch** — `frontend/src/components/MediaPlayer.tsx:195-211`
  - When switching between HTML video (`src`) and MediaStream (`srcObject`), the previous binding can linger.
  - Fix: explicitly clear both `src` and `srcObject` before assigning the new source.
