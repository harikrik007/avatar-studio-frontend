# Avatar Studio — frontend

Plain, white/black Next.js app for Avatar Creation Studio: landing page,
pricing, a shared-password gate, and a dashboard where you upload a 6-second
video and watch the avatar get created.

Backend lives in a separate repo (`realtime-avatar-studio`).

## Deploy (Railway)

Railway auto-detects Next.js. Set these environment variables:

| Variable | Purpose |
|---|---|
| `AVATAR_STUDIO_API_URL` | URL of the deployed backend API |
| `AVATAR_STUDIO_API_TOKEN` | shared bearer token the API expects (server-side only, never shipped to the browser) |
| `GATE_PASSWORD` | shared password for the demo access gate |

All three are read server-side only (no `NEXT_PUBLIC_` prefix) — the browser
never sees the API token or the gate password. The `app/api/*` routes proxy
to the backend, holding the token server-side, the same pattern the
pizza/bank client apps use.

## Local dev

```bash
npm install
# .env.local with the three vars above (backend at http://127.0.0.1:8095)
npm run dev
```
