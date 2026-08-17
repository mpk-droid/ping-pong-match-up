# Ping Pong Availability Board

> Also see `AGENTS.md` — shared agent context for Cursor and Claude Code.

## Project Overview

Office ping pong availability board. People mark 30-minute time slots when they're free to play. Real-time sync across all browsers via SSE. No auth — self-reported nicknames only.

## Tech Stack

- **Runtime**: Node.js (no build step)
- **Server**: Express 5 serving static files + JSON API + SSE
- **Frontend**: Vanilla HTML/CSS/JS (no framework, no bundler)
- **State**: SQLite via `better-sqlite3` (`data/pingpong.db` locally)
- **Deployment**: Docker container on OpenShift (single replica + PVC)

## Project Structure

```
server.js                  — Express server, API routes, SSE broadcast, SQLite
public/index.html          — Single-page frontend with inline JS
public/style.css           — Responsive styles, dark mode via prefers-color-scheme
Dockerfile                 — Node 20 Alpine, non-root (UID 1001)
openshift/deployment.yaml  — Deployment + Service + Route + PVC
openshift/cronjob.yaml     — Daily clear via POST /api/clear
```

## Running

```bash
npm install
npm start              # starts on PORT env var or 8080
```

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Serve index.html |
| GET | `/api/today` | Return all slot data as JSON |
| POST | `/api/toggle` | Toggle a name in a slot |
| POST | `/api/register` | Register/validate a nickname |
| POST | `/api/clear` | Clear all entries |
| GET | `/api/events` | SSE stream for real-time updates |

## Key Conventions

- Slots are 30-min intervals from 09:00 to 17:30 (18 slots)
- Names are max 12 characters, trimmed, validated server-side
- SSE broadcasts full slot state on every toggle (simple, no diffing)
- `ensureToday()` deletes entries for past dates on each request
- OpenShift CronJob clears all data daily via `/api/clear`
- Frontend stores user's name in `localStorage` under key `pp-name`
- Optional Slack notifications via `SLACK_WEBHOOK_URL` (immediate on toggle)

## Deployment

- Container runs as non-root user 1001 (OpenShift requirement)
- Health probes hit `GET /api/today`
- Single replica only — SQLite on PVC does not support horizontal scaling
- OpenShift Route uses TLS edge termination
