# 🚀 WatchWithMi Deployment Guide

## Quick Start Options (Choose One)

### 🌟 Option 1: Railway (Recommended - Full Stack)
**Best for: Complete deployment with database persistence**

1. **Sign up**: Go to [railway.app](https://railway.app) and sign up with GitHub
2. **Deploy**: 
   ```bash
   # Install Railway CLI
   npm install -g @railway/cli
   
   # Login and deploy
   railway login
   railway deploy
   ```
3. **Configure**: Add environment variables in Railway dashboard
4. **Share**: Get your live URL (e.g., `https://watchwithmi-production.up.railway.app`)

---

### ⚡ Option 2: Render (Free Tier Available)
**Best for: Free hosting with some limitations**

1. **Frontend on Vercel**:
   ```bash
   cd frontend
   npx vercel --prod
   ```

2. **Backend on Render**:
   - Go to [render.com](https://render.com)
   - Connect your GitHub repo
   - Deploy as "Web Service"
   - Use: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

---

### 🐳 Option 3: DigitalOcean App Platform
**Best for: Production deployment**

1. **Create account**: [DigitalOcean App Platform](https://www.digitalocean.com/products/app-platform)
2. **Connect repo**: Link your GitHub repository
3. **Configure**:
   - **Backend**: Python app, port 8000
   - **Frontend**: Node.js app (Next.js)
4. **Deploy**: Automatic deployment from GitHub

---

## Environment Variables Needed

```env
# Backend (.env)
CORS_ORIGINS=https://your-frontend-url.vercel.app
PORT=8000

# Frontend (.env.local)
NEXT_PUBLIC_BACKEND_URL=https://your-backend-url.com
NEXT_PUBLIC_WS_URL=wss://your-backend-url.com
```

---

## Local Development URLs
- **Frontend**: http://localhost:3000
- **Backend**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs

## Production Checklist
- [ ] Backend deployed and accessible
- [ ] Frontend deployed with correct backend URL
- [ ] WebSocket connections working
- [ ] CORS configured for your domain
- [ ] Environment variables set
- [ ] Test room creation and joining

---

## Quick Test Script
```bash
# Test backend health
curl https://your-backend-url.com/health

# Test frontend
curl https://your-frontend-url.com
```

## Troubleshooting

### Common Issues:
1. **CORS errors**: Update CORS_ORIGINS in backend
2. **WebSocket fails**: Check WSS URL in frontend
3. **404 errors**: Verify API endpoints match
4. **Slow loading**: Check torrent streaming thresholds

### Debug Commands:
```bash
# Check backend logs
railway logs --service backend

# Check frontend build
cd frontend && npm run build
```

## Scaling

### Single-worker constraint

The backend currently runs **one Gunicorn/Uvicorn worker** (see the `CMD`
in `Dockerfile`). This is deliberate — Socket.IO, `RoomManager`, chat
history, the queue, and the per-sid rate-limit bucket all live in
**in-process memory**. Starting a second worker breaks the app because
room state diverges between workers and socket emits don't cross the
process boundary.

What this buys you: simpler deployment, no external dependencies.
What it costs you: the service can't take advantage of multi-core or
run more than one instance. On Render, scale vertically (larger
instance) rather than horizontally for now.

### When you're ready to horizontally scale

Flip to a Redis-backed Socket.IO manager so emits propagate across
workers:

```python
# app/main.py
import socketio
manager = socketio.AsyncRedisManager(os.environ["REDIS_URL"])
sio = socketio.AsyncServer(client_manager=manager, async_mode='asgi', ...)
```

Then:
1. Add `redis>=5.0.0` back to `requirements.txt` (was dropped in the
   06-deployment-scaling pass because nothing imported it).
2. Provision a Render **Key Value** service, or point `REDIS_URL` at
   Upstash / Redis Cloud.
3. Bump Gunicorn `--workers` in the `Dockerfile` `CMD` to 2+.
4. Enable sticky sessions on the Render service so a given socket stays
   pinned to one worker — room state still lives per-worker; Redis only
   carries the pub/sub channel.

Full room-state-in-Redis is a separate project and not necessary for
this step.

### Graceful shutdown

The FastAPI `lifespan` context in `app/main.py` calls
`media_bridge.clear_all_medias()` and cancels the orphaned-session
sweep in its `finally` block. Uvicorn translates `SIGTERM` from the
container orchestrator into lifespan shutdown, so Render / Docker-stop
should let the app close cleanly. Verify with:

```bash
docker run --rm -it -p 8000:8000 watchwithmi
# in another terminal:
docker kill --signal=SIGTERM <container>
# logs should show "WatchWithMi shutting down" + "Cleaning up N active
# media items" before the process exits.
```

## Health check

`GET /health` returns JSON with `{status, room_count, uptime_s, app,
version}`. Render and the Dockerfile are configured to use it.
`status` is `"starting"` during boot and `"ok"` once the lifespan has
initialized services — a partially-initialized app won't pass the check.

## Required environment variables on Render

Covered end-to-end in [`docs/polishing/05-security.md`](../docs/polishing/05-security.md).
Short version: `ENV=production`, `SECRET_KEY`, and
`CORS_ALLOWED_ORIGINS` are **required** in prod or the app refuses to
start. See that doc for the full table including optional rate-limit
knobs.

## 🎉 Ready to Share!
Once deployed, share your live URL with friends:
`https://your-app-name.railway.app` 