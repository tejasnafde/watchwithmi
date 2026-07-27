# Deploying to GCP Cloud Run

Current production target as of 2026-07-27. Supersedes `DEPLOYMENT.md`, which
describes Render and Railway and is stale (it also names the wrong ASGI target -
the app with Socket.IO mounted is `app.main:socket_app`, not `app.main:app`).

**Public URL: <https://watchwithmi.tn07.dev>** - both services behind one
hostname via the Cloudflare Worker in `edge/`. Paths `/api/*`, `/socket.io/*`
and `/health` go to the API; everything else goes to the Next.js app.

Because both are on one origin the browser never makes a cross-origin request.
`CORS_ALLOWED_ORIGINS` is still set (Socket.IO checks `Origin` on the handshake)
but there are no preflights and no allowlist to re-sync when a URL changes. The
`*.run.app` URLs keep working and are what the Worker forwards to.

Two services in `teejayproject`, region `asia-south1`:

| Service | Image source | URL |
|---|---|---|
| `watchwithmi-api` | root `Dockerfile`, deployed with `run deploy --source .` | `https://watchwithmi-api-974343814740.asia-south1.run.app` |
| `watchwithmi-web` | `frontend/Dockerfile` via `frontend/cloudbuild.yaml` | `https://watchwithmi-web-974343814740.asia-south1.run.app` |

## The constraint that governs everything: `--max-instances=1`

Room state, chat history, the media queue and the rate-limit buckets all live in
process memory (`app/services/room_manager.py:18`). The Dockerfile already pins
`--workers 1` for that reason. On Cloud Run the same logic applies one level up:
**if a second instance starts, two users in the same room land on different
processes and cannot see each other.** There is no error, they simply sit in
what look like separate rooms.

So the API is deployed with `--max-instances=1 --session-affinity`.

`--min-instances=0` is safe and is what we want. An open WebSocket is an
in-flight request, so Cloud Run keeps the instance alive while anyone is
connected, and only scales to zero once every room is empty - at which point
there is no state left worth preserving. The cost is a cold start for the first
visitor after an idle period.

Lifting the max-instances cap requires the Redis work sketched in
`DEPLOYMENT.md` (`socketio.AsyncRedisManager` + sticky sessions). Until then,
raising it is a silent correctness bug, not a scaling win.

## Deploying the API

```sh
gcloud --configuration=personal run deploy watchwithmi-api \
  --source . --region=asia-south1 --allow-unauthenticated \
  --min-instances=0 --max-instances=1 --session-affinity \
  --timeout=3600 --cpu=1 --memory=512Mi \
  --set-env-vars="ENV=production,DEBUG=false,ENABLE_MEDIA_BRIDGE=false,CORS_ALLOWED_ORIGINS=<web-url>" \
  --set-secrets="SECRET_KEY=WATCHWITHMI_SECRET_KEY:latest,YOUTUBE_API_KEY=WATCHWITHMI_YOUTUBE_API_KEY:latest"
```

`--timeout=3600` is the Cloud Run request timeout and it bounds how long a
single WebSocket connection may live. Clients reconnect, so this is a ceiling on
connection age, not on session length.

`ENV=production` makes `validate_production_config()` refuse to boot unless
`SECRET_KEY` and `CORS_ALLOWED_ORIGINS` are both set and not `*`. That is
deliberate. Both secrets are in Secret Manager and are read by the default
compute service account, which holds `roles/secretmanager.secretAccessor` on
each.

## Deploying the web frontend

`NEXT_PUBLIC_*` is inlined into the client bundle at **build** time, so the
backend URL is a build argument. `gcloud run deploy --source` cannot pass
`--build-arg`, which is why there is an explicit build config:

```sh
cd frontend
gcloud --configuration=personal builds submit --config cloudbuild.yaml \
  --substitutions=_BACKEND_URL=https://watchwithmi-api-974343814740.asia-south1.run.app \
  --region=asia-south1 .

gcloud --configuration=personal run deploy watchwithmi-web \
  --image=asia-south1-docker.pkg.dev/teejayproject/cloud-run-source-deploy/watchwithmi-web:latest \
  --region=asia-south1 --allow-unauthenticated \
  --min-instances=0 --max-instances=2 --port=8080
```

**Changing the backend hostname requires rebuilding the frontend.** Editing an
env var on the running service does nothing, because the old URL is already
compiled into the JavaScript.

Since the Worker puts both services on one origin, `_BACKEND_URL` is now
`https://watchwithmi.tn07.dev` - the frontend's own address.

## The edge Worker

```sh
cd edge && npx wrangler deploy
```

`routes` declares `custom_domain = true`, so Cloudflare creates and owns the DNS
record. Do not also add a `watchwithmi` record with `dns.sh`; they conflict.

Expect roughly 15 minutes of TLS handshake failures after first deploying a new
hostname while its certificate is issued. There is no wildcard covering
`*.tn07.dev` to inherit from.

The frontend may scale past one instance freely - it holds no shared state.

## Chicken-and-egg on first deploy

The API needs the web origin for CORS; the web build needs the API URL. Deploy
the API first with a placeholder `CORS_ALLOWED_ORIGINS`, build and deploy the
web service, then `run services update watchwithmi-api
--update-env-vars=CORS_ALLOWED_ORIGINS=<web-url>`.

## Verifying a deploy

```sh
curl -s $API/health                                     # 200 {"status":"ok",...}
curl -s -X POST $API/api/media/add -d '{...}'           # 501 - WIP, expected
curl -s -H "Origin: $WEB" "$API/socket.io/?EIO=4&transport=polling"   # 200 + sid
curl -s -H "Origin: https://evil.example" "$API/socket.io/?EIO=4&transport=polling"  # 400
```

The Origin pair is the test worth keeping: it proves CORS allows the real
frontend and rejects everything else. A 200 on `/health` alone does not.
