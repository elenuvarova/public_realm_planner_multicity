# Full-Stack Template

A minimal React + Node.js starter that deploys for free on Render. The frontend is built with React 18 and Vite 5; the backend runs Express on Node.js with Sequelize as the only database access layer. Locally it uses SQLite (no install required); on Render it switches automatically to the free Postgres instance provisioned by the Blueprint.

## Stack

- **Frontend:** React 18, Vite 5 (JavaScript)
- **Backend:** Node.js, Express, ES modules
- **Database:** Sequelize ORM — SQLite locally, PostgreSQL on Render (same `DATABASE_URL` env var, zero config changes)
- **Deploy:** Render free tier (web service + Postgres), Docker build handled by Render

## Project structure

```
.
├── backend/
│   ├── package.json
│   ├── server.js
│   └── db.js
├── frontend/
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       └── styles.css
├── Dockerfile
├── render.yaml
├── .env.example
├── .gitignore
├── .dockerignore
└── README.md
```

## Local development

No database to install — SQLite is built in. Open two terminals:

**Terminal 1 — backend**
```bash
cd backend
npm install
npm run dev
```

**Terminal 2 — frontend**
```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The frontend dev server proxies `/api` requests to the backend on port 3001.

## Deploy to Render

1. Push this repo to GitHub.
2. In Render, go to **New → Blueprint** and connect your repository.
3. Render reads `render.yaml` and provisions a free Postgres database and a Docker-based web service. `DATABASE_URL` is wired automatically — you don't copy/paste anything.

**Free tier notes:**
- The web service sleeps after inactivity; the first request after sleep takes ~30 seconds.
- Render's free Postgres instances expire after 30 days and must be recreated.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/hello` | Returns `{ message: "Hello from the backend 👋" }` |
| GET | `/api/health` | Returns `{ status: "ok", db: "sqlite" \| "postgres" }` |
| GET | `*` | Serves the built React app (production only) |
