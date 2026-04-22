# Environment Variables & Security Guide

## ✅ Correct Location for `.env` File

**Put your `.env` file in the PROJECT ROOT:**
```
/Users/tejas/Desktop/projects/watchwithmi/.env
```

**NOT in:**
- ❌ `/Users/tejas/Desktop/projects/watchwithmi/frontend/.env` (would be exposed to client)
- ❌ `/Users/tejas/Desktop/projects/watchwithmi/app/.env` (works but not standard)

## Why Project Root is Secure

### Backend (Python/FastAPI)
- The backend runs on the server side
- It reads `.env` from the project root using `os.getenv()`
- Environment variables are **never** sent to the client
- The `.env` file is in `.gitignore` so it won't be committed

### Frontend (Next.js)
- Next.js has a special convention for environment variables
- **Server-side variables**: Regular variables (e.g., `YOUTUBE_API_KEY`)
  - Only accessible in server-side code
  - Never exposed to the browser
- **Client-side variables**: Must be prefixed with `NEXT_PUBLIC_`
  - Example: `NEXT_PUBLIC_BACKEND_URL`
  - These ARE exposed to the browser (intentionally)

## Security Best Practices

### ✅ DO:
1. **Keep sensitive keys in the root `.env`** (backend only)
2. **Use `NEXT_PUBLIC_` prefix** only for non-sensitive values that the frontend needs
3. **Add `.env` to `.gitignore`** (already done ✅)
4. **Create a `.env.example`** with dummy values for documentation

### ❌ DON'T:
1. **Never prefix sensitive keys with `NEXT_PUBLIC_`**
2. **Never commit `.env` to git**
3. **Never hardcode API keys in code**

## Example `.env` File Structure

Create `/Users/tejas/Desktop/projects/watchwithmi/.env`:

```bash
# ============================================================================
# Backend Environment Variables (Server-side only - SECURE)
# ============================================================================

# YouTube API
YOUTUBE_API_KEY=your_actual_youtube_api_key_here

# Database (if you add one later)
DATABASE_URL=postgresql://user:password@localhost/watchwithmi

# Redis (if you use it)
REDIS_URL=redis://localhost:6379

# Secret keys for authentication
SECRET_KEY=your_secret_key_here
JWT_SECRET=your_jwt_secret_here

# ============================================================================
# Frontend Environment Variables (Client-side - PUBLIC)
# ============================================================================

# Backend URL - safe to expose, it's just the API endpoint
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000

# Any other public configuration
NEXT_PUBLIC_APP_NAME=WatchWithMi
```

## How the Backend Reads Environment Variables

The backend uses Python's `os.getenv()`:

```python
# In app/services/youtube_search.py
import os

api_key = os.getenv("YOUTUBE_API_KEY")  # Reads from .env in project root
```

This is handled by:
1. The `python-dotenv` package (if installed)
2. Or by manually loading the `.env` file
3. Or by setting environment variables before running the app

## How the Frontend Reads Environment Variables

Next.js automatically loads `.env` files:

```typescript
// In frontend code
const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL  // ✅ Works (public)
const apiKey = process.env.YOUTUBE_API_KEY              // ❌ Undefined (not prefixed)
```

## Current Setup

Looking at your code:
- ✅ Backend reads `YOUTUBE_API_KEY` using `os.getenv("YOUTUBE_API_KEY")`
- ✅ Frontend uses `NEXT_PUBLIC_BACKEND_URL` for the API endpoint
- ✅ `.env` is in `.gitignore`

## Quick Setup

1. **Create the `.env` file:**
```bash
cd /Users/tejas/Desktop/projects/watchwithmi
touch .env
```

2. **Add your API key:**
```bash
echo "YOUTUBE_API_KEY=your_api_key_here" >> .env
echo "NEXT_PUBLIC_BACKEND_URL=http://localhost:8000" >> .env
```

3. **Restart the server:**
```bash
# Press Ctrl+C to stop
./scripts/start-fullstack.sh
```

## Verification

After adding the API key, you should see in the logs:
```
✅ YouTube search service initialized with API key
```

Instead of:
```
🚫 Google API client not installed - YouTube search disabled
```

## Additional Security Tips

1. **Use different `.env` files for different environments:**
   - `.env.local` - Local development (git-ignored)
   - `.env.production` - Production (never commit)
   - `.env.example` - Template (safe to commit)

2. **For production deployment:**
   - Use environment variables from your hosting platform
   - Never deploy the `.env` file itself
   - Use secrets management (AWS Secrets Manager, Vercel Env Vars, etc.)

3. **Rotate API keys regularly:**
   - Especially if you suspect they've been exposed
   - Google Cloud Console makes this easy

## Summary

**Location:** `/Users/tejas/Desktop/projects/watchwithmi/.env`

**What goes in it:**
- ✅ `YOUTUBE_API_KEY` (backend only, secure)
- ✅ `NEXT_PUBLIC_BACKEND_URL` (frontend, public - just the URL)
- ✅ Any other backend secrets

**What stays out:**
- ❌ Never put sensitive keys with `NEXT_PUBLIC_` prefix
- ❌ Never commit `.env` to git (already in `.gitignore`)

You're all set! 🔒
