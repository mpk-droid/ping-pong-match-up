# Ping Pong Availability Board

## Project Overview

Office ping pong availability board. People mark 30-minute time slots when they're free to play. Real-time sync across all browsers via SSE. No auth, no database — in-memory state that clears daily at 5 PM.

## Tech Stack

- **Runtime**: Node.js (no build step)
- **Server**: Express 5 serving static files + JSON API + SSE
- **Frontend**: Vanilla HTML/CSS/JS (no framework, no bundler)
- **State**: In-memory object, no database
- **Deployment**: Docker container on OpenShift

## Project Structure

```
server.js              — Express server, API routes, SSE broadcast, daily clear
public/index.html      — Single-page frontend with inline JS
public/style.css       — Responsive styles, dark mode via prefers-color-scheme
Dockerfile             — Node 20 Alpine, non-root (UID 1001)
openshift/deployment.yaml — Deployment + Service + Route
```

## Running

```bash
npm start              # starts on PORT env var or 8080
```

## API Endpoints

| Method | Path           | Purpose                          |
|--------|----------------|----------------------------------|
| GET    | /              | Serve index.html                 |
| GET    | /api/today     | Return all slot data as JSON     |
| POST   | /api/toggle    | Toggle a name in a slot          |
| GET    | /api/events    | SSE stream for real-time updates |

## Key Conventions

- Slots are 30-min intervals from 09:00 to 16:30 (16 total, covering 9 AM – 5 PM)
- Names are max 20 characters, trimmed, validated server-side
- SSE broadcasts full slot state on every toggle (simple, no diffing)
- `ensureToday()` guards every request — if date changed, state resets
- `scheduleDailyClear()` wipes state at 5 PM and re-schedules for next day
- Frontend stores user's name in `localStorage` under key `pp-name`
- No authentication — identity is self-reported nickname only

## Deployment

- Container runs as non-root user 1001 (OpenShift requirement)
- Health probes hit `GET /api/today`
- Single replica only — in-memory state doesn't support horizontal scaling
- OpenShift Route uses TLS edge termination
