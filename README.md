# Social Connect — Backend

Express + MongoDB + Socket.IO API for Social Connect.

**GitHub:** [social-connect-backend](https://github.com/vijaynarkar17-crypto/social-connect-backend)

## Requirements

- Node.js 18+
- MongoDB Atlas cluster (or local MongoDB)

## Quick start

```powershell
npm install
copy .env.example .env
# Edit .env — set MONGODB_URI and JWT secrets
npm run dev
```

API runs at **http://localhost:4000**  
Root: **http://localhost:4000/**  
Health check: **http://localhost:4000/health**

## Production (Render)

Set these in **Render → Environment**:

| Variable | Example |
|----------|---------|
| `MONGODB_URI` | `mongodb+srv://user:pass@sc.iudyjxq.mongodb.net/socialconnect?appName=sc` |
| `FRONTEND_URL` | `https://social-connect-frontend-pi.vercel.app` |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | 32+ character random string |
| `JWT_REFRESH_SECRET` | 32+ character random string |

**MongoDB Atlas:** allow `0.0.0.0/0` in Network Access so Render can connect.

**Vercel frontend** must set `VITE_API_URL` to your Render URL (e.g. `https://social-connect-backend-t9nh.onrender.com`) and redeploy.

Test after deploy:
- `https://your-api.onrender.com/` → JSON welcome message
- `https://your-api.onrender.com/health` → `{"status":"ok"}`

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with hot reload (`tsx watch`) |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm run start` | Run compiled server |

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGODB_URI` | Yes | MongoDB connection string |
| `JWT_SECRET` | Yes | Access token secret (32+ chars) |
| `JWT_REFRESH_SECRET` | Yes | Refresh token secret |
| `FRONTEND_URL` | Yes | CORS origin (default `http://localhost:5173`) |
| `PORT` | No | API port (default `4000`) |
| `CLOUDINARY_*` | Optional | Image/video uploads |
| `GOOGLE_*` | Optional | Google OAuth |
| `SMTP_*` | Optional | Email (OTP, password reset) |

## MongoDB Atlas

1. Create a free cluster at [MongoDB Atlas](https://cloud.mongodb.com)
2. Add your IP under **Network Access**
3. Create a database user and copy the connection string into `MONGODB_URI`

## Repo layout

This folder is its own Git repo. The frontend lives in a separate repo. For local full-stack dev, use the parent workspace (`socialconnect/`) and run `npm run dev` from there to start both servers.
