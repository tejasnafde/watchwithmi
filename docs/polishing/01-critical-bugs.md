# Critical Bugs

Confirmed, user-impacting bugs found during the post-session audit. These should be fixed first — they affect correctness today.

## Critical

- [x] **Chat history loses `message_id`** — `frontend/src/hooks/useRoom.ts:170`
  - On `room_joined` / `room_created`, incoming messages are mapped to client-generated IDs instead of preserving `msg.message_id` from the server.
  - Emoji reactions on historical messages silently fail to match because reaction lookups use the server's ID.
  - Fix: preserve `msg.message_id` when present; fall back to the generated ID only if missing.

- [x] **Video reaction `setTimeout` leak** — `frontend/src/hooks/useRoom.ts:351-353`
  - Timeouts that clear ephemeral video reactions after 3s are not tracked.
  - If the component unmounts within the 3s window, the callback fires on stale state and may warn or no-op incorrectly.
  - Fix: keep timeout IDs in a `useRef` keyed by reaction; clear all on unmount.

- [x] **Host race condition on simultaneous join** — `app/handlers/socket_events.py:183-199`
  - Two users joining an empty room in the same event-loop tick both see `room.host_id is None` and both get `is_host=True`.
  - Fix: serialize host assignment inside `RoomManager.join_room` under a lock, or re-check `host_id is None` atomically inside `add_user`.

## High

- [x] **Queue title not validated** — `app/handlers/socket_events.py` (`handle_queue_add`)
  - Empty / whitespace-only titles are accepted into the queue.
  - Fix: reject after `.strip()`; emit error to sender.

- [x] **Queue reorder bounds not validated in handler** — `app/handlers/socket_events.py` (`handle_queue_reorder`)
  - Handler delegates to model-level clamping; client-supplied `new_index` could be any integer.
  - Fix: validate `0 <= new_index < len(queue)` in the handler; emit error on violation.

- [x] **User name length unbounded** — `app/handlers/socket_events.py` (`handle_create_room`, `handle_join_room`)
  - No max length → a 1MB name is possible and gets broadcast to every peer.
  - Fix: cap at 50 chars server-side; emit error above the limit.

## Medium

- [x] **Video reaction silent failure** — `app/handlers/socket_events.py` (`handle_video_reaction`)
  - Returns without emitting an error to the sender when validation fails, unlike other handlers which emit a structured error.
  - Fix: mirror the error-emit pattern used elsewhere so the client can surface the failure.
