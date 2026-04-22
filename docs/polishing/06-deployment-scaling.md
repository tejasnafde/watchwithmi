# Deployment & Scaling

Docker, env vars, health checks, Redis, and dependency hygiene. Needed before exposing the service to the public.

## High

- [ ] **No real `/health` endpoint** — Dockerfile / compose healthcheck hits `/` which returns HTML
  - HTML comes back `200` even when the app is partially broken, giving false confidence.
  - Fix: add JSON `GET /health` returning `{status, room_count, uptime_s}`; update compose / Dockerfile to hit it.

- [ ] **Env vars not validated at startup**
  - Missing `CORS_ALLOWED_ORIGINS`, `SECRET_KEY`, etc. in prod silently use defaults.
  - Fix: on startup, if `ENV=production`, assert required vars are present; fail fast.

- [ ] **Redis integration unfinished** — `redis==5.0.1` in `requirements.txt`, `REDIS_URL` in `app/config.py`, but never imported anywhere
  - Either commit to it (multi-worker state, pub/sub for sockets) or drop the dep.
  - Fix: decide; implement the pub/sub pattern if keeping, or remove dep + config for now.

- [ ] **Unused auth dependencies** — `passlib`, `python-jose` installed; no auth code exists
  - Dead deps bloat image size and CVE surface.
  - Fix: remove from `requirements.txt` until auth is actually built.

## Medium

- [ ] **Single-worker limitation not documented**
  - Socket.IO in-memory state means horizontal scaling requires the Redis adapter.
  - Fix: add a "Scaling" note to `README.md` and `readmes/DEPLOYMENT.md` calling this out.

- [ ] **Graceful shutdown for libtorrent** — `__del__` is unreliable, but `app/main.py:54-63` lifespan already calls `clear_all_medias()`
  - Verify it runs on `SIGTERM` inside the container (uvicorn lifecycle).
  - Fix: add integration test or manual verification step in deployment docs.

- [ ] **libtorrent `listen_on()` deprecated** — `app/services/media_bridge.py:72`
  - Call is deprecated; replacement is the `listen_interfaces` setting on the session.
  - Fix: migrate to `listen_interfaces`; drop the `listen_on()` call.

- [ ] **Content-Type for MKV files** — `app/services/media_bridge_api.py:128`
  - Currently served as `video/webm` regardless of container; browsers may refuse MKV.
  - Fix: use `video/x-matroska` for `.mkv`, keep `video/webm` for `.webm`, etc.

## Low

- [ ] **No cleanup job for orphaned sessions** — empty rooms are deleted on last-leave (already works)
  - Sockets that vanish without a clean disconnect (network drop) can leave stale entries.
  - Fix: periodic sweep (e.g., every 5 min) removing `sid`s not present in the current Socket.IO session map.
