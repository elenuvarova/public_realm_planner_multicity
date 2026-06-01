import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import sequelize, { dbKind } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

app.get("/api/health", async (req, res) => {
  // Only verify the database when an external Postgres is configured. Without
  // DATABASE_URL the app still serves its static datasets fine, and the SQLite
  // driver isn't built into the production (alpine) image — so don't hard-fail.
  if (dbKind === "postgres") {
    try {
      await sequelize.authenticate();
      return res.json({ status: "ok", db: "postgres" });
    } catch (err) {
      return res.status(500).json({ status: "error", db: "postgres", message: err.message });
    }
  }
  res.json({ status: "ok", db: "none" });
});

app.get("/api/hello", (_req, res) => {
  res.json({ message: "Hello from the backend 👋" });
});

if (process.env.NODE_ENV === "production") {
  const publicDir = path.join(__dirname, "public");
  app.use(express.static(publicDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`server running on port ${PORT}  db: ${dbKind}`);
});
