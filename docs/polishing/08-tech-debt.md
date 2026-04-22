# Tech Debt

Deprecations, dead code, type-safety gaps. Low urgency per item; quality-of-life wins when taken together.

## High

- [ ] **Pydantic v1 `@validator` deprecated** — `app/main.py:134, 148`, `app/services/media_bridge_api.py:25`
  - v2 emits a `DeprecationWarning` on import; will break on the next major bump.
  - Fix: migrate to `@field_validator` + `mode="before" | "after"` as appropriate.

- [ ] **Two failing test files** — `tests/test_search_service.py`, `tests/test_services.py`
  - Both require external services (real network / real torrent peers) and are currently red.
  - Fix: gate behind `@pytest.mark.external` and skip by default, or delete if they're not providing coverage.

## Medium

- [ ] **Map mutation pattern in `useWebRTC.ts`**
  - Working, but scattered `connections.current.set(id, {...connections.current.get(id), foo: bar})` is fragile.
  - Fix: extract `updateConnection(userId, patch)` helper.

- [ ] **`any` types in `useRoom.ts` socket handlers**
  - Most socket callbacks have `(payload: any) => ...`.
  - Fix: define payload types in `frontend/src/types/socket.ts` (or similar); thread through.

- [ ] **Unused `User.joined_at` string**
  - Only `joined_at_ts` (number) is read anywhere.
  - Fix: drop the string field from the model; update serializers/tests.

- [ ] **Bare `except Exception:`** — `app/services/youtube_search.py:139`
  - Swallows everything with no log.
  - Fix: narrow to the actual expected exception types; log at `warning` otherwise.

## Low

- [ ] **Inconsistent chat ID scheme** — some IDs client-generated, some server-generated
  - Related to `01-critical-bugs.md` first item.
  - Fix: standardize on server-generated; clients use returned IDs for subsequent ops.

- [ ] **Ad-hoc z-index values** — `z-10 / 20 / 30 / 50` scattered across components
  - Hard to reason about stacking.
  - Fix: define a z-scale in `tailwind.config` or a shared constants file; replace literals.
