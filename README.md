# Public-Realm Planner (multi-city)

A static-data SPA that maps service gaps for public-realm assets (toilets, benches,
waste bins, drinking water, fitness stations, bike parking, defibrillators, dog
areas) across multiple cities, and recommends where to add new ones. The web app
reads pre-computed GeoJSON — **there is no database and no runtime backend logic
beyond serving files**. All scoring/optimisation happens offline in the Python
engine; the deployed service only ships the results.

## Architecture

```
            OFFLINE (CI / local)                     RUNTIME (Coolify)
  ┌───────────────────────────────┐         ┌──────────────────────────────┐
  │ engine/  (Python, OSMnx, ...)  │         │ backend/  Express on :3001    │
  │   run via                      │  GeoJSON │   - helmet (CSP/HSTS/...)     │
  │   .github/workflows/engine.yml │ ───────► │   - compression (gzip)        │
  │   → writes GeoJSON into        │  commit  │   - GET /api/health           │
  │   frontend/public/data/        │          │   - serves built SPA + data   │
  └───────────────────────────────┘         │   ZERO outbound calls at run  │
                                              └──────────────────────────────┘
```

- **Frontend:** React 18 + Vite 5, Leaflet / react-leaflet. Reads GeoJSON from
  `frontend/public/data/<city>/<asset>/…` (shipped as static files).
- **Backend:** Node.js + Express (ES modules). A thin static server: it adds
  security headers (`helmet`), gzip (`compression`), exposes `GET /api/health`,
  and in production serves the built SPA and its data. **No database, no ORM,
  no external API calls at runtime.**
- **Engine:** Python (`engine/`, deps in `requirements.txt`). Run offline — see
  `.github/workflows/engine.yml` — to (re)generate the GeoJSON that the web app
  ships. Outputs are committed into `frontend/public/data/`.
- **Deploy:** Docker multi-stage build on **Coolify**, live at
  **https://city-planner.ontwrpn.com**.

## Map data

Basemap tiles are CARTO ("light_all") over OpenStreetMap data. These are the only
remote requests the *browser* makes; the *server* makes none. The CSP in
`backend/server.js` allows `https://*.basemaps.cartocdn.com` accordingly.

## Project structure

```
.
├── backend/
│   ├── package.json
│   └── server.js          # thin Express static server on :3001
├── frontend/
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   ├── public/
│   │   └── data/          # committed GeoJSON the app ships (engine output)
│   └── src/               # React + Leaflet SPA
├── engine/                # Python engine (offline GeoJSON generation)
├── requirements.txt
├── .github/workflows/
│   ├── engine.yml         # offline data refresh (Python)
│   └── docker-ci.yml      # builds + boots the real image, asserts health + SPA
├── Dockerfile             # multi-stage: build frontend → backend deps → runtime
├── .env.example
├── .gitignore
├── .dockerignore
└── README.md
```

## Local development

No database to install — there isn't one. Open two terminals:

**Terminal 1 — backend**
```bash
cd backend
npm ci
npm run dev        # Express on http://localhost:3001
```

**Terminal 2 — frontend**
```bash
cd frontend
npm ci
npm run dev        # Vite on http://localhost:5173
```

Open http://localhost:5173. The Vite dev server proxies `/api` to the backend on
port 3001. In dev, the SPA loads GeoJSON directly from `frontend/public/data/`.

### Refreshing the engine data (optional)

```bash
python -m engine.run --city paris --asset toilets --solver greedy
# or regenerate everything:
python -m engine.run --all --solver greedy
```

This writes GeoJSON into `frontend/public/data/`. The same thing runs in CI via
`.github/workflows/engine.yml` (monthly + manual dispatch).

## Production build (what Coolify runs)

```bash
docker build -t public-realm-planner .
docker run -p 3001:3001 -e NODE_ENV=production public-realm-planner
```

`NODE_ENV=production` makes the backend serve the built SPA and its data. The
image runs `node server.js` as the non-root `node` user, with a `wget`-based
`HEALTHCHECK` against `/api/health`.

## Deploy (Coolify)

Deploy is auto-triggered on push to GitHub via Coolify (Docker / Dockerfile
build). Live at **https://city-planner.ontwrpn.com**.

- The Express app is the edge (no nginx): it sets CSP/HSTS/security headers via
  `helmet`, gzips via `compression`, long-caches Vite content-hashed assets, and
  serves `index.html` with `Cache-Control: no-cache`.
- `app.set("trust proxy", 1)` because it runs behind Coolify/Traefik.
- Environment variables are set in Coolify (`NODE_ENV=production`, `PORT=3001`).
  There are **no secrets** — no database URL, no API keys.

## CI

- `.github/workflows/docker-ci.yml` — installs frontend deps with `npm ci`, runs
  the Vitest suite and `vite build`, then builds the **real** Docker image, boots
  it, polls the container healthcheck, and asserts `GET /api/health` → 200 and the
  SPA root → 200.
- `.github/workflows/engine.yml` — offline Python data refresh (separate from CI).

## Endpoints

| Method | Path          | Description                                            |
|--------|---------------|--------------------------------------------------------|
| GET    | `/api/health` | Returns `{ status: "ok" }`                             |
| GET    | `*`           | Serves the built React SPA (production only)           |
