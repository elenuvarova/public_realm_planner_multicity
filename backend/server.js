import express from "express";
import compression from "compression";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// Behind Coolify/Traefik — trust the first proxy so req.protocol/secure and
// rate-limit client IPs are correct (and HSTS upgrades behave).
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      // A custom `directives` object REPLACES helmet's defaults wholesale, so
      // safe defaults like object-src/frame-ancestors must be restated here.
      directives: {
        "default-src": ["'self'"],
        // CARTO basemap tiles (see frontend/src/components/MapView.jsx) are
        // fetched as <img> by Leaflet, hence cartocdn in img-src.
        "img-src": ["'self'", "data:", "https://*.basemaps.cartocdn.com"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "connect-src": ["'self'", "https://*.basemaps.cartocdn.com"],
        "script-src": ["'self'"],
        "object-src": ["'none'"],
        "frame-ancestors": ["'self'"],
      },
    },
  })
);
app.use(compression());
app.use(express.json({ limit: "10kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

if (process.env.NODE_ENV === "production") {
  const publicDir = path.join(__dirname, "public");
  app.use(
    express.static(publicDir, {
      maxAge: "1y", // Vite content-hashes asset filenames → safe to cache long
      setHeaders: (res, filePath) => {
        // ...but index.html must always be re-validated so new deploys appear.
        if (path.basename(filePath) === "index.html") {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    })
  );
  // SPA fallback — registered AFTER /api routes so it never shadows them.
  app.get("*", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(publicDir, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`server running on port ${PORT}`);
});
