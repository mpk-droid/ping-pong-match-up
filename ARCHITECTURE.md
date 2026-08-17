# Architecture

## System Design

```
┌─────────────────────────────────────────────┐
│                  Browser                     │
│                                              │
│  localStorage ──► name (pp-name)             │
│                                              │
│  index.html                                  │
│  ├── on load: EventSource(/api/events)       │
│  ├── on SSE message: re-render grid          │
│  ├── on notify event: browser Notification   │
│  ├── on clear event: re-render empty grid    │
│  └── on slot click: POST /api/toggle         │
└──────────────┬───────────────────────────────┘
               │ HTTP + SSE
┌──────────────▼───────────────────────────────┐
│              Express Server                   │
│                                               │
│  Static files ◄── public/                     │
│                                               │
│  SQLite (better-sqlite3)                      │
│  ┌─────────────────────────────┐              │
│  │ entries: date, slot, name    │              │
│  │ users: name, created         │              │
│  └─────────────────────────────┘              │
│                                               │
│  SSE clients[] ──► broadcast on every toggle  │
│  ensureToday() ──► delete entries != today    │
│  CronJob ──► POST /api/clear daily            │
│  SLACK_WEBHOOK_URL ──► immediate notifications on toggle │
└───────────────────────────────────────────────┘
```

## Data Flow

### Toggle a slot

1. User taps a slot cell in the browser
2. Frontend sends `POST /api/toggle` with `{name, slot}`
3. Server validates name (non-empty, max 12 chars) and slot (must be a known slot key)
4. Server inserts or removes the row in SQLite (toggle behavior)
5. Server posts Slack/browser notification based on slot count, then broadcasts full slot state to SSE clients
6. Every connected browser receives the SSE message and re-renders

### Real-time sync (SSE)

- On page load, frontend opens `EventSource('/api/events')`
- Server immediately sends current state as the first SSE message
- On every toggle, server broadcasts to all clients
- Custom events: `notify` (notification text), `clear` (daily reset)
- If a client disconnects, it's removed from the clients array on the `close` event
- Full state is sent each time (no diffs)

### Daily reset

Two mechanisms:

1. **CronJob**: OpenShift CronJob POSTs `/api/clear` daily, wiping all entries and broadcasting a `clear` SSE event.

2. **Date guard**: `ensureToday()` runs on API requests and deletes entries where `date != today`. Handles overnight runs and date changes without waiting for the CronJob.

## Frontend Architecture

Single HTML file with inline `<script>`. No components, no state management library.

- **State**: `slots` object (from SSE) and `myName` (from localStorage)
- **Rendering**: `render()` rebuilds the grid DOM on every SSE update
- **Slot styling**:
  - `.past` — slot time has passed, not clickable
  - `.mine` — blue border/background on slots containing the user's name
  - `.match` — green background on slots with 2+ people
- **Name prompt**: modal overlay shown on first visit or when "change" is clicked
- **Notifications**: browser `Notification` API on SSE `notify` events

## Deployment Architecture

```
┌─ OpenShift ──────────────────────────────┐
│                                           │
│  Route (TLS edge) ──► Service:8080        │
│                          │                │
│                    Deployment (1 replica)  │
│                    ┌──────────────────┐    │
│                    │ node:20-alpine   │    │
│                    │ USER 1001        │    │
│                    │ node server.js   │    │
│                    │ PVC: /data       │    │
│                    │ port 8080        │    │
│                    └──────────────────┘    │
│                                           │
│  CronJob ──► POST /api/clear              │
│                                           │
│  Probes:                                  │
│    readiness: GET /api/today (3s, 10s)    │
│    liveness:  GET /api/today (5s, 15s)    │
│                                           │
│  Resources:                               │
│    requests: 64Mi / 50m CPU               │
│    limits:   128Mi / 200m CPU             │
└───────────────────────────────────────────┘
```

## Constraints & Trade-offs

| Decision | Rationale |
|----------|-----------|
| SQLite on PVC | Persists across pod restarts within the day. Still ephemeral by design — cleared daily. |
| Single replica | SQLite file on RWO PVC can't be shared across pods. Acceptable for a low-traffic office tool. |
| Full-state broadcast | 18 slots with a few names each is small. Diffing would add complexity for no real gain. |
| No auth | Friction is the enemy. Self-reported nicknames are fine for an office. |
| Vanilla JS, no framework | The UI is a list of slots. No build step means faster deploys and simpler debugging. |
| SSE over WebSocket | SSE is simpler (built-in reconnection, HTTP/1.1). Server-to-client push only — client actions use REST. |
| Names max 12 chars | Prevents layout breakage. Enforced server-side and in HTML maxlength. |
