# Deployment & Scaling

Docker, env vars, health checks, Redis, and dependency hygiene. Needed before exposing the service to the public.

## High

- [x] **No real `/health` endpoint** — Dockerfile / compose healthcheck hits `/` which returns HTML
  - Fixed: `/health` now returns JSON `{status, room_count, uptime_s, app, version}`. `status` is `"starting"` during boot and `"ok"` after `lifespan` initializes services — so a partially-wired app fails the healthcheck. Dockerfile `HEALTHCHECK` updated to hit `/health`.

- [x] **Env vars not validated at startup**
  - Fixed in [`05-security.md`](05-security.md) — `validate_production_config()` in `app/config.py` refuses to start when `ENV=production` and `SECRET_KEY` / `CORS_ALLOWED_ORIGINS` are unsafe. Called at the top of `app/main.py`.

- [x] **Redis integration unfinished** — `redis==5.0.1` in `requirements.txt`, `REDIS_URL` in `app/config.py`, but never imported anywhere
  - Dropped: `redis==5.0.1` removed from `requirements.txt`, `REDIS_URL` removed from `app/config.py`. Render free tier only runs one worker anyway — the socket.io Redis adapter buys nothing until we scale out. `readmes/DEPLOYMENT.md` now documents the re-integration path (socket.io's `AsyncRedisManager`, ~30 min of work when we need it).

- [x] **Unused auth dependencies** — `passlib`, `python-jose` installed; no auth code exists
  - Dropped from `requirements.txt`. Re-add when accounts / signed links land.

## Medium

- [x] **Single-worker limitation not documented**
  - Fixed: new "Scaling" section in `readmes/DEPLOYMENT.md` explains the in-process constraint, how to flip to multi-worker via socket.io's Redis manager, and what's required on Render (Key Value service, sticky sessions, bumped `--workers`).

- [x] **Graceful shutdown for libtorrent** — `__del__` is unreliable, but `app/main.py` lifespan already calls `clear_all_medias()`
  - Verified: FastAPI's `@asynccontextmanager` lifespan runs its `finally`/post-yield cleanup when uvicorn receives `SIGTERM`. The orphaned-session sweep is now cancelled there as well. Manual verification recipe documented in `readmes/DEPLOYMENT.md` (`docker kill --signal=SIGTERM` → inspect logs).

- [x] **libtorrent `listen_on()` deprecated** — `app/services/media_bridge.py:72`
  - Fixed: session now uses the settings-based `listen_interfaces` with a port range (`6881..6891`). The deprecation warning is gone from test runs.

- [x] **Content-Type for MKV files** — `app/services/media_bridge_api.py:128`
  - Fixed: new `content_type_for(filename)` helper with an explicit `CONTENT_TYPE_BY_EXT` map. `.mkv` now returns `video/x-matroska`, which browsers can actually parse; previously it was aliased to `video/webm` on the mistaken assumption that it's "more standard".

## Low

- [x] **No cleanup job for orphaned sessions** — empty rooms are deleted on last-leave (already works)
  - Fixed: new `RoomManager.cleanup_stale_sessions(active_sids)` walks the room/user map and evicts users whose sid isn't in the live Socket.IO session set. A background task in `lifespan` invokes it every `ORPHANED_SESSION_SWEEP_INTERVAL_SECONDS` (default 300) using `sio.manager.rooms["/"]` as the source of truth. Host-transfer and empty-room deletion are reused from the existing `leave_room` path, and the sweep is cancelled as part of graceful shutdown.
