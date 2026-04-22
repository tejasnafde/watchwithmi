# Chat, Reactions, Queue

Polish for the most recently added features. Core flows work; these items tighten UX and server-side validation.

## High

- [ ] **Emoji picker `onClose` not memoized** — `frontend/src/components/ChatPanel.tsx:27-38`
  - A new function identity every render causes `useEffect` to reattach the document click listener on each render.
  - Fix: wrap `onClose` in `useCallback` with stable deps.

- [ ] **Queue operations have no debounce** — `frontend/src/hooks/useRoom.ts:486-496`
  - Rapid clicks on reorder / remove send overlapping events; server state can leapfrog.
  - Fix: disable the button while an in-flight op for that item is pending; re-enable on ack or timeout.

- [ ] **Server-side emoji validation is weak** — `app/handlers/socket_events.py` (`handle_toggle_reaction`)
  - Current check is only `len(emoji) <= 2`, which admits arbitrary non-emoji payloads.
  - Fix: validate against a Unicode emoji category whitelist (e.g., `emoji` lib or regex for the emoji code blocks).

- [ ] **Playlist items not validated per-item** — `app/handlers/socket_events.py` (`handle_media_control` `load_playlist`)
  - A 10k-item list with missing fields is currently acceptable.
  - Fix: enforce max 500 items; require `url` and `title` on each; reject with structured error.

## Medium

- [ ] **Emoji picker overflow on small screens** — `frontend/src/components/ChatPanel.tsx`
  - Picker renders off-screen near viewport edges.
  - Fix: add simple viewport-edge detection, or use `@floating-ui/react` for robust placement.

- [ ] **No optimistic UI for reactions** — reactors see a delay until the server broadcast returns.
  - Fix: apply the reaction locally on click, reconcile on `reaction_updated`, roll back on error.

- [ ] **Queue thumbnail URL unvalidated** — `app/handlers/socket_events.py` (`handle_queue_add`)
  - Any string is accepted as `thumbnail`; could be `javascript:` or internal URLs.
  - Fix: require `http://` / `https://` prefix; strip otherwise.

## Low

- [ ] **Queue reorder indices go stale if queue updates mid-reorder** — item-id-based reorder is already implemented and the server clamps; leaving as-is for now unless users report issues.
