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
│  └── on slot click: POST /api/toggle         │
└──────────────┬───────────────────────────────┘
               │ HTTP + SSE
┌──────────────▼───────────────────────────────┐
│              Express Server                   │
│                                               │
│  Static files ◄── public/                     │
│                                               │
│  In-memory store                              │
│  ┌─────────────────────────────┐              │
│  │ { date: "2026-07-01",      │              │
│  │   slots: {                  │              │
│  │     "09:00": ["Alice"],     │              │
│  │     "09:30": ["Alice","Bob"]│              │
│  │     ...16 slots total       │              │
│  │   }                         │              │
│  │ }                           │              │
│  └─────────────────────────────┘              │
│                                               │
│  SSE clients[] ──► broadcast on every toggle  │
│  scheduleDailyClear() ──► wipe at 5 PM        │
│  ensureToday() ──► wipe on date change        │
└───────────────────────────────────────────────┘
```

## Data Flow

### Toggle a slot

1. User taps a slot cell in the browser
2. Frontend sends `POST /api/toggle` with `{name, slot}`
3. Server validates name (non-empty, max 20 chars) and slot (must be a known slot key)
4. Server adds or removes the name from the slot array (toggle behavior)
5. Server broadcasts the full slot state to all connected SSE clients
6. Every connected browser receives the SSE message and re-renders

### Real-time sync (SSE)

- On page load, frontend opens `EventSource('/api/events')`
- Server immediately sends current state as the first SSE message
- On every toggle by any user, server broadcasts to all clients
- If a client disconnects, it's removed from the clients array on the `close` event
- Full state is sent each time (no diffs) — the payload is small (~500 bytes)

### Daily reset

Two mechanisms ensure data doesn't persist:

1. **Scheduled clear**: `scheduleDailyClear()` computes milliseconds until 5 PM and sets a `setTimeout`. When it fires, it replaces the store with an empty one and broadcasts the cleared state. Then it reschedules for the next day's 5 PM.

2. **Date guard**: `ensureToday()` runs on every API request. If the server's date no longer matches `store.date`, the store is replaced. This handles cases where the server runs overnight or across a restart.

## Frontend Architecture

Single HTML file with inline `<script>`. No components, no state management library.

- **State**: `slots` object (from SSE) and `myName` (from localStorage)
- **Rendering**: `render()` rebuilds the grid DOM on every SSE update. Simple and correct — 16 slots is trivial to re-render.
- **Slot styling**:
  - `.current` — orange border on the slot matching the current 30-min window
  - `.mine` — blue border/background on slots containing the user's name
  - `.match` — green background on slots with 2+ people
- **Name prompt**: modal overlay shown on first visit or when "change" is clicked

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
│                    │ port 8080        │    │
│                    └──────────────────┘    │
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
| In-memory store, no DB | Simplicity. Data is ephemeral by design — clears daily. No persistence needed. |
| Single replica | In-memory state can't be shared across pods. Acceptable for a low-traffic office tool. |
| Full-state broadcast | 16 slots with a few names each is ~500 bytes. Diffing would add complexity for no real gain. |
| No auth | Friction is the enemy. The whole point is one-tap availability. Self-reported nicknames are fine for an office. |
| Vanilla JS, no framework | The UI is a list of 16 cells. React/Vue would be overhead. No build step means faster deploys and simpler debugging. |
| SSE over WebSocket | SSE is simpler (built-in reconnection, works over HTTP/1.1, no library needed). Server-to-client push is the only direction needed — client actions go through REST. |
| Names max 20 chars | Prevents layout breakage and abuse. Enforced server-side. |
