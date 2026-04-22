# WatchWithMi Polishing Index

Master checklist for production-hardening work across the codebase. Each linked doc groups issues by severity (Critical / High / Medium / Low) with `file:line` references, rationale, and a suggested fix approach.

Work items are checkboxes — tick them off as you go. Keep the per-area "done/total" tally updated below so the top-level picture stays accurate.

## Docs

| # | Area | Doc | Progress |
|---|------|-----|----------|
| 01 | Critical bugs | [01-critical-bugs.md](01-critical-bugs.md) | 0/7 |
| 02 | Sync & playback | [02-sync-playback.md](02-sync-playback.md) | 0/6 |
| 03 | Chat, reactions, queue | [03-chat-reactions-queue.md](03-chat-reactions-queue.md) | 0/8 |
| 04 | WebRTC video chat | [04-webrtc-video-chat.md](04-webrtc-video-chat.md) | 0/5 |
| 05 | Security | [05-security.md](05-security.md) | 0/8 |
| 06 | Deployment & scaling | [06-deployment-scaling.md](06-deployment-scaling.md) | 0/9 |
| 07 | Accessibility & mobile | [07-accessibility-mobile.md](07-accessibility-mobile.md) | 0/6 |
| 08 | Tech debt | [08-tech-debt.md](08-tech-debt.md) | 0/8 |
| 09 | Observability | [09-observability.md](09-observability.md) | 0/5 |
| 10 | Testing | [10-testing.md](10-testing.md) | 0/6 |

**Total: 0/68**

## How to use

1. Pick a doc (start with `01-critical-bugs.md` — these affect users today).
2. Work items top-down within a severity bucket.
3. When you tick a checkbox, bump the progress tally in this index.
4. If you discover a new issue mid-work, add it to the relevant doc rather than letting it drift.

## Conventions

- **File references** use the form `` `path/from/repo/root.ext:line` `` so they click-through in most editors.
- **Severity** is about user/production impact, not effort:
  - *Critical* — user-visible bug or security hole today.
  - *High* — reliability, performance, or hardening gap likely to bite in prod.
  - *Medium* — polish, UX, or maintainability.
  - *Low* — nice-to-have.
- One doc per area. Cross-reference instead of duplicating.
