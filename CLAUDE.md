# watchwithmi

Shared cross-project conventions (GCP accounts and the `--configuration=personal`
rule, OAuth consent branding, Secret Manager inventory, Cloud Run gotchas,
writing style) live in `~/Desktop/projects/CLAUDE.local.md`. Read it before
touching gcloud, secrets, or DNS.

@/Users/tejas/Desktop/projects/CLAUDE.local.md

Watch-party app: room codes, synchronized playback, chat, media queue, WebRTC
video, YouTube search. Live at <https://watchwithmi.tn07.dev>.

## Layout

- `app/` - FastAPI + python-socketio ASGI. The ASGI target is
  **`app.main:socket_app`**, not `app.main:app`. Using the latter serves HTTP
  fine and silently breaks every realtime feature.
- `frontend/` - Next.js 15 App Router, runs as a Node server (`next start`), not
  a static export. Cannot go on a bucket or Cloudflare Pages.
- `edge/` - Cloudflare Worker that fronts both services on one hostname.
- `Torrent-Api-py/` (sibling repo) - dead scaffolding. The provider it documents
  does not exist and its tests are disabled in `pyproject.toml`. Ignore it.

## Commands

- `pip install -r requirements-dev.txt` then `pytest tests -q`
- `npm --prefix frontend run dev`, `npm --prefix frontend test`
- Runtime deps are `requirements.txt`; test-only deps are in
  `requirements-dev.txt` so the image stays slim.

## Deploying: merging to `main` deploys

`.github/workflows/deploy.yml` runs on every push to `main`, so **a merged PR
ships**. Doc-only commits (`readmes/**`, `docs/**`, `*.md`) are skipped. The
`test` job gates both deploys, so a red suite ships nothing.

Full detail in `readmes/DEPLOYMENT-GCP.md`. `readmes/DEPLOYMENT.md` is
out of date and says so at the top. The things worth knowing here:

- **`--max-instances=1` on the API is load-bearing, not cost control.** Room
  state, chat, queue and rate-limit buckets are in process memory
  (`app/services/room_manager.py`). A second *instance* puts two people with the
  same room code in different processes with no error and nothing in the logs.
  `--workers 1` in the Dockerfile only covers one instance. Raising the cap needs
  the Redis adapter sketched in `readmes/DEPLOYMENT.md`.
- `--min-instances=0` is safe: an open WebSocket is an in-flight request, so an
  instance stays warm while anyone is connected and scales to zero only once
  rooms are empty.
- **Changing the backend URL requires rebuilding the frontend.** `NEXT_PUBLIC_*`
  is inlined into the client bundle at build time, so editing an env var on the
  running service does nothing. `run deploy --source` cannot pass `--build-arg`,
  hence `frontend/cloudbuild.yaml` with substitutions.
- **Always pass `--project teejayproject` to gcloud in CI.** It otherwise infers
  the project from the credential's email domain
  (`...@developer.gserviceaccount.com`) and fails against a project named
  `developer`.
- One hostname serves both services via `edge/`: `/api/*`, `/socket.io/*` and
  `/health` go to the API, everything else to Next.js. That makes the browser
  same-origin, so there are no CORS preflights and no allowlist to keep in sync.
  WebSocket upgrades pass through the Worker fine (verified 101 + `websocket`
  transport).

Nothing runs on Render any more; those services are suspended.

## The torrent bridge is WIP and disabled

`ENABLE_MEDIA_BRIDGE` defaults to `false`. All `/api/media/*` routes plus
`/api/search-content` and `/api/diag/search*` return **501**, gated by a
router-level dependency so a new route cannot forget it.

501 and not 503 on purpose: `frontend/src/components/MediaPlayer.tsx` treats 503
as "still buffering" and retries five times with backoff, so 503 would make the
UI spin against a feature that is off by design. `tests/test_search_diagnostics.py`
asserts this.

`libtorrent` is not installed. It has no manylinux wheel for every platform, so
pip falls back to building against Boost and fails late in the image build, which
looks like "torrent doesn't work" rather than a deploy failure.

**It cannot be fixed by rehosting.** It needs inbound TCP+UDP on 6881-6891 for
DHT and trackers, a writable disk sized for whole video files, and a process that
stays warm for the length of a movie. Cloud Run is strictly worse than Render
here because `/tmp` is tmpfs, so a large download exhausts RAM instead of disk.
Public indexers also 403 datacenter IPs (see the audit note in
`app/services/p2p_search.py`). Intended direction: stop fetching server-side and
accept a user-supplied direct link from a browser extension.

To work on it locally: `pip install libtorrent==2.0.11` and
`ENABLE_MEDIA_BRIDGE=true python run.py`.

## Known gaps

- No auth at all. Access control is the 6-character room code. `SECRET_KEY` is
  demanded by `validate_production_config` but no auth code reads it.
- `/api/search-youtube` is an unauthenticated, unthrottled proxy to the YouTube
  Data API key. `app/handlers/rate_limit.py` covers Socket.IO only, not REST.
- WebRTC has STUN but no TURN (`frontend/src/hooks/useWebRTC.ts`), so peer video
  fails behind symmetric NAT regardless of hosting.
- Any restart or scale-to-zero destroys every live room. There is no persistence.
