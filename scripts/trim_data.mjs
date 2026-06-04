#!/usr/bin/env node
/**
 * One-off post-processor for the already-generated static GeoJSON under
 * frontend/public/data. Re-running the Python engine isn't feasible here (needs
 * OSMnx + source datasets), so we transform the committed outputs in place to
 * match what engine/export.py now produces for fresh runs:
 *   - units.geojson      : keep {Score,GapScore,EquityIndex}, round coords to 5dp
 *   - demand_pois.geojson: keep {poi_type},                    round coords to 5dp
 *   - existing_assets    : keep {name,accessible,source},      round coords to 5dp
 *   - selected.geojson   : keep {id,rank,Score,GapScore,EquityIndex}, round to 6dp
 *   - scenario.json      : drop the unused `demand` + `candidates` blobs
 *   - candidates.geojson : delete (never fetched by the frontend)
 * Idempotent: safe to run repeatedly.
 */
import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from "fs";
import { join } from "path";

const ROOT = join(process.cwd(), "frontend/public/data");

const roundCoords = (c, p) => {
  if (typeof c === "number") return Math.round(c * 10 ** p) / 10 ** p;
  if (Array.isArray(c)) return c.map((x) => roundCoords(x, p));
  return c;
};

const pick = (obj, keys) => {
  const out = {};
  for (const k of keys) if (obj && obj[k] !== undefined && obj[k] !== null) out[k] = obj[k];
  return out;
};

function trimGeojson(path, keepProps, precision) {
  if (!existsSync(path)) return 0;
  const before = readFileSync(path).length;
  const gj = JSON.parse(readFileSync(path, "utf8"));
  for (const f of gj.features || []) {
    if (f.properties) f.properties = pick(f.properties, keepProps);
    if (f.geometry && f.geometry.coordinates)
      f.geometry.coordinates = roundCoords(f.geometry.coordinates, precision);
  }
  writeFileSync(path, JSON.stringify(gj));
  return before - readFileSync(path).length;
}

function trimScenario(path) {
  if (!existsSync(path)) return 0;
  const before = readFileSync(path).length;
  const s = JSON.parse(readFileSync(path, "utf8"));
  delete s.demand;
  delete s.candidates;
  writeFileSync(path, JSON.stringify(s));
  return before - readFileSync(path).length;
}

let saved = 0;
let dirs = 0;
const cities = readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory());
for (const city of cities) {
  const cityDir = join(ROOT, city.name);
  const assets = readdirSync(cityDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const asset of assets) {
    const d = join(cityDir, asset.name);
    dirs++;
    saved += trimGeojson(join(d, "units.geojson"), ["Score", "GapScore", "EquityIndex"], 5);
    saved += trimGeojson(join(d, "demand_pois.geojson"), ["poi_type"], 5);
    saved += trimGeojson(join(d, "existing_assets.geojson"), ["name", "accessible", "source"], 5);
    saved += trimGeojson(join(d, "selected.geojson"), ["id", "rank", "Score", "GapScore", "EquityIndex"], 6);
    saved += trimScenario(join(d, "scenario.json"));
    const cand = join(d, "candidates.geojson");
    if (existsSync(cand)) {
      saved += readFileSync(cand).length;
      rmSync(cand);
    }
  }
}
console.log(`Processed ${dirs} city/asset dirs. Reclaimed ${(saved / 1024 / 1024).toFixed(1)} MB.`);
