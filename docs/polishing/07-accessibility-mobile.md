# Accessibility & Mobile

Touch targets, responsive layout, keyboard navigation, and ARIA labels. The desktop UX is solid; mobile needs a real pass, and keyboard users are locked out of several flows.

## High

- [ ] **Fixed 400px sidebar** — `frontend/src/app/room/[roomCode]/page.tsx:362`
  - Sidebar is absolute-sized; on mobile it crowds out the video.
  - Fix: `w-full md:w-[400px]`; stack vertically on mobile (`flex-col md:flex-row`).

- [ ] **Touch targets too small** — `frontend/src/components/MediaControls.tsx:494-508` (queue reorder), video reactions
  - Under 44×44px violates WCAG and iOS HIG.
  - Fix: bump visible sizes or add larger hit areas via padding / `::before` pseudo-elements.

- [ ] **Video reaction bar only visible on hover**
  - Unusable on touch devices (no hover event).
  - Fix: always visible on `@media (hover: none)`; keep hover-to-reveal on desktop.

## Medium

- [ ] **Missing aria-labels** — emoji buttons, reorder buttons, reaction pills
  - Screen readers announce nothing meaningful.
  - Fix: add `aria-label` describing the action; `aria-pressed` for toggles.

- [ ] **No keyboard shortcuts**
  - Users have to mouse everything.
  - Fix: Space (play/pause), Arrow L/R (seek ±5s), M (mute), T (focus chat), Esc (close picker). Wire via a single global listener; respect `input`/`textarea` focus.

- [ ] **Emoji picker positioning naive**
  - Fix tied to `03-chat-reactions-queue.md`; swap to `@floating-ui/react` for proper edge detection.
