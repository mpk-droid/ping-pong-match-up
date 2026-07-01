# Ping Pong Availability Board

A dead-simple web app for the office ping pong room. Mark when you're free to play, see who else is available, find a match.

## How It Works

1. Open the page, enter a nickname (saved in your browser)
2. Tap any 30-minute slot to mark yourself available
3. See who else is available in real time
4. When 2+ people are in the same slot — it's a match!
5. Tap again to remove yourself
6. All data clears automatically at 5 PM

## Quick Start

```bash
npm install
npm start
```

Open [http://localhost:8080](http://localhost:8080)

## Deploy to OpenShift

Build and push the container image:

```bash
# Using podman/docker locally
podman build -t ping-pong .
podman tag ping-pong <registry>/ping-pong:latest
podman push <registry>/ping-pong:latest
```

Update the image reference in `openshift/deployment.yaml`, then apply:

```bash
oc apply -f openshift/deployment.yaml
```

Or use OpenShift's built-in source-to-image:

```bash
oc new-build --binary --name=ping-pong --strategy=docker
oc start-build ping-pong --from-dir=. --follow
oc apply -f openshift/deployment.yaml
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT`   | `8080`  | Server listen port |

## Project Structure

```
server.js                  — Node.js server (Express, SSE, in-memory store)
public/index.html          — Frontend (vanilla HTML/JS)
public/style.css           — Styles (responsive, dark mode)
Dockerfile                 — Container image (Node 20 Alpine, non-root)
openshift/deployment.yaml  — Deployment + Service + Route
```

## Features

- **One-tap availability**: tap a slot to toggle yourself in/out
- **Real-time sync**: updates appear instantly across all browsers (SSE)
- **Match detection**: slots with 2+ people are highlighted green
- **Current time indicator**: orange border on the active time slot
- **Mobile-friendly**: designed for phone screens first
- **Dark mode**: follows system preference
- **Privacy**: all data clears at 5 PM daily, no data stored on disk
- **Zero accounts**: just a nickname saved in your browser

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/today` | Get all slots and who's in them |
| `POST` | `/api/toggle` | Add/remove yourself from a slot |
| `GET` | `/api/events` | SSE stream for real-time updates |

### Toggle example

```bash
curl -X POST http://localhost:8080/api/toggle \
  -H 'Content-Type: application/json' \
  -d '{"name": "Alice", "slot": "10:00"}'
```
