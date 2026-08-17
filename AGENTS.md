# Ping Pong Availability Board

Office ping pong availability board. People mark 30-minute slots when they're free to play. Real-time sync across browsers via SSE.

## Tech Stack

- **Runtime**: Node.js (no build step)
- **Server**: Express 5 — static files, JSON API, SSE
- **Frontend**: Vanilla HTML/CSS/JS (no framework, no bundler)
- **State**: SQLite via `better-sqlite3` (local: `data/pingpong.db`)
- **Deploy**: Docker on OpenShift (single replica + PVC)

## Quick Start

```bash
npm install
npm start    # http://localhost:8080
```

## Project Structure

```
server.js                  — Express server, API, SSE, SQLite, Slack notifications
public/index.html          — Single-page frontend (inline JS)
public/style.css           — Responsive styles, dark mode via prefers-color-scheme
Dockerfile                 — Node 20 Alpine, non-root (UID 1001)
openshift/deployment.yaml  — Deployment, Service, Route, PVC
openshift/cronjob.yaml     — Daily clear via POST /api/clear
```

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Serve index.html |
| GET | `/api/today` | Return all slot data as JSON |
| POST | `/api/toggle` | Toggle a name in a slot |
| POST | `/api/register` | Register/validate a nickname |
| POST | `/api/clear` | Clear all entries (CronJob) |
| GET | `/api/events` | SSE stream for real-time updates |

SSE event types: default `message` (slot state), `notify` (browser notification text), `clear` (daily reset).

## Key Conventions

- Slots: 30-min intervals from 09:00 to 17:30 (18 slots)
- Names: max 12 characters, trimmed, validated server-side; case-insensitive duplicate check
- Max 20 names per slot; toggle rate-limited (30/min)
- SSE broadcasts full slot state on every toggle (no diffing)
- `ensureToday()` deletes entries for past dates on each request
- Frontend stores user's name in `localStorage` under key `pp-name`
- No authentication — identity is self-reported nickname only
- Optional `SLACK_WEBHOOK_URL` for immediate Slack on tap + scheduled summaries (9/11/1/3/5/6 PM Eastern)
- Toggle audit log: `toggle <name> <slot> add|remove` — debug Slack via `oc logs deployment/ping-pong -n pk-individual --timestamps`

## Deployment Notes

- Container runs as non-root user 1001 (OpenShift requirement)
- Health probes hit `GET /api/today`
- Single replica only — SQLite on PVC does not support horizontal scaling
- OpenShift Route uses TLS edge termination
- `DB_PATH` env var sets database location (default `/data/pingpong.db` in cluster)

## Editing Guidelines

- Keep changes minimal — no frameworks, no build step, no unnecessary abstractions
- Match existing patterns in `server.js` and inline JS in `index.html`
- Update docs (`AGENTS.md`, `CLAUDE.md`, `ARCHITECTURE.md`) when changing architecture
