# Chat, Reactions, Queue

Polish for the most recently added features. Core flows work; these items tighten UX and server-side validation.

## High

- [x] **Emoji picker `onClose` not memoized** — `frontend/src/components/ChatPanel.tsx:27-38`
  - A new function identity every render causes `useEffect` to reattach the document click listener on each render.
  - Fixed: `closePicker` and `selectEmoji` are now memoized with `useCallback` inside `MessageReactions`, so `EmojiPicker`'s document-listener effect runs exactly once per open session.

- [x] **Queue operations have no debounce** — `frontend/src/hooks/useRoom.ts:486-496`
  - Rapid clicks on reorder / remove send overlapping events; server state can leapfrog.
  - Fixed: per-item in-flight tracking via `pendingQueueOpsRef`. Repeat calls for the same item_id no-op until the server's `queue_updated` ack clears the guard. New `isQueueOpPending(itemId)` helper exposed for button disable states.

- [x] **Server-side emoji validation is weak** — `app/handlers/socket_events.py` (`handle_toggle_reaction`)
  - Current check is only `len(emoji) <= 2`, which admits arbitrary non-emoji payloads.
  - Fixed: regex-based `_is_allowed_emoji` helper restricts to known emoji code-point ranges (plus VS-16, ZWJ, keycap combiner, skin tones), capped at 8 chars.

- [x] **Playlist items not validated per-item** — `app/handlers/socket_events.py` (`handle_media_control` `load_playlist`)
  - A 10k-item list with missing fields is currently acceptable.
  - Fixed: `_validate_playlist_items` enforces `len(items) <= 500` and requires each item to be an object with a non-empty `url` and `title`. Returns a per-item error message on violation.

## Medium

- [x] **Emoji picker overflow on small screens** — `frontend/src/components/ChatPanel.tsx`
  - Picker renders off-screen near viewport edges.
  - Fixed: extracted pure `choosePickerAnchor` helper (`frontend/src/lib/pickerPlacement.ts`). `EmojiPicker` uses `useLayoutEffect` to measure the trigger and flip from right-anchoring to left-anchoring when right-anchoring would clip the left viewport edge.

- [x] **No optimistic UI for reactions** — reactors see a delay until the server broadcast returns.
  - Fixed: `toggleReaction` now updates `chatMessages` locally before emitting. The existing `reaction_updated` handler overwrites with the authoritative server state when the broadcast arrives.

- [x] **Queue thumbnail URL unvalidated** — `app/handlers/socket_events.py` (`handle_queue_add`)
  - Any string is accepted as `thumbnail`; could be `javascript:` or internal URLs.
  - Fixed: `_is_allowed_thumbnail` requires blank or an http(s) URL.

## Low

- [x] **Queue reorder indices go stale if queue updates mid-reorder** — item-id-based reorder is already implemented and the server clamps. Left as documented non-issue; no reports.
