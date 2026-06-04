/**
 * Pure scenario math shared by the UI and covered by unit tests.
 * Keeping these out of components makes the engine↔UI contract verifiable.
 */

/** Average H3 resolution-9 cell area (km²). */
export const H3_RES9_AREA_KM2 = 0.1054;

/** Recommendation features with rank within the chosen budget (1..budget). */
export function selectByBudget(features, budget) {
  if (!Array.isArray(features)) return [];
  return features.filter((f) => (f?.properties?.rank ?? Infinity) <= budget);
}

/** Coverage fraction at a given budget, clamped to the available steps. */
export function coverageAt(steps, budget) {
  if (!Array.isArray(steps) || steps.length === 0) return 0;
  const before = steps[0] ?? 0;
  if (budget <= 0) return before;
  const i = Math.min(budget, steps.length - 1);
  return steps[i] ?? before;
}

/** Approximate city area from H3 cell count. */
export function cityAreaKm2(nGridCells) {
  return Math.round((nGridCells ?? 0) * H3_RES9_AREA_KM2);
}

/** Existing-asset density per 10 km² (0 when area is unknown). */
export function assetDensityPer10Km2(nExisting, nGridCells) {
  const area = cityAreaKm2(nGridCells);
  if (!area) return 0;
  return ((nExisting ?? 0) / area) * 10;
}

// ── what-if planner (client-side straight-line estimate) ─────────────────────
// The browser can't run the walking-network model, so the interactive planner
// estimates reach with a straight line shrunk by the same circuity factor the
// engine uses (≈1.35), and frames the result as "service gap closed" — the gap
// is exactly what GapScore measures, so this stays honest about what it shows.

export const SERVICE_RADIUS_M = 500;
export const CIRCUITY = 1.35;
/** Straight-line radius that approximates SERVICE_RADIUS_M on foot. */
export const REACH_M = SERVICE_RADIUS_M / CIRCUITY;
/** GapScore above this ≈ a cell beyond the service distance of existing assets. */
export const GAP_THRESHOLD = 0.5;

/** Average of a polygon's outer-ring vertices → [lng, lat]. Good enough for hex cells. */
export function ringCentroid(ring) {
  if (!Array.isArray(ring) || ring.length === 0) return null;
  // drop the closing vertex if the ring is explicitly closed
  const pts = ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring;
  let sx = 0, sy = 0;
  for (const [x, y] of pts) { sx += x; sy += y; }
  return [sx / pts.length, sy / pts.length];
}

/** Centroids of analysis cells whose GapScore exceeds the threshold (underserved). */
export function underservedCentroids(unitsFeatures, gapThreshold = GAP_THRESHOLD) {
  if (!Array.isArray(unitsFeatures)) return [];
  const out = [];
  for (const f of unitsFeatures) {
    if ((f?.properties?.GapScore ?? 0) <= gapThreshold) continue;
    const ring = f?.geometry?.coordinates?.[0];
    const c = ringCentroid(ring);
    if (c) out.push(c);
  }
  return out;
}

const R_EARTH = 6371000;
const toRad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in metres between two [lng, lat] points. */
export function haversineMeters(a, b) {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const la1 = toRad(a[1]);
  const la2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Share of underserved cells brought within straight-line reach of any site.
 * `cells` and `sites` are [lng, lat] arrays. Returns { reached, total, pct }.
 * A cheap lat/lng bounding-box prefilter keeps this fast on big grids.
 */
export function gapClosure(cells, sites, radiusM = REACH_M) {
  const total = cells.length;
  if (total === 0 || sites.length === 0) return { reached: 0, total, pct: 0 };
  const dLat = radiusM / 111320; // metres per degree latitude
  let reached = 0;
  for (const cell of cells) {
    const dLng = radiusM / (111320 * Math.max(0.01, Math.cos(toRad(cell[1]))));
    let hit = false;
    for (const s of sites) {
      if (Math.abs(s[1] - cell[1]) > dLat || Math.abs(s[0] - cell[0]) > dLng) continue;
      if (haversineMeters(cell, s) <= radiusM) { hit = true; break; }
    }
    if (hit) reached += 1;
  }
  return { reached, total, pct: total ? reached / total : 0 };
}
