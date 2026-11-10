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

## Routes

- `/station` – guest kiosk: selfie (auto face alignment) → pick a character with a live 3D preview → ticket number
- `/main` – parade wall. `?debug=1` or press **D** for the operator panel; `?calibrateCharacter=1` for calibration;
  `?danceBreakEvery=15` to trigger the group "Dance Break" every 15 s while testing (default: every 35–55 s)
- `/admin` – character lineup: all four characters wearing the latest selfie

## Parade wall

The wall rotates through four procedural worlds: The Moon, Mars, Crystal Planet and Neon Jungle (galaxy sky,
planets, shooting stars and a low-poly ground with props), all generated in code with no video files.
The world changes every 2 minutes with a "Next stop" banner (calibration: Change; `?worldEvery=20` seconds for
testing). Add or edit worlds in `apps/frontend/src/components/main/worlds.js`. Switch back to the video
playlist in calibration (Background: Videos). Each character dances its own random dance (`components/avatar/danceMoves.js`),
and every 35–55 s a "Dance Break" stops the whole parade for a moment.

## 3D characters

All four characters share one rigged Meshy skeleton and its animations (idle/wave/dance/pose). The Alien is
the sculpted Meshy model; the Astronaut, Human and Robot are lightweight code-built bodies
(`apps/frontend/src/components/avatar/proceduralBodies.js`, designed from `assets/reference/characters`),
one merged mesh and one draw call each. The guest's selfie is aligned with on-device face detection
(MediaPipe, bundled locally) and shown on a 3D head attached to the `Head` bone. Source models live in
`assets/models/source/`; run `npm run optimize:models` after replacing them
(see `assets/models/source/alien/README.txt`).
