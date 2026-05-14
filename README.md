# Moonwalk Selfie Parade

Step 1 foundation: offline LAN-ready project structure with separate frontend, server, and Electron apps.

## Folder Structure

```text
moonwalk-selfie-parade/
  apps/
    frontend/
    server/
    electron/
  storage/
    faces/
  assets/
    models/
    textures/
    backgrounds/
    effects/
```

## Install Dependencies (per app)

```bash
npm --prefix apps/frontend install
npm --prefix apps/server install
npm --prefix apps/electron install
```

Or run all:

```bash
npm run install:all
```

## Basic Local Run Commands

```bash
npm --prefix apps/server run dev
npm --prefix apps/frontend run dev
npm --prefix apps/electron run dev
```

## Offline Rule

- No cloud services required.
- Server runs on LAN (example `192.168.1.100:3001`).
- Frontend and Electron connect to local server IP only.
# Galaxy-Walk
