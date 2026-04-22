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

## 🎉 Ready to Share!
Once deployed, share your live URL with friends:
`https://your-app-name.railway.app` 