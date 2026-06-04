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
